import { createElement as h } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddFigure } from '../src/client/workbench/AddFigure.ts'
import { parseFiguresJson } from '../src/figures/schema.ts'
import { FigureWorkbench } from '../src/client/workbench/FigureWorkbench.ts'
import { applyJsonPatch } from '../src/figures/figuresStore.ts'
import { createProjectStore } from '../src/client/store.ts'
import type { FiguresFile, ProjectSnapshot, ProjectStore, UpdateFiguresRequest, WorkspaceFilesPort } from '../src/client/types.ts'

let view: ReactTestRenderer
afterEach(() => { act(() => view?.unmount()) })

async function mount(options: {region?: [number, number, number, number]; flags?: string[]; onFollowup?: (text: string) => Promise<void>; crop?: 'ok' | 'anomaly' | 'throw'; deferWrites?: boolean} = {}) {
  let snapshot: ProjectSnapshot = {
    figures: { version: 1, status: 'draft', revision: 1,
      documents: [{ id: 'main', path: 'main.pdf', role: 'main', pages: 1 }],
      figures: [{ id: 'f', label: 'Figure 1', status: 'pending',
        regions: [{ document: 'main', page: 1, bbox: options.region ?? [0, 0, 600, 800] }],
        panels: [{ id: 'a', label: 'A', region_index: 0, bbox: [60, 60, 220, 160], caption_refs: [], flags: options.flags ?? [], origin: 'auto' }] }],
    }, versions: {}, changedFigureIds: [], loadedAt: 1,
  }
  const listeners = new Set<() => void>()
  const publish = (figures: FiguresFile) => {
    snapshot = { ...snapshot, figures, loadedAt: snapshot.loadedAt + 1 }
    listeners.forEach(fn => fn())
  }
  // deferWrites：写入停在闸门，由测试逐个放行，用于制造"写入进行中又发起编辑"。
  const gates: (() => void)[] = []
  const release = async () => { await act(async () => { gates.shift()?.(); await new Promise(resolve => setTimeout(resolve, 0)) }) }
  const updateFigures = vi.fn(async (request: UpdateFiguresRequest) => {
    if (options.deferWrites) await new Promise<void>(resolve => gates.push(resolve))
    const current = snapshot.figures!
    if (request.base_rev !== current.revision) return { ok: false as const, conflict: true as const, revision: current.revision }
    const next = applyJsonPatch(current, request.patch) as FiguresFile
    publish({ ...next, revision: current.revision + 1 })
    return { ok: true as const, conflict: false as const, revision: current.revision + 1 }
  })
  // 与真实 crop 同语义：新登记 asset 推进 revision，已有 asset 只换像素。
  const cropPanels = vi.fn(async (ids: readonly string[]) => {
    if (options.crop === 'throw') throw new Error('PDF 不可读 fixture')
    if (options.crop === 'anomaly') return { base_revision: snapshot.figures!.revision, revision: snapshot.figures!.revision, cropped: [], anomalies: [{ id: ids[0]!, kind: 'bbox-outside-page' }] }
    const current = snapshot.figures!
    const missing = current.figures.flatMap(f => f.panels).filter(p => ids.includes(p.id) && p.asset === undefined)
    if (missing.length > 0) {
      publish({ ...current, revision: current.revision + 1, figures: current.figures.map(f => ({
        ...f, panels: f.panels.map(p => ids.includes(p.id) && p.asset === undefined ? { ...p, asset: `figures/${p.id}.png` } : p),
      })) })
    }
    return { base_revision: current.revision, revision: snapshot.figures!.revision, cropped: [...ids], anomalies: [] }
  })
  const store: ProjectStore = {
    getSnapshot: () => snapshot,
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
    refresh: async () => {}, updateFigures, readAsset: async () => '', dispose: () => {},
    ...(options.crop === undefined ? {} : { cropPanels }),
  }
  const loadPage = vi.fn(async () => ({ src: 'page.png', width: 600, height: 800 }))
  await act(async () => {
    view = create(h(FigureWorkbench, { store, loadPage, onFollowup: options.onFollowup }), { createNodeMock: () => ({
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 800 }), setPointerCapture: () => {},
    }) })
  })
  const button = (text: string) => view.root.findAllByType('button').find(node => node.children.includes(text))!
  const input = () => view.root.findByProps({ 'aria-label': 'Panel 标签' })
  const externalLabel = async (label: string) => {
    await act(async () => {
      const d = snapshot.figures!
      publish({ ...d, revision: d.revision + 1, figures: d.figures.map(f => ({
        ...f, panels: f.panels.map(p => ({ ...p, label })),
      })) })
    })
  }
  const externalInsert = () => {
    const current = snapshot.figures!, other = structuredClone(current.figures[0]!)
    other.id = 'other'; other.label = 'Figure 0'; other.panels[0]!.id = 'other_a'
    publish({...current, revision: current.revision + 1, figures: [other, ...current.figures]})
  }
  return { store, button, input, externalLabel, externalInsert, updateFigures, cropPanels, loadPage, release }
}

