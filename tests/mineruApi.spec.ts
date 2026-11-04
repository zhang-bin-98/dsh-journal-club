import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ZipFile } from 'yazl'
import { parsePaper, resolveMineruToken, type ParseOptions } from '../src/mineru/parse.ts'
import { extractZip } from '../src/mineru/archive.ts'
import { MineruHttp, safeError } from '../src/mineru/transport.ts'

const dirs: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'jc-mineru-api-')); dirs.push(dir)
  const source = join(dir, '论文.pdf'); await writeFile(source, '%PDF-fixture')
  return { dir, source, output: join(dir, 'parse') }
}
async function archive(extra: Record<string, string> = {}) {
  const zip = new ZipFile()
  const files = { 'full.md': '# Fixture\n\n![Figure](images/a.jpg)\n', 'test_content_list.json': JSON.stringify([{ type: 'image', bbox: [10, 20, 400, 500], page_idx: 0, img_path: 'images/a.jpg', image_caption: ['A test'] }]), 'images/a.jpg': 'test pixels', 'layout.json': '{}', ...extra }
  for (const [path, content] of Object.entries(files)) zip.addBuffer(Buffer.from(content), path)
  zip.end()
  const chunks: Buffer[] = []
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
function fakeApi(bytes: Buffer) {
  const calls: { url: string; init: RequestInit }[] = []
  let badDownload = false
  let failParse = false
  let submissions = 0
  const fake = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input); calls.push({ url, init })
    if (url.endsWith('/file-urls/batch')) { submissions++; return Response.json({ code: 0, data: { batch_id: `batch-${submissions}`, file_urls: ['https://upload.example/file?signature=private'] } }) }
    if (url.endsWith('/parse/file')) return Response.json({ code: 0, data: { task_id: 'flash-id', file_url: 'https://upload.example/flash' } })
    if (url.startsWith('https://upload.example/')) return new Response('', { status: 200 })
    if (url.includes('/extract-results/batch/')) return Response.json({ code: 0, data: { extract_result: [{ state: failParse ? 'failed' : 'done', full_zip_url: 'https://cdn.example/result.zip?signature=private' }] } })
    if (url.includes('/parse/flash-id')) return Response.json({ code: 0, data: { state: 'done', markdown_url: 'https://cdn.example/flash.md' } })
    if (url.includes('flash.md')) return new Response('# Flash result')
    if (badDownload) return new Response('private diagnostic', { status: 503 })
    return new Response(new Uint8Array(bytes))
  }) as unknown as typeof fetch
  return { fake, calls, setBadDownload: (value: boolean) => { badDownload = value }, setFailed: () => { failParse = true } }
}
function options(f: Awaited<ReturnType<typeof fixture>>, api: ReturnType<typeof fakeApi>): ParseOptions {
  return { ...f, fetch: api.fake, token: 'secret-test-token', retryDelayMs: 1, pollIntervalMs: 1, retries: 1 }
}

