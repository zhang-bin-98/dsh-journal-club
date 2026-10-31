import { realpath } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { FigureEdit, FigureEditResult, PageInfo, PanelCrop, PanelCropResult } from './types.ts'
import { updateFiguresFile } from './figures/figuresStore.ts'
import { cropFigures } from './tools/crop.ts'
import { assertInsideDirectory, stableStem, pageSuffix } from './paths.ts'
import { PdfFile } from './pdf/pdf.ts'

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