describe('工作台编辑期间的文件变更', () => {
  it('保留标签草稿，以编辑开始时的版本报冲突，显式重试后才覆盖', async () => {
    const m = await mount()
    await act(async () => { m.button('放大编辑').props.onClick() })
    act(() => { m.button('A').props.onClick() })
    act(() => { m.input().props.onFocus(); m.input().props.onChange({ target: { value: 'A_manual' } }) })
    await m.externalLabel('A_agent')
    expect(m.input().props.value).toBe('A_manual')
    await act(async () => { await m.input().props.onBlur() })
    expect(m.updateFigures.mock.calls[0]![0].base_rev).toBe(1)
    expect(m.store.getSnapshot().figures!.figures[0]!.panels[0]!.label).toBe('A_agent')
    expect(m.input().props.value).toBe('A_manual')
    expect(view.root.findByProps({ role: 'dialog' }).findByProps({ role: 'alert' }).children.join('')).toContain('本次修改未覆盖')
    act(() => { m.input().props.onFocus() })
    await act(async () => { await m.input().props.onBlur() })
    expect(m.updateFigures.mock.calls[1]![0].base_rev).toBe(2)
    expect(m.store.getSnapshot().figures!.figures[0]!.panels[0]).toMatchObject({ label: 'A_manual', origin: 'manual', flags: ['missing-caption'] })
  })

  it('删除确认期间发生外部变更时，不用新版本静默执行旧决定', async () => {
    const m = await mount()
    act(() => { m.button('A').props.onClick() })
    act(() => { m.button('删除 Panel').props.onClick() })
    await m.externalLabel('changed')
    await act(async () => { m.button('确认').props.onClick() })
    expect(m.updateFigures.mock.calls[0]![0].base_rev).toBe(1)
    expect(m.store.getSnapshot().figures!.figures[0]!.panels).toHaveLength(1)
  })

  it('拖框期间刷新仍保留页图和草稿，松手提交旧版本并报告冲突', async () => {
    const m = await mount()
    const event = (x: number) => ({ clientX: x, clientY: 100, pointerId: 1, stopPropagation() {}, preventDefault() {} })
    const stage = () => view.root.findAllByType('div').find(node => node.props.onPointerMove)!
    const box = () => view.root.findAllByType('div').find(node => node.props.onPointerDown && node.props.title !== undefined)!
    act(() => { box().props.onPointerDown(event(100)); stage().props.onPointerMove(event(110)) })
    await m.externalLabel('changed')
    expect(view.root.findAllByProps({ alt: '论文页图' })).toHaveLength(1)
    await act(async () => { stage().props.onPointerUp() })
    expect(m.updateFigures).toHaveBeenCalledTimes(1)
    expect(m.updateFigures.mock.calls[0]![0].base_rev).toBe(1)
    expect(m.store.getSnapshot().figures!.figures[0]!.panels[0]!.bbox).toEqual([60, 60, 220, 160])
  })
})


