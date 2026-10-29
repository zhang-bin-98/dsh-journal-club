import type { BBox } from '../types.ts'

export const DEFAULT_PAGE_SIZE = { width: 612, height: 792 }
export const MIN_BBOX_SIZE = 2

export interface PageSize {
  readonly width: number
  readonly height: number
}

export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'

export function bboxStyle(bbox: BBox, page: PageSize): {
  left: string
  top: string
  width: string
  height: string
} {
  return {
    left: `${(bbox[0] / page.width) * 100}%`,
    top: `${(bbox[1] / page.height) * 100}%`,
    width: `${((bbox[2] - bbox[0]) / page.width) * 100}%`,
    height: `${((bbox[3] - bbox[1]) / page.height) * 100}%`,
  }
}

export function normalizeBBox(bbox: BBox, page: PageSize): BBox {
  const x0 = clamp(Math.min(bbox[0], bbox[2]), 0, page.width - MIN_BBOX_SIZE)
  const y0 = clamp(Math.min(bbox[1], bbox[3]), 0, page.height - MIN_BBOX_SIZE)
  const x1 = clamp(Math.max(bbox[0], bbox[2]), x0 + MIN_BBOX_SIZE, page.width)
  const y1 = clamp(Math.max(bbox[1], bbox[3]), y0 + MIN_BBOX_SIZE, page.height)
  return [x0, y0, x1, y1]
}

export function resizeBBox(
  bbox: BBox,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  page: PageSize,
): BBox {
  let [x0, y0, x1, y1] = bbox
  if (handle.includes('w')) x0 = clamp(x0 + deltaX, 0, x1 - MIN_BBOX_SIZE)
  if (handle.includes('e')) x1 = clamp(x1 + deltaX, x0 + MIN_BBOX_SIZE, page.width)
  if (handle.includes('n')) y0 = clamp(y0 + deltaY, 0, y1 - MIN_BBOX_SIZE)
  if (handle.includes('s')) y1 = clamp(y1 + deltaY, y0 + MIN_BBOX_SIZE, page.height)
  return [x0, y0, x1, y1]
}

export function pageSizeFromImage(width: number, height: number, dpi = 150): PageSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return DEFAULT_PAGE_SIZE
  return { width: width * 72 / dpi, height: height * 72 / dpi }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
