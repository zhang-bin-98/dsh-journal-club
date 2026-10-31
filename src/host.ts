import { realpath, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { basename, dirname, relative, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { FigureEdit, FigureEditResult, PageInfo, PanelCrop, PanelCropResult } from './types.ts'
import { updateFiguresFile } from './figures/figuresStore.ts'
import { cropFigures } from './tools/crop.ts'
import { composePanels, bytesDigest, groupsDigest } from './tools/composePanels.ts'
import { readGroups } from './groups.ts'
import { parseFiguresJson } from './figures/schema.ts'
import { validateGeometry, type CompositionSave, type CompositionState, type CompositionLayout } from './layout/composition.ts'
import { assertInsideDirectory, assertSafeAssetId, stableStem, pageSuffix } from './paths.ts'
import { PdfFile } from './pdf/pdf.ts'
import { parseDeck, normalizeAssetReference } from './validate/markdown.ts'

function sessionCwd(ctx: Context, id: string): string {
  const session = ctx.sessions.get(id as SessionId)
  if (!session?.header.cwd) throw new Error('会话未加载或没有工作目录')
  return session.header.cwd
}

declare module '@deepseek-ai/cordis' {
  interface Context { journalClub: JournalClubService }
}

/** Resolve the actual file within the session workspace, including symlink targets. */
export async function projectFile(cwd: string, path: string): Promise<string> {
  const root = await realpath(cwd)
  const target = resolve(root, path)
  assertInsideDirectory(target, root)
  const canonical = await realpath(target)
  assertInsideDirectory(canonical, root)
  return canonical
}

/** Thin host bridge; editing uses the same CAS service as the agent tool. */
export class JournalClubService extends TypertRemoteService {
  static inject = ['sessions']
  constructor(ctx: Context) { super(ctx, 'journalClub') }

  @Remote({ resources: { session: (sessionId) => sessionId as SessionId } })
  async compositionState(sessionId: string, project: string, signal: AbortSignal): Promise<CompositionState> {
    const cwd = sessionCwd(this.ctx, sessionId)
    const path = await projectFile(cwd, resolve(cwd, project, 'figures.json'))
    const root = dirname(path), groupsPath = resolve(root, 'groups.json')
    try { await projectFile(cwd, groupsPath) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    const digest = await groupsDigest(groupsPath)
    const groups = await readGroups(groupsPath)
    if (await groupsDigest(groupsPath) !== digest) throw new Error('图组文件读取期间发生变化，请重试')
    const figures = parseFiguresJson(await readFile(path, 'utf8'))
    const assets: CompositionState['assets'] = [], warnings: string[] = []
    for (const figure of figures.figures) for (const panel of figure.panels) {
      signal.throwIfAborted()
      if (!panel.asset) { warnings.push(`${panel.id} 尚未裁切`); continue }
      try {
        const assetPath = await projectFile(root, panel.asset)
        const bytes = await readFile(assetPath), metadata = await sharp(bytes).metadata()
        if (!metadata.width || !metadata.height) throw new Error('图片尺寸缺失')
        assets.push({ id: panel.id, asset: panel.asset, label: `${figure.label ?? figure.id} · ${panel.label ?? '整图'}`, width: metadata.width, height: metadata.height, digest: bytesDigest(bytes) })
      } catch (e) { warnings.push(`${panel.id}：${(e as Error).message}`) }
    }
    const existing = []
    for (const group of groups.groups) {
      try { await projectFile(root, group.asset); existing.push(group) }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    }
    const entries = existing.map(group => {
      const currentInputs = `sha256:${bytesDigest(group.members.map(id => `${id}:${assets.find(a => a.id === id)?.digest ?? 'missing'}`).join('\n'))}`
      const stale = group.inputs_digest !== currentInputs
      if (group.layout === undefined) return { ...group, stale, layout: undefined }
      const layout = group.layout as CompositionLayout
      if (!layout || !['manual', 'grid', 'rows', '1+2'].includes(layout.kind)) throw new Error(`图组布局格式无效：${group.id}`)
      return { ...group, stale, layout: { kind: layout.kind, geometry: validateGeometry(layout.geometry, group.members) } }
    })
    let order: string[] | undefined
    try {
      const deck = await readFile(await projectFile(root, 'deck.md'), 'utf8')
      const byAsset = new Map(entries.map(group => [normalizeAssetReference(group.asset), group.id]))
      order = [...new Set(parseDeck(deck).pages.flatMap(page => page.images.flatMap(image => {
        const id = byAsset.get(normalizeAssetReference(image.path))
        return id ? [id] : []
      })))]
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    return { groups: entries, order, digest, assets, warnings }
  }

  @Remote({ resources: { session: (sessionId) => sessionId as SessionId } })
  async saveComposition(sessionId: string, request: CompositionSave, signal: AbortSignal): Promise<{ digest: string; asset: string }> {
    const cwd = sessionCwd(this.ctx, sessionId)
    const root = dirname(await projectFile(cwd, resolve(cwd, request.project, 'figures.json')))
    const geometry = validateGeometry(request.geometry)
    const figures = parseFiguresJson(await readFile(resolve(root, 'figures.json'), 'utf8'))
    const panels = new Map(figures.figures.flatMap(f => f.panels).map(p => [p.id, p]))
    const assets = geometry.cells.map(c => {
      const panel = panels.get(c.member)
      if (!panel?.asset) throw new Error(`图源不存在或尚未裁切：${c.member}`)
      return resolve(root, panel.asset)
    })
    // The output id is validated by the shared composer before it touches files.
    assertSafeAssetId(request.id)
    if (typeof request.base_digest !== 'string' || !Array.isArray(request.inputs)) throw new Error('保存需要图组与图源版本')
    const existing = (await readGroups(resolve(root, 'groups.json'))).groups.find(group => group.id === request.id)
    if (request.create !== true && !existing) throw new Error('原拼图已不存在，请重新加载；只有新建操作才能另存。')
    const asset = existing?.asset ?? `groups/${request.id}.png`
    const result = await composePanels({ assets, output: resolve(root, asset), create: request.create, geometry, base_digest: request.base_digest, inputs: request.inputs, scale: 2 }, cwd, signal)
    return { digest: result.groups_digest, asset }
  }

  /** Edit the current session's figures file without bypassing revisions or snapshots. */
  @Remote({ resources: { session: (sessionId) => sessionId as SessionId } })
  async updateFigures(sessionId: string, request: FigureEdit, signal: AbortSignal): Promise<FigureEditResult> {
    if (basename(request.figures_json) !== 'figures.json') throw new Error('工作台只能修改 figures.json')
    const path = await projectFile(sessionCwd(this.ctx, sessionId), request.figures_json)
    const result = await updateFiguresFile(path, request.patch, request.base_rev, { signal })
    return { ok: result.ok, conflict: result.conflict, revision: result.revision }
  }

  /** Re-crop the given panels after a workbench box edit, through the same crop service as the agent tool. */
  @Remote({ resources: { session: (sessionId) => sessionId as SessionId } })
  async cropPanels(sessionId: string, request: PanelCrop, signal: AbortSignal): Promise<PanelCropResult> {
    if (basename(request.figures_json) !== 'figures.json') throw new Error('工作台只能裁切 figures.json 中的 Panel')
    if (request.ids.length === 0) throw new Error('至少指定一个 Panel')
    const cwd = sessionCwd(this.ctx, sessionId)
    const path = await projectFile(cwd, request.figures_json)
    const result = await cropFigures(path, { ids: request.ids, cwd, signal })
    return {
      revision: result.revision,
      cropped: result.cropped.map(item => item.id),
      anomalies: result.anomalies.map(item => ({ id: item.id, kind: item.kind, ...(item.detail === undefined ? {} : { detail: item.detail }) })),
    }
  }

  /** Read true rotated PDF page dimensions and the render_pages asset path. */
  @Remote({ resources: { session: (sessionId) => sessionId as SessionId } })
  async pageInfo(sessionId: string, projectPath: string, document: string, page: number, signal: AbortSignal): Promise<PageInfo> {
    const path = await projectFile(sessionCwd(this.ctx, sessionId), resolve(sessionCwd(this.ctx, sessionId), projectPath, document))
    const pdf = await PdfFile.open(path, signal)
    const size = await pdf.pageSize(page)
    const asset = resolve(dirname(path), 'pages', `${stableStem(path, 'doc')}-${pageSuffix(page)}.png`)
    return { ...size, path: relative(resolve(sessionCwd(this.ctx, sessionId), projectPath), asset).replaceAll('\\', '/') }
  }
}
