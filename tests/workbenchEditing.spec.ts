import { createElement as h } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddFigure } from '../src/client/workbench/AddFigure.ts'
import { parseFiguresJson } from '../src/figures/schema.ts'
import { FigureWorkbench } from '../src/client/workbench/FigureWorkbench.ts'
import { applyJsonPatch } from '../src/figures/figuresStore.ts'
import type { BBox, FiguresFile, ProjectSnapshot, ProjectStore, UpdateFiguresRequest } from '../src/client/types.ts'

let view: ReactTestRenderer
afterEach(() => { act(() => view?.unmount()) })

async function mount(options: {region?: BBox; flags?: string[]; onFollowup?: (text: string) => Promise<void>} = {}) {
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
  const updateFigures = vi.fn(async (request: UpdateFiguresRequest) => {
    const current = snapshot.figures!
    if (request.base_rev !== current.revision) return { ok: false as const, conflict: true as const, revision: current.revision }
    const next = applyJsonPatch(current, request.patch) as FiguresFile
    publish({ ...next, revision: current.revision + 1 })
    return { ok: true as const, conflict: false as const, revision: current.revision + 1 }
  })
  const store: ProjectStore = {
    getSnapshot: () => snapshot,
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
    refresh: async () => {}, updateFigures, readAsset: async () => '', dispose: () => {},
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
  return { store, button, input, externalLabel, updateFigures, loadPage }
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
