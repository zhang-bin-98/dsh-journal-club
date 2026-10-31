import { chooseLayout, containRect, type Rect, type ImageSize } from './figureGeometry.ts'

export interface CompositionCell extends Rect { member: string; content?: Rect }
export interface CompositionGeometry { width: number; height: number; gap: number; cells: CompositionCell[] }
export interface CompositionLayout { kind: 'manual' | 'grid' | 'rows' | '1+2'; geometry: CompositionGeometry }
export interface CompositionAsset extends ImageSize { id: string; asset: string; digest: string; label: string }
export interface CompositionGroup { id: string; asset: string; members: string[]; inputs_digest: string; layout?: CompositionLayout; stale?: boolean }
export interface CompositionState { groups: CompositionGroup[]; order?: string[]; digest: string; assets: CompositionAsset[]; warnings: string[] }
export interface CompositionSave {
  project: string
  id: string
  create?: boolean
  geometry: CompositionGeometry
  base_digest: string
  inputs: { id: string; digest: string }[]
}

/** The same logical rectangles drive the editor and PNG export. No count or aspect-ratio cap. */
export function validateGeometry(value: unknown, members?: readonly string[]): CompositionGeometry {
  if (!value || typeof value !== 'object') throw new Error('缺少拼图几何')
  const g = value as CompositionGeometry
  if (![g.width, g.height].every(n => Number.isFinite(n) && n >= 1) || !Number.isFinite(g.gap) || g.gap < 0 || !Array.isArray(g.cells)) throw new Error('参考宽高必须至少为 1，间距必须非负')
  const ids = new Set<string>()
  for (const c of g.cells) {
    if (!c || typeof c.member !== 'string' || ids.has(c.member) || ![c.x, c.y, c.width, c.height].every(Number.isFinite) || c.width <= 0 || c.height <= 0) throw new Error('图片坐标或尺寸无效，成员不可重复')
    ids.add(c.member)
  }
  if (members && (members.length !== ids.size || members.some(id => !ids.has(id)))) throw new Error('布局成员与输入图片不一致')
  return { width: g.width, height: g.height, gap: g.gap, cells: g.cells.map(c => ({ member: c.member, x: c.x, y: c.y, width: c.width, height: c.height })) }
}

export function suggestGeometry(assets: readonly (ImageSize & { id: string })[], width: number, height: number): CompositionGeometry {
  if (!assets.length) return { width, height, gap: 12, cells: [] }
  const chosen = chooseLayout(assets.length, assets, undefined, 12, width, height)
  return { width, height, gap: 12, cells: chosen.cells.map((cell, i) => ({ member: assets[i]!.id, ...containRect(cell, assets[i]!.width / assets[i]!.height) })) }
}

export function fitCanvas(g: CompositionGeometry): CompositionGeometry {
  if (!g.cells.length) return g
  const left = Math.min(...g.cells.map(c => c.x)), top = Math.min(...g.cells.map(c => c.y))
  const right = Math.max(...g.cells.map(c => c.x + c.width)), bottom = Math.max(...g.cells.map(c => c.y + c.height))
  return { ...g, width: Math.max(1, right - left), height: Math.max(1, bottom - top), cells: g.cells.map(c => ({ ...c, x: c.x - left, y: c.y - top })) }
}

/** Bounds of the displayed images, excluding contain-cell padding but never trimming source pixels. */
export function compositionBounds(g: CompositionGeometry, assets: readonly (ImageSize & { id: string })[]): Rect {
  if (!g.cells.length) return { x: 0, y: 0, width: 960, height: 540 }
  const cells = contentCells(g, assets)
  const x = Math.min(...cells.map(c => c.x)), y = Math.min(...cells.map(c => c.y))
  return { x, y, width: Math.max(1, Math.max(...cells.map(c => c.x + c.width)) - x), height: Math.max(1, Math.max(...cells.map(c => c.y + c.height)) - y) }
}

function contentCells(g: CompositionGeometry, assets: readonly (ImageSize & { id: string })[]): CompositionCell[] {
  const byId = new Map(assets.map(a => [a.id, a]))
  return g.cells.map(c => {
    const asset = byId.get(c.member)
    return { member: c.member, ...containRect(c, asset ? asset.width / asset.height : c.width / c.height) }
  })
}

/** Export one tightly bounded image; the previous canvas is only a layout reference. */
export function fitComposition(g: CompositionGeometry, assets: readonly (ImageSize & { id: string })[]): CompositionGeometry {
  return fitCanvas({ ...g, cells: contentCells(g, assets) })
}

export function editingBounds(g: CompositionGeometry, assets: readonly (ImageSize & { id: string })[]): Rect {
  const b = compositionBounds(g, assets)
  const pad = Math.max(40, Math.max(b.width, b.height) * .08)
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 }
}

/** Pixel rounding is shared, so both preview and exported images use the same fit. */
export function imageRect(cell: Rect, image: ImageSize, scale = 1): Rect {
  const r = containRect(cell, image.width / image.height)
  return { x: Math.round(r.x * scale), y: Math.round(r.y * scale), width: Math.max(1, Math.round(r.width * scale)), height: Math.max(1, Math.round(r.height * scale)) }
}

export function resizeImage(rect: Rect, corner: string, dx: number, dy: number): Rect {
  const sx = corner.includes('w') ? -1 : 1, sy = corner.includes('n') ? -1 : 1
  const factor = Math.max(1 / Math.min(rect.width, rect.height), 1 + (sx * dx * rect.width + sy * dy * rect.height) / (rect.width ** 2 + rect.height ** 2))
  const width = rect.width * factor, height = rect.height * factor
  return { x: sx < 0 ? rect.x + rect.width - width : rect.x, y: sy < 0 ? rect.y + rect.height - height : rect.y, width, height }
}
