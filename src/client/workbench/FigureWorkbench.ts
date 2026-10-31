import { createElement as h, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { BBox, FigureRecord, JsonPatch, ProjectStore } from '../types.ts'
import { styles } from '../styles.ts'
import { bboxStyle, drawWithinRegion, editWithinRegion, expandRegionPatch, type PageSize, type ResizeHandle } from './geometry.ts'
import { AddFigure } from './AddFigure.ts'

export interface PageImage extends PageSize { readonly src: string }
export interface FigureWorkbenchProps {
  readonly store: ProjectStore
  readonly onOpenResource?: (path: string) => void
  readonly onFollowup?: (text: string) => void | Promise<void>
  readonly loadPage?: (documentPath: string, page: number) => Promise<PageImage>
}

/** baseRev：编辑开始时的 CAS 版本；recrop：写入成功后需从 PDF 重裁的 Panel（框发生变化的那些）。 */
export interface UpdateOptions { readonly baseRev?: number; readonly figureId?: string; readonly recrop?: readonly string[] }

export function FigureWorkbench(props: FigureWorkbenchProps): ReactElement {
  const { store } = props
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [error, setError] = useState<{message: string; figureId?: string}>()
  const [filter, setFilter] = useState('all')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string>()
  const sendingRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const writing = useRef(false)
  const figures = snapshot.figures
  async function update(patch: readonly JsonPatch[], options: UpdateOptions = {}): Promise<boolean> {
    if (writing.current || !figures) return false
    const { figureId, recrop = [] } = options
    writing.current = true
    setBusy(true)
    setError(undefined)
    setSent(undefined)
    try {
      const result = await store.updateFigures({ figures_json: 'figures.json', patch, base_rev: options.baseRev ?? figures.revision })
      if (!result.ok) setError({figureId, message: `图源已更新到 revision ${result.revision}，请根据重载后的内容重试；本次修改未覆盖其他修改。`})
      // 改框后立即从 PDF 重裁：figures/<id>.png 是 agent 读取的图，必须与工作台所见的框一致。
      // 框已保存；重裁失败只提示，不当作编辑失败。
      if (result.ok && recrop.length > 0 && store.cropPanels) {
        try {
          const crop = await store.cropPanels(recrop)
          if (crop.anomalies.length > 0) setError({figureId, message: `框已保存，但裁切未刷新：${crop.anomalies.map(item => `${item.id} ${item.kind}${item.detail ? `（${item.detail}）` : ''}`).join('；')}。确认图源时会全量重裁。`})
        } catch (cause) { setError({figureId, message: `框已保存，但裁切未刷新：${messageOf(cause)}。确认图源时会全量重裁。`}) }
      }
      await store.refresh()
      return result.ok
    } catch (cause) { setError({figureId, message: messageOf(cause)}); return false }
    finally { writing.current = false; setBusy(false) }
  }
  async function followup(text: string, figureId?: string): Promise<void> {
    if (sendingRef.current) return
    sendingRef.current = true; setSending(true); setSent(undefined); setError(undefined)
    try { await props.onFollowup?.(text); setSent(figureId ?? 'workflow') }
    catch (cause) { setError({figureId, message: messageOf(cause)}) }
    finally { sendingRef.current = false; setSending(false) }
  }
  if (!figures) return h('div', { className: styles.content }, snapshot.error ?? '正在读取 figures.json…')
  const pending = figures.figures.filter(f => f.status === 'pending').length
  const matchesFilter = (figure: FigureRecord) => filter === 'pending' ? figure.status === 'pending' : filter === 'flagged' ? figure.panels.some(p => p.flags.length) : true
  const errorHidden = error?.figureId && !figures.figures.some(f => f.id === error.figureId && matchesFilter(f))
  const flagged = figures.figures.reduce((n, f) => n + f.panels.filter(p => p.flags.length > 0).length, 0)
  return h('div', { className: `${styles.root} ${styles.workbench}` },
    h('div', { className: styles.header },
      h('div', null, h('h1', { className: styles.title }, '图源核对'), h('p', { className: styles.subtitle }, `${figures.figures.length} 个 Figure · ${pending} 个未查看 · ${flagged} 个 Panel 有疑点`)),
      h('div', {className: styles.inlineActions},
        h('label', {className: styles.subtitle}, '显示 ', h('select', {value: filter, onChange: (event: {target: {value: string}}) => setFilter(event.target.value)},
          h('option', {value: 'all'}, '全部图'), h('option', {value: 'pending'}, '未查看'), h('option', {value: 'flagged'}, '有疑点'))),
        h('button', { type: 'button', className: styles.secondaryAction, onClick: () => void store.refresh().catch(cause => setError({message: messageOf(cause)})) }, '刷新'))),
    (error && (!error.figureId || errorHidden)) || snapshot.error ? h('div', { className: styles.error, role: 'alert' }, errorHidden ? `${error.figureId}：${error.message}` : snapshot.error ?? error?.message) : null,
    h('div', { className: `${styles.content} ${styles.figureList}` }, h('div', { className: styles.stack },
      figures.figures.map((figure, index) => h('div', {key: figure.id, hidden: !matchesFilter(figure)}, h(FigureCard, {
        figure, index, revision: figures.revision, busy, sending,
        update: (patch, options) => update(patch, { ...options, figureId: figure.id }),
        error: error?.figureId === figure.id ? error.message : undefined,
        sent: sent === figure.id,
        changed: snapshot.changedFigureIds.includes(figure.id),
        documentPaths: figures.documents,
        loadPage: props.loadPage, onOpenResource: props.onOpenResource,
        onFollowup: props.onFollowup ? text => followup(text, figure.id) : undefined,
      }))),
      !figures.figures.some(matchesFilter)
        ? h('p', {className: styles.subtitle}, filter === 'all' ? '还没有 Figure；可通过下方入口补充图源。' : '没有符合条件的图，可切回全部图。') : null,
      props.loadPage ? h(AddFigure, { documents: figures.documents, busy, loadPage: props.loadPage, update, onFollowup: props.onFollowup }) : null)),
    props.onFollowup ? h('div', { className: styles.confirmBar },
      h('p', { className: styles.subtitle }, `${pending} 个 Figure 未查看，${flagged} 个 Panel 有疑点。可按当前状态继续。`),
      sent === 'workflow' ? h('p', {role: 'status', className: styles.subtitle}, '已发送至聊天，请查看后续回复。') : null,
      h('button', { type: 'button', className: styles.action, disabled: busy || sending, onClick: () => void followup('/jc confirm figures') }, sending ? '正在发送…' : '确认图源，生成大纲')) : null)

}

interface FigureCardProps {
  figure: FigureRecord
  index: number
  revision: number
  busy: boolean
  sending: boolean
  sent: boolean
  changed: boolean
  error?: string
  documentPaths: readonly { id: string; path: string; role: string }[]
  update(patch: readonly JsonPatch[], options?: Omit<UpdateOptions, 'figureId'>): Promise<boolean>
  loadPage?: FigureWorkbenchProps['loadPage']
  onOpenResource?: FigureWorkbenchProps['onOpenResource']
  onFollowup?: FigureWorkbenchProps['onFollowup']
}

function FigureCard(props: FigureCardProps): ReactElement {
  const { figure } = props
  const [selectedId, setSelectedId] = useState<string>()
  const [expanded, setExpanded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [collapsed, setCollapsed] = useState(figure.status === 'excluded')
  const [newPanelId, setNewPanelId] = useState<string>()
  const dialog = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [placeholderHeight, setPlaceholderHeight] = useState(0)
  useEffect(() => {
    if (figure.status === 'excluded') setCollapsed(true)
  }, [figure.status])
  useEffect(() => {
    if (expanded) dialog.current?.showModal?.()
  }, [expanded])
  const closeExpanded = () => { dialog.current?.close?.(); setExpanded(false) }
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'exclude'; commit(): Promise<boolean> }>()
  const selectedIndex = figure.panels.findIndex(p => p.id === selectedId)
  const selected = figure.panels[selectedIndex]
  useEffect(() => {
    if (selectedId && !figure.panels.some(panel => panel.id === selectedId)) setSelectedId(undefined)
  }, [selectedId, figure.panels])
  const root = `/figures/${props.index}`
  const edit = (patch: readonly JsonPatch[], recrop?: readonly string[]) => props.update([
    ...patch,
    { op: 'replace', path: `${root}/status`, value: 'adjusted' },
    { op: 'replace', path: '/status', value: 'draft' },
  ], { baseRev: props.revision, recrop })
  const controls = h('div', { className: styles.inlineActions },
    h('button', { type: 'button', className: styles.secondaryAction, disabled: props.busy, onClick: () => void props.update([{ op: 'replace', path: `${root}/status`, value: 'viewed' }]) }, figure.status === 'viewed' ? '已查看' : '标记已查看'),
    h('details', {className: styles.moreActions}, h('summary', null, '更多操作'),
    h('div', {className: styles.moreMenu, onClick: (event: {target: HTMLElement; currentTarget: HTMLElement}) => {
      if (event.target.closest('button')) event.currentTarget.closest('details')?.removeAttribute('open')
    }},
    h('button', { type: 'button', className: styles.dangerAction, disabled: props.busy, onClick: () => setConfirm({ kind: 'exclude', commit: () => props.update([{ op: 'replace', path: `${root}/status`, value: 'excluded' }], { baseRev: props.revision }) }) }, '排除本图'),
    props.onFollowup ? h('button', { type: 'button', className: styles.secondaryAction, disabled: props.busy || props.sending, onClick: () => void props.onFollowup?.(`请重新识别 Figure ${figure.id} 的 Panel，保留人工调整并说明冲突，经 update_figures 写入。`) }, '让 AI 重新识别') : null,
    props.onFollowup ? h('button', { type: 'button', className: styles.secondaryAction, disabled: props.busy || props.sending, onClick: () => void props.onFollowup?.(`请从 .history 快照查找 Figure ${figure.id} 的自动结果并恢复该图，不覆盖其他 Figure。`) }, '让 AI 恢复自动结果') : null)))
  const selectedDetails = selected ? h('div', { className: styles.inlineActions },
      h(PanelLabel, { key: selected.id, label: selected.label, disabled: props.busy, autoFocus: selected.id === newPanelId, onFocus: () => setNewPanelId(undefined), commit: (label: string) => {
        if ((label || null) === selected.label) return Promise.resolve(true)
        return edit([{ op: 'replace', path: `${root}/panels/${selectedIndex}/label`, value: label || null }, { op: 'replace', path: `${root}/panels/${selectedIndex}/flags`, value: [...new Set([...selected.flags, 'missing-caption'])] }, { op: 'replace', path: `${root}/panels/${selectedIndex}/origin`, value: 'manual' }])
      } }),
      h('button', { type: 'button', className: styles.dangerAction, disabled: props.busy, onClick: () => setConfirm({ kind: 'delete', commit: () => edit([{ op: 'remove', path: `${root}/panels/${selectedIndex}` }]) }) }, '删除 Panel')) : null
  const body = h('div', { className: styles.figureBody, ref: bodyRef },
    expanded && props.error ? h('div', {className: styles.error, role: 'alert'}, props.error) : null,
    props.sent ? h('p', {role: 'status', className: styles.subtitle}, '已发送至聊天，请查看后续回复。') : null,
    h('div', {className: styles.editorToolbar},
      h('div', {className: styles.panelsHeader},
        h('div', {className: styles.panelChips, 'aria-label': 'Panel 切换'}, figure.panels.map(panel => h('button', {key: panel.id, type: 'button', 'aria-pressed': panel.id === selectedId, className: `${styles.panelChip} ${panel.id === selectedId ? styles.panelChipSelected : ''}`, onClick: () => setSelectedId(panel.id)}, panel.label ?? '整图', panel.flags.length ? ' ⚠' : null))),
        h('button', {type: 'button', className: styles.secondaryAction, disabled: props.busy, onClick: () => setAdding(v => !v)}, adding ? '取消添加' : '＋ 添加 Panel')),
      controls),
    adding ? h('p', {className: styles.subtitle}, '在页图上拖出新框，再填写标签；空标签表示整图。') : null,
    confirm ? h('div', { className: styles.card, role: 'alert' }, confirm.kind === 'delete' ? '删除当前 Panel？下游引用需要复核。' : '排除本图？图源身份和图注仍将保留。',
      h('button', { type: 'button', disabled: props.busy, onClick: () => {
        void confirm.commit()
        setConfirm(undefined)
      } }, '确认'), h('button', { type: 'button', onClick: () => setConfirm(undefined) }, '取消')) : null,
    figure.regions.map((region, regionIndex) => h(RegionEditor, {
      key: `${region.document}:${region.page}:${regionIndex}`, regionIndex,
      documentPath: props.documentPaths.find(d => d.id === region.document)?.path ?? region.document,
      pageNumber: region.page, figure, selectedId, revision: props.revision,
      adding, disabled: props.busy, expanded, loadPage: props.loadPage,
      selectedDetails: selected?.region_index === regionIndex ? selectedDetails : undefined,
      onOpenResource: props.onOpenResource,
      onSelect: setSelectedId,
      onChange: (index: number, bbox: BBox) => edit([
        ...expandRegionPatch(`${root}/regions/${regionIndex}/bbox`, region.bbox, bbox),
        { op: 'replace', path: `${root}/panels/${index}/bbox`, value: [...bbox] },
        { op: 'replace', path: `${root}/panels/${index}/origin`, value: 'manual' },
      ], [figure.panels[index]!.id]),
      onAdd: async (bbox: BBox) => {
        const id = `panel_${crypto.randomUUID()}`
        // 重裁登记新 asset 会推进 revision；update 等待重裁与刷新完成后才聚焦标签，标签提交据此使用最新版本。
        if (await edit([...expandRegionPatch(`${root}/regions/${regionIndex}/bbox`, region.bbox, bbox), { op: 'add', path: `${root}/panels/-`, value: { id, label: null, region_index: regionIndex, bbox: [...bbox], caption_refs: [], flags: ['missing-caption'], origin: 'manual' } }], [id])) {
          setAdding(false); setSelectedId(id); setNewPanelId(id)
        }
      },
    })))
  function onKeyDown(event: ReactKeyboardEvent): void {
    const target = event.target as HTMLElement
    if (event.key === 'Escape') {
      if (adding) { event.preventDefault(); event.stopPropagation(); setAdding(false) }
      return
    }
    if (event.key === 'Delete' && selected && !props.busy && !target.closest?.('input, textarea, select, [contenteditable="true"]')) {
      event.preventDefault()
      setConfirm({kind: 'delete', commit: () => edit([{op: 'remove', path: `${root}/panels/${selectedIndex}`}])})
    }
  }
  const flagged = figure.panels.filter(panel => panel.flags.length).length
  return h('article', { className: `${styles.figure} ${props.changed ? styles.figureChanged : ''}`, 'data-figure-id': figure.id, onKeyDown },
    h('div', { className: styles.figureHeader },
      h('button', {type: 'button', className: styles.figureToggle, 'aria-expanded': !collapsed, onClick: () => setCollapsed(v => !v)}, `${collapsed ? '▸' : '▾'} ${figure.label ?? figure.id}`),
      h('div', {className: styles.figureMeta},
        h('span', {className: styles.badge}, ({ pending: '未查看', viewed: '已查看', adjusted: '已调整', excluded: '已排除' }[figure.status])),
        flagged ? h('span', {className: styles.warningBadge}, `⚠ 疑点 ${flagged}`) : null,
        props.changed ? h('span', {className: styles.changedBadge}, '刚刚变更') : null),
      h('button', { type: 'button', className: styles.secondaryAction, onClick: () => { setPlaceholderHeight(bodyRef.current?.getBoundingClientRect().height ?? 0); setExpanded(true) } }, '放大编辑')),
    !expanded && props.error ? h('div', {className: styles.error, role: 'alert'}, props.error) : null,
    // Keep the editor mounted when switching between inline and modal presentation.
    h('div', {hidden: collapsed && !expanded, style: expanded ? {height: placeholderHeight} : undefined},
      h('dialog', {ref: dialog, open: expanded ? undefined : true, className: expanded ? styles.modal : styles.inlineDialog,
        role: expanded ? 'dialog' : 'group', 'aria-modal': expanded ? true : undefined, 'aria-label': `${figure.label ?? figure.id} ${expanded ? '放大编辑' : '编辑'}`,
        onCancel: (event: {preventDefault(): void}) => { event.preventDefault(); if (adding) setAdding(false); else closeExpanded() }},
        expanded ? h('div', {className: styles.header}, h('strong', null, `${figure.label ?? figure.id} · 放大编辑`),
          h('button', {type: 'button', className: styles.secondaryAction, onClick: closeExpanded}, '关闭')) : null,
        h('div', {key: 'editor', className: styles.editorContainer}, body))))


}

/** 未提交输入只存于当前控件；文件监听不能替换它，提交使用开始编辑时的 CAS 版本。 */
function PanelLabel(props: { label: string | null; disabled: boolean; autoFocus?: boolean; onFocus?(): void; commit(label: string): Promise<boolean> }): ReactElement {
  const [draft, setDraft] = useState<string>()
  const commit = useRef(props.commit)
  const cancelled = useRef(false)
  return h('label', null, '标签 ', h('input', {
    autoFocus: props.autoFocus, value: draft ?? props.label ?? '', disabled: props.disabled, 'aria-label': 'Panel 标签',
    onFocus: () => { commit.current = props.commit; cancelled.current = false; props.onFocus?.() },
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; setDraft(undefined); event.currentTarget.blur() }
    },
    onBlur: async () => { if (!cancelled.current && draft !== undefined && await commit.current(draft)) setDraft(undefined) },
  }))
}

