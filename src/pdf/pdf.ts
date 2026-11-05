import { createRequire } from 'node:module'
import { dirname, sep } from 'node:path'
import { stat } from 'node:fs/promises'
import { createCanvas, type Canvas } from '@napi-rs/canvas'
import {
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import { clampBBox, type ClampedBBox } from './coords.ts'
import type { BBox } from '../figures/figuresJson.ts'

/**
 * Node 侧 pdfjs-dist 封装（架构 §2 src/pdf：文档缓存、DPI 渲染、bbox 裁剪 viewport）。
 *
 * - pdfjs-dist v6 在 Node 下官方配对即 @napi-rs/canvas（NodeCanvasFactory 直接
 *   require 该包）；cmap/字体/wasm 资源经 NodeBinaryDataFactory 用 fs 读取。
 * - 渲染数学移植自 SmartJC pdfResource.renderPage（C 类参考适配，算法语义不变）：
 *   bbox 换算为旋转后基准的归一化分数，经 render transform 的画布空间平移裁剪
 *   （pdfjs 语义：transform 先于 viewport.transform 进入 CTM，即作用于已缩放的
 *   画布坐标），裁切从 PDF 重渲染而非压缩预览图（产品原则：无损）。
 */

const require = createRequire(import.meta.url)

/**
 * pdfjs-dist 资源目录（cmaps/standard_fonts/wasm）。getDocument 校验要求
 * 以 `/` 结尾的 URL 形式；Node 下 pdfjs 经 fs.readFile 读取，正斜杠路径两者皆宜。
 */
function assetDir(dir: string): string {
  const pkgRoot = dirname(require.resolve('pdfjs-dist/package.json')).split(sep).join('/')
  return `${pkgRoot}/${dir}/`
}

const docParams = {
  cMapUrl: assetDir('cmaps'),
  cMapPacked: true,
  standardFontDataUrl: assetDir('standard_fonts'),
  wasmUrl: assetDir('wasm'),
} as const

/**
 * Node 无 Worker 环境：设置 globalThis.pdfjsWorker 让 pdfjs 走主线程
 * fake worker（PDFWorker.#initialize 检测到该句柄即跳过 new Worker 与
 * 动态 import workerSrc）。模块只需加载一次。
 */
let workerReady: Promise<void> | undefined
function ensureFakeWorker(): Promise<void> {
  workerReady ??= (async () => {
    const global = globalThis as { pdfjsWorker?: unknown }
    if (global.pdfjsWorker) return
    global.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  })().catch(error => {
    workerReady = undefined
    throw new PdfError(`pdfjs worker 预载失败：${(error as Error).message}`)
  })
  return workerReady
}

export interface PngImage {
  data: Uint8Array
  width: number
  height: number
}

interface OpenEntry {
  file?: PdfFile
  promise: Promise<PdfFile>
  version?: string
}

/** 已打开文档缓存：按绝对路径共享，LRU 上限 4 份（主论文 + 补充材料场景足够）。 */
const openDocs = new Map<string, OpenEntry>()
const MAX_OPEN_DOCS = 4

function touch(absPath: string, entry: OpenEntry): void {
  openDocs.delete(absPath)
  openDocs.set(absPath, entry)
  while (openDocs.size > MAX_OPEN_DOCS) {
    const oldest = openDocs.keys().next().value
    if (oldest === undefined) break
    const evicted = openDocs.get(oldest)
    openDocs.delete(oldest)
    void evicted?.file?.destroy().catch(() => {})
  }
}

export class PdfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfError'
  }
}

function fileVersion(absPath: string): Promise<string> {
  return stat(absPath).then(info => `${info.size}:${info.mtimeMs}:${info.ctimeMs}`)
}

export class PdfFile {
  private readonly doc: PDFDocumentProxy

  private constructor(doc: PDFDocumentProxy) {
    this.doc = doc
  }

  get numPages(): number {
    return this.doc.numPages
  }

