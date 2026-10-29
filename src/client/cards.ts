import { createElement as h, useEffect, useState, type ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { cardConfirmation, cardDefinition, fileResourceAddress, type CardMarker } from './cardMarker.ts'
import { styles } from './styles.ts'
import { parseFiguresJson, type FiguresJson } from '../figures/schema.ts'
import { workspaceFiles, unwrap, type WorkspaceRemote } from './workspace.ts'
import { sendSessionMessage, type SessionScopes } from './sessionActions.ts'

interface CardProps { readonly sessionId: string; readonly node: { readonly data: CardMarker } }
interface CardHost {
  readonly remote: { readonly workspaceFiles: WorkspaceRemote }
  readonly uiConversation: { readonly events: { register(definition: typeof cardDefinition): () => void } }
  readonly slots: {
    inject(name: string, register: () => () => void): unknown
    register(entry: { name: string; key: string }, render: (props: CardProps) => ReactElement): () => void
  }
  readonly sessions: SessionScopes
  readonly sidebarRight: {
    openResource(address: string): unknown
    openTab(kind: string, options?: { params: { project: string } }): unknown
  }
}
const LABELS = { figures: '图源核对', outline: '叙事大纲', deck: '幻灯片内容' } as const

/** The model contributes a display marker; only explicit button clicks send fixed user actions. */
export function registerCards(ctx: Context): void {
  const host = ctx as unknown as CardHost
  ctx.effect(() => host.uiConversation.events.register(cardDefinition), 'journal-club: card events')
  host.slots.inject('conversation.chat.node', () => host.slots.register(
    { name: 'conversation.chat.node', key: 'journal-club-card' },
    props => h(ConfirmationCard, { ...props, host }),
  ))
}

function ConfirmationCard({ node, sessionId, host }: CardProps & { readonly host: CardHost }): ReactElement {
  const marker = node.data
  const [error, setError] = useState<string>()
  const [sending, setSending] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const [figures, setFigures] = useState<FiguresJson>()
  const [thumbnails, setThumbnails] = useState<{ id: string; label: string; src: string }[]>([])
  const [readError, setReadError] = useState<string>()
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const urls: string[] = []
    const pathFor = (name: string) => marker.project ? marker.project + '/' + name : name
    setLoaded(false); setReadError(undefined); setFigures(undefined); setThumbnails([]); setFiles([])
    void (async () => {
      try {
        const listing = unwrap(await host.remote.workspaceFiles.list(sessionId, marker.project || '.', controller.signal))
        if (controller.signal.aborted) return
        const names = listing.entries.filter(entry => entry.type === 'file').map(entry => entry.name)
        setFiles(names)
        if (listing.truncated) setReadError('项目列表超过宿主上限；产物摘要可能不完整。')
        if (!names.includes('figures.json')) return
        const reader = workspaceFiles(host.remote.workspaceFiles)
        const source = await reader.read(sessionId, pathFor('figures.json'), controller.signal)
        const data = parseFiguresJson(source.text)
        if (controller.signal.aborted) return
        setFigures(data)
        const panels = data.figures.flatMap(figure => figure.panels).filter(panel => panel.asset).slice(0, 8)
        const images = await Promise.all(panels.map(async panel => {
          try {
            const image = await reader.readBytes(sessionId, pathFor(panel.asset!), controller.signal)
            if (controller.signal.aborted) return
            const src = URL.createObjectURL(new Blob([new Uint8Array(image.data)], { type: 'image/png' }))
            urls.push(src)
            return { id: panel.id, label: panel.label || panel.id, src }
          } catch { return }
        }))
        if (!controller.signal.aborted) {
          setThumbnails(images.filter((image): image is {id: string; label: string; src: string} => image !== undefined))
          if (images.some(image => image === undefined)) setReadError('部分裁切资产暂不可读；可刷新或在工作台核对。')
        }
      } catch (cause) { if (!controller.signal.aborted) setReadError(cause instanceof Error ? cause.message : String(cause)) }
      finally { if (!controller.signal.aborted) setLoaded(true) }
    })()
    return () => { controller.abort(); for (const url of urls) URL.revokeObjectURL(url) }
  }, [host, sessionId, marker.project, refresh])
  async function run(action: () => unknown | Promise<unknown>): Promise<void> {
    setError(undefined)
    setSending(true)
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSending(false) }
  }
  const filename = marker.stage === 'figures' ? 'figures.json' : `${marker.stage}.md`
  const path = marker.project ? `${marker.project}/${filename}` : filename
  return h('section', { className: `${styles.root} ${styles.card}`, 'aria-label': `Journal Club ${LABELS[marker.stage]}` },
    h('strong', null, `Journal Club · ${LABELS[marker.stage]}`),
    h('p', { className: styles.subtitle }, `项目：${marker.project || '当前目录'}。此卡片是确认入口，当前文件版本由 agent 核对。`),
    !loaded ? h('p', {className: styles.subtitle}, '正在读取当前产物…') : null,
    figures ? h('p', {className: styles.subtitle}, figures.figures.length + ' Figure · ' + figures.figures.reduce((n, f) => n + f.panels.length, 0) + ' Panel · 疑点 ' + figures.figures.reduce((n, f) => n + f.panels.filter(p => p.flags.length > 0).length, 0) + ' · revision ' + figures.revision) : loaded && !readError ? h('p', {className: styles.subtitle}, '尚未发现 figures.json') : null,
    marker.stage !== 'figures' && loaded && !readError ? h('p', {className: styles.subtitle}, files.includes(filename) ? filename + ' 已产出；内容与确认状态待核对。' : '尚未发现 ' + filename) : null,
    thumbnails.length ? h('div', {style: {display: 'flex', gap: 8, overflowX: 'auto'}, 'aria-label': '已有 Panel 缩略图（最多八张）'}, thumbnails.map(image => h('figure', {key: image.id, style: {margin: 0, flex: '0 0 96px'}}, h('img', {src: image.src, alt: image.label, style: {width: 96, height: 72, objectFit: 'contain'}}), h('figcaption', {className: styles.subtitle}, image.label)))) : null,
    h('p', {className: styles.subtitle}, '缩略图显示已有裁切资产；最新框以工作台为准。'),
    readError ? h('p', {className: styles.error, role: 'alert'}, readError) : null,
    h('div', { className: styles.inlineActions },
      h('button', {type: 'button', className: styles.secondaryAction, onClick: () => setRefresh(value => value + 1)}, '刷新摘要'),
      h('button', { type: 'button', className: styles.secondaryAction, disabled: sending, onClick: () => void run(() => marker.stage === 'figures'
        ? host.sidebarRight.openTab('journal-club', { params: { project: marker.project } })
        : host.sidebarRight.openResource(fileResourceAddress(sessionId, path))) }, marker.stage === 'figures' ? '打开核对工作台' : `预览 ${filename}`),
      h('button', { type: 'button', className: styles.action, disabled: sending, onClick: () => void run(() => sendSessionMessage(host.sessions, sessionId, cardConfirmation(marker))) }, marker.stage === 'deck' ? '确认内容，渲染 PPTX' : '确认并继续')),
    error ? h('p', { className: styles.error, role: 'alert' }, error) : null)
}
