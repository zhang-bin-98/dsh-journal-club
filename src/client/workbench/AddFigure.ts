import { createElement as h, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { BBox, FigureDocument, FigureRecord, JsonPatch } from '../types.ts'
import type { PageImage, UpdateOptions } from './FigureWorkbench.ts'
import { bboxStyle, drawWithinRegion } from './geometry.ts'
import { styles } from '../styles.ts'

interface Props {
  documents: readonly FigureDocument[]
  busy: boolean
  loadPage(document: string, page: number): Promise<PageImage>
  update(patch: readonly JsonPatch[], options?: Pick<UpdateOptions, 'recrop'>): Promise<boolean>
  onFollowup?: (text: string) => void | Promise<void>
}

/** A manually located Figure remains a usable whole-panel until the agent refines it. */
export function manualFigure(document: FigureDocument, page: number, bbox: BBox, label: string, id: string): FigureRecord {
  if (!Number.isInteger(page) || page < 1 || page > document.pages) throw new Error('页码超出来源文档范围')
  if (!bbox.every(Number.isFinite) || bbox[2] - bbox[0] < 2 || bbox[3] - bbox[1] < 2) throw new Error('请绘制有效的整图范围')
  return {
    id, label: label.trim() || null, status: 'adjusted',
    regions: [{ document: document.id, page, bbox: [...bbox] }],
    caption: { page, sentences: [] },
    panels: [{ id: `${id}_whole`, label: null, region_index: 0, bbox: [...bbox], caption_refs: [], flags: ['missing-caption'], origin: 'manual' }],
  }
}

export function addFigurePatch(figure: FigureRecord): readonly JsonPatch[] {
  return [{ op: 'add', path: '/figures/-', value: figure }, { op: 'replace', path: '/status', value: 'draft' }]
}

export function AddFigure(props: Props): ReactElement {
  const [open, setOpen] = useState(false)
  const [documentId, setDocumentId] = useState(props.documents[0]?.id ?? '')
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [label, setLabel] = useState('')
  const [image, setImage] = useState<PageImage>()
  const [bbox, setBbox] = useState<BBox>()
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState<FigureRecord>()
  const [sending, setSending] = useState(false)
  const [reload, setReload] = useState(0)
  const saving = useRef(false)
  const id = useRef<string>()
  const frame = useRef<HTMLDivElement>(null)
  const start = useRef<[number, number]>()
  const document = props.documents.find(d => d.id === documentId)
  // 换文档/换页/手动重读才清空页图；文件刷新只换 loadPage 引用，同页重读期间保留旧图，不打断拖框。
  useEffect(() => { setImage(undefined); setError(undefined) }, [open, document?.path, page, reload])
  useEffect(() => {
    if (!open || !document || page < 1 || page > document.pages) return
    let active = true
    void props.loadPage(document.path, page).then(value => { if (active) { setImage(value); setError(undefined) } }).catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [open, document?.path, page, props.loadPage, reload])
  const pageValid = /^\d+$/.test(pageInput) && Number(pageInput) >= 1 && Number(pageInput) <= (document?.pages ?? 0)
  const disabled = props.busy || sending || saved !== undefined
  function point(event: ReactPointerEvent): [number, number] {
    const rect = frame.current!.getBoundingClientRect()
    return [(event.clientX - rect.left) / rect.width * image!.width, (event.clientY - rect.top) / rect.height * image!.height]
  }
  async function complete(figure: FigureRecord): Promise<void> {
    if (!props.onFollowup) return
    setSending(true); setError(undefined)
    try {
      await props.onFollowup(`已手工补入 Figure ${figure.id}（${figure.label ?? '未标图号'}），来源 ${JSON.stringify(document?.path)} 第 ${page} 页。请保留人工整图框，核对原文图注并补充 Panel/图注关联，经 update_figures 写入；若需改变人工框先说明。`)
      setOpen(false); setSaved(undefined); setBbox(undefined); setLabel(''); id.current = undefined
    } catch (cause) { setError(`人工框已保存，后续请求发送失败，可重试：${String(cause)}`) }
    finally { setSending(false) }
  }
  async function save(): Promise<void> {
    if (saving.current || disabled || !pageValid || !document || !bbox) return
    saving.current = true
    setError(undefined)
    try {
      id.current ??= `figure_${crypto.randomUUID()}`
      const figure = manualFigure(document, page, bbox, label, id.current)
      if (!await props.update(addFigurePatch(figure), { recrop: figure.panels.map(panel => panel.id) })) return
      setSaved(figure)
      await complete(figure)
    } catch (cause) { setError(String(cause)) }
    finally { saving.current = false }
  }
  return h('section', { className: styles.card },
    h('button', { type: 'button', className: styles.secondaryAction, disabled: props.busy || sending, onClick: () => setOpen(v => !v) }, open ? '收起补图' : '漏了一张图？'),
    open ? h('div', { className: styles.stack },
      h('label', null, '来源文件 ', h('select', { 'aria-label': '补图来源文件', value: documentId, disabled, onChange: (e: { target: { value: string } }) => { setDocumentId(e.target.value); setPage(1); setPageInput('1'); setBbox(undefined); start.current = undefined } },
        props.documents.map(d => h('option', { key: d.id, value: d.id }, `${d.role === 'main' ? '主论文' : '补充材料'} · ${d.path}`)))),
      h('label', null, '页码 ', h('input', { type: 'number', 'aria-label': '补图页码', min: 1, max: document?.pages, value: pageInput, disabled, onChange: (e: { target: { value: string } }) => {
        const value = e.target.value; setPageInput(value)
        if (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= (document?.pages ?? 0) && Number(value) !== page) { setPage(Number(value)); setBbox(undefined); start.current = undefined }
      }  })),
      h('label', null, '图号（可空） ', h('input', { 'aria-label': '补图图号', value: label, disabled, onChange: (e: { target: { value: string } }) => setLabel(e.target.value) })),
      error ? h('div', null, h('p', { className: styles.error, role: 'alert' }, error),
        !image ? h('button', { type: 'button', onClick: () => setReload(v => v + 1) }, '重读页图') : null,
        !image && props.onFollowup && document ? h('button', { type: 'button', disabled: sending, onClick: () => {
          setSending(true)
          void Promise.resolve(props.onFollowup?.(`请用 render_pages 渲染 ${JSON.stringify(document.path)} 的第 ${page} 页，供手工补图；保留已有图源。`))
            .catch(cause => setError(String(cause))).finally(() => setSending(false))
        } }, '生成该页预览') : null) : null,
      !pageValid ? h('p', {className: styles.subtitle}, '请输入来源文档范围内的整数页码；当前保留上一页预览。') : null,
        image ? h('div', { className: styles.pageFrame }, h('div', {
          ref: frame, className: styles.pageStage, style: { aspectRatio: `${image.width}/${image.height}`, width: '100%', touchAction: 'none' },
          onPointerDown: (event: ReactPointerEvent) => { if (disabled || !pageValid) return; event.preventDefault(); start.current = point(event); setBbox(undefined); frame.current!.setPointerCapture(event.pointerId) },
          onPointerMove: (event: ReactPointerEvent) => { if (!start.current || disabled || !pageValid) return; const end = point(event); setBbox(drawWithinRegion([...start.current, ...end] as BBox, [0, 0, image.width, image.height])) },
          onPointerUp: () => { start.current = undefined },
          onPointerCancel: () => { start.current = undefined; setBbox(undefined) },
        }, h('img', { src: image.src, className: styles.pageImage, alt: '补图页图：拖选整图范围', draggable: false }),
        bbox ? h('div', { className: styles.panelBox, style: { ...bboxStyle(bbox, image), pointerEvents: 'none' } }) : null)) : error ? null : h('p', null, '正在读取页图…'),
      saved ? h('div', null, h('p', null, '人工整图框已保存，图注关联待复核。'), props.onFollowup ? h('button', { type: 'button', disabled: sending, onClick: () => void complete(saved) }, '重试补充 Panel 与图注') : null,
        h('button', { type: 'button', disabled: sending, onClick: () => { setSaved(undefined); setBbox(undefined); setLabel(''); id.current = undefined } }, '继续补图')) :
        h('button', { type: 'button', className: styles.action, disabled: disabled || !pageValid || !bbox || !image, onClick: () => void save() }, '保存整图并补充图注')) : null)
}
