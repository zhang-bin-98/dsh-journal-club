import { createElement as h, useEffect, useRef, type ReactElement } from 'react'
import { AssetImage } from './MaterialBrowser.ts'
import { styles } from '../styles.ts'

interface Props {
  items: { id: string; asset?: string; dirty: boolean; stale?: boolean }[]
  current: string
  revision: string
  busy: boolean
  choose(id: string): void
  readAsset(path: string): Promise<string>
}

/** Wheel navigation belongs only to this rail; canvas/material scrolling stays native. */
export function GroupNavigator(props: Props): ReactElement {
  const list = useRef<HTMLDivElement>(null)
  const wheel = useRef({ delta: 0, last: 0, switched: 0 })
  const index = props.items.findIndex(item => item.id === props.current)
  useEffect(() => {
    const element = list.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY) return
      event.preventDefault(); event.stopPropagation()
      if (props.busy) return
      const now = Date.now(), state = wheel.current
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
      if (now - state.last > 200 || Math.sign(delta) !== Math.sign(state.delta)) state.delta = 0
      state.last = now
      if (now - state.switched < 180) return
      state.delta += delta
      if (Math.abs(state.delta) < 40) return
      const next = props.items[index + Math.sign(state.delta)]
      state.delta = 0; state.switched = now
      if (next) props.choose(next.id)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [props.items, props.busy, props.choose, index])
  useEffect(() => {
    const element = list.current, selected = element?.querySelector<HTMLElement>('[aria-current=true]')
    if (!element || !selected) return
    if (selected.offsetTop < element.scrollTop) element.scrollTop = selected.offsetTop
    else if (selected.offsetTop + selected.offsetHeight > element.scrollTop + element.clientHeight) element.scrollTop = selected.offsetTop + selected.offsetHeight - element.clientHeight
  }, [props.current])
  return h('nav', { className: 'jc-composeNav', 'aria-label': '拼图导航', onKeyDown: (event: { key: string; preventDefault(): void; stopPropagation(): void }) => {
    event.stopPropagation()
    if (props.busy || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = props.items[event.key === 'Home' ? 0 : event.key === 'End' ? props.items.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1)]
    if (next) props.choose(next.id)
  } },
    h('strong', null, '拼图'), h('span', { className: styles.subtitle }, '滚轮切换'),
    h('div', { ref: list, className: 'jc-composeGroupList', 'aria-label': '拼图列表', tabIndex: 0 },
      ...props.items.map(item => h('button', { key: item.id, type: 'button', className: 'jc-composeGroup', title: item.asset ? `${item.id} · 缩略图为已保存版本` : item.id, 'aria-label': `切换拼图 ${item.id}`, 'aria-current': item.id === props.current ? 'true' : undefined, disabled: props.busy, onClick: () => props.choose(item.id) },
        h('span', { className: 'jc-composeGroupImage' }, item.asset
          ? h(AssetImage, { key: `${item.asset}:${props.revision}`, asset: { asset: item.asset, label: item.id, digest: props.revision }, readAsset: props.readAsset, lazy: true })
          : h('span', null, '新拼图')),
        h('span', null, item.id),
        item.dirty ? h('small', null, '未保存') : null,
        item.stale ? h('small', null, '图源已变化 · 待保存') : null))))
}
