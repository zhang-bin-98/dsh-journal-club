import { open, readFile, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * 同一路径的写入互斥：进程内按路径排队，进程间用 `<path>.lock` 独占文件。
 * 锁文件记录持有者 pid；持有进程已退出（或写入锁内容前崩溃留下空锁）时回收，
 * 避免一次崩溃让后续写入永久超时。
 */

export interface FileLockOptions {
  readonly signal?: AbortSignal
}

export class FileLockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileLockError'
  }
}

/** 锁内容为空或不可解析时，超过该时长才视为崩溃残留（正常写入锁内容是瞬时的）。 */
const UNREADABLE_LOCK_GRACE_MS = 5_000
const LOCK_TIMEOUT_MS = 10_000
const LOCK_RETRY_MS = 20

const queues = new Map<string, Promise<unknown>>()

export function lockPathFor(path: string): string {
  return `${resolve(path)}.lock`
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('操作已取消')
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** 判断现有锁是否为残留；返回判定时读到的内容，回收前用于确认锁未被他人替换。 */
async function staleLockContent(lockPath: string): Promise<string | undefined> {
  let raw: string
  try {
    raw = await readFile(lockPath, 'utf8')
  } catch {
    return undefined
  }
  let pid: unknown
  try {
    pid = (JSON.parse(raw) as { pid?: unknown }).pid
  } catch { /* 空锁或写到一半 */ }
  if (typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0) return processAlive(pid) ? undefined : raw
  const info = await stat(lockPath).catch(() => undefined)
  return info !== undefined && Date.now() - info.mtimeMs > UNREADABLE_LOCK_GRACE_MS ? raw : undefined
}

async function reclaimIfStale(lockPath: string): Promise<boolean> {
  const stale = await staleLockContent(lockPath)
  if (stale === undefined) return false
  // 删除前再读一次，缩小误删另一回收者刚建立新锁的窗口；跨进程同时回收仍是尽力而为。
  if (await readFile(lockPath, 'utf8').catch(() => undefined) !== stale) return false
  await rm(lockPath, { force: true })
  return true
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortReason(signal!))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolvePromise()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function acquire(lockPath: string, options: FileLockOptions): Promise<void> {
  const started = Date.now()
  for (;;) {
    if (options.signal?.aborted) throw abortReason(options.signal)
    try {
      const handle = await open(lockPath, 'wx')
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, 'utf8')
      } catch (error) {
        await handle.close().catch(() => {})
        await rm(lockPath, { force: true }).catch(() => {})
        throw error
      }
      await handle.close().catch(() => {})
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if (await reclaimIfStale(lockPath)) continue
    if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new FileLockError(`等待锁超时：${lockPath}`)
    await wait(LOCK_RETRY_MS, options.signal)
  }
}

/** 在 `path` 的进程内队列和进程间锁下执行 task；task 结束（含失败）后释放锁。 */
export function withFileLock<T>(path: string, task: () => Promise<T>, options: FileLockOptions = {}): Promise<T> {
  const key = resolve(path)
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(async () => {
    const lockPath = lockPathFor(key)
    await acquire(lockPath, options)
    try {
      return await task()
    } finally {
      await rm(lockPath, { force: true }).catch(() => {})
    }
  })
  queues.set(key, current)
  void current.finally(() => {
    if (queues.get(key) === current) queues.delete(key)
  }).catch(() => {})
  return current
}
