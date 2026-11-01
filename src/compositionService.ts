import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'
import { sha256Hex } from './files.ts'
import { parseFiguresJson } from './figures/schema.ts'
import { digestMembers, readGroups, readGroupsWithDigest, sameDigest } from './groups.ts'
import { validateGeometry, type CompositionLayout, type CompositionSave, type CompositionState } from './layout/composition.ts'
import { assertSafeAssetId, projectFile } from './paths.ts'
import { composePanels } from './tools/composePanels.ts'
import { normalizeAssetReference, parseDeck } from './validate/markdown.ts'

/**
 * 自由拼图页的读写（D35）：host 只负责会话与工作区根，这里做图源读取、过期判定、
 * 文稿顺序与保存；保存复用 compose_panels 的同一导出核心。
 */

function ignoreMissing(error: unknown): void {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

/** 载入项目的已保存图组、可用素材与 groups.json 摘要（保存时据此拒绝过期写入）。 */
export async function loadCompositionState(cwd: string, project: string, signal: AbortSignal): Promise<CompositionState> {
  const path = await projectFile(cwd, resolve(cwd, project, 'figures.json'))
  const root = dirname(path), groupsPath = resolve(root, 'groups.json')
  try { await projectFile(cwd, groupsPath) } catch (error) { ignoreMissing(error) }
  const { groups, digest } = await readGroupsWithDigest(groupsPath)
  const figures = parseFiguresJson(await readFile(path, 'utf8'))
  const assets: CompositionState['assets'] = [], warnings: string[] = []
  for (const figure of figures.figures) for (const panel of figure.panels) {
    signal.throwIfAborted()
    if (!panel.asset) { warnings.push(`${panel.id} 尚未裁切`); continue }
    try {
      const bytes = await readFile(await projectFile(root, panel.asset)), metadata = await sharp(bytes).metadata()
      if (!metadata.width || !metadata.height) throw new Error('图片尺寸缺失')
      assets.push({ id: panel.id, asset: panel.asset, label: `${figure.label ?? figure.id} · ${panel.label ?? '整图'}`, width: metadata.width, height: metadata.height, digest: sha256Hex(bytes) })
    } catch (error) { warnings.push(`${panel.id}：${(error as Error).message}`) }
  }
  const digests = new Map(assets.map(asset => [asset.id, asset.digest]))
  const existing = []
  for (const group of groups.groups) {
    try { await projectFile(root, group.asset); existing.push(group) } catch (error) { ignoreMissing(error) }
  }
  const entries = existing.map(group => {
    const stale = !sameDigest(group.inputs_digest, digestMembers(group.members.map(id => ({ id, digest: digests.get(id) }))))
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
  } catch (error) { ignoreMissing(error) }
  return { groups: entries, order, digest, assets, warnings }
}

/** 保存拼图：修改沿用已登记的原 asset 路径，只有明确新建才另起身份。 */
export async function saveComposition(cwd: string, request: CompositionSave, signal: AbortSignal): Promise<{ digest: string; asset: string }> {
  const path = await projectFile(cwd, resolve(cwd, request.project, 'figures.json'))
  const root = dirname(path)
  const geometry = validateGeometry(request.geometry)
  const figures = parseFiguresJson(await readFile(path, 'utf8'))
  const panels = new Map(figures.figures.flatMap(f => f.panels).map(p => [p.id, p]))
  const assets = geometry.cells.map(c => {
    const panel = panels.get(c.member)
    if (!panel?.asset) throw new Error(`图源不存在或尚未裁切：${c.member}`)
    return resolve(root, panel.asset)
  })
  // 新建时 id 用来拼输出路径，先拒绝非法 ID。
  assertSafeAssetId(request.id)
  if (typeof request.base_digest !== 'string' || !Array.isArray(request.inputs)) throw new Error('保存需要图组与图源版本')
  const existing = (await readGroups(resolve(root, 'groups.json'))).groups.find(group => group.id === request.id)
  if (request.create !== true && !existing) throw new Error('原拼图已不存在，请重新加载；只有新建操作才能另存。')
  const asset = existing?.asset ?? `groups/${request.id}.png`
  const result = await composePanels({ assets, output: resolve(root, asset), create: request.create, geometry, base_digest: request.base_digest, inputs: request.inputs }, cwd, signal)
  return { digest: result.groups_digest, asset }
}
