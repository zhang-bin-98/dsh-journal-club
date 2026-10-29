import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export interface FigureEdit {
  figures_json: string
  base_rev: number
  patch: ({ op: 'add' | 'replace' | 'test'; path: string; value: JsonValue } |
    { op: 'remove'; path: string } | { op: 'move' | 'copy'; path: string; from: string })[]
}
export interface FigureEditResult { ok: boolean; conflict: boolean; revision: number }
export interface PageInfo { path: string; width: number; height: number }
