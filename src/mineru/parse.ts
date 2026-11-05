import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join, resolve, relative, isAbsolute } from 'node:path'
import { lstat, mkdir, readFile, realpath, rename, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { parse as parseYaml } from 'yaml'
import { atomicWriteFile, sha256Hex } from '../files.ts'
import { withFileLock } from '../fileLock.ts'
import { extractZip, inside, normalizeResult, validateResult } from './archive.ts'
import { MineruError, MineruHttp, type HttpOptions } from './transport.ts'

export interface ParseOptions extends HttpOptions {
  source: string
  output: string
  id?: string
  mode?: 'extract' | 'flash'
  model?: 'vlm' | 'pipeline'
  pages?: string
  language?: string
  ocr?: boolean
  formula?: boolean
  table?: boolean
  token?: string
  configPath?: string
  pollTimeoutMs?: number
  pollIntervalMs?: number
  restart?: boolean
  onProgress?: (message: string) => void
}
interface DocumentRecord {
  id: string
  source_sha256: string
  mode: 'extract' | 'flash'
  provider: 'mineru-api'
  parser_version: 1
  options_digest: string
  status: 'partial' | 'done'
  batch_id?: string
  task_id?: string
  uploaded?: boolean
  artifacts: string[]
  artifact_sha256: Record<string, string>
}
interface Manifest { documents: (DocumentRecord | Record<string, unknown>)[] }
export interface ParseResult { cached: boolean; directory: string; artifacts: string[]; mode: 'extract' | 'flash' }

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export async function resolveMineruToken(options: Pick<ParseOptions, 'token' | 'configPath'>): Promise<string> {
  const supplied = options.token ?? process.env.MINERU_TOKEN
  if (supplied?.trim()) return supplied.trim()
  try {
    const config = parseYaml(await readFile(options.configPath ?? join(homedir(), '.mineru', 'config.yaml'), 'utf8'))
    if (typeof config?.token === 'string' && config.token.trim()) return config.token.trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new MineruError('认证', '无法读取 MinerU 配置，请检查配置格式')
  }
  throw new MineruError('认证', '请设置 MINERU_TOKEN，或使用已有 ~/.mineru/config.yaml；不要在命令行传 token')
}
async function loadManifest(path: string): Promise<Manifest> {
  try {
    const data = JSON.parse(await readFile(path, 'utf8')) as Manifest
    if (!Array.isArray(data.documents)) throw new Error('documents')
    return data
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { documents: [] }
    throw new MineruError('缓存', 'manifest 损坏，未覆盖原文件')
  }
}
function handle(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w.-]{1,256}$/u.test(value)) throw new MineruError('API', '任务标识格式不符')
  return value
}
function assetUrl(value: unknown): string {
  if (typeof value !== 'string') throw new MineruError('API', '缺少结果或上传地址')
  let url: URL
  try { url = new URL(value) } catch { throw new MineruError('API', '文件地址格式不符') }
  if (url.protocol !== 'https:' || url.username || url.password) throw new MineruError('API', '文件地址必须为 HTTPS')
  return value
}