describe('MinerU API 文件链', () => {
  it('一次任务取齐 md/JSON/图片，按参数提交并验证缓存；缓存不要求认证', async () => {
    const f = await fixture(), api = fakeApi(await archive())
    const opts = { ...options(f, api), model: 'pipeline' as const, pages: '1-3', language: 'en', ocr: true, formula: false, table: false }
    const result = await parsePaper(opts)
    expect(result.cached).toBe(false)
    expect(result.artifacts).toContain('main/main.json')
    expect(JSON.parse(await readFile(join(f.output, 'main/main.json'), 'utf8'))[0].bbox).toEqual([10, 20, 400, 500])
    const submitted = JSON.parse(api.calls[0]!.init.body as string)
    expect(submitted).toMatchObject({ model_version: 'pipeline', language: 'en', enable_formula: false, enable_table: false, files: [{ name: '论文.pdf', is_ocr: true, page_ranges: '1-3' }] })
    expect(submitted).not.toHaveProperty('is_ocr')
    expect(api.calls.filter(c => c.url.startsWith('https://cdn')).every(c => c.init.headers === undefined)).toBe(true)
    const raw = await readFile(join(f.output, 'manifest.json'), 'utf8')
    expect(raw).not.toContain('secret-test-token'); expect(raw).not.toContain('signature'); expect(raw).not.toContain('https:')
    const count = api.calls.length
    expect((await parsePaper({ ...opts, token: undefined, configPath: join(f.dir, 'missing-config') })).cached).toBe(true)
    expect(api.calls).toHaveLength(count)
  })
  it('下载失败保留旧产物与 partial，重跑只查询和下载，不重新上传', async () => {
    const f = await fixture(), api = fakeApi(await archive())
    await mkdir(join(f.output, 'main'), { recursive: true }); await writeFile(join(f.output, 'main/old.txt'), 'preserved')
    api.setBadDownload(true)
    await expect(parsePaper(options(f, api))).rejects.toThrow('下载结果')
    expect(await readFile(join(f.output, 'main/old.txt'), 'utf8')).toBe('preserved')
    expect(JSON.parse(await readFile(join(f.output, 'manifest.json'), 'utf8')).documents[0]).toMatchObject({ status: 'partial', batch_id: 'batch-1' })
    api.setBadDownload(false)
    await parsePaper(options(f, api))
    expect(api.calls.filter(c => c.init.method === 'POST')).toHaveLength(1)
    expect(api.calls.filter(c => c.init.method === 'PUT')).toHaveLength(1)
  })
  it('更改图像或删除正文会从已有任务修复，源文件/参数变化才新建任务', async () => {
    const f = await fixture(), api = fakeApi(await archive()), opts = options(f, api)
    await parsePaper(opts)
    await writeFile(join(f.output, 'main/images/a.jpg'), 'tampered')
    expect((await parsePaper(opts)).cached).toBe(false)
    await rm(join(f.output, 'main/main.md'))
    await parsePaper(opts)
    expect(api.calls.filter(c => c.init.method === 'POST')).toHaveLength(1)
    await writeFile(f.source, '%PDF changed')
    await parsePaper(opts)
    await parsePaper({ ...opts, pages: '2-4' })
    expect(api.calls.filter(c => c.init.method === 'POST')).toHaveLength(3)
  })
  it('保留其他文档和旧 CLI 元数据；主/补文档并发更新不丢失清单', async () => {
    const f = await fixture(), api = fakeApi(await archive()), opts = options(f, api)
    await mkdir(f.output)
    await writeFile(join(f.output, 'manifest.json'), JSON.stringify({ documents: [{ id: 'legacy', cli_version: '0.5.9', status: 'done' }] }))
    await Promise.all([parsePaper(opts), parsePaper({ ...opts, id: 'supp' })])
    const manifest = JSON.parse(await readFile(join(f.output, 'manifest.json'), 'utf8'))
    expect(manifest.documents.map((d: {id: string}) => d.id).sort()).toEqual(['legacy', 'main', 'supp'])
    expect(manifest.documents[0].cli_version).toBe('0.5.9')
  })
  it('云端解析失败不循环创建任务；restart 才重新提交', async () => {
    const f = await fixture(), api = fakeApi(await archive()), opts = options(f, api)
    api.setFailed()
    await expect(parsePaper(opts)).rejects.toThrow('云端解析失败')
    await expect(parsePaper(opts)).rejects.toThrow('云端解析失败')
    expect(api.calls.filter(c => c.init.method === 'POST')).toHaveLength(1)
    await expect(parsePaper({ ...opts, restart: true })).rejects.toThrow('云端解析失败')
    expect(api.calls.filter(c => c.init.method === 'POST')).toHaveLength(2)
  })
  it('flash 免 token 产生 Markdown，不伪造 JSON；认证配置错误不泄露内容', async () => {
    const f = await fixture(), api = fakeApi(await archive())
    vi.stubEnv('MINERU_TOKEN', '')
    const result = await parsePaper({ ...options(f, api), token: undefined, mode: 'flash' })
    expect(result.artifacts).toEqual(['main/main.md'])
    expect(api.calls.every(c => !(c.init.headers as Record<string, string> | undefined)?.Authorization)).toBe(true)
    const configPath = join(f.dir, 'config.yaml')
    await writeFile(configPath, 'token: valid-token\n')
    expect(await resolveMineruToken({ configPath })).toBe('valid-token')
    await writeFile(configPath, 'token: [secret-unclosed')
    await expect(resolveMineruToken({ configPath })).rejects.toThrow('配置格式')
  })
  it('缺图或损坏 ZIP 不标记 done；拒绝穿越和符号链接', async () => {
    const f = await fixture()
    const api = fakeApi(await archive({ 'full.md': '![missing](images/missing.jpg)' }))
    await expect(parsePaper(options(f, api))).rejects.toThrow()
    expect(JSON.parse(await readFile(join(f.output, 'manifest.json'), 'utf8')).documents[0].status).toBe('partial')
    const badZip = join(f.dir, 'bad.zip'); await writeFile(badZip, 'not a zip')
    await expect(extractZip(badZip, join(f.dir, 'bad-output'))).rejects.toThrow('ZIP')
    // Rewrite a valid archive's equal-length image entry names in both headers.
    const unsafe = (await archive()).toString('latin1').replaceAll('images/a.jpg', '../evilx.jpg')
    await writeFile(badZip, Buffer.from(unsafe, 'latin1'))
    await expect(extractZip(badZip, join(f.dir, 'unsafe-output'))).rejects.toThrow()
    await expect(stat(join(f.dir, 'evilx.jpg'))).rejects.toThrow()
    const corrupt = Buffer.from(await archive())
    const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    corrupt.writeUInt32LE((corrupt.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16)
    await writeFile(badZip, corrupt)
    await expect(extractZip(badZip, join(f.dir, 'crc-output'))).rejects.toThrow()
    const symbolic = new ZipFile()
    symbolic.addBuffer(Buffer.from('../outside'), 'link', { mode: 0o120777 }); symbolic.end()
    const chunks: Buffer[] = []
    for await (const chunk of symbolic.outputStream) chunks.push(Buffer.from(chunk))
    await writeFile(badZip, Buffer.concat(chunks))
    await expect(extractZip(badZip, join(f.dir, 'symlink-output'))).rejects.toThrow()
  })
  it('上传中断保留任务，不自动提交新任务；pending 表示已受理时继续恢复', async () => {
    const f = await fixture(), api = fakeApi(await archive()), opts = options(f, api)
    await parsePaper(opts)
    const path = join(f.output, 'manifest.json'), manifest = JSON.parse(await readFile(path, 'utf8'))
    manifest.documents[0].uploaded = false; manifest.documents[0].status = 'partial'
    await writeFile(path, JSON.stringify(manifest))
    let pending = true
    const resumed = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(url).includes('/extract-results/batch/') && pending) { pending = false; return Response.json({ code: 0, data: { extract_result: [{ state: 'pending' }] } }) }
      return api.fake(url, init)
    }) as typeof fetch
    await parsePaper({ ...opts, fetch: resumed })
    expect(api.calls.filter(c => c.init.method === 'POST')).toHaveLength(1)
    const again = JSON.parse(await readFile(path, 'utf8')); again.documents[0].uploaded = false; again.documents[0].status = 'partial'
    await writeFile(path, JSON.stringify(again))
    const waiting = vi.fn(async () => Response.json({ code: 0, data: { extract_result: [{ state: 'waiting-file' }] } }))
    await expect(parsePaper({ ...opts, fetch: waiting })).rejects.toThrow('上传未完成')
    expect(waiting).toHaveBeenCalledTimes(1)
  })
})

