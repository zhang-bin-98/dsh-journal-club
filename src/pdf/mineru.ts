/**
 * MinerU content-list 适配（M1 实测结论，2026-10-28，mineru-open-api v0.5.9 extract）：
 *
 * - API 结果 ZIP 同时提供 Markdown、content-list、images；随包 runner 规范化命名；
 *   json 即 content-list：block 数组 `{ type, bbox, page_idx, text?, img_path?, image_caption?, … }`。
 * - **bbox 坐标基准：两轴各自归一化 0–1000**（x/maxX 与 y/maxY 均接近 1000，
 *   与页面纵横比无关；经真实论文页图叠加验证：文本块与整图块均对齐）。
 *   换算到本插件契约的 PDF pt（原页旋转后基准）：
 *   `pt = norm / 1000 × rotatedPageSize`。
 * - 整图块：type = image | chart，含 img_path（对应 images/ 内文件名）与
 *   image_caption（切分好的图注句）；文本块 type = text（text_level ≥ 1 为标题）。
 */

export type MineruBlockType = 'text' | 'ref_text' | 'image' | 'chart' | 'table' | 'equation' | string

export interface MineruBlock {
  type: MineruBlockType
  /** [x0, y0, x1, y1]，两轴各自 0–1000 归一化。 */
  bbox: [number, number, number, number]
  /** 0 起始页索引。 */
  page_idx: number
  text?: string
  text_level?: number
  img_path?: string
  image_caption?: string[]
  image_footnote?: string[]
}

export interface PtSize {
  width: number
  height: number
}

/** 归一化 bbox → PDF pt（旋转后基准）。pageSize 为该页 getViewport({scale:1}) 尺寸。 */
export function mineruBBoxToPt(
  bbox: [number, number, number, number],
  pageSize: PtSize,
): [number, number, number, number] {
  return [
    (bbox[0] / 1000) * pageSize.width,
    (bbox[1] / 1000) * pageSize.height,
    (bbox[2] / 1000) * pageSize.width,
    (bbox[3] / 1000) * pageSize.height,
  ]
}

/** 解析 content-list JSON（数组或 { content_list: [...] } 容器）。 */
export function parseContentList(raw: string): MineruBlock[] {
  const parsed: unknown = JSON.parse(raw)
  const blocks = Array.isArray(parsed) ? parsed : (parsed as { content_list?: unknown }).content_list
  if (!Array.isArray(blocks)) throw new Error('content-list 结构不符：既非数组也无 content_list 字段')
  for (const block of blocks) {
    const candidate = block as Partial<MineruBlock>
    if (
      typeof candidate.type !== 'string' ||
      !Array.isArray(candidate.bbox) ||
      candidate.bbox.length !== 4 ||
      typeof candidate.page_idx !== 'number'
    ) {
      throw new Error('content-list block 字段缺失（type/bbox/page_idx）')
    }
  }
  return blocks as MineruBlock[]
}