describe('图源工作台的人工核对路径', () => {
  it('分隔条支持拖动、键盘和复位，保留比例且不写图源', async () => {
    const m = await mount()
    const divider = () => view.root.findByProps({'aria-label': '调整原图与预览宽度'})
    const target = {focus() {}, setPointerCapture() {}, parentElement: {getBoundingClientRect: () => ({width: 1000})}}
    act(() => {
      divider().props.onPointerDown({button: 0, clientX: 600, pointerId: 1, currentTarget: target, preventDefault() {}})
      divider().props.onPointerMove({clientX: 400})
      divider().props.onPointerUp()
    })
    expect(divider().props['aria-valuenow']).toBe(40)
    act(() => { m.button('放大编辑').props.onClick() })
    act(() => { m.button('关闭').props.onClick() })
    expect(divider().props['aria-valuenow']).toBe(40)
    act(() => { divider().props.onKeyDown({key: 'ArrowRight', preventDefault() {}}) })
    expect(divider().props['aria-valuenow']).toBe(42)
    act(() => {
      divider().props.onPointerDown({button: 0, clientX: 400, pointerId: 1, currentTarget: target, preventDefault() {}})
      divider().props.onPointerMove({clientX: -1000})
      divider().props.onPointerCancel()
      divider().props.onPointerMove({clientX: 2000})
    })
    expect(divider().props['aria-valuenow']).toBe(30)
    act(() => { divider().props.onKeyDown({key: 'End', preventDefault() {}}) })
    expect(divider().props['aria-valuenow']).toBe(75)
    act(() => { divider().props.onDoubleClick() })
    expect(divider().props['aria-valuenow']).toBe(60)
    expect(m.updateFigures).not.toHaveBeenCalled()
    expect(m.store.getSnapshot().figures!.figures[0]!.panels[0]!.bbox).toEqual([60, 60, 220, 160])
  })

  it('手柄外扩超出初始整图框时，Panel 和 region 在同一 CAS 写入且仍满足包含契约', async () => {
    const m = await mount({region: [50, 50, 230, 170]})
    act(() => { m.button('A').props.onClick() })
    const event = (x: number, y: number) => ({clientX: x, clientY: y, pointerId: 1, stopPropagation() {}, preventDefault() {}})
    act(() => {
      view.root.findByProps({'aria-label': '调整 A se 角'}).props.onPointerDown(event(220, 160))
      view.root.findByProps({'aria-label': '图源编辑画布'}).props.onPointerMove(event(320, 260))
    })
    await act(async () => { view.root.findByProps({'aria-label': '图源编辑画布'}).props.onPointerUp() })
    const data = m.store.getSnapshot().figures!
    expect(data.figures[0]!.panels[0]!.bbox).toEqual([60, 60, 320, 260])
    expect(data.figures[0]!.regions[0]!.bbox).toEqual([50, 50, 320, 260])
    expect(m.updateFigures).toHaveBeenCalledTimes(1)
    expect(m.updateFigures.mock.calls[0]![0].base_rev).toBe(1)
    expect(parseFiguresJson(JSON.stringify(data))).toEqual(data)
  })

  it('多种疑点完整可见，图注关联待复核不会盖掉截断和串图提示', async () => {
    const m = await mount({flags: ['missing-caption', 'edge-cut', 'overlap']})
    expect(JSON.stringify(view.toJSON())).toContain('⚠ 疑点 1')
    act(() => { m.button('A').props.onClick() })
    const text = JSON.stringify(view.toJSON())
    expect(text).toContain('图注关联待复核、边缘可能截断、可能串入邻图')
  })

  it('同一发送中的请求不会重复提交，成功反馈显示在当前图内', async () => {
    let finish!: () => void
    const onFollowup = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const m = await mount({onFollowup})
    act(() => { m.button('让 AI 重新识别').props.onClick(); m.button('让 AI 重新识别').props.onClick() })
    expect(onFollowup).toHaveBeenCalledTimes(1)
    expect(m.button('让 AI 重新识别').props.disabled).toBe(true)
    await act(async () => { finish() })
    expect(m.button('让 AI 重新识别').props.disabled).toBe(false)
    expect(view.root.findByType('article').findByProps({role: 'status'}).children.join('')).toContain('已发送至聊天')
    await act(async () => { m.button('标记已查看').props.onClick() })
    expect(view.root.findByType('article').findAllByProps({role: 'status'})).toHaveLength(0)
  })

  it('Escape 取消标签草稿而不提交；输入框中的 Delete 不触发删图', async () => {
    const m = await mount()
    act(() => { m.button('A').props.onClick() })
    act(() => { m.input().props.onFocus(); m.input().props.onChange({target: {value: 'discard'}}) })
    const blur = vi.fn()
    act(() => { m.input().props.onKeyDown({key: 'Escape', preventDefault() {}, stopPropagation() {}, currentTarget: {blur}}) })
    await act(async () => { await m.input().props.onBlur() })
    expect(m.input().props.value).toBe('A')
    expect(m.updateFigures).not.toHaveBeenCalled()
    act(() => { view.root.findByType('article').props.onKeyDown({key: 'Delete', target: {closest: () => true}, preventDefault() {}}) })
    expect(view.root.findAllByProps({role: 'alert'})).toHaveLength(0)
  })

  it('文件刷新换掉 loadPage 时，补图保留同页页图直到重读完成，不打断拖框', async () => {
    const documents = [{id: 'main', path: 'main.pdf', pages: 12, role: 'main' as const}]
    const first = vi.fn(async () => ({src: 'p1.png', width: 600, height: 800}))
    await act(async () => { view = create(h(AddFigure, {documents, busy: false, loadPage: first, update: async () => true})) })
    await act(async () => { view.root.findAllByType('button')[0]!.props.onClick() })
    const image = () => view.root.findAllByProps({alt: '补图页图：拖选整图范围'})
    expect(image().map(node => node.props.src)).toEqual(['p1.png'])
    let resolve!: (value: {src: string; width: number; height: number}) => void
    const second = vi.fn(() => new Promise<{src: string; width: number; height: number}>(done => { resolve = done }))
    act(() => { view.update(h(AddFigure, {documents, busy: false, loadPage: second, update: async () => true})) })
    expect(second).toHaveBeenCalledWith('main.pdf', 1)
    expect(image().map(node => node.props.src)).toEqual(['p1.png'])
    await act(async () => { resolve({src: 'p2.png', width: 600, height: 800}) })
    expect(image().map(node => node.props.src)).toEqual(['p2.png'])
  })

  it('补图页码清空时保留原页预览且不能把旧框保存到新页', async () => {
    const loadPage = vi.fn(async () => ({src: 'page.png', width: 600, height: 800}))
    await act(async () => { view = create(h(AddFigure, {documents: [{id: 'main', path: 'main.pdf', pages: 12, role: 'main'}], busy: false, loadPage, update: async () => true})) })
    await act(async () => { view.root.findAllByType('button')[0]!.props.onClick() })
    const page = () => view.root.findByProps({'aria-label': '补图页码'})
    await act(async () => { page().props.onChange({target: {value: ''}}) })
    expect(view.root.findAllByProps({alt: '补图页图：拖选整图范围'})).toHaveLength(1)
    expect(loadPage).toHaveBeenCalledTimes(1)
    expect(view.root.findAllByProps({role: 'alert'})).toHaveLength(0)
    await act(async () => { page().props.onChange({target: {value: '12'}}) })
    expect(loadPage).toHaveBeenLastCalledWith('main.pdf', 12)
  })
})


