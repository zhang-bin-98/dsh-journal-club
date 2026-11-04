import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises'
import { dirname, relative, resolve, basename } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { crc32 } from 'node:zlib'
import yauzl from 'yauzl'
import { parseContentList } from '../pdf/mineru.ts'
import { MineruError } from './transport.ts'

export function inside(root: string, path: string): string {
  if (!path || /[\\:\u0000]/u.test(path) || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.')) {
    throw new MineruError('结果校验', '结果含不安全路径')
  }
  const full = resolve(root, path)
  if (!relative(root, full) || relative(root, full).startsWith('..')) throw new MineruError('结果校验', '路径超出结果目录')
  return full
}

/** Lazy streamed extraction; never execute files or follow archive symlinks. */
export async function extractZip(path: string, target: string, signal?: AbortSignal): Promise<void> {
  await mkdir(target, { recursive: true })
  await new Promise<void>((resolvePromise, reject) => yauzl.open(path, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
    if (error || !zip) { reject(new MineruError('结果校验', 'ZIP 损坏或不完整')); return }
    const fail = () => { zip.close(); reject(new MineruError('结果校验', 'ZIP 解包失败或含不安全文件')) }
    const abort = () => { zip.close(); reject(signal!.reason) }
    signal?.addEventListener('abort', abort, { once: true })
    zip.on('close', () => signal?.removeEventListener('abort', abort))
    zip.on('error', fail)
    zip.on('end', resolvePromise)
    zip.on('entry', (entry: yauzl.Entry) => {
      void (async () => {
        signal?.throwIfAborted()
        if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('symlink')
        const name = entry.fileName.replace(/\/$/u, '')
        const output = inside(target, name)
        if (entry.fileName.endsWith('/')) { await mkdir(output, { recursive: true }); zip.readEntry(); return }
        await mkdir(dirname(output), { recursive: true })
        const stream = await new Promise<NodeJS.ReadableStream>((ok, bad) => zip.openReadStream(entry, (err, value) => err || !value ? bad(err) : ok(value)))
        let checksum = 0
        const verify = new Transform({ transform(chunk: Buffer, _encoding, callback) { checksum = crc32(chunk, checksum); callback(null, chunk) } })
        await pipeline(stream, verify, createWriteStream(output, { flags: 'wx' }), { signal })
        if (checksum !== entry.crc32) throw new Error('CRC mismatch')
        zip.readEntry()
      })().catch(fail)
    })
    zip.readEntry()
  }))
}

export async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries.filter(e => e.isFile()).map(e => relative(root, resolve(e.parentPath, e.name)).replaceAll('\\', '/')).sort()
}

export async function normalizeResult(root: string, stem: string, mode: 'extract' | 'flash'): Promise<string[]> {
  if (mode === 'extract') {
    const files = await listFiles(root)
    const markdown = files.filter(f => basename(f) === 'full.md')
    const content = files.filter(f => /(?:^|_)content_list\.json$/u.test(basename(f)))
    if (markdown.length !== 1 || content.length !== 1) throw new MineruError('结果校验', 'ZIP 缺少唯一的 Markdown 或 content-list')
    // Official archives normally have a flat root. A nested root is normalized as a whole.
    const parent = dirname(markdown[0]!)
    if (parent !== '.') {
      if (dirname(content[0]!) !== parent) throw new MineruError('结果校验', 'ZIP 正文与内容清单目录不一致')
      for (const entry of await readdir(resolve(root, parent))) await rename(resolve(root, parent, entry), resolve(root, entry))
    }
    await rename(resolve(root, basename(markdown[0]!)), resolve(root, `${stem}.md`))
    await rename(resolve(root, basename(content[0]!)), resolve(root, `${stem}.json`))
  }
  await validateResult(root, stem, mode)
  return listFiles(root)
}

export async function validateResult(root: string, stem: string, mode: 'extract' | 'flash'): Promise<void> {
  const markdown = await readFile(resolve(root, `${stem}.md`), 'utf8')
  if (!markdown.trim()) throw new MineruError('结果校验', 'Markdown 为空')
  const refs = [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/gu)].map(m => m[1]!.trim().replace(/^<|>$/gu, ''))
  if (mode === 'extract') refs.push(...parseContentList(await readFile(resolve(root, `${stem}.json`), 'utf8')).flatMap(b => b.img_path ? [b.img_path] : []))
  for (const path of new Set(refs)) {
    // Flash can contain remote image URLs; precision archives must contain their actual assets.
    if (mode === 'flash' && /^https?:\/\//u.test(path)) continue
    const info = await stat(inside(root, decodeURIComponent(path)))
    if (!info.isFile() || !info.size) throw new MineruError('结果校验', '图片缺失或为空')
  }
}
