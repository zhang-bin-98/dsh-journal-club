import { createReadStream, createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'

export class MineruError extends Error {
  constructor(readonly phase: string, message: string, readonly retryable = false) {
    super(`${phase}：${message}`)
    this.name = 'MineruError'
  }
}

/** Never include response bodies, credentials or signed URLs in diagnostics. */
export function safeError(error: unknown): string {
  if (error instanceof MineruError) return error.message
  return error instanceof Error && error.name === 'AbortError' ? '操作已取消' : '请求失败或超时；可使用同一命令恢复'
}

export interface HttpOptions {
  fetch?: typeof fetch
  signal?: AbortSignal
  requestTimeoutMs?: number
  downloadTimeoutMs?: number
  retries?: number
  retryDelayMs?: number
}

export class MineruHttp {
  constructor(readonly options: HttpOptions = {}) {}
  async run<T>(phase: string, timeout: number, retry: boolean, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const attempts = retry ? (this.options.retries ?? 2) + 1 : 1
    for (let attempt = 0; ; attempt++) {
      this.options.signal?.throwIfAborted()
      const signal = AbortSignal.any([AbortSignal.timeout(timeout), ...(this.options.signal ? [this.options.signal] : [])])
      try { return await work(signal) } catch (error) {
        this.options.signal?.throwIfAborted()
        const failure = error instanceof MineruError ? error : new MineruError(phase, '网络请求、响应体读取失败或超时', true)
        if (!failure.retryable || attempt + 1 >= attempts) throw failure
        await delay((this.options.retryDelayMs ?? 1000) * 2 ** attempt, undefined, { signal: this.options.signal })
      }
    }
  }
  async response(url: string, init: RequestInit, phase: string): Promise<Response> {
    const response = await (this.options.fetch ?? fetch)(url, init)
    if (!response.ok) {
      await response.body?.cancel()
      throw new MineruError(phase, `HTTP ${response.status}`, response.status === 429 || response.status >= 500)
    }
    return response
  }
  async json(url: string, token?: string, body?: unknown): Promise<Record<string, any>> {
    // Submission POST is deliberately never retried: a lost reply may already have created a job.
    return this.run(body ? '提交任务' : '查询任务', this.options.requestTimeoutMs ?? 60_000, body === undefined, async signal => {
      const response = await this.response(url, {
        method: body ? 'POST' : 'GET', signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }, 'API')
      const value = await response.json() as Record<string, any>
      if (value.code !== 0 || !value.data || typeof value.data !== 'object') {
        throw new MineruError('API', `返回错误代码 ${typeof value.code === 'number' ? value.code : '未知'}；请核对认证或请求参数`)
      }
      return value.data
    })
  }
  async upload(url: string, path: string): Promise<void> {
    await this.run('上传文件', this.options.downloadTimeoutMs ?? 600_000, true, async signal => {
      const stream = createReadStream(path)
      try {
        const response = await this.response(url, { method: 'PUT', body: stream as unknown as BodyInit, duplex: 'half', signal } as RequestInit, '上传文件')
        await response.body?.cancel()
      } finally { stream.destroy() }
    })
  }
  async download(url: string, path: string): Promise<void> {
    try {
      await this.run('下载结果', this.options.downloadTimeoutMs ?? 600_000, true, async signal => {
        const response = await this.response(url, { signal, redirect: 'follow' }, '下载结果')
        if (!response.body) throw new MineruError('下载结果', '结果为空')
        await pipeline(Readable.fromWeb(response.body as any), createWriteStream(path), { signal })
      })
    } catch (error) { await rm(path, { force: true }); throw error }
  }
}