describe('评审反馈回归', () => {
  it('筛选隐藏错误所属图时，在固定头部保留错误；折叠卡片也不隐藏错误', async () => {
    const m = await mount({onFollowup: async () => { throw new Error('发送失败 fixture') }})
    await act(async () => { m.button('让 AI 重新识别').props.onClick() })
    act(() => { m.button('▾ Figure 1').props.onClick() })
    expect(view.root.findByType('article').findByProps({role:'alert'}).children.join('')).toContain('发送失败 fixture')
    act(() => { view.root.findAllByType('select')[0]!.props.onChange({target:{value:'flagged'}}) })
    const alerts = view.root.findAllByProps({role:'alert'})
    expect(alerts.some(node => node.children.join('').includes('f：发送失败 fixture'))).toBe(true)
  })

  it('放大/关闭编辑器保留未提交草稿与编辑开始时的 revision', async () => {
    const m = await mount()
    act(() => { m.button('A').props.onClick() })
    act(() => { m.input().props.onFocus(); m.input().props.onChange({target:{value:'draft'}}) })
    await m.externalLabel('agent')
    act(() => { m.button('放大编辑').props.onClick() })
    expect(m.input().props.value).toBe('draft')
    act(() => { m.button('关闭').props.onClick() })
    expect(m.input().props.value).toBe('draft')
    await act(async () => { await m.input().props.onBlur() })
    expect(m.updateFigures.mock.calls[0]![0].base_rev).toBe(1)
    expect(m.store.getSnapshot().figures!.figures[0]!.panels[0]!.label).toBe('agent')
  })
})


