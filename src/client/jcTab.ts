import { CompositionEditor } from './composition/CompositionEditor.ts'
import { prepareCompositionReference, type ComposerInputActions } from './composition/conversationReference.ts'
import type { CompositionSave, CompositionState } from '../layout/composition.ts'
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { createProjectStore } from './store.ts'
import { FigureWorkbench } from './workbench/FigureWorkbench.ts'
import { workspaceFiles, discoverProjects, unwrap, type WorkspaceRemote, type ProjectEntry } from './workspace.ts'
import type { CropPanelsResult, UpdateFiguresRequest, UpdateFiguresResult } from './types.ts'
import { ensureStyles, styles } from './styles.ts'
import type { ProjectOverview } from '../types.ts'
import { isWorkbenchView, readBrowseLocation, rememberBrowseLocation, type WorkbenchView } from './browseLocation.ts'
import { projectStatus, overviewFocus } from './projectStatus.ts'
import { sendSessionMessage, type SessionScopes } from './sessionActions.ts'
import { fileResourceAddress } from './cardMarker.ts'

const TAB_ID = 'dsh-journal-club'
const TAB_KIND = 'journal-club'
const GUIDE_ID = 'journal-club'
interface SidebarTabBodyProps {
  sessionId: string
  inputActions?: ComposerInputActions
  useTabInfo: () => { tab: { id?: string; navigation?: { params?: { project?: string; view?: string } } } }
}
interface WorkspaceRemotes {
  workspaceFiles: WorkspaceRemote
  journalClub: {
    projectOverview?(sessionId: string, project: string, signal: AbortSignal): Promise<{ok: true; value: ProjectOverview} | {ok: false; error: {message: string}}>
    compositionState?(sessionId: string, project: string, signal: AbortSignal): Promise<{ok: true; value: CompositionState} | {ok: false; error: {message: string}}>
    saveComposition?(sessionId: string, request: CompositionSave, signal: AbortSignal): Promise<{ok: true; value: {digest: string; asset: string}} | {ok: false; error: {message: string}}>

    updateFigures(sessionId: string, request: UpdateFiguresRequest, signal: AbortSignal): Promise<{ok: true; value: UpdateFiguresResult} | {ok: false; error: {message: string}}>
    cropPanels?(sessionId: string, request: {figures_json: string; ids: string[]}, signal: AbortSignal): Promise<{ok: true; value: CropPanelsResult} | {ok: false; error: {message: string}}>
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
  sidebarRight?: { openResource(address: string): void; registerCloseHandler?(kind: string, handler: (sessionId: string, tab: {id: string}) => void): () => void }
}

type TabProps = SidebarTabBodyProps & {remote: WorkspaceRemotes; context: ClientContext; registerGuard?: (session: string, tab: string, guard: () => boolean) => () => void}

export function JournalClubTab(props: TabProps): ReactElement {
  const tab = props.useTabInfo().tab
  const navigation = tab.navigation?.params
  const [project, setProject] = useState<string | undefined>(() => navigation?.project ?? readBrowseLocation(props.sessionId).project)
  const [projects, setProjects] = useState<ProjectEntry[]>([])
  const [choosing, setChoosing] = useState(project === undefined)
  const [scan, setScan] = useState(0)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const discovered = useRef(false)
  const editState = useRef({dirty: false, busy: false})
  const onDraftState = useCallback((state: {dirty: boolean; busy: boolean}) => { editState.current = state }, [])
  const canLeave = useCallback(() => {
    if (editState.current.busy) { setError('正在保存或裁切，请完成后再切换或关闭。'); return false }
    return !editState.current.dirty || window.confirm('还有未保存的调整。离开将丢弃这些调整，是否继续？')
  }, [])
  useEffect(() => props.registerGuard?.(props.sessionId, tab.id ?? TAB_ID, canLeave), [props.registerGuard, props.sessionId, tab.id, canLeave])
  useEffect(() => {
    if (navigation?.project !== undefined && navigation.project !== project && canLeave()) {
      setProject(navigation.project); setChoosing(false); setError('')
    }
  }, [navigation])
  useEffect(() => {
    const controller = new AbortController()
    void discoverProjects(props.remote.workspaceFiles, props.sessionId, controller.signal).then(entries => {
      if (controller.signal.aborted) return
      setProjects(entries); setLoaded(true)
      const firstScan = !discovered.current; discovered.current = true
      setProject(current => {
        if (!firstScan && current !== undefined) return current
        if (current !== undefined && (entries.some(p => p.path === current) || navigation?.project === current)) return current
        if (entries.length === 1) { setChoosing(false); return entries[0]!.path }
        setChoosing(true); return undefined
      })
    }).catch(cause => { if (!controller.signal.aborted) { setError(String(cause)); setLoaded(true) } })
    return () => controller.abort()
  }, [props.remote, props.sessionId, scan])
  useEffect(() => { if (project !== undefined) rememberBrowseLocation(props.sessionId, project) }, [props.sessionId, project])
  const choose = (path: string) => {
    if (path !== project && !canLeave()) return
    setProject(path); setChoosing(false); setError('')
  }
  return h('div', {className: `${styles.root} jc-shell`, style: {height: '100%'}},
    h('header', {className: 'jc-projectHeader'},
      h('span', {className: 'jc-projectName', title: project || '当前工作目录'}, project === undefined ? 'Journal Club' : project.split(/[\\/]/u).filter(Boolean).at(-1) || '当前工作目录'),
      h('button', {className: styles.secondaryAction, onClick: () => { setChoosing(v => project === undefined || !v); setScan(n => n + 1) }}, choosing && project !== undefined ? '返回工作台' : '切换项目')),
    error ? h('p', {className: styles.error, role: 'alert'}, error) : null,
    choosing ? h('section', {className: 'jc-projectPicker', 'aria-label': '选择项目'},
      h('div', {className: styles.inlineActions}, h('h2', {className: styles.title}, '继续工作'),
        h('button', {className: styles.secondaryAction, onClick: () => setScan(n => n + 1)}, '重新扫描')),
      h('p', {className: styles.subtitle}, '选择当前工作目录中的论文或工具产物。'),
      ...projects.map(entry => h('button', {key: entry.path, className: 'jc-projectItem', onClick: () => choose(entry.path)},
        h('strong', null, entry.title), entry.path !== entry.title ? h('span', {className: styles.subtitle}, entry.path || '.') : null,
        h('span', {className: 'jc-projectFacts'}, entry.artifacts.includes('jc.md') ? '论文汇报' : '局部工具', ' · ',
          [['figures.json','图源'], ['groups.json','拼图'], ['outline.md','大纲'], ['slides.md','幻灯片']].filter(([file]) => entry.artifacts.includes(file!)).map(([,label]) => label).join(' · ') || '项目已建立'))),
      !projects.length ? h('p', {className: styles.subtitle}, loaded ? '尚未发现项目。在聊天中提供论文，或调用切图、拼图工具后，这里会显示对应目录。' : '正在查找项目…') : null) : null,
    project !== undefined ? h('div', {hidden: choosing, className: 'jc-workspaceBody'}, h(ProjectWorkspace, {
      key: `${props.sessionId}:${project}`, ...props, project, navigationView: navigation?.project === project ? navigation.view : undefined, onDraftState,
    })) : null)
}

function ProjectWorkspace(props: TabProps & {project: string; navigationView?: string; onDraftState(state: {dirty: boolean; busy: boolean}): void}): ReactElement {
  const projectPath = props.project
  const saved = useRef(readBrowseLocation(props.sessionId).locations[projectPath] ?? {})
  const [view, setView] = useState<WorkbenchView | undefined>(() => isWorkbenchView(props.navigationView) ? props.navigationView : saved.current.view)
  const [composerVisited, setComposerVisited] = useState(view === 'compose')
  const [compositionRevision, setCompositionRevision] = useState(0)
  const [overview, setOverview] = useState<ProjectOverview>()
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const sendingRef = useRef(false)
  const compositionEdit = useRef({dirty: false, busy: false}), figureBusy = useRef(false), figureDirty = useRef(false)
  const onCompositionEdit = useCallback((state: {dirty: boolean; busy: boolean}) => { compositionEdit.current = state; props.onDraftState({dirty: state.dirty || figureDirty.current, busy: state.busy || figureBusy.current}) }, [props.onDraftState])
  const onFigureBusy = useCallback((busy: boolean) => { figureBusy.current = busy; props.onDraftState({dirty: compositionEdit.current.dirty || figureDirty.current, busy: busy || compositionEdit.current.busy}) }, [props.onDraftState])
  const onFigureDirty = useCallback((dirty: boolean) => { figureDirty.current = dirty; props.onDraftState({dirty: dirty || compositionEdit.current.dirty, busy: figureBusy.current || compositionEdit.current.busy}) }, [props.onDraftState])
  useEffect(() => () => props.onDraftState({dirty: false, busy: false}), [props.onDraftState])
  const files = useMemo(() => workspaceFiles(props.remote.workspaceFiles), [props.remote])
  const store = useMemo(() => createProjectStore({
    files, sessionId: props.sessionId, projectPath,
    updateFigures: {
      updateFigures: async request => unwrap(await props.remote.journalClub.updateFigures(props.sessionId, request, new AbortController().signal)),
      ...(props.remote.journalClub.cropPanels === undefined ? {} : {
        cropPanels: async (request: {figures_json: string; ids: readonly string[]}) => unwrap(await props.remote.journalClub.cropPanels!(props.sessionId, {figures_json: request.figures_json, ids: [...request.ids]}, new AbortController().signal)),
      }),
    },
  }), [files, props.remote, props.sessionId, projectPath])
  useEffect(() => () => store.dispose(), [store])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const artifacts = overview?.artifacts ?? []
  const status = projectStatus(snapshot.jcText, artifacts, snapshot.figures)
  const fullProject = Boolean(snapshot.jcText)
  const canCompose = Boolean(snapshot.figures) || artifacts.includes('groups.json')
  const changeView = (next: WorkbenchView) => { setView(next); if (next === 'compose') setComposerVisited(true) }
  useEffect(() => { if (isWorkbenchView(props.navigationView)) changeView(props.navigationView) }, [props.navigationView])
  useEffect(() => {
    if (view !== undefined || !overview || !snapshot.loadedAt) return
    changeView(fullProject ? status.stageHint === 'figure-review' && snapshot.figures ? 'figures' : ['slides','render'].includes(status.stageHint ?? '') && canCompose ? 'compose' : 'overview' : artifacts.includes('groups.json') ? 'compose' : snapshot.figures ? 'figures' : 'overview')
  }, [overview, snapshot, view])
  useEffect(() => { if (view) rememberBrowseLocation(props.sessionId, projectPath, {view}) }, [props.sessionId, projectPath, view])
  const rememberGroup = useCallback((group: string) => rememberBrowseLocation(props.sessionId, projectPath, {group}), [props.sessionId, projectPath])
  const rememberFigure = useCallback((figure: string, panel?: string) => rememberBrowseLocation(props.sessionId, projectPath, {figure, panel}), [props.sessionId, projectPath])
  useEffect(() => {
    const controller = new AbortController()
    for (const name of ['groups.json','slides.md','outline.md','analysis.md','groups','render','.']) void (async () => {
      try {
        const path = projectPath ? `${projectPath}/${name}` : name
        for await (const _ of props.remote.workspaceFiles.changes(props.sessionId, path, controller.signal)) if (!controller.signal.aborted) setCompositionRevision(n => n + 1)
      } catch (cause) { if (!controller.signal.aborted) setError(`文件监听失败：${String(cause)}`) }
    })()
    return () => controller.abort()
  }, [props.remote, props.sessionId, projectPath])
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      if (!props.remote.journalClub.projectOverview) throw new Error('请更新插件并重开工作台，以读取项目概览。')
      const result = unwrap(await props.remote.journalClub.projectOverview(props.sessionId, projectPath, controller.signal))
      if (!controller.signal.aborted) { setOverview(result); setError('') }
    })().catch(cause => { if (!controller.signal.aborted) setError(`概览暂未更新：${String(cause)}`) })
    return () => controller.abort()
  }, [props.remote, props.sessionId, projectPath, snapshot.loadedAt, compositionRevision])
  const followup = useCallback(async (text: string) => {
    if (sendingRef.current) throw new Error('请求正在发送，请稍候。')
    sendingRef.current = true; setSending(true); setSent(false)
    try { await sendSessionMessage(props.context.sessions as unknown as SessionScopes, props.sessionId, '项目：' + JSON.stringify(projectPath || '.') + '\n' + text); setSent(true) }
    finally { sendingRef.current = false; setSending(false) }
  }, [props.context, props.sessionId, projectPath])
  const open = (path: string) => props.context.sidebarRight?.openResource(fileResourceAddress(props.sessionId, projectPath ? projectPath + '/' + path : path))
  const loadPage = useCallback(async (document: string, page: number) => {
    const info = unwrap(await props.remote.journalClub.pageInfo(props.sessionId, projectPath, document, page, new AbortController().signal))
    return {...info, src: await store.readAsset(info.path)}
  }, [props.remote, props.sessionId, projectPath, store, snapshot.loadedAt])
  const loadComposition = useCallback(async () => {
    if (!props.remote.journalClub.compositionState) throw new Error('请更新插件以加载自由拼图。')
    await store.refresh()
    return unwrap(await props.remote.journalClub.compositionState(props.sessionId, projectPath, new AbortController().signal))
  }, [props.remote, props.sessionId, projectPath, store])
  const saveComposition = useCallback(async (request: Omit<CompositionSave, 'project'>) => {
    if (!props.remote.journalClub.saveComposition) throw new Error('请更新插件以保存拼图。')
    const result = unwrap(await props.remote.journalClub.saveComposition(props.sessionId, {...request, project: projectPath}, new AbortController().signal))
    await store.refresh(); return result
  }, [props.remote, props.sessionId, projectPath, store])
  const tabs: [WorkbenchView, string][] = [['overview','概览'], ...(snapshot.figures ? [['figures','图源核对'] as [WorkbenchView,string]] : []), ...(canCompose ? [['compose','自由拼图'] as [WorkbenchView,string]] : [])]
  const effectiveView = tabs.some(([id]) => id === view) ? view : 'overview'
  const confirmationLabel = {confirmed: '已确认 · 当前版本', stale: '来源已变更 · 待复核', missing: '待确认'}
  const focus = overviewFocus(status, overview, fullProject, Boolean(snapshot.figures), canCompose, error || snapshot.error)
  const listedArtifacts = artifacts.filter(path => /\.(md|pptx|pptd|pdf)$/iu.test(path) || ['figures.json','groups.json'].includes(path))
  const pptx = artifacts.find(path => /\.pptx$/iu.test(path))
  const featured = [
    ...(pptx ? [{label: '演示稿', detail: pptx, path: pptx}] : []),
    ...(artifacts.includes('slides.md') ? [{label: '幻灯片文稿', detail: 'slides.md', path: 'slides.md'}] : artifacts.includes('outline.md') ? [{label: '叙事大纲', detail: 'outline.md', path: 'outline.md'}] : []),
  ]
  const figureSummary = snapshot.figures ? `${snapshot.figures.figures.length} 个 Figure · ${snapshot.figures.figures.reduce((n,f) => n + f.panels.length,0)} 个 Panel` : ''
  const groupSummary = overview?.groupCount === undefined ? '' : `${overview.groupCount} 张拼图`
  const stepState = (step: typeof status.steps[number]) => !step.produced ? 'absent' : step.id === 'analysis' ? 'produced' : overview?.confirmations?.[step.id] ?? 'produced'
  const stepLabel = (step: typeof status.steps[number]) => !step.produced ? '待产出' : step.id === 'analysis' ? '已有产物' : overview?.confirmations?.[step.id] ? confirmationLabel[overview.confirmations[step.id]!] : '已有产物'
  const resume = () => void followup('继续 journal club；先核对产物和确认记录，再从有效断点恢复。').catch(e => setError(String(e)))
  return h('div', {className: 'jc-workspaceBody'},
    h('nav', {className: 'jc-tabs', 'aria-label': '工作台页面'}, ...tabs.map(([id,label]) => h('button', {key: id, 'aria-current': effectiveView === id ? 'page' : undefined, onClick: () => changeView(id)}, label))),
    effectiveView !== 'overview' && (error || snapshot.error) ? h('p', {className: styles.error, role: 'alert'}, error || snapshot.error) : null,
    h('section', {hidden: effectiveView !== 'overview', className: 'jc-overview', 'aria-label': '项目概览'},
      h('h1', {className: styles.title}, status.title || (fullProject ? '论文汇报' : '工具产物')),
      h('div', {className: 'jc-overviewFocus', 'data-warning': Boolean(focus.warning), 'aria-label': '当前状态'},
        h('p', {className: styles.eyebrow}, focus.warning ? '需要关注' : '当前进展'),
        h('h2', null, focus.title), h('p', {className: styles.subtitle}, focus.detail),
        !fullProject && overview ? h('p', {className: styles.subtitle}, [figureSummary,groupSummary].filter(Boolean).join(' · ')) : null,
        focus.action ? h('div', {className: styles.inlineActions},
          h('button', {className: styles.action, disabled: sending, onClick: () => { const action = focus.action!; if (action.view) changeView(action.view); else if (action.path) open(action.path); else resume() }}, sending ? '正在发送…' : focus.action.label),
          fullProject && focus.action.view === 'figures' ? h('button', {className: styles.secondaryAction, disabled: sending || figureBusy.current, onClick: () => void followup('/jc confirm figures').catch(e => setError(String(e)))}, '确认图源') : null,
          fullProject && focus.action.path ? h('button', {className: styles.secondaryAction, disabled: sending, onClick: resume}, '在对话中继续') : null) : null,
        sent ? h('p', {role: 'status', className: styles.subtitle}, '已发送至聊天，请查看后续回复。') : null),
      fullProject && overview ? h('ol', {className: 'jc-stageSummary', 'aria-label': '阶段摘要'}, ...status.steps.map(step => h('li', {key: step.id, 'data-state': stepState(step)}, h('strong', null, step.label), h('span', null, stepLabel(step))))) : null,
      overview && (featured.length || snapshot.figures || canCompose) ? h('section', {className: 'jc-featured', 'aria-label': '主要产物'},
        h('h2', null, '主要产物'), h('div', {className: 'jc-featuredGrid'},
          ...featured.map(item => h('button', {key: item.path, className: styles.secondaryAction, onClick: () => open(item.path)}, h('strong', null, item.label), h('small', null, item.detail))),
          snapshot.figures || canCompose ? h('button', {className: styles.secondaryAction, onClick: () => changeView(canCompose && artifacts.includes('groups.json') ? 'compose' : 'figures')}, h('strong', null, '图源与拼图'), h('small', null, [figureSummary,groupSummary].filter(Boolean).join(' · '))) : null)) : null,
      fullProject && overview ? h('details', {className: 'jc-overviewDetails'}, h('summary', null, '阶段详情'),
        h('ol', {className: 'jc-steps'}, ...status.steps.map(step => h('li', {key: step.id},
          h('div', {className: styles.statusLine}, h('strong', null, step.label), h('span', null, stepLabel(step))), h('p', {className: styles.subtitle}, step.detail))))) : null,
      overview ? h('details', {className: 'jc-overviewDetails'}, h('summary', null, `全部文件（${listedArtifacts.length}）`),
        h('div', {className: 'jc-artifacts'}, ...listedArtifacts.map(path => h('button', {key: path, className: styles.secondaryAction, onClick: () => open(path)}, path))),
        h('p', {className: styles.subtitle}, '文件存在表示已有产物；PPTX 是否与当前图源和文稿一致，仍需渲染与检查。')) : null),
    snapshot.figures ? h('div', {hidden: effectiveView !== 'figures', className: 'jc-view'}, h(FigureWorkbench, {active: effectiveView === 'figures', store, loadPage, onFollowup: followup, onOpenResource: open, initialSelection: saved.current, onSelection: rememberFigure, onBusy: onFigureBusy, onDirty: onFigureDirty})) : null,
    canCompose && composerVisited ? h('div', {hidden: effectiveView !== 'compose', className: 'jc-view jc-composeView'}, h(CompositionEditor, {
      revision: compositionRevision, load: loadComposition, save: saveComposition, readAsset: store.readAsset, openAsset: open,
      initialGroup: saved.current.group, onGroupChange: rememberGroup, onDraftState: onCompositionEdit,
      prepareConversation: id => prepareCompositionReference(props.inputActions, projectPath, id),
    })) : null)
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
  const guards = new Map<string, () => boolean>()
  const registerGuard = (session: string, tab: string, guard: () => boolean) => {
    const key = JSON.stringify([session, tab]); guards.set(key, guard)
    return () => { if (guards.get(key) === guard) guards.delete(key) }
  }
  if (active.sidebarRight?.registerCloseHandler) ctx.effect(() => active.sidebarRight!.registerCloseHandler!(TAB_KIND, (session, tab) => {
    if (guards.get(JSON.stringify([session, tab.id]))?.() === false) throw new Error('请先保存拼图或等待当前写入完成。')
  }), 'journal-club: unsaved draft guard')
  ctx.effect(() => tabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    keepMounted: true,
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
    props => h(JournalClubTab, { ...props, key: props.sessionId, remote, context: active, registerGuard }),
  )), 'journal-club: tab body')
}


export { TAB_ID, TAB_KIND }