describe('下载边界', () => {
  it('超时覆盖响应体，重试只下载；取消不重试；HTTP 403 不重试', async () => {
    const f = await fixture(); let calls = 0
    const http = new MineruHttp({ retries: 1, retryDelayMs: 1, downloadTimeoutMs: 20, fetch: (async () => {
      calls++
      return calls === 1 ? new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])) } })) : new Response('complete')
    }) as typeof fetch })
    await http.download('https://cdn.example/signed-secret', join(f.dir, 'result.part'))
    expect(calls).toBe(2); expect(await readFile(join(f.dir, 'result.part'), 'utf8')).toBe('complete')
    const fetch403 = vi.fn(async () => new Response('', { status: 403 }))
    await expect(new MineruHttp({ fetch: fetch403, retryDelayMs: 1 }).download('https://cdn.example/a', join(f.dir, 'bad.part'))).rejects.toThrow('403')
    expect(fetch403).toHaveBeenCalledTimes(1)
    const controller = new AbortController(); controller.abort()
    await expect(new MineruHttp({ signal: controller.signal, fetch: fetch403 }).download('https://cdn.example/a', join(f.dir, 'cancel.part'))).rejects.toThrow()
    expect(fetch403).toHaveBeenCalledTimes(1)
    expect(safeError(new Error('https://cdn.example/?token=secret'))).not.toContain('secret')
  })
  it('提交请求响应丢失不自动重试，避免重复解析', async () => {
    const request = vi.fn(async () => { throw new Error('lost response with token=secret') })
    await expect(new MineruHttp({ fetch: request, retries: 3 }).json('https://mineru.net/submit', 'secret', {})).rejects.toThrow('提交任务')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
