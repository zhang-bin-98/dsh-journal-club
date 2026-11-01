import { MaterialBrowser } from './MaterialBrowser.ts'
import { GroupNavigator } from './GroupNavigator.ts'
import { createElement as h, useEffect, useId, useRef, useState, type ReactElement, type PointerEvent as Pointer, type KeyboardEvent } from 'react'
import { compositionBounds, editingBounds, fitComposition, imageRect, resizeImage, suggestGeometry, validateGeometry, type CompositionAsset, type CompositionGeometry, type CompositionSave, type CompositionState } from '../../layout/composition.ts'
import { DEFAULT_CANVAS } from '../../layout/figureGeometry.ts'
import { styles } from '../styles.ts'

interface Props {
  revision?: number
  load(): Promise<CompositionState>
  save(request: Omit<CompositionSave, 'project'>): Promise<{ digest: string; asset: string }>
  readAsset(path: string): Promise<string>
  openAsset?(path: string): void
  prepareConversation?(id: string): (asset: string) => void
}
interface Draft { id: string; history: CompositionGeometry[]; index: number; saved: string; base: string; inputs: CompositionAsset[]; local: boolean }
const orderedIds = (data: CompositionState): string[] => data.order ?? data.groups.map(g => g.id)
const empty = (): CompositionGeometry => ({ ...DEFAULT_CANVAS, cells: [] })
const value = (draft: Draft): CompositionGeometry => draft.history[draft.index]!
const serialized = (g: CompositionGeometry): string => JSON.stringify(g)
function newId(ids: readonly string[]): string {
  let n = 1
  while (ids.includes(`group_${n}`)) n++
  return `group_${n}`
}