interface RegionEditorProps {
  regionIndex: number; documentPath: string; pageNumber: number; figure: FigureRecord
  selectedDetails?: ReactElement | null
  onOpenResource?: FigureWorkbenchProps['onOpenResource']
  selectedId?: string; revision: number; adding: boolean; disabled: boolean; expanded: boolean
  loadPage?: FigureWorkbenchProps['loadPage']
  onSelect(id: string): void
  onChange(index: number, bbox: BBox): Promise<boolean>
  onAdd(bbox: BBox): Promise<void>
}
interface Drag { index?: number; handle?: ResizeHandle; startX: number; startY: number; original: BBox; bbox: BBox; commit(bbox: BBox): void }

/** Adapted from SmartJC WorkspaceDivider: pointer capture + clamped keyboard resizing, in percentages. */
function ColumnDivider({ value, onChange }: {value: number; onChange(value: number): void}): ReactElement {
  const start = useRef<{x: number; value: number; width: number}>()
  const resize = (next: number) => onChange(Math.max(30, Math.min(75, next)))
  return h('div', {
    role: 'separator', 'aria-label': '调整原图与预览宽度', 'aria-orientation': 'vertical',
    'aria-valuemin': 30, 'aria-valuemax': 75, 'aria-valuenow': Math.round(value),
    'aria-valuetext': `原图 ${Math.round(value)}%，预览 ${Math.round(100 - value)}%`,
    tabIndex: 0, className: styles.columnDivider,
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault(); event.currentTarget.focus({preventScroll: true})
      start.current = {x: event.clientX, value, width: event.currentTarget.parentElement!.getBoundingClientRect().width}
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (start.current) resize(start.current.value + (event.clientX - start.current.x) / start.current.width * 100)
    },
    onPointerUp: () => { start.current = undefined },
    onPointerCancel: () => { start.current = undefined },
    onDoubleClick: () => resize(60),
    onKeyDown: (event: ReactKeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); resize(value + (event.key === 'ArrowLeft' ? -2 : 2))
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); resize(event.key === 'Home' ? 30 : 75)
      }
    },
  })
}