describe('改框后重裁，使 agent 读取的裁切与工作台一致', () => {
  const event = (x: number, y: number) => ({clientX: x, clientY: y, pointerId: 1, stopPropagation() {}, preventDefault() {}})
  const stage = () => view.root.findByProps({'aria-label': '图源编辑画布'})
  async function resizeA() {
    act(() => { view.root.findAllByType('button').find(node => node.children.includes('A'))!.props.onClick() })
    act(() => { view.root.findByProps({'aria-label': '调整 A se 角'}).props.onPointerDown(event(220, 160)); stage().props.onPointerMove(event(260, 200)) })
    await act(async () => { stage().props.onPointerUp() })
  }

  it('调整框保存成功后只重裁该 Panel；改标签不触发重裁', async () => {
    const m = await mount({crop: 'ok'})
    await resizeA()
    expect(m.updateFigures).toHaveBeenCalledTimes(1)
    expect(m.cropPanels).toHaveBeenCalledTimes(1)
    expect(m.cropPanels.mock.calls[0]![0]).toEqual(['a'])
    expect(m.updateFigures.mock.invocationCallOrder[0]!).toBeLessThan(m.cropPanels.mock.invocationCallOrder[0]!)
    act(() => { m.input().props.onFocus(); m.input().props.onChange({target: {value: 'A2'}}) })
    await act(async () => { await m.input().props.onBlur() })
    expect(m.updateFigures).toHaveBeenCalledTimes(2)
    expect(m.cropPanels).toHaveBeenCalledTimes(1)
  })

  it('重裁失败时框仍保存，并在该图内提示裁切未刷新', async () => {
    for (const crop of ['throw', 'anomaly'] as const) {
      const m = await mount({crop})
      await resizeA()
      expect(m.store.getSnapshot().figures!.figures[0]!.panels[0]!.bbox).toEqual([60, 60, 260, 200])
      expect(view.root.findByType('article').findByProps({role: 'alert'}).children.join('')).toContain('框已保存，但裁切未刷新')
      act(() => view.unmount())
    }
  })

  it('新增 Panel 重裁登记 asset 后，标签提交使用重裁后的 revision 不冲突', async () => {
    const m = await mount({crop: 'ok'})
    act(() => { m.button('＋ 添加 Panel').props.onClick() })
    act(() => { stage().props.onPointerDown(event(300, 200)); stage().props.onPointerMove(event(400, 300)) })
    await act(async () => { stage().props.onPointerUp() })
    const added = m.store.getSnapshot().figures!.figures[0]!.panels[1]!
    expect(m.cropPanels.mock.calls[0]![0]).toEqual([added.id])
    expect(added.asset).toBe(`figures/${added.id}.png`)
    expect(m.store.getSnapshot().figures!.revision).toBe(3)
    act(() => { m.input().props.onFocus(); m.input().props.onChange({target: {value: 'B'}}) })
    await act(async () => { await m.input().props.onBlur() })
    expect(m.updateFigures.mock.calls[1]![0].base_rev).toBe(3)
    expect(m.store.getSnapshot().figures!.figures[0]!.panels[1]!.label).toBe('B')
    expect(view.root.findAllByProps({role: 'alert'})).toHaveLength(0)
  })
})

