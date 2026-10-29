import {
  createElement,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { createProjectStore } from './store.ts'
import { FigureWorkbench } from './workbench/FigureWorkbench.ts'
import type { JournalClubRpcPort, WorkspaceFilesPort } from './types.ts'
import { ensureStyles, styles } from './styles.ts'

const TAB_ID = 'dsh-journal-club'
const TAB_KIND = 'journal-club'
const GUIDE_ID = 'journal-club'

interface SidebarRightTabsPort {
  register(definition: {
    readonly id: string
    readonly kind: string
    readonly title: (address?: string) => string
    readonly keepMounted?: boolean
    readonly guide?: readonly { readonly id: string; readonly order: number; readonly title: () => string; readonly description?: () => string }[]
  }): () => void
}

interface SlotsPort {
  inject(name: 'sidebar.right.pane.tab', callback: () => () => void): () => void
  register(entry: { readonly name: 'sidebar.right.pane.tab'; readonly key: string }, factory: (props: SidebarTabBodyProps) => ReactElement): () => void
}

interface SidebarTabBodyProps {
  readonly sessionId: string
  readonly useTabInfo: () => { readonly tab: { readonly visible: boolean; readonly signal?: AbortSignal } }
}

interface RemoteResult<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { readonly message?: string }
}

interface WorkspaceTextResult {
  readonly text: string
  readonly version: string
}

interface WorkspaceBytesResult {
  readonly data: Uint8Array
  readonly version: string
}

interface WorkspaceRemote {
  readonly workspaceFiles: {
    read(sessionId: string, path: string, range: { readonly offset?: number; readonly limit?: number }, signal: AbortSignal): Promise<RemoteResult<WorkspaceTextResult>>
    readBytes(sessionId: string, path: string, options: Record<string, never>, signal: AbortSignal): Promise<RemoteResult<WorkspaceBytesResult>>
    changes?(sessionId: string, path: string, signal: AbortSignal): AsyncIterable<{ readonly kind?: string; readonly change?: unknown }>
  }
  readonly journalClub?: JournalClubRpcPort
}

interface ClientContext extends Context {
  readonly slots?: SlotsPort
  readonly sidebarRightTabs?: SidebarRightTabsPort
  readonly remote?: WorkspaceRemote
}

export function JournalClubTab(props: SidebarTabBodyProps & { readonly remote: WorkspaceRemote }): ReactElement {
  const [projectPath, setProjectPath] = useState('')
  const store = useMemo(() => {
    const files = createWorkspaceFiles(props.remote)
    return createProjectStore({
      files,
      updateFigures: props.remote.journalClub,
      sessionId: props.sessionId,
      projectPath,
    })
  }, [props.remote, props.sessionId, projectPath])
  useEffect(() => () => store.dispose(), [store])
  const snapshot = useProjectSnapshot(store)
  if (snapshot.figures !== undefined) {
    return createElement(FigureWorkbench, { store })
  }
  if (snapshot.jcText !== undefined) {
    return createElement('div', { className: styles.root },
      createElement('div', { className: styles.header },
        createElement('div', null,
          createElement('p', { className: styles.eyebrow }, 'Journal Club'),
          createElement('h1', { className: styles.title }, '项目状态'),
          createElement('p', { className: styles.subtitle }, '已发现 jc.md，等待图源产物或确认点推进。'),
        ),
        createElement('button', { className: styles.secondaryAction, type: 'button', onClick: () => void store.refresh() }, '刷新'),
      ),
      createElement('div', { className: styles.content },
        createElement('div', { className: styles.card },
          createElement('p', { className: styles.subtitle }, summarizeJc(snapshot.jcText)),
          createElement('button', { className: styles.action, type: 'button', onClick: () => void store.refresh() }, '读取图源状态'),
        ),
      ),
    )
  }
  return createElement('div', { className: styles.root },
    createElement('div', { className: styles.header },
      createElement('div', null,
        createElement('p', { className: styles.eyebrow }, 'Journal Club'),
        createElement('h1', { className: styles.title }, '还没有当前项目'),
        createElement('p', { className: styles.subtitle }, '在当前会话工作目录中创建 jc.md 后，右侧栏会自动发现项目。'),
      ),
      createElement('button', { className: styles.secondaryAction, type: 'button', onClick: () => void store.refresh() }, '重新扫描'),
    ),
    snapshot.error ? createElement('div', { className: styles.content }, createElement('div', { className: styles.error, role: 'alert' }, snapshot.error)) : null,
  )
}

/** Host services this client needs; the loader activates `apply` only once all are present. */
export const inject = ['slots', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles']

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
    props => createElement(JournalClubTab, { ...props, remote }),
  )), 'journal-club: tab body')
}

function createWorkspaceFiles(remote: WorkspaceRemote): WorkspaceFilesPort {
  return {
    read: async (sessionId, path, signal) => unwrap(await remote.workspaceFiles.read(sessionId, path, { offset: 1 }, signal)),
    readBytes: async (sessionId, path, signal) => unwrap(await remote.workspaceFiles.readBytes(sessionId, path, {}, signal)),
    changes: remote.workspaceFiles.changes === undefined ? undefined : async function* (sessionId, path, signal) {
      const stream = remote.workspaceFiles.changes?.(sessionId, path, signal)
      if (stream === undefined) return
      for await (const frame of stream) yield { version: JSON.stringify(frame) }
    },
  }
}

function unwrap<T extends { readonly text: string } | { readonly data: Uint8Array }>(result: RemoteResult<T>): T {
  if (result.ok && result.value !== undefined) return result.value
  throw new Error(result.error?.message ?? '宿主文件 Remote 读取失败。')
}

function summarizeJc(text: string): string {
  const body = text.replace(/^---[\s\S]*?---/u, '').trim().replace(/\s+/gu, ' ')
  return body.slice(0, 240) || 'jc.md 已存在，但还没有可显示的备注。'
}

function useProjectSnapshot(store: ReturnType<typeof createProjectStore>) {
  const [snapshot, setSnapshot] = useState(store.getSnapshot)
  useEffect(() => store.subscribe(() => setSnapshot(store.getSnapshot())), [store])
  return snapshot
}

export { TAB_ID, TAB_KIND }
