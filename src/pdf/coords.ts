import type { BBox } from '../figures/figuresJson.ts'

/**
 * bbox 坐标约定（架构 §1.4，继承 SmartJC）：统一 PDF 点（pt）、原页旋转后基准。
 * 旋转后基准 = page.getViewport({ scale: 1 }) 的宽高：横排页即 MediaBox 常规朝向，
 * 旋转 90/270 的页按旋转后的视觉朝向计量，与渲染底图所见一致。
 */

export interface ClampedBBox {
  bbox: BBox
  clamped: boolean
}

/** 将 bbox 收拢到页面范围内；越界部分截断并标记。退化（宽高 ≤ 0）由调用方按异常处理。 */
export function clampBBox(bbox: BBox, pageWidth: number, pageHeight: number): ClampedBBox {
  const x0 = Math.max(0, Math.min(bbox[0], pageWidth))
  const y0 = Math.max(0, Math.min(bbox[1], pageHeight))
  const x1 = Math.max(0, Math.min(bbox[2], pageWidth))
  const y1 = Math.max(0, Math.min(bbox[3], pageHeight))
  const clamped =
    bbox[0] !== x0 || bbox[1] !== y0 || bbox[2] !== x1 || bbox[3] !== y1
  return { bbox: [x0, y0, x1, y1], clamped }
}

/** 宽或高 ≤ minimum（pt）视为空框。 */
export function isEmptyBBox(bbox: BBox, minimum = 1): boolean {
  return bbox[2] - bbox[0] < minimum || bbox[3] - bbox[1] < minimum
}