describe('真实 store 的异步读写', () => {
  it('新增 Panel 后立即改标签：重裁与刷新异步完成，标签按最新版本提交不冲突', async () => {
    let data: FiguresFile = { version: 1, status: 'draft', revision: 1,
      documents: [{ id: 'main', path: 'main.pdf', role: 'main', pages: 1 }],
      figures: [{ id: 'f', label: 'Figure 1', status: 'pending', regions: [{ document: 'main', page: 1, bbox: [0, 0, 600, 800] }],
        panels: [{ id: 'a', label: 'A', region_index: 0, bbox: [60, 60, 220, 160], caption_refs: [], flags: [], origin: 'auto' }] }] }
    const tick = () => new Promise(resolve => setTimeout(resolve, 2))
    const files: WorkspaceFilesPort = {
      read: async (_session, path) => { await tick(); return path.endsWith('figures.json') ? { text: JSON.stringify(data), version: String(data.revision) } : { text: '备注', version: 'jc' } },
      readBytes: async () => ({ data: new Uint8Array([1]) }),
    }
    const updateFigures = vi.fn(async (request: UpdateFiguresRequest) => {
      await tick()
      if (request.base_rev !== data.revision) return { ok: false as const, conflict: true as const, revision: data.revision }
      data = { ...(applyJsonPatch(data, request.patch) as FiguresFile), revision: data.revision + 1 }
      return { ok: true as const, conflict: false as const, revision: data.revision }
    })
    const cropPanels = vi.fn(async (request: { figures_json: string; ids: readonly string[] }) => {
      await tick()
      const base = data.revision
      data = { ...data, revision: base + 1, figures: data.figures.map(f => ({ ...f, panels: f.panels.map(p => request.ids.includes(p.id) && !p.asset ? { ...p, asset: `figures/${p.id}.png` } : p) })) }
      return { base_revision: base, revision: data.revision, cropped: [...request.ids], anomalies: [] }
    })
    const store = createProjectStore({ files, sessionId: 's', updateFigures: { updateFigures, cropPanels } })
    try {
      await act(async () => { await store.refresh() })
      const loadPage = async () => ({ src: 'page.png', width: 600, height: 800 })
      await act(async () => {
        view = create(h(FigureWorkbench, { store, loadPage }), { createNodeMock: () => ({
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 800 }), setPointerCapture: () => {},
        }) })
      })
      const event = (x: number, y: number) => ({clientX: x, clientY: y, pointerId: 1, stopPropagation() {}, preventDefault() {}})
      const stage = () => view.root.findByProps({'aria-label': '图源编辑画布'})
      act(() => { view.root.findAllByType('button').find(node => node.children.includes('＋ 添加 Panel'))!.props.onClick() })
      act(() => { stage().props.onPointerDown(event(300, 200)); stage().props.onPointerMove(event(400, 300)) })
      act(() => { stage().props.onPointerUp() })
      const input = () => view.root.findByProps({ 'aria-label': 'Panel 标签' })
      await act(async () => { await vi.waitFor(() => expect(input().props.autoFocus).toBe(true)) })
      expect(cropPanels).toHaveBeenCalledTimes(1)
      act(() => { input().props.onFocus(); input().props.onChange({target: {value: 'B'}}) })
      await act(async () => { await input().props.onBlur() })
      expect(updateFigures.mock.calls.map(call => call[0].base_rev)).toEqual([1, 3])
      expect(data.figures[0]!.panels[1]).toMatchObject({ label: 'B', asset: expect.stringMatching(/^figures\/panel_/u) })
      expect(data.revision).toBe(4)
      expect(view.root.findAllByProps({role: 'alert'})).toHaveLength(0)
    } finally { store.dispose() }
  })
})