/** File-based transport helper; deliberately registers no DSH tool or workflow state. */
export async function parsePaper(options: ParseOptions): Promise<ParseResult> {
  const id = options.id ?? 'main'
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test(id)) throw new MineruError('参数', 'document ID 格式不符')
  const mode = options.mode ?? 'extract'
  const source = await realpath(resolve(options.source))
  const input = await lstat(source)
  if (!input.isFile() || !input.size || input.size > (mode === 'flash' ? 10 : 200) * 1024 * 1024) throw new MineruError('参数', '源文件为空或超过模式大小限制')
  await mkdir(resolve(options.output), { recursive: true })
  const root = await realpath(resolve(options.output))
  const target = join(root, id)
  const targetInfo = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
  if (targetInfo && (!targetInfo.isDirectory() || targetInfo.isSymbolicLink())) throw new MineruError('输出', '文档目录必须是普通目录')
  const manifestPath = join(root, 'manifest.json')
  const sourceHash = await hashFile(source)
  const request = { model: options.model ?? 'vlm', pages: options.pages ?? '', language: options.language ?? 'ch', ocr: options.ocr ?? false, formula: options.formula ?? true, table: options.table ?? true }
  const optionsDigest = sha256Hex(JSON.stringify(request))
  const http = new MineruHttp(options)
  const base = mode === 'extract' ? 'https://mineru.net/api/v4' : 'https://mineru.net/api/v1/agent'
  return withFileLock(join(root, `.mineru-${id}`), async () => {
    let entry = (await loadManifest(manifestPath)).documents.find(d => d.id === id) as DocumentRecord | undefined
    const matches = entry?.provider === 'mineru-api' && entry.parser_version === 1 && entry.source_sha256 === sourceHash && entry.mode === mode && entry.options_digest === optionsDigest
    if (!matches || options.restart) entry = { id, source_sha256: sourceHash, mode, provider: 'mineru-api', parser_version: 1, options_digest: optionsDigest, status: 'partial', artifacts: [], artifact_sha256: {} }
    const record = entry!
    async function save(): Promise<void> {
      await withFileLock(manifestPath, async () => {
        const manifest = await loadManifest(manifestPath)
        const index = manifest.documents.findIndex(d => d.id === id)
        if (index === -1) manifest.documents.push(record)
        else manifest.documents[index] = record
        await atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
      }, options)
    }
    if (matches && !options.restart && record.status === 'done') {
      try {
        if (!record.artifacts.length) throw new Error('missing artifact list')
        for (const path of record.artifacts) {
          const full = await realpath(inside(root, path))
          if (isAbsolute(relative(target, full)) || relative(target, full).startsWith('..') || (await hashFile(full)) !== record.artifact_sha256[path]) throw new Error('changed artifact')
        }
        await validateResult(target, id, mode)
        options.onProgress?.('复用已验证的解析产物')
        return { cached: true, directory: target, artifacts: record.artifacts, mode }
      } catch { /* Missing/changed assets are recovered from the existing remote task. */ }
    }
    const token = mode === 'extract' ? await resolveMineruToken(options) : undefined
    record.status = 'partial'
    await save()
    const pollDeadline = Date.now() + (options.pollTimeoutMs ?? 1_800_000)
    const params = { language: request.language, enable_formula: request.formula, enable_table: request.table }
    if (!record.batch_id && !record.task_id) {
      options.onProgress?.('申请任务并上传原文件')
      const data = mode === 'extract'
        ? await http.json(`${base}/file-urls/batch`, token, { files: [{ name: basename(source), is_ocr: request.ocr, ...(request.pages ? { page_ranges: request.pages } : {}) }], model_version: request.model, ...params })
        : await http.json(`${base}/parse/file`, undefined, { file_name: basename(source), is_ocr: request.ocr, ...(request.pages ? { page_range: request.pages } : {}), ...params })
      if (mode === 'extract') record.batch_id = handle(data.batch_id)
      else record.task_id = handle(data.task_id)
      record.uploaded = false
      await save() // Persist before upload; a lost upload response must not silently create another parse.
      await http.upload(assetUrl(mode === 'extract' ? data.file_urls?.[0] : data.file_url), source)
      record.uploaded = true
      await save()
    }
    let result: Record<string, any>
    let previousProgress = ''
    for (;;) {
      options.signal?.throwIfAborted()
      if (Date.now() >= pollDeadline) throw new MineruError('查询任务', '轮询等待超时；任务已保存，可用同一命令恢复')
      const data = await http.json(mode === 'extract' ? `${base}/extract-results/batch/${encodeURIComponent(record.batch_id!)}` : `${base}/parse/${encodeURIComponent(record.task_id!)}`, token)
      result = mode === 'extract' ? data.extract_result?.[0] : data
      if (!result || typeof result.state !== 'string') throw new MineruError('查询任务', '任务响应缺少状态')
      if (result.state === 'failed') throw new MineruError('解析任务', '云端解析失败；检查原文件后使用 --restart 显式新建任务')
      if (result.state === 'done') break
      if (!record.uploaded && result.state === 'waiting-file') throw new MineruError('上传文件', '上次上传未完成，上传链接不落盘；请使用 --restart 重新上传')
      if (!record.uploaded) { record.uploaded = true; await save() }
      const progress = result.extract_progress
      const message = progress ? `解析 ${progress.extracted_pages}/${progress.total_pages} 页` : `任务状态：${['pending', 'running', 'waiting-file', 'converting'].includes(result.state) ? result.state : '等待'}`
      if (message !== previousProgress) { options.onProgress?.(message); previousProgress = message }
      await delay(options.pollIntervalMs ?? 3000, undefined, { signal: options.signal })
    }
    options.onProgress?.('下载结果（独立超时与重试）')
    const staging = join(root, `.${id}-staging-${randomUUID()}`)
    const download = join(root, `.${id}-${randomUUID()}.part`)
    await mkdir(staging)
    try {
      await http.download(assetUrl(mode === 'extract' ? result.full_zip_url : result.markdown_url), download)
      if (mode === 'extract') await extractZip(download, staging, options.signal)
      else await rename(download, join(staging, `${id}.md`))
      const files = await normalizeResult(staging, id, mode)
      if (await hashFile(source) !== sourceHash) throw new MineruError('源文件', '解析期间源文件已变化，未发布产物')
      const digests: Record<string, string> = {}
      for (const path of files) digests[`${id}/${path}`] = await hashFile(inside(staging, path))
      const backup = join(root, `.${id}-previous-${randomUUID()}`)
      let backedUp = false
      try { await rename(target, backup); backedUp = true } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      try { await rename(staging, target) } catch (error) { if (backedUp) await rename(backup, target); throw error }
      if (backedUp) await rm(backup, { recursive: true, force: true })
      record.artifacts = Object.keys(digests)
      record.artifact_sha256 = digests
      record.status = 'done'
      await save()
      return { cached: false, directory: target, artifacts: record.artifacts, mode }
    } finally {
      await rm(download, { force: true })
      await rm(staging, { recursive: true, force: true })
    }
  }, options)
}
