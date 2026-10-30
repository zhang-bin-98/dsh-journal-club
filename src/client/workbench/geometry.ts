import type { BBox, JsonPatch } from '../types.ts'

/** Keep the persisted containment invariant when a user corrects an undersized region. */
export function expandRegionPatch(path: string, region: BBox, bbox: BBox): JsonPatch[] {
  const expanded = [Math.min(region[0], bbox[0]), Math.min(region[1], bbox[1]), Math.max(region[2], bbox[2]), Math.max(region[3], bbox[3])]
  return expanded.every((value, index) => value === region[index]) ? [] : [{ op: 'replace', path, value: expanded }]
}

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

/** SmartJC moveBox: preserve size while clamping the translated rectangle to the page. */
export function moveBBox(bbox: BBox, dx: number, dy: number, page: PageSize): BBox {
  const width = bbox[2] - bbox[0]
  const height = bbox[3] - bbox[1]
  const x = clamp(bbox[0] + dx, 0, page.width - width)
  const y = clamp(bbox[1] + dy, 0, page.height - height)
  return [x, y, x + width, y + height]
}

/** Apply the page gesture inside its Figure region, keeping the persisted containment contract. */
export function editWithinRegion(bbox: BBox, region: BBox, dx: number, dy: number, handle?: ResizeHandle): BBox {
  const page = { width: region[2] - region[0], height: region[3] - region[1] }
  const local: BBox = [bbox[0] - region[0], bbox[1] - region[1], bbox[2] - region[0], bbox[3] - region[1]]
  const result = handle ? resizeBBox(local, handle, dx, dy, page) : moveBBox(local, dx, dy, page)
  return [result[0] + region[0], result[1] + region[1], result[2] + region[0], result[3] + region[1]]
}

export function drawWithinRegion(bbox: BBox, region: BBox): BBox {
  const result = normalizeBBox([bbox[0] - region[0], bbox[1] - region[1], bbox[2] - region[0], bbox[3] - region[1]], { width: region[2] - region[0], height: region[3] - region[1] })
  return [result[0] + region[0], result[1] + region[1], result[2] + region[0], result[3] + region[1]]
}
