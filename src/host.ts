import { basename, relative, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { FigureEdit, FigureEditResult, PageInfo, PanelCrop, PanelCropResult } from './types.ts'
import { loadCompositionState, saveComposition } from './compositionService.ts'
import { updateFiguresFile } from './figures/figuresStore.ts'
import type { CompositionSave, CompositionState } from './layout/composition.ts'
import { pageImagePath, projectFile } from './paths.ts'
import { PdfFile } from './pdf/pdf.ts'
import { cropFigures } from './tools/crop.ts'

function sessionCwd(ctx: Context, id: string): string {
  const session = ctx.sessions.get(id as SessionId)
  if (!session?.header.cwd) throw new Error('会话未加载或没有工作目录')
  return session.header.cwd
}

declare module '@deepseek-ai/cordis' {
  interface Context { journalClub: JournalClubService }
}

/** Thin host bridge: resolves the session workspace and delegates to the same services as the agent tools. */
export class JournalClubService extends TypertRemoteService {
  static inject = ['sessions']
  constructor(ctx: Context) { super(ctx, 'journalClub') }

  @Remote({ resources: { session: (sessionId) => sessionId as SessionId } })
  async compositionState(sessionId: string, project: string, signal: AbortSignal): Promise<CompositionState> {
    return loadCompositionState(sessionCwd(this.ctx, sessionId), project, signal)
  }

  @Remote({ resources: { session: (sessionId) => sessionId as SessionId } })
  async saveComposition(sessionId: string, request: CompositionSave, signal: AbortSignal): Promise<{ digest: string; asset: string }> {
    return saveComposition(sessionCwd(this.ctx, sessionId), request, signal)
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
      base_revision: result.base_revision,
      revision: result.revision,
      cropped: result.cropped.map(item => item.id),
      anomalies: result.anomalies.map(item => ({ id: item.id, kind: item.kind, ...(item.detail === undefined ? {} : { detail: item.detail }) })),
    }
  }

  /** Read true rotated PDF page dimensions and the render_pages asset path. */
  @Remote({ resources: { session: (sessionId) => sessionId as SessionId } })
  async pageInfo(sessionId: string, projectPath: string, document: string, page: number, signal: AbortSignal): Promise<PageInfo> {
    const cwd = sessionCwd(this.ctx, sessionId)
    const path = await projectFile(cwd, resolve(cwd, projectPath, document))
    const pdf = await PdfFile.open(path, signal)
    const size = await pdf.pageSize(page)
    return { ...size, path: relative(resolve(cwd, projectPath), pageImagePath(path, page)).replaceAll('\\', '/') }
  }
}
