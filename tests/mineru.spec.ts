import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PdfFile } from '../src/pdf/pdf.ts'
import { mineruBBoxToPt, parseContentList } from '../src/pdf/mineru.ts'
import { FIXTURES, fixturePath } from './fixtures.ts'

const CONTENT_LIST = join(import.meta.dirname, 'fixtures', 'parse', '2605.13902.content-list.json')

describe('MinerU content-list 适配（真实解析产物回归）', () => {
  it('解析 content-list：block 数组、类型分布与图块字段齐全', async () => {
    const blocks = parseContentList(await readFile(CONTENT_LIST, 'utf8'))
    expect(blocks.length).toBeGreaterThan(100)
    const figures = blocks.filter(b => b.type === 'image' || b.type === 'chart')
    expect(figures.length).toBeGreaterThanOrEqual(7)
    let withCaption = 0
    for (const figure of figures) {
      expect(figure.img_path).toMatch(/^images\/[0-9a-f]+\.jpe?g$/)
      if ((figure.image_caption?.length ?? 0) > 0) withCaption++
    }
    // 正式 Figure 均带图注；无图注块（装饰图等）允许存在。
    expect(withCaption).toBeGreaterThanOrEqual(5)
  })

  it('bbox 为两轴 0–1000 归一化（实测坐标基准回归）', async () => {
    const blocks = parseContentList(await readFile(CONTENT_LIST, 'utf8'))
    const maxX = Math.max(...blocks.map(b => Math.max(b.bbox[0], b.bbox[2])))
    const maxY = Math.max(...blocks.map(b => Math.max(b.bbox[1], b.bbox[3])))
    // 若为统一像素栅格，x/y 上限比例应接近页面纵横比（本文档 ~1.29）；
    // 归一化基准下两者都贴近 1000。
    expect(maxX).toBeGreaterThan(950)
    expect(maxX).toBeLessThanOrEqual(1000)
    expect(maxY).toBeGreaterThan(950)
    expect(maxY).toBeLessThanOrEqual(1000)
    expect(maxY / maxX).toBeLessThan(1.1)
  })

  it('归一化 bbox 换算到 PDF pt 后落在页面内（对齐换算回归）', async () => {
    const blocks = parseContentList(await readFile(CONTENT_LIST, 'utf8'))
    const file = await PdfFile.open(fixturePath(FIXTURES[0]!))
    const figures = blocks.filter(b => b.type === 'image' || b.type === 'chart')
    for (const figure of figures) {
      const size = await file.pageSize(figure.page_idx + 1)
      const [x0, y0, x1, y1] = mineruBBoxToPt(figure.bbox, size)
      expect(x0).toBeGreaterThanOrEqual(0)
      expect(y0).toBeGreaterThanOrEqual(0)
      expect(x1).toBeLessThanOrEqual(size.width + 0.5)
      expect(y1).toBeLessThanOrEqual(size.height + 0.5)
      expect(x1 - x0).toBeGreaterThan(10)
      expect(y1 - y0).toBeGreaterThan(10)
    }
  })
})
