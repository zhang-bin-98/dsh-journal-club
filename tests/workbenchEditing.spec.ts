import { createElement as h } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FigureWorkbench } from '../src/client/workbench/FigureWorkbench.ts'
import { applyJsonPatch } from '../src/figures/figuresStore.ts'
import type { FiguresFile, ProjectSnapshot, ProjectStore, UpdateFiguresRequest } from '../src/client/types.ts'

let view: ReactTestRenderer
afterEach(() => { act(() => view?.unmount()) })

async function mount() {
  let snapshot: ProjectSnapshot = {
    figures: { version: 1, status: 'draft', revision: 1,
      documents: [{ id: 'main', path: 'main.pdf', role: 'main', pages: 1 }],
      figures: [{ id: 'f', label: 'Figure 1', status: 'pending',
        regions: [{ document: 'main', page: 1, bbox: [0, 0, 600, 800] }],
        panels: [{ id: 'a', label: 'A', region_index: 0, bbox: [60, 60, 220, 160], caption_refs: [], flags: [], origin: 'auto' }] }],
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
    view = create(h(FigureWorkbench, { store, loadPage }), { createNodeMock: () => ({
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
