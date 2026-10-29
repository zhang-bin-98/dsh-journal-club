import { describe, expect, it, vi } from 'vitest'
import { createProjectStore } from '../src/client/store.ts'
import type { FiguresFile, UpdateFiguresRequest, WorkspaceFilesPort } from '../src/client/types.ts'

const baseFigures: FiguresFile = {
  version: 1,
  status: 'draft',
  revision: 2,
  documents: [{ id: 'main', path: 'main.pdf', role: 'main', pages: 1 }],
  figures: [{
    id: 'fig1',
    label: 'Figure 1',
    status: 'pending',
    regions: [{ document: 'main', page: 1, bbox: [0, 0, 612, 792] }],
    panels: [{ id: 'fig1_A', label: 'A', region_index: 0, bbox: [10, 10, 200, 200], caption_refs: [], flags: [], origin: 'auto' }],
  }],
}

function filesOf(readFigures: () => FiguresFile, changes?: WorkspaceFilesPort['changes']): WorkspaceFilesPort {
  return {
    read: async (_session, path) => path.endsWith('figures.json')
      ? { text: JSON.stringify(readFigures()), version: String(readFigures().revision) }
      : { text: '---\nstage: figures\n---\n等待图源核对', version: 'jc-1' },
    readBytes: async () => ({ data: new Uint8Array([137, 80, 78, 71]), version: 'asset-1' }),
    changes,
  }
}

describe('client project store', () => {
  it('从文件读取 figures/jc，更新只调用 host RPC，不提供直写路径', async () => {
    let updateCalls: UpdateFiguresRequest[] = []
    const rpc = {
      updateFigures: vi.fn(async (request: UpdateFiguresRequest) => {
        updateCalls.push(request)
        return { ok: true as const, conflict: false as const, revision: 3 }
      }),
    }
    const store = createProjectStore({ files: filesOf(() => baseFigures), updateFigures: rpc, sessionId: 's1' })
    await store.refresh()
    expect(store.getSnapshot().figures?.figures[0]?.id).toBe('fig1')
    expect(store.getSnapshot().jcText).toContain('等待图源核对')
    await store.updateFigures({ figures_json: 'figures.json', patch: [{ op: 'replace', path: '/figures/0/status', value: 'viewed' }], base_rev: 2 })
    expect(updateCalls).toHaveLength(1)
    store.dispose()
  })

  it('watch 触发重新读取并标记外部变更 Figure', async () => {
    let current = baseFigures
    let pushChange: (() => void) | undefined
    const changes = async function* (_session: string, path: string, signal: AbortSignal) {
      if (!path.endsWith('figures.json')) return
      await new Promise<void>(resolve => {
        pushChange = resolve
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
      if (!signal.aborted) yield { version: 'next' }
    }
    const store = createProjectStore({ files: filesOf(() => current, changes), sessionId: 's1' })
    await store.refresh()
    current = { ...baseFigures, revision: 3, figures: [{ ...baseFigures.figures[0]!, status: 'adjusted' }] }
    pushChange?.()
    await new Promise(resolve => setTimeout(resolve, 0))
    await store.refresh()
    expect(store.getSnapshot().changedFigureIds).toContain('fig1')
    store.dispose()
  })

  it('版本冲突原样交给工作台，不静默刷新覆盖', async () => {
    const result = { ok: false as const, conflict: true as const, revision: 8 }
    const rpc = { updateFigures: vi.fn(async () => result) }
    const store = createProjectStore({ files: filesOf(() => baseFigures), updateFigures: rpc, sessionId: 's1' })
    const actual = await store.updateFigures({ figures_json: 'figures.json', patch: [], base_rev: 2 })
    expect(actual).toEqual(result)
    expect(rpc.updateFigures).toHaveBeenCalledTimes(1)
    store.dispose()
  })
})