  static async open(absPath: string, signal?: AbortSignal): Promise<PdfFile> {
    const version = await fileVersion(absPath)
    const cached = openDocs.get(absPath)
    if (cached && cached.version === version) {
      touch(absPath, cached)
      return cached.promise
    }
    if (cached?.file) await cached.file.destroy()
    openDocs.delete(absPath)
    const promise = (async () => {
      await ensureFakeWorker()
      const { readFile } = await import('node:fs/promises')
      let data: Uint8Array
      try {
        data = new Uint8Array(await readFile(absPath))
      } catch (error) {
        throw new PdfError(`PDF 不可读（${absPath}）：${(error as Error).message}`)
      }
      const loading = getDocument({ data, ...docParams })
      const onAbort = () => void loading.destroy().catch(() => {})
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const doc = await loading.promise
        return new PdfFile(doc)
      } catch (error) {
        if (signal?.aborted) throw abortError()
        if (error instanceof Error && error.name === 'PasswordException') {
          throw new PdfError('加密 PDF 暂不支持，请提供无密码版本')
        }
        throw new PdfError(`PDF 解析失败（${absPath}）：${(error as Error).message}`)
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    })()
    const entry: OpenEntry = { promise, version }
    promise.then(
      file => {
        entry.file = file
        touch(absPath, entry)
      },
      () => openDocs.delete(absPath),
    )
    openDocs.set(absPath, entry)
    return promise
  }

  async destroy(): Promise<void> {
    await this.doc.loadingTask.destroy().catch(() => {})
  }

  private async getPageChecked(pageNumber: number): Promise<PDFPageProxy> {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > this.doc.numPages) {
      throw new PdfError(`页码越界：${pageNumber}（共 ${this.doc.numPages} 页）`)
    }
    return this.doc.getPage(pageNumber)
  }

  /** 旋转后基准的页面尺寸（pt）。 */
  async pageSize(pageNumber: number): Promise<{ width: number; height: number }> {
    const page = await this.getPageChecked(pageNumber)
    try {
      const viewport = page.getViewport({ scale: 1 })
      return { width: viewport.width, height: viewport.height }
    } finally {
      page.cleanup()
    }
  }

  /** 整页渲染为 PNG。 */
  async renderPage(pageNumber: number, dpi: number, signal?: AbortSignal): Promise<PngImage> {
    const page = await this.getPageChecked(pageNumber)
    try {
      const canvas = await this.renderToCanvas(page, dpi, undefined, signal)
      return await canvasToPng(canvas)
    } finally {
      page.cleanup()
    }
  }

  /** 按 bbox（pt，旋转后基准）裁剪 viewport 渲染；越界部分截断并在结果中标记。 */
  async renderRegion(
    pageNumber: number,
    bbox: BBox,
    dpi: number,
    signal?: AbortSignal,
  ): Promise<PngImage & ClampedBBox> {
    const page = await this.getPageChecked(pageNumber)
    try {
      const base = page.getViewport({ scale: 1 })
      const region = clampBBox(bbox, base.width, base.height)
      const canvas = await this.renderToCanvas(page, dpi, region, signal)
      const png = await canvasToPng(canvas)
      return { ...png, ...region }
    } finally {
      page.cleanup()
    }
  }

  private async renderToCanvas(
    page: PDFPageProxy,
    dpi: number,
    region: ClampedBBox | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Canvas> {
    if (!Number.isFinite(dpi) || dpi <= 0 || dpi > 600) {
      throw new PdfError(`DPI 无效：${dpi}（支持 1–600）`)
    }
    signal?.throwIfAborted()
    const scale = dpi / 72
    const viewport = page.getViewport({ scale })
    let width: number
    let height: number
    let transform: [number, number, number, number, number, number] | undefined
    if (region) {
      const base = page.getViewport({ scale: 1 })
      const [x0, y0, x1, y1] = region.bbox
      width = Math.max(1, Math.round((x1 - x0) * scale))
      height = Math.max(1, Math.round((y1 - y0) * scale))
      transform = [
        1,
        0,
        0,
        1,
        -(x0 / base.width) * viewport.width,
        -(y0 / base.height) * viewport.height,
      ]
    } else {
      width = Math.ceil(viewport.width)
      height = Math.ceil(viewport.height)
    }
    const canvas = createCanvas(width, height)
    let task: RenderTask | undefined
    let onCancel: (() => void) | undefined
    try {
      task = page.render({
        canvas: canvas as unknown as Parameters<PDFPageProxy['render']>[0]['canvas'],
        viewport,
        ...(transform === undefined ? {} : { transform }),
      })
      onCancel = () => task?.cancel()
      signal?.addEventListener('abort', onCancel, { once: true })
      await task.promise
      signal?.throwIfAborted()
      return canvas
    } catch (error) {
      if (signal?.aborted) throw abortError()
      throw new PdfError(`页面渲染失败：${(error as Error).message}`)
    } finally {
      if (onCancel && signal) signal.removeEventListener('abort', onCancel)
    }
  }
}

async function canvasToPng(canvas: Canvas): Promise<PngImage> {
  const data = await canvas.encode('png')
  return { data, width: canvas.width, height: canvas.height }
}

function abortError(): Error {
  const error = new Error('render aborted')
  error.name = 'AbortError'
  return error
}
