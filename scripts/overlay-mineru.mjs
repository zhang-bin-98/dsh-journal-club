// M1 验收脚本：MinerU content-list bbox 叠加到 pdfjs 页图，目视验证坐标对齐。
// 用法：node scripts/overlay-mineru.mjs <pdf> <content-list.json> <outdir> [pageIdx...]
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { PdfFile } from '../src/pdf/pdf.ts'

const [pdfPath, jsonPath, outDir, ...pageArgs] = process.argv.slice(2)
const blocks = JSON.parse(await readFile(jsonPath, 'utf8'))
const file = await PdfFile.open(pdfPath)
await mkdir(outDir, { recursive: true })

// MinerU bbox 坐标基准验证：两轴各自归一化到 0–1000（百分比×10）。
const GRID = 1000

const pages = pageArgs.length > 0 ? pageArgs.map(Number) : [...new Set(blocks.filter(b => b.type === 'image' || b.type === 'chart').map(b => b.page_idx))]

for (const pageIdx of pages) {
  const pageNumber = pageIdx + 1
  const png = await file.renderPage(pageNumber, 150)
  const image = await loadImage(Buffer.from(png.data))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const scaleX = image.width / GRID
  const scaleY = image.height / GRID
  for (const block of blocks.filter(b => b.page_idx === pageIdx && b.bbox)) {
    const [x0, y0, x1, y1] = block.bbox
    const isFigure = block.type === 'image' || block.type === 'chart'
    ctx.strokeStyle = isFigure ? 'rgba(255,0,0,0.95)' : 'rgba(0,120,255,0.35)'
    ctx.lineWidth = isFigure ? 4 : 1.5
    ctx.strokeRect(x0 * scaleX, y0 * scaleY, (x1 - x0) * scaleX, (y1 - y0) * scaleY)
    if (isFigure) {
      ctx.fillStyle = 'rgba(255,0,0,0.9)'
      ctx.font = 'bold 22px sans-serif'
      ctx.fillText(`${block.type}${block.img_path ? '' : '(no img)'} p${pageNumber}`, x0 * scaleX + 6, Math.max(24, y0 * scaleY - 6))
    }
  }
  const out = `${outDir}/overlay-p${String(pageNumber).padStart(3, '0')}.png`
  await writeFile(out, await canvas.encode('png'))
  console.log(`written ${out} (${image.width}x${image.height}, scale=(${scaleX.toFixed(3)},${scaleY.toFixed(3)}))`)
}
