/**
 * Rectangle primitives adapted from SmartJC's presentation/layout geometry.
 * Coordinates use the supplied canvas; 960 x 540 is only the default.
 */

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ImageSize {
  readonly width: number
  readonly height: number
}

export type LayoutKind = 'grid' | 'rows' | '1+2'

export function containRect(area: Rect, aspect: number): Rect {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('图片宽高比必须是正数')
  const width = Math.min(area.width, area.height * aspect)
  const height = width / aspect
  return {
    x: area.x + (area.width - width) / 2,
    y: area.y + (area.height - height) / 2,
    width,
    height,
  }
}

function splitRows(count: number, width: number, height: number, gap: number): Rect[] {
  const rowHeight = (height - Math.max(0, count - 1) * gap) / count
  return Array.from({ length: count }, (_, index) => ({
    x: 0,
    y: index * (rowHeight + gap),
    width,
    height: rowHeight,
  }))
}

function splitGrid(count: number, width: number, height: number, gap: number): Rect[] {
  const columns = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / columns)
  const cellWidth = (width - Math.max(0, columns - 1) * gap) / columns
  const cellHeight = (height - Math.max(0, rows - 1) * gap) / rows
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    return {
      x: column * (cellWidth + gap),
      y: row * (cellHeight + gap),
      width: cellWidth,
      height: cellHeight,
    }
  })
}

function splitOnePlusTwo(width: number, height: number, gap: number): Rect[] {
  const topHeight = (height - gap) * 0.5
  const bottomHeight = height - topHeight - gap
  const bottomWidth = (width - gap) * 0.5
  return [
    { x: 0, y: 0, width, height: topHeight },
    { x: 0, y: topHeight + gap, width: bottomWidth, height: bottomHeight },
    { x: bottomWidth + gap, y: topHeight + gap, width: width - bottomWidth - gap, height: bottomHeight },
  ]
}

/** 空白编辑区与自动排版的参考画布；拼图导出尺寸由图片外缘决定，与此无关。 */
export const DEFAULT_CANVAS = { width: 960, height: 540 } as const
/** 自动排版的分区间距（参考画布单位）；只用于建议排版，不写入 groups.json。 */
export const DEFAULT_GAP = 12

function partitionRects(kind: LayoutKind, count: number, gap: number, width: number, height: number): Rect[] {
  if (!Number.isInteger(count) || count < 1) throw new Error('图组至少需要一个成员')
  if (!Number.isFinite(gap) || gap < 0) throw new Error('布局间距必须非负')
  if (![width, height].every(n => Number.isFinite(n) && n >= 1)) throw new Error('画布尺寸必须至少为 1')
  gap = Math.min(gap, width / (count * 2), height / (count * 2))
  if (kind === '1+2' && count !== 3) throw new Error('1+2 布局必须恰好包含 3 个成员')
  if (kind === 'rows') return splitRows(count, width, height, gap)
  if (kind === '1+2') return splitOnePlusTwo(width, height, gap)
  return splitGrid(count, width, height, gap)
}

function scoreLayout(cells: readonly Rect[], images: readonly ImageSize[]): number {
  const areas = cells.map((cell, index) => {
    const image = images[index]
    if (!image || image.width <= 0 || image.height <= 0) return 0
    const fitted = containRect(cell, image.width / image.height)
    return fitted.width * fitted.height
  })
  return Math.min(...areas) * 4 + areas.reduce((sum, value) => sum + value, 0)
}

/**
 * Deterministically rank the finite layouts used by compose_panels. A requested
 * hint is tried first; automatic selection uses SmartJC's area-based score.
 */
export function chooseLayout(
  count: number,
  images: readonly ImageSize[],
  hint?: LayoutKind,
  gap = DEFAULT_GAP,
  width: number = DEFAULT_CANVAS.width,
  height: number = DEFAULT_CANVAS.height,
): { kind: LayoutKind; cells: Rect[]; score: number } {
  const candidates: LayoutKind[] = hint
    ? [hint]
    : count === 3
      ? ['1+2', 'grid', 'rows']
      : ['grid', 'rows']
  const ranked = candidates.map(kind => {
    const cells = partitionRects(kind, count, gap, width, height)
    return { kind, cells, score: scoreLayout(cells, images) }
  })
  ranked.sort((left, right) => right.score - left.score || left.kind.localeCompare(right.kind))
  const selected = ranked[0]
  if (!selected) throw new Error('无法生成图组布局')
  return selected
}
