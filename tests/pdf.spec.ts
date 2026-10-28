import { readFile } from 'node:fs/promises'
import { loadImage, createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { PdfFile } from '../src/pdf/pdf.ts'
import { FIXTURES, fixturePath } from './fixtures.ts'

/** PNG → RGBA 像素（经 napi-canvas 解码）。 */
async function pngPixels(png: Uint8Array): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const image = await loadImage(Buffer.from(png))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  return { data: ctx.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height }
}

/** 两图去掉 edge 边缘后逐像素平均绝对差（0–255）。 */
function meanAbsDiff(
  a: { data: Uint8ClampedArray; width: number; height: number },
  b: { data: Uint8ClampedArray; width: number; height: number },
  edge = 2,
): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`尺寸不一致：${a.width}x${a.height} vs ${b.width}x${b.height}`)
  }
  let total = 0
  let count = 0
  for (let y = edge; y < a.height - edge; y++) {
    for (let x = edge; x < a.width - edge; x++) {
      for (let c = 0; c < 3; c++) {
        total += Math.abs(a.data[(y * a.width + x) * 4 + c]! - b.data[(y * b.width + x) * 4 + c]!)
        count++
      }
    }
  }
  return total / count
}

describe('M1 fixture：真实论文渲染', () => {
  it.each(FIXTURES)('$id：打开、页数与首页渲染尺寸正确', async fixture => {
    const file = await PdfFile.open(fixturePath(fixture))
    expect(file.numPages).toBeGreaterThan(5)
    const size = await file.pageSize(1)
    expect(size.width).toBeGreaterThan(300)
    expect(size.height).toBeGreaterThan(300)
    const png = await file.renderPage(1, 150)
    // 150 DPI：px = pt * 150/72，容差 ±2px（取整差异）。
    expect(Math.abs(png.width - (size.width * 150) / 72)).toBeLessThanOrEqual(2)
    expect(Math.abs(png.height - (size.height * 150) / 72)).toBeLessThanOrEqual(2)
    // PNG 可解码且非空白（方差 > 0）。
    const pixels = await pngPixels(png.data)
  let variance = 0
  let mean = 0
  const n = pixels.width * pixels.height
  for (let i = 0; i < n; i++) mean += pixels.data[i * 4]!
  mean /= n
  for (let i = 0; i < n; i++) variance += (pixels.data[i * 4]! - mean) ** 2
  variance /= n
    expect(variance).toBeGreaterThan(100)
  })

  it.each(FIXTURES.slice(0, 2))('$id：crop 与整页渲染切片一致（transform 数学回归）', async fixture => {
    const file = await PdfFile.open(fixturePath(fixture))
    const page = 2
    const size = await file.pageSize(page)
    const dpi = 300
    // 中央 40% 区域。
    const bbox: [number, number, number, number] = [
      size.width * 0.3,
      size.height * 0.3,
      size.width * 0.7,
      size.height * 0.7,
    ]
    const full = await file.renderPage(page, dpi)
    const region = await file.renderRegion(page, bbox, dpi)
    expect(Math.abs(region.width - ((bbox[2] - bbox[0]) * dpi) / 72)).toBeLessThanOrEqual(1)
    // 从整页渲染中切出同一区域（px 坐标 = pt * dpi/72）。
    const scale = dpi / 72
    const sx = Math.round(bbox[0] * scale)
    const sy = Math.round(bbox[1] * scale)
    const fullPixels = await pngPixels(full.data)
    const sw = Math.min(region.width, fullPixels.width - sx)
    const sh = Math.min(region.height, fullPixels.height - sy)
    const sliceCanvas = createCanvas(sw, sh)
    const sliceCtx = sliceCanvas.getContext('2d')
    const fullImage = await loadImage(Buffer.from(full.data))
    sliceCtx.drawImage(fullImage, sx, sy, sw, sh, 0, 0, sw, sh)
    const slicePng = { data: sliceCtx.getImageData(0, 0, sw, sh).data, width: sw, height: sh }
    const regionPixels = await pngPixels(region.data)
    const diff = meanAbsDiff(regionPixels, slicePng)
    // 亚像素取整与文字抗锯齿允许微小差异；方向错误会产生数量级偏差。
    expect(diff).toBeLessThan(1.5)
  })
})

describe('M1：旋转页渲染基准（原页旋转后基准的 bbox）', () => {
  const rotatedPath = () =>
    fixturePath({ id: 'rotated', file: 'rotated-landscape.pdf', title: 'synthetic rotated page' })

  it('旋转页尺寸按旋转后基准（792x612 横排）', async () => {
    const file = await PdfFile.open(rotatedPath())
    const size = await file.pageSize(1)
    expect(Math.round(size.width)).toBe(792)
    expect(Math.round(size.height)).toBe(612)
  })

  it('旋转后基准的 bbox 裁切命中蓝色矩形（自动定位 → 回裁验证）', async () => {
    const file = await PdfFile.open(rotatedPath())
    const dpi = 150
    const full = await file.renderPage(1, dpi)
    expect(full.width).toBeGreaterThan(full.height) // 横排
    // 在渲染图上定位蓝色矩形像素（用户空间左下角，旋转后出现在画面某侧）。
    const pixels = await pngPixels(full.data)
    let minX = Infinity
    let minY = Infinity
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < pixels.height; y++) {
      for (let x = 0; x < pixels.width; x++) {
        const i = (y * pixels.width + x) * 4
        if (pixels.data[i + 2]! > 200 && pixels.data[i]! < 100 && pixels.data[i + 1]! < 100) {
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }
    expect(maxX).toBeGreaterThan(0) // 找到了蓝色矩形
    // px → pt（旋转后基准），内缩 2px 避开抗锯齿边缘。
    const scale = dpi / 72
    const bbox: [number, number, number, number] = [
      (minX + 2) / scale,
      (minY + 2) / scale,
      (maxX - 2) / scale,
      (maxY - 2) / scale,
    ]
    const region = await file.renderRegion(1, bbox, dpi)
    const regionPixels = await pngPixels(region.data)
    // 内部应全蓝：均值接近 (0,0,255)。
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let y = 3; y < regionPixels.height - 3; y++) {
      for (let x = 3; x < regionPixels.width - 3; x++) {
        const i = (y * regionPixels.width + x) * 4
        r += regionPixels.data[i]!
        g += regionPixels.data[i + 1]!
        b += regionPixels.data[i + 2]!
        n++
      }
    }
    expect(r / n).toBeLessThan(30)
    expect(g / n).toBeLessThan(30)
    expect(b / n).toBeGreaterThan(220)
  })
})

describe('M1：边界与异常', () => {
  it('越界 bbox 截断并标记 clamped', async () => {
    const file = await PdfFile.open(fixturePath(FIXTURES[0]!))
    const size = await file.pageSize(1)
    const region = await file.renderRegion(1, [-50, -50, size.width + 100, size.height * 0.5], 150)
    expect(region.clamped).toBe(true)
    expect(region.width).toBeGreaterThan(0)
  })

  it('页码越界报错', async () => {
    const file = await PdfFile.open(fixturePath(FIXTURES[0]!))
    await expect(file.renderPage(99999, 150)).rejects.toThrow(/页码越界/)
  })
})
