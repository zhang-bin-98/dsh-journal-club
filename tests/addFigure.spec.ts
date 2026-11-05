import { describe, expect, it, vi } from 'vitest'
vi.mock('react', () => ({ createElement: vi.fn(), useEffect: vi.fn(), useRef: vi.fn(), useState: vi.fn() }))
import { manualFigure, addFigurePatch } from '../src/client/workbench/AddFigure.ts'
import { drawWithinRegion } from '../src/client/workbench/geometry.ts'
import { applyJsonPatch } from '../src/figures/figuresStore.ts'
import { validateFiguresJson, parseFiguresJson } from '../src/figures/figuresJson.ts'

const document = { id: 'supp', path: 'supplement.pdf', role: 'supplement' as const, pages: 7 }
describe('手工补 Figure', () => {
  it('反向拖选按真实页尺寸限制范围，并创建可写入的 whole-panel', () => {
    const bbox = drawWithinRegion([900, 620, -10, 30], [0, 0, 842, 595])
    expect(bbox).toEqual([0, 30, 842, 595])
    const figure = manualFigure(document, 7, bbox, ' Figure S2 ', 'figure_test')
    const before = { version: 1, status: 'confirmed', revision: 4, documents: [document], figures: [] }
    const next = validateFiguresJson(parseFiguresJson(JSON.stringify(applyJsonPatch(before, addFigurePatch(figure))), 'manual fixture'))
    expect(next.status).toBe('draft')
    expect(next.figures[0]).toMatchObject({ label: 'Figure S2', status: 'adjusted', regions: [{ document: 'supp', page: 7, bbox }] })
    expect(next.figures[0]?.panels[0]).toMatchObject({ id: 'figure_test_whole', label: null, bbox, origin: 'manual', flags: ['missing-caption'], caption_refs: [] })
    expect(next.revision).toBe(4) // Only the host write service increments revision.
  })
  it('空图号保留 null，拒绝越界页码和空框', () => {
    expect(manualFigure(document, 1, [0, 0, 20, 20], '', 'figure_other').label).toBeNull()
    for (const page of [0, 8, 1.5]) expect(() => manualFigure(document, page, [0, 0, 20, 20], '', 'id')).toThrow()
    expect(() => manualFigure(document, 1, [0, 0, 0, 20], '', 'id')).toThrow()
    expect(() => manualFigure(document, 1, [0, 0, Number.NaN, 20], '', 'id')).toThrow()
  })
})
