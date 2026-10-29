import { describe, expect, it } from 'vitest'
import { normalizeBBox, resizeBBox, bboxStyle } from '../src/client/workbench/geometry.ts'

describe('图源工作台 bbox 几何', () => {
  const page = { width: 612, height: 792 }

  it('将 PDF pt bbox 映射成底图百分比', () => {
    expect(bboxStyle([61.2, 79.2, 306, 396], page)).toEqual({
      left: '10%',
      top: '10%',
      width: '40%',
      height: '40%',
    })
  })

  it('四角调框限制在页面内并保留最小面积', () => {
    expect(normalizeBBox([-10, -10, 900, 1000], page)).toEqual([0, 0, 612, 792])
    expect(resizeBBox([100, 100, 200, 200], 'nw', 150, 150, page)).toEqual([198, 198, 200, 200])
  })
})
