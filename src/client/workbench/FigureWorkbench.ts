import {
  createElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react'
import type { FigurePanel, FigureRecord, FiguresFile, ProjectSnapshot, ProjectStore, JsonPatch } from '../types.ts'
import { isUpdateConflict } from '../types.ts'
import { bboxStyle, DEFAULT_PAGE_SIZE, normalizeBBox, resizeBBox, type PageSize, type ResizeHandle } from './geometry.ts'
import { styles } from '../styles.ts'

export interface FigureWorkbenchProps {
  readonly store: ProjectStore
  readonly onOpenResource?: (path: string) => void
}

export function FigureWorkbench({ store, onOpenResource }: FigureWorkbenchProps): ReactElement {
  const snapshot = useProjectSnapshot(store)
  const [selectedPanel, setSelectedPanel] = useState<string | undefined>()
  const [expanded, setExpanded] = useState(true)
  const [modalFigureId, setModalFigureId] = useState<string | undefined>()
  const [conflict, setConflict] = useState<string | undefined>()
  const figures = snapshot.figures
  if (figures === undefined) {
    return createElement('div', { className: styles.content },
      snapshot.error
        ? createElement('div', { className: styles.error, role: 'alert' }, snapshot.error)
        : createElement('div', { className: styles.card, role: 'status' }, '正在读取 figures.json…'),
    )
  }
  if (figures.figures.length === 0) {
    return createElement('div', { className: styles.content },
      createElement('div', { className: styles.empty },
        createElement('div', { className: styles.emptyIcon, 'aria-hidden': true }, '▧'),
        createElement('strong', null, '还没有 Figure'),
        createElement('p', { className: styles.subtitle }, '分析完成后，候选图源会写入 figures.json 并在这里出现。'),
      ),
    )
  }
  const update = async (patch: readonly JsonPatch[]) => {
    setConflict(undefined)
    const result = await store.updateFigures({ figures_json: projectFiguresPath(store), patch, base_rev: figures.revision })
    if (isUpdateConflict(result)) {
      setConflict(`figures.json 已被其他操作更新到 revision ${result.revision}。请重载后再调整，未覆盖对方修改。`)
      await store.refresh()
    }
  }
  const selected = selectedPanel === undefined ? undefined : findPanel(figures, selectedPanel)
  const modalFigure = modalFigureId === undefined ? undefined : figures.figures.find(figure => figure.id === modalFigureId)
  return createElement('div', { className: styles.root },
    createElement('div', { className: styles.header },
      createElement('div', null,
        createElement('p', { className: styles.eyebrow }, 'Journal Club · 图源核对'),
        createElement('h1', { className: styles.title }, '核对工作台'),
        createElement('p', { className: styles.subtitle }, `${figures.figures.length} 个 Figure · revision ${figures.revision}`),
      ),
      createElement('button', {
        className: styles.secondaryAction,
        type: 'button',
        onClick: () => void store.refresh(),
      }, '刷新'),
    ),
    conflict ? createElement('div', { className: styles.conflict, role: 'alert' }, conflict) : null,
    createElement('div', { className: styles.content },
      createElement('div', { className: styles.stack },
        figures.figures.map((figure, index) => createElement(FigureCard, {
          key: figure.id,
          figure,
          figureIndex: index,
          changed: snapshot.changedFigureIds.includes(figure.id),
          selectedPanelId: selected?.figure.id === figure.id ? selected.panel.id : undefined,
          store,
          expanded,
          documentPath: figures.documents.find(document => document.id === figure.regions[0]?.document)?.path,
          onToggleCaption: () => setExpanded(value => !value),
          onSelectPanel: panelId => setSelectedPanel(panelId),
          onResize: (panelIndex, bbox) => void update([{ op: 'replace', path: `/figures/${index}/panels/${panelIndex}/bbox`, value: [...bbox] }]),
          onStatus: status => void update([{ op: 'replace', path: `/figures/${index}/status`, value: status }]),
          onOpenResource,
          onOpenModal: () => setModalFigureId(figure.id),
        })),
      ),
    ),
    selected ? createElement(SelectedPanelDetails, { selected, store, onOpenResource }) : null,
    modalFigure ? createElement(FigureModal, {
      figure: modalFigure,
      store,
      selectedPanelId: selectedPanelIdForFigure(selected, modalFigure.id),
      onSelectPanel: panelId => setSelectedPanel(panelId),
      onClose: () => setModalFigureId(undefined),
    }) : null,
  )
}

function FigureCard(props: {
  readonly figure: FigureRecord
  readonly figureIndex: number
  readonly changed: boolean
  readonly selectedPanelId?: string
  readonly store: ProjectStore
  readonly documentPath?: string
  readonly expanded: boolean
  readonly onToggleCaption: () => void
  readonly onSelectPanel: (id: string) => void
  readonly onResize: (panelIndex: number, bbox: readonly [number, number, number, number]) => void
  readonly onStatus: (status: FigureRecord['status']) => void
  readonly onOpenResource?: (path: string) => void
  readonly onOpenModal: () => void
}): ReactElement {
  const { figure } = props
  const region = figure.regions[0]
  const page = pageForRegion(region?.bbox)
  const [pageSrc, setPageSrc] = useState<string>()
  useEffect(() => {
    let active = true
    if (region === undefined) return () => { active = false }
    const path = pageAssetPath(props.documentPath ?? region.document, region.page)
    void props.store.readAsset(path).then(src => {
      if (active) setPageSrc(src)
    }).catch(() => {
      if (active) setPageSrc(undefined)
    })
    return () => { active = false }
  }, [props.store, region?.document, region?.page])
  return createElement('article', {
    className: `${styles.figure} ${props.changed ? styles.figureChanged : ''}`,
    'data-figure-id': figure.id,
  },
    createElement('div', { className: styles.figureHeader },
      createElement('div', null,
        createElement('div', { className: styles.figureLabel }, figure.label ?? figure.id),
        createElement('div', { className: styles.figureMeta },
          region ? `${region.document} · p.${region.page}` : '缺少页面区域',
          figure.status === 'excluded' ? ' · 已排除' : '',
        ),
      ),
      createElement('div', { className: styles.figureMeta },
        figure.status === 'adjusted' ? createElement('span', { className: styles.badge }, '已调整') : null,
        figure.panels.some(panel => panel.flags.length > 0) ? createElement('span', { className: styles.warningBadge }, `疑点 ${figure.panels.filter(panel => panel.flags.length > 0).length}`) : null,
        props.changed ? createElement('span', { className: styles.changedBadge }, '刚刚变更') : null,
      ),
    ),
    createElement('div', { className: styles.figureBody },
      region ? createElement(PageCanvas, {
        src: pageSrc,
        page,
        panels: figure.panels,
        selectedPanelId: props.selectedPanelId,
        onSelectPanel: props.onSelectPanel,
        onResize: props.onResize,
      }) : null,
      createElement('div', { className: styles.panelsHeader },
        createElement('strong', { className: styles.subtitle }, 'Panels'),
        createElement('button', { className: styles.secondaryAction, type: 'button', onClick: props.onOpenModal }, '放大编辑'),
      ),
      createElement('div', { className: styles.panelChips },
        figure.panels.map(panel => createElement('button', {
          className: `${styles.panelChip} ${props.selectedPanelId === panel.id ? styles.panelChipSelected : ''}`,
          key: panel.id,
          type: 'button',
          onClick: () => props.onSelectPanel(panel.id),
        }, panel.label ?? 'whole-Panel', panel.flags.length > 0 ? ' ⚠' : '')),
      ),
      figure.caption ? createElement('details', { className: styles.caption, open: props.expanded },
        createElement('summary', { onClick: props.onToggleCaption }, '图注'),
        figure.caption.sentences.map((sentence, index) => createElement('span', {
          className: `${styles.captionLine} ${figure.panels.some(panel => panel.id === props.selectedPanelId && panel.caption_refs.includes(index)) ? styles.captionLineSelected : ''}`,
          key: `${figure.id}-caption-${index}`,
        }, sentence)),
      ) : null,
      createElement('div', { className: styles.inlineActions },
        createElement('button', { className: styles.secondaryAction, type: 'button', onClick: () => props.onStatus('viewed') }, '采纳本图'),
        createElement('button', { className: styles.dangerAction, type: 'button', onClick: () => props.onStatus('excluded') }, '排除本图'),
      ),
    ),
  )
}

/** Page image height cap in the sidebar; the stage keeps the page aspect ratio under it. */
const PAGE_MAX_HEIGHT = 390

function PageCanvas(props: {
  readonly src?: string
  readonly page: PageSize
  readonly panels: readonly FigurePanel[]
  readonly selectedPanelId?: string
  readonly onSelectPanel: (id: string) => void
  readonly onResize: (panelIndex: number, bbox: readonly [number, number, number, number]) => void
}): ReactElement {
  const frameRef = useRef<HTMLDivElement>(null)
  const [drafts, setDrafts] = useState<Record<string, FigurePanel['bbox']>>({})
  const [drag, setDrag] = useState<{ panelIndex: number; handle: ResizeHandle; startX: number; startY: number; bbox: FigurePanel['bbox'] }>()
  useEffect(() => {
    if (drag === undefined) return
    const onMove = (event: PointerEvent) => {
      const frame = frameRef.current
      if (frame === null) return
      const rect = frame.getBoundingClientRect()
      const dx = (event.clientX - drag.startX) / rect.width * props.page.width
      const dy = (event.clientY - drag.startY) / rect.height * props.page.height
      const bbox = resizeBBox(drag.bbox, drag.handle, dx, dy, props.page)
      setDrafts(current => ({ ...current, [props.panels[drag.panelIndex]?.id ?? '']: bbox }))
    }
    const onUp = () => {
      const panel = props.panels[drag.panelIndex]
      if (panel !== undefined) {
        const bbox = drafts[panel.id]
        if (bbox !== undefined) props.onResize(drag.panelIndex, bbox)
      }
      setDrag(undefined)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, drafts, props])
  const ratio = props.page.width / props.page.height
  const stageStyle: CSSProperties = { aspectRatio: `${props.page.width} / ${props.page.height}`, width: `min(100%, ${PAGE_MAX_HEIGHT * ratio}px)` }
  return createElement('div', { className: styles.pageFrame },
    createElement('div', { className: styles.pageStage, ref: frameRef, style: stageStyle },
    props.src ? createElement('img', { alt: '论文页图', className: styles.pageImage, src: props.src }) : createElement('div', { className: styles.pagePlaceholder }, '页面底图暂不可用，请确认 pages/ 已生成。'),
    props.panels.map((panel, panelIndex) => {
      const bbox = drafts[panel.id] ?? panel.bbox
      const style = bboxStyle(bbox, props.page) as CSSProperties
      const selected = panel.id === props.selectedPanelId
      return createElement('div', {
        className: `${styles.panelBox} ${selected ? styles.panelBoxSelected : ''}`,
        key: panel.id,
        style,
        title: panel.flags.length ? panel.flags.join('、') : undefined,
        onClick: () => props.onSelectPanel(panel.id),
      },
        createElement('button', { className: styles.panelTag, type: 'button', onClick: (event: ReactMouseEvent<HTMLButtonElement>) => { event.stopPropagation(); props.onSelectPanel(panel.id) } }, panel.label ?? 'whole'),
        selected ? (['nw', 'ne', 'sw', 'se'] as const).map(handle => createElement('button', {
          className: `${styles.handle} ${handleClass(handle)}`,
          key: handle,
          type: 'button',
          'aria-label': `调整 ${panel.label ?? panel.id} ${handle} 角`,
          onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
            event.stopPropagation()
            event.preventDefault()
            setDrag({ panelIndex, handle, startX: event.clientX, startY: event.clientY, bbox })
          },
        })) : null,
      )
    }),
    ),
  )
}

function SelectedPanelDetails(props: { readonly selected: { figure: FigureRecord; panel: FigurePanel }; readonly store: ProjectStore; readonly onOpenResource?: (path: string) => void }): ReactElement {
  const [asset, setAsset] = useState<string>()
  useEffect(() => {
    let active = true
    if (props.selected.panel.asset === undefined) return () => { active = false }
    void props.store.readAsset(props.selected.panel.asset).then(value => { if (active) setAsset(value) }).catch(() => { if (active) setAsset(undefined) })
    return () => { active = false }
  }, [props.store, props.selected.panel.asset])
  return createElement('aside', { className: styles.card, 'aria-label': '当前 Panel' },
    createElement('strong', null, `当前选中：${props.selected.panel.label ?? 'whole-Panel'}`),
    createElement('p', { className: styles.subtitle }, props.selected.panel.flags.length ? `疑点：${props.selected.panel.flags.join('、')}` : '没有标记疑点。'),
    asset ? createElement('img', { alt: 'Panel 裁切预览', className: styles.assetPreview, src: asset }) : null,
    props.selected.panel.asset && props.onOpenResource ? createElement('button', { className: styles.secondaryAction, type: 'button', onClick: () => props.onOpenResource?.(props.selected.panel.asset as string) }, '打开裁切预览') : null,
  )
}

function FigureModal(props: { readonly figure: FigureRecord; readonly store: ProjectStore; readonly selectedPanelId?: string; readonly onSelectPanel: (id: string) => void; readonly onClose: () => void }): ReactElement {
  const region = props.figure.regions[0]
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let active = true
    if (region !== undefined) void props.store.readAsset(pageAssetPath(region.document, region.page)).then(value => { if (active) setSrc(value) }).catch(() => undefined)
    return () => { active = false }
  }, [props.store, region?.document, region?.page])
  return createElement('div', { className: styles.modalBackdrop, role: 'presentation', onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) props.onClose() } },
    createElement('section', { className: styles.modal, role: 'dialog', 'aria-modal': true, 'aria-label': `${props.figure.label ?? props.figure.id} 放大编辑` },
      createElement('div', { className: styles.statusLine }, createElement('strong', null, props.figure.label ?? props.figure.id), createElement('button', { className: styles.secondaryAction, type: 'button', onClick: props.onClose }, '关闭')),
      createElement('div', { className: styles.figureBody }, region ? createElement(PageCanvas, { src, page: pageForRegion(region.bbox), panels: props.figure.panels, selectedPanelId: props.selectedPanelId, onSelectPanel: props.onSelectPanel, onResize: () => undefined }) : null),
    ),
  )
}

