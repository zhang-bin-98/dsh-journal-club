import { createElement as h, useEffect, useId, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { BBox, FigureRecord, JsonPatch, ProjectStore } from '../types.ts'
import { styles } from '../styles.ts'
import { bboxStyle, drawWithinRegion, editWithinRegion, type PageSize, type ResizeHandle } from './geometry.ts'
import { AddFigure } from './AddFigure.ts'

export interface PageImage extends PageSize { readonly src: string }
export interface FigureWorkbenchProps {
  readonly store: ProjectStore
  readonly onOpenResource?: (path: string) => void
  readonly onFollowup?: (text: string) => void | Promise<void>
  readonly loadPage?: (documentPath: string, page: number) => Promise<PageImage>
}

export function FigureWorkbench(props: FigureWorkbenchProps): ReactElement {
  const { store } = props
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const writing = useRef(false)
  const figures = snapshot.figures
  async function update(patch: readonly JsonPatch[], baseRev = figures?.revision): Promise<boolean> {
    if (writing.current || !figures) return false
    writing.current = true
    setBusy(true)
    setError(undefined)
    try {
      const result = await store.updateFigures({ figures_json: 'figures.json', patch, base_rev: baseRev ?? figures.revision })
      if (!result.ok) setError(`图源已更新到 revision ${result.revision}，请根据重载后的内容重试；本次修改未覆盖其他修改。`)
      await store.refresh()
      return result.ok
    } catch (cause) { setError(messageOf(cause)); return false }
    finally { writing.current = false; setBusy(false) }
  }
  async function followup(text: string): Promise<void> {
    try { await props.onFollowup?.(text) } catch (cause) { setError(messageOf(cause)) }
  }
  if (!figures) return h('div', { className: styles.content }, snapshot.error ?? '正在读取 figures.json…')
  const pending = figures.figures.filter(f => f.status === 'pending').length
  const flagged = figures.figures.reduce((n, f) => n + f.panels.filter(p => p.flags.length > 0).length, 0)
  return h('div', { className: styles.root },
    h('div', { className: styles.header },
      h('div', null, h('h1', { className: styles.title }, '图源核对'), h('p', { className: styles.subtitle }, `${figures.figures.length} 个 Figure · revision ${figures.revision}`)),
      h('button', { type: 'button', className: styles.secondaryAction, onClick: () => void store.refresh() }, '刷新')),
    error || snapshot.error ? h('div', { className: styles.error, role: 'alert' }, error ?? snapshot.error) : null,
    h('div', { className: styles.content }, h('div', { className: styles.stack },
      figures.figures.map((figure, index) => h(FigureCard, {
        key: figure.id, figure, index, revision: figures.revision, busy, update, error,
        changed: snapshot.changedFigureIds.includes(figure.id),
        documentPaths: figures.documents,
        loadPage: props.loadPage, onOpenResource: props.onOpenResource,
        onFollowup: props.onFollowup ? followup : undefined,
      })),
      !figures.figures.length ? h('p', null, '还没有 Figure；可通过下方入口补充图源。') : null,
      props.loadPage ? h(AddFigure, { documents: figures.documents, busy, loadPage: props.loadPage, update, onFollowup: props.onFollowup }) : null,
      props.onFollowup ? h('div', { className: styles.card },
        h('p', { className: styles.subtitle }, `${pending} 个 Figure 未查看，${flagged} 个 Panel 有疑点。确认将按当前图源继续。`),
        h('div', { className: styles.inlineActions },
          h('button', { type: 'button', className: styles.action, disabled: busy, onClick: () => void followup('/jc confirm figures') }, '确认图源，生成大纲'))) : null)))
}

interface FigureCardProps {
  figure: FigureRecord
  index: number
  revision: number
  busy: boolean
  changed: boolean
  error?: string
  documentPaths: readonly { id: string; path: string; role: string }[]
  update(patch: readonly JsonPatch[], baseRev?: number): Promise<boolean>
  loadPage?: FigureWorkbenchProps['loadPage']
  onOpenResource?: FigureWorkbenchProps['onOpenResource']
  onFollowup?: FigureWorkbenchProps['onFollowup']
}

function FigureCard(props: FigureCardProps): ReactElement {
  const { figure } = props
  const [selectedId, setSelectedId] = useState<string>()
  const [expanded, setExpanded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'exclude'; commit(): Promise<boolean> }>()
  const selectedIndex = figure.panels.findIndex(p => p.id === selectedId)
  const selected = figure.panels[selectedIndex]
  const root = `/figures/${props.index}`
  const edit = (patch: readonly JsonPatch[]) => props.update([
    ...patch,
    { op: 'replace', path: `${root}/status`, value: 'adjusted' },
    { op: 'replace', path: '/status', value: 'draft' },
  ], props.revision)
  const controls = h('div', { className: styles.inlineActions },
    h('button', { type: 'button', className: styles.secondaryAction, disabled: props.busy, onClick: () => setAdding(v => !v) }, adding ? '取消添加' : '＋ 添加 Panel'),
    h('button', { type: 'button', className: styles.secondaryAction, disabled: props.busy, onClick: () => void props.update([{ op: 'replace', path: `${root}/status`, value: 'viewed' }]) }, '采纳本图'),
    h('button', { type: 'button', className: styles.dangerAction, disabled: props.busy, onClick: () => setConfirm({ kind: 'exclude', commit: () => props.update([{ op: 'replace', path: `${root}/status`, value: 'excluded' }], props.revision) }) }, '排除本图'),
    props.onFollowup ? h('button', { type: 'button', className: styles.secondaryAction, onClick: () => void props.onFollowup?.(`请重新识别 Figure ${figure.id} 的 Panel，保留人工调整并说明冲突，经 update_figures 写入。`) }, '重新识别') : null,
    props.onFollowup ? h('button', { type: 'button', className: styles.secondaryAction, onClick: () => void props.onFollowup?.(`请从 .history 快照查找 Figure ${figure.id} 的自动结果并恢复该图，不覆盖其他 Figure。`) }, '恢复自动结果') : null)
  const body = h('div', { className: styles.figureBody },
    figure.regions.map((region, regionIndex) => h(RegionEditor, {
      key: `${region.document}:${region.page}:${regionIndex}`, regionIndex,
      documentPath: props.documentPaths.find(d => d.id === region.document)?.path ?? region.document,
      pageNumber: region.page, figure, selectedId, revision: props.revision,
      adding, disabled: props.busy, expanded, loadPage: props.loadPage,
      onSelect: setSelectedId,
      onChange: (index: number, bbox: BBox) => edit([
        { op: 'replace', path: `${root}/panels/${index}/bbox`, value: [...bbox] },
        { op: 'replace', path: `${root}/panels/${index}/origin`, value: 'manual' },
      ]),
      onAdd: async (bbox: BBox) => {
        const id = `panel_${crypto.randomUUID()}`
        if (await edit([{ op: 'add', path: `${root}/panels/-`, value: { id, label: null, region_index: regionIndex, bbox: [...bbox], caption_refs: [], flags: ['missing-caption'], origin: 'manual' } }])) {
          setAdding(false); setSelectedId(id)
        }
      },
    })),
    expanded && props.error ? h('div', { className: styles.error, role: 'alert' }, props.error) : null,
    controls,
    adding ? h('p', { className: styles.subtitle }, '在页图上拖出新框，再填写标签；空标签表示整图。') : null,
    h('div', { className: styles.panelChips }, figure.panels.map(panel => h('button', { key: panel.id, type: 'button', className: `${styles.panelChip} ${panel.id === selectedId ? styles.panelChipSelected : ''}`, onClick: () => setSelectedId(panel.id) }, panel.label ?? 'whole-Panel'))),
    selected ? h('div', { className: styles.inlineActions },
      h(PanelLabel, { key: selected.id, label: selected.label, disabled: props.busy, commit: (label: string) => {
        if ((label || null) === selected.label) return Promise.resolve(true)
        return edit([{ op: 'replace', path: `${root}/panels/${selectedIndex}/label`, value: label || null }, { op: 'replace', path: `${root}/panels/${selectedIndex}/flags`, value: [...new Set([...selected.flags, 'missing-caption'])] }, { op: 'replace', path: `${root}/panels/${selectedIndex}/origin`, value: 'manual' }])
      } }),
      h('button', { type: 'button', className: styles.dangerAction, disabled: props.busy, onClick: () => setConfirm({ kind: 'delete', commit: () => edit([{ op: 'remove', path: `${root}/panels/${selectedIndex}` }]) }) }, '删除 Panel'),
      selected.asset && props.onOpenResource ? h('button', { type: 'button', className: styles.secondaryAction, onClick: () => props.onOpenResource?.(selected.asset!) }, '打开正式裁切') : null,
      h('span', { className: styles.subtitle }, selected.flags.includes('missing-caption') ? '图注关联待复核' : selected.flags.join('、'))) : null,
    confirm ? h('div', { className: styles.card, role: 'alert' }, confirm.kind === 'delete' ? '删除当前 Panel？下游引用需要复核。' : '排除本图？图源身份和图注仍将保留。',
      h('button', { type: 'button', disabled: props.busy, onClick: () => {
        void confirm.commit()
        setConfirm(undefined)
      } }, '确认'), h('button', { type: 'button', onClick: () => setConfirm(undefined) }, '取消')) : null,
    figure.caption ? h('details', { className: styles.caption }, h('summary', null, '图注'), figure.caption.sentences.map((sentence, index) => h('span', { key: index, className: `${styles.captionLine} ${selected?.caption_refs.includes(index) ? styles.captionLineSelected : ''}` }, sentence))) : null)
  return h('article', { className: `${styles.figure} ${props.changed ? styles.figureChanged : ''}`, 'data-figure-id': figure.id },
    h('div', { className: styles.figureHeader }, h('strong', null, figure.label ?? figure.id),
      h('span', { className: styles.figureMeta }, ({ pending: '未查看', viewed: '已查看', adjusted: '已调整', excluded: '已排除' }[figure.status]), props.changed ? ' · 刚刚变更' : ''),
      h('button', { type: 'button', className: styles.secondaryAction, onClick: () => setExpanded(true) }, '放大编辑')),
    expanded ? h('div', { className: styles.modalBackdrop }, h('section', { className: styles.modal, role: 'dialog', 'aria-modal': true, 'aria-label': `${figure.label ?? figure.id} 放大编辑` },
      h('button', { type: 'button', className: styles.secondaryAction, onClick: () => setExpanded(false) }, '关闭'),
      body)) : body)
}

/** 未提交输入只存于当前控件；文件监听不能替换它，提交使用开始编辑时的 CAS 版本。 */
function PanelLabel(props: { label: string | null; disabled: boolean; commit(label: string): Promise<boolean> }): ReactElement {
  const [draft, setDraft] = useState<string>()
  const commit = useRef(props.commit)
  return h('label', null, '标签 ', h('input', {
    value: draft ?? props.label ?? '', disabled: props.disabled, 'aria-label': 'Panel 标签',
    onFocus: () => { commit.current = props.commit },
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: async () => { if (draft !== undefined && await commit.current(draft)) setDraft(undefined) },
  }))
}

interface RegionEditorProps {
  regionIndex: number; documentPath: string; pageNumber: number; figure: FigureRecord
  selectedId?: string; revision: number; adding: boolean; disabled: boolean; expanded: boolean
  loadPage?: FigureWorkbenchProps['loadPage']
  onSelect(id: string): void
  onChange(index: number, bbox: BBox): Promise<boolean>
  onAdd(bbox: BBox): Promise<void>
}
interface Drag { index?: number; handle?: ResizeHandle; startX: number; startY: number; original: BBox; bbox: BBox; commit(bbox: BBox): void }
function RegionEditor(props: RegionEditorProps): ReactElement {
  const previewClipId = useId()
  const [image, setImage] = useState<PageImage>()
  const [error, setError] = useState<string>()
  const [draft, setDraft] = useState<Drag>()
  const drag = useRef<Drag>()
  const frame = useRef<HTMLDivElement>(null)
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
    event.stopPropagation(); event.preventDefault()
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
  const preview = draft?.index === selectedIndex ? draft.bbox : props.figure.panels[selectedIndex]?.bbox
  if (!image) return h('p', { className: styles.subtitle }, error ?? '正在读取页图…')
  return h('div', null,
    h('p', { className: styles.subtitle }, `${props.documentPath} · p.${props.pageNumber}`),
    h('div', { className: styles.pageFrame }, h('div', {
      ref: frame, className: styles.pageStage,
      style: { aspectRatio: `${image.width}/${image.height}`, width: `min(100%, ${(props.expanded ? 750 : 390) * image.width / image.height}px)`, touchAction: 'none' },
      onPointerDown: (event: ReactPointerEvent) => start(event),
      onPointerMove: (event: ReactPointerEvent) => {
        const current = drag.current
        if (!current) return
        const [x, y] = point(event)
        const region = props.figure.regions[props.regionIndex]!.bbox
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
      key: panel.id, className: `${styles.panelBox} ${panel.id === props.selectedId ? styles.panelBoxSelected : ''}`,
      style: { ...bboxStyle(draft?.index === index ? draft.bbox : panel.bbox, image), pointerEvents: props.adding ? 'none' : undefined }, title: panel.flags.join('、'),
      onPointerDown: (event: ReactPointerEvent) => start(event, index),
    }, h('span', { className: styles.panelTag }, panel.label ?? 'whole'),
    panel.id === props.selectedId ? (['nw', 'ne', 'sw', 'se'] as const).map(handle => h('button', { key: handle, type: 'button', className: `${styles.handle} ${styles[`handle${handle[0]!.toUpperCase()}${handle[1]}` as keyof typeof styles]}`, 'aria-label': `调整 ${panel.label ?? panel.id} ${handle} 角`, onPointerDown: (event: ReactPointerEvent) => start(event, index, handle) })) : null)),
    draft?.index === undefined && draft ? h('div', { className: styles.panelBox, style: bboxStyle(draft.bbox, image) }) : null)),
    preview ? h('svg', { viewBox: `${preview[0]} ${preview[1]} ${preview[2] - preview[0]} ${preview[3] - preview[1]}`, role: 'img', 'aria-label': '当前选框裁切预览', style: { display: 'block', maxHeight: 200, width: '100%', overflow: 'hidden' } },
      h('defs', null, h('clipPath', { id: previewClipId, clipPathUnits: 'userSpaceOnUse' }, h('rect', { x: preview[0], y: preview[1], width: preview[2] - preview[0], height: preview[3] - preview[1] }))),
      h('image', { href: image.src, width: image.width, height: image.height, clipPath: 'url(#' + previewClipId + ')' })) : null)
}
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }
