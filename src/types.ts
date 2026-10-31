import type { JsonValue } from '@deepseek-ai/dsh-util-values'
export type { CompositionState, CompositionSave, CompositionGeometry, CompositionCell, CompositionAsset, CompositionLayout, CompositionGroup } from './layout/composition.ts'

export interface FigureEdit {
  figures_json: string
  base_rev: number
  patch: ({ op: 'add' | 'replace' | 'test'; path: string; value: JsonValue } |
    { op: 'remove'; path: string } | { op: 'move' | 'copy'; path: string; from: string })[]
}
export interface FigureEditResult { ok: boolean; conflict: boolean; revision: number }
/** 工作台改框后重裁指定 Panel，使 figures/<id>.png 与当前框一致。 */
export interface PanelCrop { figures_json: string; ids: string[] }
/** base_revision：重裁读取时的版本；与 revision 不同即本次登记新 asset 推进的版本。 */
export interface PanelCropResult { base_revision: number; revision: number; cropped: string[]; anomalies: { id: string; kind: string; detail?: string }[] }
export interface PageInfo { path: string; width: number; height: number }
