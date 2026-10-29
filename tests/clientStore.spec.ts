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
  it('子目录编辑始终发往选定项目，资产读取失败后允许重试', async () => {
    const files = filesOf(() => baseFigures)
    let attempts = 0
    files.readBytes = async () => {
      if (++attempts === 1) throw new Error('not found')
      return {data: new Uint8Array([1])}
    }
    const rpc = {updateFigures: vi.fn(async () => ({ok: true as const, conflict: false as const, revision: 3}))}
    const store = createProjectStore({files, updateFigures: rpc, sessionId: 's', projectPath: 'paper'})
    await store.refresh()
    await store.updateFigures({figures_json: 'wrong/figures.json', patch: [], base_rev: 2})
    expect(rpc.updateFigures).toHaveBeenCalledWith(expect.objectContaining({figures_json: 'paper/figures.json'}))
    await expect(store.readAsset('pages/main-001.png')).rejects.toThrow('not found')
    await expect(store.readAsset('pages/main-001.png')).resolves.toContain('data:image/png')
    store.dispose()
  })
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

describe('client store 文件与刷新边界', () => {
  it('坏 JSON 或不满足 schema 的图源不进入快照，并清除此前有效图源', async () => {
    for (const invalid of ['{broken', JSON.stringify({ ...baseFigures, documents: [] })]) {
      let text = JSON.stringify(baseFigures)
      const files = filesOf(() => baseFigures)
      files.read = async (_session, path) => path.endsWith('figures.json')
        ? { text, version: text }
        : { text: '项目备注', version: 'jc-1' }
      const store = createProjectStore({ files, sessionId: 'invalid-figures' })
      try {
        await store.refresh()
        expect(store.getSnapshot().figures?.revision).toBe(2)
        text = invalid
        await store.refresh()
        expect(store.getSnapshot().figures).toBeUndefined()
        expect(store.getSnapshot().error).toBeTruthy()
        expect(store.getSnapshot().jcText).toBe('项目备注')
      } finally { store.dispose() }
    }
  })

  it('读取尚未完成时收到 watch 变化，自动补读最新 revision', async () => {
    let releaseRead!: () => void
    const firstRead = new Promise<void>(resolve => { releaseRead = resolve })
    let pushChange!: () => void
    const changed = new Promise<void>(resolve => { pushChange = resolve })
    let acknowledgeChange!: () => void
    const delivered = new Promise<void>(resolve => { acknowledgeChange = resolve })
    let current = baseFigures
    let figureReads = 0
    const files = filesOf(() => current, async function* (_session, path, signal) {
      if (!path.endsWith('figures.json')) return
      await changed
      if (signal.aborted) return
      yield { version: '3' }
      // Reaching here means the store consumed the event while its first read was pending.
      acknowledgeChange()
    })
    files.read = async (_session, path) => {
      if (!path.endsWith('figures.json')) return { text: '项目备注', version: 'jc-1' }
      const captured = current
      figureReads += 1
      if (figureReads === 1) await firstRead
      return { text: JSON.stringify(captured), version: String(captured.revision) }
    }
    const store = createProjectStore({ files, sessionId: 'watch-race' })
    try {
      expect(figureReads).toBe(1)
      current = { ...baseFigures, revision: 3 }
      pushChange()
      await delivered
      expect(store.getSnapshot().loadedAt).toBe(0)
      releaseRead()
      // No explicit refresh: only the watch event can request the required second read.
      await vi.waitFor(() => expect(store.getSnapshot().figures?.revision).toBe(3))
      expect(figureReads).toBe(2)
    } finally { releaseRead(); pushChange(); store.dispose() }
  })
})
