import { describe, expect, it } from 'vitest'
import { drawWithinRegion, editWithinRegion, moveBBox } from '../src/client/workbench/geometry.ts'

describe('工作台页图与区域编辑', () => {
  it('移动保持大小，限制在真实横向页范围', () => {
    expect(moveBBox([600, 200, 750, 400], 200, -300, { width: 800, height: 500 })).toEqual([650, 0, 800, 200])
  })
  it('框移动和四角修改不得越出 Figure region', () => {
    const region = [100, 200, 500, 700] as const
    expect(editWithinRegion([200, 300, 300, 400], region, -500, 900)).toEqual([100, 600, 200, 700])
    expect(editWithinRegion([200, 300, 300, 400], region, 900, 900, 'se')).toEqual([200, 300, 500, 700])
  })
  it('新框支持反向拖选并限制在区域内', () => {
    expect(drawWithinRegion([550, 750, 50, 50], [100, 200, 500, 700])).toEqual([100, 200, 500, 700])
  })
})
