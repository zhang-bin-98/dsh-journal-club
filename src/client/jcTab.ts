import { createElement as h, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { createProjectStore } from './store.ts'
import { FigureWorkbench } from './workbench/FigureWorkbench.ts'
import { workspaceFiles, discoverProjects, fileAddress, unwrap, type WorkspaceRemote, type ProjectEntry } from './workspace.ts'
import type { UpdateFiguresRequest, UpdateFiguresResult } from './types.ts'
import { ensureStyles, styles } from './styles.ts'
import { projectStatus } from './projectStatus.ts'

const TAB_ID = 'dsh-journal-club'
const TAB_KIND = 'journal-club'
const GUIDE_ID = 'journal-club'
interface SidebarTabBodyProps {
  sessionId: string
  useTabInfo: () => { tab: { navigation?: { params?: { project?: string } } } }
}
interface WorkspaceRemotes {
  workspaceFiles: WorkspaceRemote
  journalClub: {
    updateFigures(sessionId: string, request: UpdateFiguresRequest, signal: AbortSignal): Promise<{ok: true; value: UpdateFiguresResult} | {ok: false; error: {message: string}}>
    pageInfo(sessionId: string, project: string, document: string, page: number, signal: AbortSignal): Promise<{ok: true; value: {path: string; width: number; height: number}} | {ok: false; error: {message: string}}>
  }
}
interface ClientContext extends Context {
  slots?: {
    inject(name: string, callback: () => () => void): () => void
    register(entry: {name: string; key: string}, factory: (props: SidebarTabBodyProps) => ReactElement): () => void
  }
  sidebarRightTabs?: { register(definition: {id: string; kind: string; title: () => string; keepMounted: boolean; guide: {id: string; order: number; title: () => string; description: () => string}[]}): () => void }
  remote?: WorkspaceRemotes
  sidebarRight?: { openResource(address: string): void }
}
interface SessionSender { scope(id: string): { conversation: { send(text: string): Promise<void> } } }

export function JournalClubTab(props: SidebarTabBodyProps & {remote: WorkspaceRemotes; context: ClientContext}): ReactElement {
  const navigation = props.useTabInfo().tab.navigation?.params?.project
  const [projectPath, setProjectPath] = useState(navigation ?? '')
  const [projects, setProjects] = useState<ProjectEntry[]>([])
  const [error, setError] = useState<string>()
  const [scanRevision, setScanRevision] = useState(0)
  const [artifacts, setArtifacts] = useState<string[]>([])
  const files = useMemo(() => workspaceFiles(props.remote.workspaceFiles), [props.remote])
  const store = useMemo(() => createProjectStore({
    files, sessionId: props.sessionId, projectPath,
    updateFigures: { updateFigures: async request => unwrap(await props.remote.journalClub.updateFigures(props.sessionId, request, new AbortController().signal)) },
  }), [files, props.remote, props.sessionId, projectPath])
  useEffect(() => () => store.dispose(), [store])
  useEffect(() => { if (navigation !== undefined) setProjectPath(navigation) }, [navigation])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const status = projectStatus(snapshot.jcText, artifacts, snapshot.figures)
  useEffect(() => {
    const controller = new AbortController()
    const scan = async () => {
      try {
        const entries = await discoverProjects(props.remote.workspaceFiles, props.sessionId, controller.signal)
        if (controller.signal.aborted) return
        setProjects(entries)
        setError(undefined)
        if (navigation === undefined && entries.length === 1) setProjectPath(entries[0]!.path)
      } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
    }
    void scan()
    void (async () => {
      try { for await (const _ of props.remote.workspaceFiles.changes(props.sessionId, '.', controller.signal)) await scan() }
      catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
    })()
    return () => controller.abort()
  }, [props.remote, props.sessionId, navigation, scanRevision])
  useEffect(() => {
    const controller = new AbortController()
    setArtifacts([])
    void props.remote.workspaceFiles.list(props.sessionId, projectPath || '.', controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (result.ok) setArtifacts(result.value.entries.filter(e => e.type === 'file').map(e => e.name))
      else setError(result.error.message)
    }).catch(cause => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [props.remote, props.sessionId, projectPath, snapshot.loadedAt])
  const followup = useCallback(async (text: string) => {
    const sessions = props.context.sessions as unknown as SessionSender
    await sessions.scope(props.sessionId).conversation.send('项目：' + JSON.stringify(projectPath || '.') + '\n' + text)
  }, [props.context, props.sessionId, projectPath])
  const open = (path: string) => props.context.sidebarRight?.openResource(fileAddress(props.sessionId, projectPath ? projectPath + '/' + path : path))
  const loadPage = useCallback(async (document: string, page: number) => {
    const info = unwrap(await props.remote.journalClub.pageInfo(props.sessionId, projectPath, document, page, new AbortController().signal))
    return {...info, src: await store.readAsset(info.path)}
  }, [props.remote, props.sessionId, projectPath, store, snapshot.loadedAt])
  return h('div', {className: styles.root, style: {display: 'block', overflow: 'auto', height: '100%'}},
    h('div', {className: styles.content},
      projects.length > 1 ? h('label', null, '打开项目 ', h('select', {value: projectPath, onChange: (e: {target: {value: string}}) => { setProjectPath(e.target.value); setError(undefined) }},
        h('option', {value: ''}, '请选择项目'), ...projects.map(p => h('option', {key: p.path, value: p.path}, p.title)))) : null,
      h('button', {className: styles.secondaryAction, onClick: () => setScanRevision(n => n + 1)}, '重新扫描项目'),
      h('p', {className: styles.subtitle}, '项目：' + (projectPath || '当前工作目录')),
      error || snapshot.error ? h('p', {role: 'alert', className: styles.error}, error ?? snapshot.error) : null,
      snapshot.jcText ? h('section', {'aria-label': '项目进度'},
        h('h2', null, status.title || '项目进度'),
        h('ol', null, ...status.steps.map(step => h('li', {key: step.id},
          h('strong', null, step.label + (step.produced ? ' · 已有产物' : ' · 待产出')),
          h('p', {className: styles.subtitle}, step.detail)))),
        h('p', {className: styles.subtitle}, status.confirmationNote)) : null,
      snapshot.jcText ? h('div', {className: styles.inlineActions},
        ...['jc.md','analysis.md','outline.md','deck.md'].filter(p => artifacts.includes(p)).map(path => h('button', {key: path, className: styles.secondaryAction, onClick: () => open(path)}, '预览 ' + path)),
        h('button', {className: styles.action, onClick: () => void followup('继续 journal club；先核对产物和确认记录，再从有效断点恢复。').catch(e => setError(String(e)))}, '继续项目')) : null,
    ),
    snapshot.figures ? h(FigureWorkbench, {key: `${props.sessionId}:${projectPath}`, store, loadPage, onFollowup: followup, onOpenResource: open}) :
      h('div', {className: styles.content}, h('h2', null, snapshot.jcText ? '项目状态' : '还没有当前项目'),
        h('p', null, snapshot.jcText ? '已读取 jc.md；产物与确认有效性由对话核对。' : '把论文 PDF 拖进聊天，或让我切分、拼图、渲染。'),
        snapshot.jcText ? h('p', null, snapshot.jcText.replace(/^---[\s\S]*?---/u, '').trim().slice(0, 240)) : null),
  )
}

/** Host services this client needs; the loader activates `apply` only once all are present. */
export const inject = ['slots', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles', 'sessions', 'conversation', 'sidebarRight']

export function apply(ctx: Context): void {
  ensureStyles()
  const active = ctx as ClientContext
  const tabs = active.sidebarRightTabs
  const slots = active.slots
  const remote = active.remote
  if (tabs === undefined || slots === undefined || remote === undefined) {
    throw new Error('dsh-journal-club: sidebarRightTabs / slots / remote 服务不可用')
  }
  ctx.effect(() => tabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    keepMounted: false,
    title: () => 'Journal Club',
    guide: [{
      id: GUIDE_ID,
      order: 80,
      title: () => 'Journal Club',
      description: () => '论文图源、确认点与项目状态',
    }],
  }), 'journal-club: tab type')
  ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register(
    { name: 'sidebar.right.pane.tab', key: TAB_ID },
    props => h(JournalClubTab, { ...props, remote, context: active }),
  )), 'journal-club: tab body')
}


export { TAB_ID, TAB_KIND }
