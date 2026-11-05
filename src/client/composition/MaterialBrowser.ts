import { createElement as h, useEffect, useRef, useState, type ReactElement } from 'react'
import type { CompositionAsset } from '../../layout/composition.ts'
import { styles } from '../styles.ts'

interface Props {
  assets: readonly CompositionAsset[]
  members: readonly string[]
  selected?: string
  busy: boolean
  readAsset(path: string): Promise<string>
  add(asset: CompositionAsset): void
  select(id: string): void
}

/** Material browsing changes neither geometry nor selection until an explicit action. */
export function MaterialBrowser(props: Props): ReactElement {
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState<string>()
  const opener = useRef<HTMLButtonElement>()
  useEffect(() => {
    if (preview === undefined) opener.current?.focus({ preventScroll: true })
  }, [preview])
  const groups = new Map<string, CompositionAsset[]>()
  for (const asset of props.assets) {
    if (!`${asset.label} ${asset.id}`.toLowerCase().includes(search.trim().toLowerCase())) continue
    const separator = asset.label.lastIndexOf(' · ')
    const figure = separator < 0 ? '图片' : asset.label.slice(0, separator)
    const group = groups.get(figure) ?? []
    group.push(asset); groups.set(figure, group)
  }
  const shown = props.assets.find(a => a.id === preview)
  return h('div', { className: 'jc-materialBrowser' },
    h('input', { 'aria-label': '搜索图片', placeholder: '搜索 Figure / Panel', value: search, onChange: (e: { target: { value: string } }) => setSearch(e.target.value) }),
    h('p', { className: styles.subtitle }, '点击缩略图看大图，点「＋」加入画布。'),
    h('div', { className: 'jc-materialList', 'aria-label': '素材列表' },
      groups.size === 0 ? h('p', { className: styles.subtitle }, search.trim() ? '没有匹配的图片' : '暂无可用图片，请先裁切 Panel。') : null,
      ...Array.from(groups, ([figure, assets]) => h('section', { key: figure, 'aria-label': figure },
        h('h3', { className: 'jc-materialGroupTitle' }, figure),
        ...assets.map(asset => {
          const added = props.members.includes(asset.id)
          return h('article', { key: asset.id, className: 'jc-materialCard', 'data-selected': props.selected === asset.id },
            h('button', { type: 'button', className: 'jc-materialThumbnail', 'aria-label': `预览 ${asset.label}`, onClick: (e: { currentTarget: HTMLButtonElement }) => { opener.current = e.currentTarget; setPreview(asset.id) } },
              h(AssetImage, { key: asset.digest, asset, readAsset: props.readAsset, lazy: true })),
            h('div', { className: 'jc-materialCaption' },
              h('span', null, asset.label),
              h('button', { type: 'button', className: styles.secondaryAction, disabled: props.busy && !added, 'aria-label': added ? `定位 ${asset.label}` : `加入 ${asset.label}`, 'aria-pressed': added ? props.selected === asset.id : undefined, onClick: () => added ? props.select(asset.id) : props.add(asset) }, added ? '已加入 · 定位' : '＋')))
        })))),
    shown ? h(MaterialPreview, { key: `${shown.id}:${shown.digest}`, asset: shown, readAsset: props.readAsset, added: props.members.includes(shown.id), busy: props.busy, close: () => setPreview(undefined), add: () => props.add(shown), select: () => { opener.current = undefined; setPreview(undefined); props.select(shown.id) } }) : null)
}

/** Defer the file read itself, not only image decoding; reuse the store's file cache. */
export function AssetImage(props: { asset: Pick<CompositionAsset, 'asset' | 'digest' | 'label'> & Partial<Pick<CompositionAsset, 'width' | 'height'>>; readAsset(path: string): Promise<string>; lazy?: boolean; original?: boolean }): ReactElement {
  const container = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(!props.lazy)
  const [source, setSource] = useState<string>()
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!props.lazy || visible) return
    if (!container.current || typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '120px' })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [props.lazy, visible])
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setError(false)
    void props.readAsset(props.asset.asset).then(src => {
      if (!cancelled) { if (src) setSource(src); else setError(true) }
    }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [visible, props.asset.asset, props.asset.digest, props.readAsset, retry])
  return h('span', { ref: container, className: `jc-materialImage ${props.original ? 'jc-materialImageOriginal' : ''}` },
    error ? h('span', { className: styles.subtitle }, '图片加载失败', props.lazy ? '，点击查看并重试' : h('button', { type: 'button', className: styles.secondaryAction, onClick: () => { setSource(undefined); setRetry(n => n + 1) } }, '重试'))
      : source ? h('img', { src: source, alt: props.asset.label, draggable: false, decoding: 'async', style: props.original ? { width: props.asset.width, height: props.asset.height } : undefined, onError: () => setError(true) })
        : h('span', { className: styles.subtitle }, visible ? '正在加载…' : '缩略图'))
}

function MaterialPreview(props: { asset: CompositionAsset; readAsset(path: string): Promise<string>; added: boolean; busy: boolean; close(): void; add(): void; select(): void }): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  const [original, setOriginal] = useState(false)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { if (element?.open) element.close() }
  }, [])
  function close() { dialog.current?.close(); props.close() }
  return h('dialog', { ref: dialog, className: 'jc-root jc-materialPreview', 'aria-label': `素材预览 ${props.asset.label}`, onKeyDown: (e: { stopPropagation(): void }) => e.stopPropagation(), onCancel: (e: { preventDefault(): void; stopPropagation(): void }) => { e.preventDefault(); e.stopPropagation(); close() } },
    h('div', { className: styles.header }, h('strong', null, props.asset.label),
      h('button', { type: 'button', className: styles.secondaryAction, 'aria-pressed': original, onClick: () => setOriginal(v => !v) }, original ? '适应窗口' : '原图尺寸'),
      h('button', { type: 'button', className: styles.secondaryAction, autoFocus: true, onClick: close }, '关闭预览')),
    h('div', { className: 'jc-materialPreviewBody' }, h(AssetImage, { asset: props.asset, readAsset: props.readAsset, original })),
    h('div', { className: styles.header }, h('span', { className: styles.subtitle }, `${props.asset.width} × ${props.asset.height} · 保持原图比例`),
      h('button', { type: 'button', className: styles.action, disabled: props.busy && !props.added, onClick: () => { if (props.added) { dialog.current?.close(); props.select() } else props.add() } }, props.added ? '已加入 · 定位到画布' : '＋ 加入画布')))
}