describe('写入进行中再发起编辑', () => {
  const event = (x: number, y: number) => ({clientX: x, clientY: y, pointerId: 1, stopPropagation() {}, preventDefault() {}})
  const stage = () => view.root.findByProps({'aria-label': '图源编辑画布'})
  const box = () => view.root.findAllByType('div').find(node => node.props.onPointerDown && node.props.title !== undefined)!
  // 改标签不按 Enter 直接拖框：按下时画布取焦点使标签失焦提交，拖框在标签写入完成前松手。
  async function labelThenDrag(m: Awaited<ReturnType<typeof mount>>) {
    act(() => { m.button('A').props.onClick() })
    act(() => { m.input().props.onFocus(); m.input().props.onChange({target: {value: 'A2'}}) })
    act(() => { box().props.onPointerDown(event(100, 100)) })
    act(() => { void m.input().props.onBlur() })
    await act(async () => { stage().props.onPointerMove(event(120, 100)); stage().props.onPointerUp() })
    expect(m.updateFigures).toHaveBeenCalledTimes(1)
  }

  it('拖框排在标签写入之后执行，并跨过本端刚完成的版本，不丢失也不报假冲突', async () => {
    const m = await mount({deferWrites: true})
    await labelThenDrag(m)
    await m.release()
    await m.release()
    expect(m.updateFigures.mock.calls.map(call => call[0].base_rev)).toEqual([1, 2])
    expect(m.store.getSnapshot().figures!.figures[0]!.panels[0]).toMatchObject({label: 'A2', bbox: [80, 60, 240, 160]})
    expect(m.store.getSnapshot().figures!.revision).toBe(3)
    expect(view.root.findAllByProps({role: 'alert'})).toHaveLength(0)
  })

  it('两次本端写入之间夹入外部修改时，排队的拖框仍报冲突且不覆盖', async () => {
    const m = await mount({deferWrites: true})
    await labelThenDrag(m)
    await m.release()
    await m.externalLabel('agent')
    await m.release()
    expect(m.updateFigures.mock.calls[1]![0].base_rev).toBe(2)
    expect(m.store.getSnapshot().figures!.figures[0]!.panels[0]).toMatchObject({label: 'agent', bbox: [60, 60, 220, 160]})
    expect(view.root.findByType('article').findByProps({role: 'alert'}).children.join('')).toContain('本次修改未覆盖')
  })
})

it('新建标签只自动聚焦一次，删除后恢复同 ID 不恢复旧选中态', async () => {
  const m = await mount()
  const event = (x: number, y: number) => ({clientX:x, clientY:y, pointerId:1, stopPropagation() {}, preventDefault() {}})
  act(() => { m.button('＋ 添加 Panel').props.onClick() })
  act(() => {
    const stage = view.root.findByProps({'aria-label':'图源编辑画布'})
    stage.props.onPointerDown(event(300,200)); stage.props.onPointerMove(event(400,300))
  })
  await act(async () => { view.root.findByProps({'aria-label':'图源编辑画布'}).props.onPointerUp() })
  expect(m.input().props.autoFocus).toBe(true)
  act(() => { m.input().props.onFocus() })
  act(() => { m.button('A').props.onClick() })
  act(() => { m.button('整图').props.onClick() })
  expect(m.input().props.autoFocus).toBe(false)
  const saved = m.store.getSnapshot().figures!.figures[0]!.panels[1]!
  act(() => { m.button('删除 Panel').props.onClick() })
  await act(async () => { m.button('确认').props.onClick() })
  await act(async () => {
    await m.store.updateFigures({figures_json:'figures.json', base_rev:m.store.getSnapshot().figures!.revision, patch:[{op:'add',path:'/figures/0/panels/-',value:saved}]})
  })
  expect(view.root.findAllByProps({'aria-label':'Panel 标签'})).toHaveLength(0)
})

it('排队标记已查看不能命中外部新插入的 Figure', async () => {
  const m = await mount({deferWrites: true})
  act(() => { m.button('A').props.onClick() })
  act(() => { m.input().props.onFocus(); m.input().props.onChange({target: {value: 'A2'}}) })
  await act(async () => {
    void m.input().props.onBlur()
    m.button('标记已查看').props.onClick()
  })
  act(() => { m.externalInsert() })
  await m.release()
  await m.release()
  expect(m.store.getSnapshot().figures!.figures.find(f => f.id === 'other')!.status).toBe('pending')
})