function useProjectSnapshot(store: ProjectStore): ProjectSnapshot {
  return useSyncExternalStoreCompat(store.subscribe, store.getSnapshot)
}

function useSyncExternalStoreCompat<T>(subscribe: (listener: () => void) => () => void, getSnapshot: () => T): T {
  const [snapshot, setSnapshot] = useState(getSnapshot)
  useEffect(() => subscribe(() => setSnapshot(getSnapshot())), [getSnapshot, subscribe])
  return snapshot
}

function findPanel(figures: FiguresFile, panelId: string): { figure: FigureRecord; panel: FigurePanel } | undefined {
  for (const figure of figures.figures) {
    const panel = figure.panels.find(item => item.id === panelId)
    if (panel !== undefined) return { figure, panel }
  }
  return undefined
}

function selectedPanelIdForFigure(selected: { figure: FigureRecord; panel: FigurePanel } | undefined, figureId: string): string | undefined {
  return selected?.figure.id === figureId ? selected.panel.id : undefined
}

function pageForRegion(bbox: readonly [number, number, number, number] | undefined): PageSize {
  if (bbox === undefined) return DEFAULT_PAGE_SIZE
  return { width: Math.max(DEFAULT_PAGE_SIZE.width, bbox[2]), height: Math.max(DEFAULT_PAGE_SIZE.height, bbox[3]) }
}

function pageAssetPath(document: string, page: number): string {
  const stem = document.split(/[\\/]/u).pop()?.replace(/\.[^.]+$/u, '').replace(/[^A-Za-z0-9._-]+/gu, '_') || 'doc'
  return `pages/${stem}-${String(page).padStart(3, '0')}.png`
}

function handleClass(handle: ResizeHandle): string {
  const first = handle.charAt(0).toUpperCase()
  return `handle${first}${handle.slice(1)}`
}

function projectFiguresPath(_store: ProjectStore): string {
  return 'figures.json'
}