/** A transient editing draft. Only Save writes the ordinary groups.json/PNG files. */
export function CompositionEditor(props: Props): ReactElement {
  const [state, setState] = useState<CompositionState>()
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [current, setCurrent] = useState('')
  const [selected, setSelected] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sidebar, setSidebar] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [expanded, setExpanded] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<'materials' | 'properties'>('materials')
  const tabId = useId()
  const [sources, setSources] = useState<Record<string, string>>({})
  const [sourceRevision, setSourceRevision] = useState(0)
  const [live, setLive] = useState<CompositionGeometry>()
  const [viewArea, setViewArea] = useState(() => editingBounds(empty(), []))
  const [viewportSize, setViewportSize] = useState({ width: 600, height: 480 })
  const viewport = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null), dialog = useRef<HTMLDialogElement>(null)
  const working = useRef(false)
  const observedRevision = useRef(props.revision)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const gesture = useRef<{ startX: number; startY: number; scale: number; original: CompositionGeometry; next: CompositionGeometry; member: string; corner?: string; view: ReturnType<typeof editingBounds> }>()
  const draft = drafts[current], geometry = live ?? (draft ? value(draft) : empty())
  const dirty = Boolean(draft && serialized(value(draft)) !== draft.saved)

  function loadDraft(id: string, data: CompositionState): Draft {
    const group = data.groups.find(g => g.id === id)
    let g = empty()
    if (group) {
      if (group.layout && typeof group.layout === 'object' && 'geometry' in group.layout) g = validateGeometry(group.layout.geometry, group.members)
      else g = suggestGeometry(group.members.map(member => {
        const asset = data.assets.find(a => a.id === member)
        if (!asset) throw new Error(`图源不可读：${member}`)
        return asset
      }), DEFAULT_CANVAS.width, DEFAULT_CANVAS.height)
    }
    return { id, history: [g], index: 0, saved: serialized(g), base: data.digest, inputs: data.assets, local: !group }
  }
  function retainedDrafts(data: CompositionState): Record<string, Draft> {
    const visible = new Set(orderedIds(data))
    return Object.fromEntries(Object.entries(drafts).filter(([id, d]) => {
      if (state?.groups.some(g => g.id === id) && !data.groups.some(g => g.id === id)) return false
      return visible.has(id) || d.local
    }).map(([id, d]) => [id, visible.has(id) ? { ...d, local: false } : d]))
  }
  async function reload(mode: 'layout' | 'sources' | 'external' = 'layout') {
    if (working.current) return
    working.current = true; setBusy(true); setError('')
    try {
      const data = await props.load()
      if (!mounted.current) return
      if (mode === 'external' && state) {
        if (data.digest === state.digest && JSON.stringify([data.order, data.groups.map(g => g.id)]) === JSON.stringify([state.order, state.groups.map(g => g.id)])) return
        // Only replace saved drafts. Local edits keep their history and CAS base.
        const nextDrafts = Object.fromEntries(Object.entries(retainedDrafts(data)).map(([id, d]) =>
          [id, serialized(value(d)) !== d.saved || d.local || d.base === data.digest ? d : loadDraft(id, data)]))
        const id = nextDrafts[current] ? current : orderedIds(data)[0] || Object.keys(nextDrafts)[0] || ''
        if (!id) {
          setDrafts({}); setCurrent(''); setSelected(undefined); setState(data)
          setNotice('当前文稿没有可显示的拼图，可新建拼图。')
          return
        }
        const next = nextDrafts[id] ?? loadDraft(id, data)
        setDrafts({ ...nextDrafts, [id]: next }); setCurrent(id)
        setState(data); setSources({}); setSourceRevision(n => n + 1)
        if (next !== drafts[current]) { setViewArea(editingBounds(value(next), next.inputs)); setSelected(undefined) }
        setNotice('已更新保存的拼图与预览；本地未保存调整已保留。')
        return
      }
      if (mode === 'sources' && state) {
        // Refresh inputs, never advance a draft's groups CAS base or replace its history.
        setState(data); setSources({}); setSourceRevision(n => n + 1)
        const nextDrafts = Object.fromEntries(Object.entries(retainedDrafts(data)).map(([id, d]) => [id, { ...d, inputs: data.assets }]))
        const id = nextDrafts[current] ? current : orderedIds(data)[0] || Object.keys(nextDrafts)[0] || ''
        if (!id) {
          setDrafts({}); setCurrent(''); setSelected(undefined)
          setNotice('图源已刷新；当前没有可自动保存的拼图。')
          return
        }
        const next = nextDrafts[id] ?? loadDraft(id, data)
        setDrafts({ ...nextDrafts, [id]: next }); setCurrent(id)
        if (id !== current) { setSelected(undefined); setViewArea(editingBounds(value(next), next.inputs)) }
        if (id === current && value(next).cells.length) {
          if (next.base !== data.digest) throw new Error('图源已刷新，但布局有外部修改；未自动保存，请重新加载布局。')
          await persist(next)
          setNotice('图源已刷新，已保留当前排版并自动保存拼图。')
        } else setNotice('图源已刷新；当前没有可自动保存的拼图。')
        return
      }
      const retained = retainedDrafts(data)
      const id = retained[current] ? current : orderedIds(data)[0] || (data.order === undefined ? newId(data.groups.map(g => g.id)) : '')
      if (!id) {
        setState(data); setDrafts(retained); setCurrent(''); setSelected(undefined)
        setNotice('当前文稿没有可显示的拼图，可新建拼图。')
        return
      }
      const next = loadDraft(id, data)
      setViewArea(editingBounds(value(next), next.inputs)); setZoom(1)
      setState(data); setSources({}); setSourceRevision(n => n + 1); setDrafts({ ...retained, [id]: next }); setCurrent(id); setSelected(undefined); setLive(undefined)
      setNotice('已加载最新图源与布局')
    } catch (e) { setError(String(e)) }
    finally { working.current = false; setBusy(false) }
  }
  useEffect(() => { void reload() }, [])
  useEffect(() => {
    if (!state || busy || live || props.revision === observedRevision.current) return
    observedRevision.current = props.revision
    void reload('external')
  }, [props.revision, busy, live, state])
  useEffect(() => {
    if (zoom === 1 || gesture.current || !geometry.cells.length) return
    const b = compositionBounds(geometry, draft?.inputs ?? [])
    setViewArea(area => {
      if (b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height) return area
      const needed = editingBounds(geometry, draft?.inputs ?? [])
      const x = Math.min(area.x, needed.x), y = Math.min(area.y, needed.y)
      return { x, y, width: Math.max(area.x + area.width, needed.x + needed.width) - x, height: Math.max(area.y + area.height, needed.y + needed.height) - y }
    })
  }, [geometry, draft?.inputs, zoom])
  useEffect(() => {
    if (zoom === 1 && !gesture.current && viewport.current) {
      viewport.current.scrollLeft = 0
      viewport.current.scrollTop = 0
    }
  }, [geometry, draft?.inputs, zoom, viewportSize])
  useEffect(() => {
    if (!viewport.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => { if (entry) setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height }) })
    observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (expanded && !element.open) element.showModal()
    if (!expanded && element.open) element.close()
  }, [expanded])
  const sourceKeys = geometry.cells.map(c => `${c.member}:${draft?.inputs.find(a => a.id === c.member)?.digest ?? ''}`).join('|')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const cell of geometry.cells) {
        const asset = draft?.inputs.find(a => a.id === cell.member)
        if (!asset) continue
        try {
          const src = await props.readAsset(asset.asset)
          if (!cancelled) setSources(old => ({ ...old, [asset.id]: src }))
        } catch (e) { if (!cancelled) setError(`图片加载失败：${asset.label} · ${String(e)}`) }
      }
    })()
    return () => { cancelled = true }
  }, [sourceKeys, sourceRevision])

  function commit(g: CompositionGeometry) {
    if (busy || !draft || serialized(g) === serialized(value(draft))) return
    setDrafts(old => {
      const d = old[current]!
      const history = [...d.history.slice(0, d.index + 1), g].slice(-60)
      return { ...old, [current]: { ...d, history, index: history.length - 1 } }
    })
    setNotice(''); setError('')
  }
  function history(step: number) {
    if (busy || !draft) return
    setDrafts(old => ({ ...old, [current]: { ...draft, index: Math.max(0, Math.min(draft.history.length - 1, draft.index + step)) } }))
  }
  function choose(id: string) {
    if (!state || busy || gesture.current || id === current) return
    try {
      const next = drafts[id] ?? loadDraft(id, state)
      if (!drafts[id]) setDrafts(old => ({ ...old, [id]: next }))
      setViewArea(editingBounds(value(next), next.inputs)); setZoom(1)
      setCurrent(id); setSelected(undefined); setLive(undefined); setNotice(''); setError('')
    } catch (e) { setError(String(e)) }
  }
  function add(asset: CompositionAsset) {
    if (geometry.cells.some(c => c.member === asset.id)) { setSelected(asset.id); return }
    const size = Math.min(geometry.width * .45 / asset.width, geometry.height * .45 / asset.height)
    const width = asset.width * size, height = asset.height * size, offset = geometry.cells.length % 8 * 12
    commit({ ...geometry, cells: [...geometry.cells, { member: asset.id, x: (geometry.width - width) / 2 + offset, y: (geometry.height - height) / 2 + offset, width, height }] })
    setSelected(asset.id)
  }
  function selectMember(id: string) {
    setSelected(id)
    const image = Array.from(svg.current?.querySelectorAll<SVGGElement>('g[data-member]') ?? []).find(g => g.dataset.member === id)
    image?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    svg.current?.focus({ preventScroll: true })
  }
  function remove() { if (selected) { commit({ ...geometry, cells: geometry.cells.filter(c => c.member !== selected) }); setSelected(undefined) } }
  function begin(e: Pointer<SVGElement>, member: string, corner?: string) {
    if (busy || e.button !== 0 || !svg.current) return
    e.preventDefault(); e.stopPropagation(); svg.current.focus()
    const bounds = svg.current.getBoundingClientRect()
    gesture.current = { startX: e.clientX, startY: e.clientY, scale: viewBounds.width / bounds.width, original: geometry, next: geometry, member, corner, view: viewBounds }
    if (member) setSelected(member)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function move(e: Pointer<SVGSVGElement>) {
    const drag = gesture.current
    if (!drag) return
    const dx = (e.clientX - drag.startX) * drag.scale, dy = (e.clientY - drag.startY) * drag.scale
    const original = drag.original
    drag.next = { ...original, cells: original.cells.map(c => c.member !== drag.member ? c : { ...c, ...(drag.corner ? resizeImage(imageRect(c, draft!.inputs.find(a => a.id === c.member) ?? c), drag.corner, dx, dy) : { x: c.x + dx, y: c.y + dy }) }) }
    setLive(drag.next)
  }
  function end(cancel = false) {
    const drag = gesture.current
    gesture.current = undefined; setLive(undefined)
    if (drag && !cancel) commit(drag.next)
  }
  function keys(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest?.('input,select,textarea') || busy) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); history(e.shiftKey ? 1 : -1) }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); history(1) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (gesture.current) end(true); else setSelected(undefined) }
    else if (selected && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); remove() }
    else if (selected && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault(); const step = e.shiftKey ? 10 : 1
      commit({ ...geometry, cells: geometry.cells.map(c => c.member === selected ? { ...c, x: c.x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0), y: c.y + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0) } : c) })
    }
  }
  async function persist(draft: Draft): Promise<string> {
    const g = fitComposition(value(draft), draft.inputs)
    const result = await props.save({ id: draft.id, create: !state?.groups.some(group => group.id === draft.id), geometry: g, base_digest: draft.base, inputs: g.cells.map(c => {
      const a = draft.inputs.find(a => a.id === c.member)
      if (!a) throw new Error(`图源缺失：${c.member}`)
      return { id: a.id, digest: a.digest }
    }) })
    if (!mounted.current) return result.asset
    const offset = compositionBounds(value(draft), draft.inputs)
    setViewArea(area => ({ ...area, x: area.x - offset.x, y: area.y - offset.y }))
    setDrafts(old => ({ ...Object.fromEntries(Object.entries(old).map(([id, d]) => [id, d.base === draft.base ? { ...d, base: result.digest } : d])), [draft.id]: { ...draft, history: draft.history.map((entry, i) => i === draft.index ? g : entry), saved: serialized(g), base: result.digest } }))
    setState(old => {
      if (!old) return old
      const group = { id: draft.id, asset: result.asset, members: g.cells.map(c => c.member), inputs_digest: '', layout: { kind: 'manual' as const, geometry: g } }
      return { ...old, digest: result.digest, groups: old.groups.some(item => item.id === draft.id) ? old.groups.map(item => item.id === draft.id ? group : item) : [...old.groups, group] }
    })
    return result.asset
  }
  async function save(toConversation = false) {
    if (!draft || working.current) return
    working.current = true; setBusy(true); setError('')
    try {
      const insert = toConversation ? props.prepareConversation?.(current) : undefined
      if (toConversation && !insert) throw new Error('宿主暂未提供输入框引用能力。')
      const group = state?.groups.find(g => g.id === current)
      if (insert && !dirty && group && !group.stale) {
        insert(group.asset)
        setExpanded(false); setNotice('已加入左侧输入框，请补充修改意见后发送。')
        return
      }
      const asset = await persist(draft)
      if (!mounted.current) return
      if (insert) {
        insert(asset)
        setExpanded(false); setNotice('拼图已保存并加入左侧输入框，请补充修改意见后发送。')
      } else setNotice('已按图片外缘保存组合图；已有 PPTX 需重新渲染才能更新。')
    } catch (e) { setError(String(e)) }
    finally { working.current = false; setBusy(false) }
  }
  const button = (label: string, click: () => void, disabled = false) => h('button', { type: 'button', className: styles.secondaryAction, onClick: click, disabled: busy || disabled }, label)
  const missing = geometry.cells.filter(c => !draft?.inputs.some(a => a.id === c.member))
  const selectedCell = geometry.cells.find(c => c.member === selected)
  const outputBounds = compositionBounds(geometry, draft?.inputs ?? [])
  // Fit follows the current images; a pointer gesture freezes its coordinate system.
  const viewBounds = gesture.current?.view ?? (zoom === 1 ? editingBounds(geometry, draft?.inputs ?? []) : viewArea)
  const displayWidth = Math.max(1, Math.min(viewportSize.width, viewportSize.height * viewBounds.width / viewBounds.height)) * zoom
  const handleSize = 14 * viewBounds.width / displayWidth
  const rectangles = geometry.cells.map(c => imageRect(c, draft?.inputs.find(a => a.id === c.member) ?? c))
  const overlaps = rectangles.some((a, i) => rectangles.slice(i + 1).some(b => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height))
  const groupIds = Array.from(new Set([...(state ? orderedIds(state) : []), ...Object.values(drafts).filter(d => d.local).map(d => d.id)]))
  const externalChange = Boolean(draft && state && draft.base !== state.digest)
  const content = h('div', { className: 'jc-compose', onKeyDown: keys },
    h('div', { className: styles.header },
      h('strong', null, '自由拼图'),
      h('span', { className: styles.subtitle, 'aria-label': '当前拼图' }, current),
      button('新建拼图', () => choose(newId([...(state?.groups.map(g => g.id) ?? []), ...Object.keys(drafts)])), !state),
      button('建议排版', () => commit(suggestGeometry(geometry.cells.map(c => draft!.inputs.find(a => a.id === c.member)!), geometry.width, geometry.height)), !geometry.cells.length || missing.length > 0),
      button('撤销', () => history(-1), !draft?.index), button('重做', () => history(1), !draft || draft.index >= draft.history.length - 1),
      h('button', { type: 'button', className: styles.action, onClick: () => void save(), disabled: busy || !geometry.cells.length || missing.length > 0 }, busy ? '处理中…' : '保存拼图'),
      button('加入对话', () => void save(true), !geometry.cells.length || missing.length > 0 || externalChange),
      button(expanded ? '收起编辑' : '放大编辑', () => setExpanded(v => !v)),
      button(sidebar ? '收起素材与属性' : '展开素材与属性', () => setSidebar(v => !v))),
    error ? h('p', { role: 'alert', className: styles.error }, error) : null,
    h('div', { className: 'jc-composeStatus' },
      h('span', { role: 'status' }, notice || `${geometry.cells.length} 张图片 · ${dirty ? '有未保存修改' : '布局已载入'} · 拖动移动，拖角点等比缩放`),
      button('刷新图源', () => void reload('sources')),
      state?.groups.some(g => g.id === current) ? button('打开已保存拼图', () => props.openAsset?.(state.groups.find(g => g.id === current)!.asset)) : null),
    overlaps ? h('p', { className: 'jc-composeWarning' }, '图片存在重叠，请检查内容是否被遮挡；可从右栏列表选中图片，方向键微调。') : null,
    state?.groups.find(g => g.id === current)?.stale ? h('p', { className: 'jc-composeWarning' }, '图源已变化：当前预览使用最新图片并保留原布局，请检查后保存以更新组合图。') : null,
    missing.length ? h('p', { role: 'alert' }, `图源缺失：${missing.map(c => c.member).join('、')}；草稿已保留。`) : null,
    externalChange ? h('div', { className: 'jc-composeWarning', role: 'alert' }, '拼图文件有外部修改；刷新图源不会覆盖当前草稿，也不会解除保存冲突。', button('重新加载布局（放弃当前草稿）', () => void reload())) : null,
    h('div', { className: `jc-composeBody ${sidebar ? '' : 'jc-composeBodySolo'}` },
      h(GroupNavigator, { items: groupIds.map(id => {
        const group = state?.groups.find(g => g.id === id), d = drafts[id]
        return { id, asset: group?.asset, stale: group?.stale, dirty: Boolean(d && serialized(value(d)) !== d.saved) }
      }), current, revision: state?.digest ?? '', busy, choose, readAsset: props.readAsset }),
      h('div', { className: 'jc-composeMain' },
        h('div', { className: 'jc-composeControls' },
          h('label', null, '查看 ', h('select', { 'aria-label': '拼图缩放', value: zoom, onChange: (e: { target: { value: string } }) => { setViewArea(viewBounds); setZoom(Number(e.target.value)) } }, [1, 1.5, 2, 3].map(n => h('option', { key: n, value: n }, n === 1 ? '适应编辑区' : `${n * 100}%`)))),
          h('span', null, `导出 ${Math.ceil(outputBounds.width * 2)} × ${Math.ceil(outputBounds.height * 2)} px`)),
        h('div', { ref: viewport, className: 'jc-composeViewport' }, h('div', { className: 'jc-composeBoardWrap', style: { width: displayWidth } },
          h('svg', { ref: svg, className: 'jc-composeBoard', tabIndex: 0, role: 'group', 'aria-label': '自由拼图画布', viewBox: `${viewBounds.x} ${viewBounds.y} ${viewBounds.width} ${viewBounds.height}`, style: { height: displayWidth * viewBounds.height / viewBounds.width, overflow: 'visible' }, onPointerDown: () => setSelected(undefined), onPointerMove: move, onPointerUp: () => end(), onPointerCancel: () => end(true), onLostPointerCapture: () => { if (gesture.current) end(true) } },
            h('rect', { ...outputBounds, fill: 'white', stroke: '#cbd5e1', strokeDasharray: '4 4', vectorEffect: 'non-scaling-stroke', 'aria-label': '按图片外缘导出范围' }),
            ...geometry.cells.map(c => {
              const asset = draft?.inputs.find(a => a.id === c.member), rect = imageRect(c, asset ?? c, 2)
              const r = { x: rect.x / 2, y: rect.y / 2, width: rect.width / 2, height: rect.height / 2 }
              return h('g', { key: c.member, 'data-member': c.member, onPointerDown: (e: Pointer<SVGGElement>) => begin(e, c.member) },
                h('rect', { ...r, fill: '#eee' }), h('image', { ...r, href: sources[c.member], preserveAspectRatio: 'none' }), h('title', null, asset?.label ?? c.member))
            }),
            selectedCell ? (() => {
              const asset = draft?.inputs.find(a => a.id === selected), rect = imageRect(selectedCell, asset ?? selectedCell, 2)
              const r = { x: rect.x / 2, y: rect.y / 2, width: rect.width / 2, height: rect.height / 2 }
              return h('g', { className: 'jc-composeSelection' },
                h('rect', { ...r, fill: 'none', stroke: '#2563eb', strokeWidth: 2, vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }),
                ...['nw', 'ne', 'sw', 'se'].map(corner => h('circle', { key: corner, 'data-corner': corner, cx: r.x + (corner.includes('e') ? r.width : 0), cy: r.y + (corner.includes('s') ? r.height : 0), r: handleSize / 2, fill: 'white', stroke: '#2563eb', vectorEffect: 'non-scaling-stroke', style: { cursor: `${corner}-resize` }, onPointerDown: (e: Pointer<SVGCircleElement>) => begin(e, selectedCell.member, corner) })))
            })() : null)))),
      h('aside', { className: 'jc-composeInspector', hidden: !sidebar },
        h('div', { role: 'tablist', 'aria-label': '素材与属性', className: 'jc-composeInspectorTabs' },
          ...(['materials', 'properties'] as const).map((tab, index) => h('button', { type: 'button', key: tab, role: 'tab', id: `${tabId}-${tab}-tab`, 'aria-controls': `${tabId}-${tab}`, 'aria-selected': inspectorTab === tab, tabIndex: inspectorTab === tab ? 0 : -1, className: styles.secondaryAction,
            onClick: () => setInspectorTab(tab), onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
              e.preventDefault(); e.stopPropagation()
              const next = e.key === 'Home' ? 'materials' : e.key === 'End' ? 'properties' : index === 0 ? 'properties' : 'materials'
              setInspectorTab(next); document.getElementById(`${tabId}-${next}-tab`)?.focus()
            } }, tab === 'materials' ? '素材' : '属性'))),
        h('div', { role: 'tabpanel', id: `${tabId}-materials`, 'aria-labelledby': `${tabId}-materials-tab`, hidden: inspectorTab !== 'materials', className: 'jc-composeTabPanel jc-composeMaterialPanel' },
          h(MaterialBrowser, { assets: draft?.inputs ?? [], members: geometry.cells.map(c => c.member), selected, busy, readAsset: props.readAsset, add, select: selectMember }),
          state?.warnings.length ? h('details', null, h('summary', null, `${state.warnings.length} 个图源暂不可用`), state.warnings.map((w, i) => h('p', { key: i }, w))) : null),
        h('div', { role: 'tabpanel', id: `${tabId}-properties`, 'aria-labelledby': `${tabId}-properties-tab`, hidden: inspectorTab !== 'properties', className: 'jc-composeTabPanel' },
        h('strong', null, '导出范围'),
        h('p', { className: styles.subtitle }, geometry.cells.length ? `${Math.ceil(outputBounds.width * 2)} × ${Math.ceil(outputBounds.height * 2)} px · 按图片外缘自动裁切` : '加入图片后自动确定导出尺寸'),
        button('查看全部图片', () => { setViewArea(editingBounds(geometry, draft?.inputs ?? [])); setZoom(1) }),
        h('p', { className: styles.subtitle }, '编辑区随图片扩展；保存时只去掉拼图外围空白，保留图片间隔和原图全部内容。'),
        h('strong', null, '已加入的图片'),
        h('div', { className: 'jc-composeMembers' }, geometry.cells.map(c => h('button', { type: 'button', key: c.member, className: styles.secondaryAction, 'aria-pressed': selected === c.member, onClick: () => setSelected(c.member) }, draft?.inputs.find(a => a.id === c.member)?.label ?? c.member))),
        button('移出选中图片', remove, !selectedCell),
        h('div', { className: styles.inlineActions },
          ...(['x', 'y'] as const).map(axis => button(axis === 'x' ? '水平居中' : '垂直居中', () => commit({ ...geometry, cells: geometry.cells.map(c => c.member !== selected ? c : { ...c, [axis]: axis === 'x' ? outputBounds.x + (outputBounds.width - c.width) / 2 : outputBounds.y + (outputBounds.height - c.height) / 2 }) }), !selectedCell)))
        ))))

  return h('div', { className: 'jc-composeContainer' },
    h('dialog', { ref: dialog, 'aria-label': '自由拼图编辑', className: `jc-root jc-composeDialog ${expanded ? 'jc-composeDialogOpen' : 'jc-composeDialogInline'}`, onCancel: (e: { preventDefault(): void }) => { e.preventDefault(); setExpanded(false) } }, content))
}