function RegionEditor(props: RegionEditorProps): ReactElement {
  const previewClipId = useId()
  const [leftShare, setLeftShare] = useState(60)
  const [zoom, setZoom] = useState(1)
  const [image, setImage] = useState<PageImage>()
  const [error, setError] = useState<string>()
  const [draft, setDraft] = useState<Drag>()
  const drag = useRef<Drag>()
  const frame = useRef<HTMLDivElement>(null)
  const evidence = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (evidence.current) evidence.current.scrollTop = 0
  }, [props.selectedId])
  useEffect(() => {
    drag.current = undefined; setDraft(undefined)
    setImage(undefined); setError(undefined)
  }, [props.documentPath, props.pageNumber])
  useEffect(() => {
    let active = true
    if (!props.loadPage) { setError('宿主尚未提供页图及页面尺寸。'); return }
    void props.loadPage(props.documentPath, props.pageNumber).then(value => { if (active) setImage(value) }).catch(cause => { if (active) setError(messageOf(cause)) })
    return () => { active = false }
  }, [props.loadPage, props.documentPath, props.pageNumber, props.revision])
  function point(event: ReactPointerEvent): [number, number] {
    const rect = frame.current!.getBoundingClientRect()
    return [(event.clientX - rect.left) / rect.width * image!.width, (event.clientY - rect.top) / rect.height * image!.height]
  }
  function start(event: ReactPointerEvent, index?: number, handle?: ResizeHandle): void {
    if (!image || props.disabled || (index === undefined && !props.adding)) return
    event.stopPropagation(); event.preventDefault(); frame.current?.focus?.({preventScroll: true})
    const [x, y] = point(event)
    const original: BBox = index === undefined ? [x, y, x, y] : props.figure.panels[index]!.bbox
    drag.current = { index, handle, startX: x, startY: y, original, bbox: original, commit: bbox => {
      if (index === undefined) { if (bbox[2] - bbox[0] >= 2 && bbox[3] - bbox[1] >= 2) void props.onAdd(bbox) }
      else if (JSON.stringify(original) !== JSON.stringify(bbox)) void props.onChange(index, bbox)
    } }
    setDraft(drag.current)
    frame.current!.setPointerCapture(event.pointerId)
    if (index !== undefined) props.onSelect(props.figure.panels[index]!.id)
  }
  const selectedIndex = props.figure.panels.findIndex(p => p.id === props.selectedId && p.region_index === props.regionIndex)
  const selected = props.figure.panels[selectedIndex]
  const preview = draft?.index === selectedIndex ? draft.bbox : props.figure.panels[selectedIndex]?.bbox
  if (!image) return h('div', null, h('p', { className: styles.subtitle }, error ?? '正在读取页图…'), props.selectedDetails)
  return h('div', {className: styles.regionLayout, style: {'--jc-columns': `minmax(220px, ${leftShare}fr) 10px minmax(220px, ${100 - leftShare}fr)`} as CSSProperties},
    h('div', {className: styles.canvasColumn},
      h('div', {className: styles.canvasToolbar},
        h('span', { className: styles.subtitle }, `${props.documentPath} · p.${props.pageNumber}`),
        h('label', {className: styles.subtitle}, '缩放 ', h('select', {value: zoom, onChange: (event: {target: {value: string}}) => setZoom(Number(event.target.value))}, ...[1, 1.5, 2].map(value => h('option', {key: value, value}, value === 1 ? '适应页面' : `${value * 100}%`))))),
    h('div', { className: `${styles.pageFrame} ${styles.zoomFrame}` }, h('div', {
      ref: frame, tabIndex: 0, 'aria-label': '图源编辑画布', className: styles.pageStage,
      style: { aspectRatio: `${image.width}/${image.height}`, width: `min(${zoom * 100}%, calc(var(--jc-editor-height) * ${image.width / image.height * zoom}))`, maxWidth: 'none', touchAction: 'none' },
      onPointerDown: (event: ReactPointerEvent) => start(event),
      onPointerMove: (event: ReactPointerEvent) => {
        const current = drag.current
        if (!current) return
        const [x, y] = point(event)
        const region: BBox = [0, 0, image.width, image.height]
        const bbox = current.index === undefined ? drawWithinRegion([current.startX, current.startY, x, y], region)
          : editWithinRegion(current.original, region, x - current.startX, y - current.startY, current.handle)
        drag.current = { ...current, bbox }; setDraft(drag.current)
      },
      onPointerUp: () => {
        const current = drag.current
        drag.current = undefined; setDraft(undefined)
        if (!current) return
        current.commit(current.bbox)
      },
      onPointerCancel: () => { drag.current = undefined; setDraft(undefined) },
    }, h('img', { src: image.src, alt: '论文页图', className: styles.pageImage, draggable: false }),
    props.figure.panels.map((panel, index) => panel.region_index !== props.regionIndex ? null : h('div', {
      key: panel.id, className: `${styles.panelBox} ${panel.flags.length ? styles.panelBoxFlagged : ''} ${panel.id === props.selectedId ? styles.panelBoxSelected : ''}`,
      style: { ...bboxStyle(draft?.index === index ? draft.bbox : panel.bbox, image), pointerEvents: props.adding ? 'none' : undefined }, title: flagText(panel.flags),
      onPointerDown: (event: ReactPointerEvent) => start(event, index),
    }, h('span', { className: styles.panelTag }, panel.label ?? '整图', panel.flags.length ? ' ⚠' : null),
    panel.id === props.selectedId ? (['nw', 'ne', 'sw', 'se'] as const).map(handle => h('button', { key: handle, type: 'button', className: `${styles.handle} ${styles[`handle${handle[0]!.toUpperCase()}${handle[1]}` as keyof typeof styles]}`, 'aria-label': `调整 ${panel.label ?? panel.id} ${handle} 角`, onPointerDown: (event: ReactPointerEvent) => start(event, index, handle) })) : null)),
    draft?.index === undefined && draft ? h('div', { className: styles.panelBox, style: bboxStyle(draft.bbox, image) }) : null))),
    h(ColumnDivider, {value: leftShare, onChange: setLeftShare}),
    h('section', {className: styles.panelDetail, 'aria-label': '当前 Panel'},
      h('div', {className: styles.panelTools},
        h('strong', {className: styles.subtitle}, selected ? `当前 Panel ${selected.label ?? '整图'} · 裁切预览` : '选择 Panel 查看裁切预览'),
        props.selectedDetails),
      h('div', {className: styles.panelEvidence, ref: evidence},
      preview ? h('svg', { className: styles.cropPreview, viewBox: `${preview[0]} ${preview[1]} ${preview[2] - preview[0]} ${preview[3] - preview[1]}`, role: 'img', 'aria-label': '当前选框裁切预览' },
      h('defs', null, h('clipPath', { id: previewClipId, clipPathUnits: 'userSpaceOnUse' }, h('rect', { x: preview[0], y: preview[1], width: preview[2] - preview[0], height: preview[3] - preview[1] }))),
      h('image', { href: image.src, width: image.width, height: image.height, clipPath: 'url(#' + previewClipId + ')' })) : null,
      selected?.asset && props.onOpenResource ? h('button', {type: 'button', className: styles.secondaryAction, onClick: () => props.onOpenResource?.(selected.asset!)}, '打开正式裁切') : null,
      selected?.flags.length ? h('p', {className: styles.warningText}, flagText(selected.flags)) : null,
      ...(selected?.caption_refs ?? []).map(index => h('p', {key: index, className: styles.captionLineSelected}, props.figure.caption?.sentences[index])),
      props.figure.caption ? h('details', {className: styles.caption}, h('summary', null, '完整图注'), props.figure.caption.sentences.map((sentence, index) => h('span', {key: index, className: `${styles.captionLine} ${selected?.caption_refs.includes(index) ? styles.captionLineSelected : ''}`}, sentence))) : null)))
}
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function flagText(flags: readonly string[]): string {
  const labels: Record<string, string> = {'missing-caption': '图注关联待复核', 'edge-cut': '边缘可能截断', overlap: '可能串入邻图', 'no-label': '标签待核对', 'cross-page': '跨页图待核对'}
  return flags.map(flag => labels[flag] ?? flag).join('、')
}
