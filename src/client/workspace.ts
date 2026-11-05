import type { WorkspaceFilesPort } from './types.ts'

type Result<T> = { ok: true; value: T } | { ok: false; error: { message: string; code?: string } }
interface TextPage { text: string; version: string; lines: number; eof: boolean }
export interface WorkspaceRemote {
  read(sessionId: string, path: string, range: { offset: number }, signal: AbortSignal): Promise<Result<TextPage>>
  readBytes(sessionId: string, path: string, options: Record<string, never>, signal: AbortSignal): Promise<Result<{ data: Uint8Array; version: string }>>
  list(sessionId: string, path: string, signal: AbortSignal): Promise<Result<{ entries: { name: string; type: string }[]; truncated: boolean }>>
  changes(sessionId: string, path: string, signal: AbortSignal): AsyncIterable<unknown>
}
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value
  throw new Error(`${result.error.code ?? ''}: ${result.error.message}`)
}
export function workspaceFiles(remote: WorkspaceRemote): WorkspaceFilesPort {
  return {
    read: async (session, path, signal) => {
      const chunks: string[] = []
      let offset = 1
      let version: string | undefined
      for (;;) {
        const page = unwrap(await remote.read(session, path, { offset }, signal))
        if (version !== undefined && page.version !== version) throw new Error('文件在分页读取期间改变，请刷新。')
        version = page.version
        chunks.push(page.text)
        if (page.eof) return { text: chunks.join('\n'), version }
        if (!page.lines) throw new Error('宿主返回空的非末页')
        offset += page.lines
      }
    },
    readBytes: async (session, path, signal) => unwrap(await remote.readBytes(session, path, {}, signal)),
    changes: async function* (session, path, signal) {
      for await (const frame of remote.changes(session, path, signal)) yield { version: JSON.stringify(frame) }
    },
  }
}

export interface ProjectEntry { path: string; title: string; artifacts: string[] }
export async function discoverProjects(remote: WorkspaceRemote, sessionId: string, signal: AbortSignal): Promise<ProjectEntry[]> {
  const list = unwrap(await remote.list(sessionId, '.', signal))
  if (list.truncated) throw new Error('工作目录条目超过宿主列表上限，请进入论文目录后打开 JC。')
  const projects: ProjectEntry[] = []
  const add = (path: string, entries: {name: string; type: string}[]) => {
    const artifacts = entries.filter(e => e.type === 'file').map(e => e.name)
    if (['jc.md', 'figures.json', 'groups.json'].some(name => artifacts.includes(name))) projects.push({path, title: path || '当前工作目录', artifacts})
  }
  add('', list.entries)
  const directories = list.entries.filter(e => e.type === 'directory' && !e.name.startsWith('.'))
  // Bounded batches avoid opening a request for every folder at once.
  for (let index = 0; index < directories.length; index += 8) {
    await Promise.all(directories.slice(index, index + 8).map(async entry => {
      const result = await remote.list(sessionId, entry.name, signal)
      if (result.ok) add(entry.name, result.value.entries)
    }))
  }
  return projects.sort((a, b) => a.path.localeCompare(b.path))
}
