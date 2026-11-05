import type { DocumentEntry, Figure, FiguresJson } from '../figures/schema.ts'
import type { FigureEditResult, PanelCropResult } from '../types.ts'

// figures.json 形状只在 zod schema 中定义一次；client 读取时也用同一 schema 解析。
export type BBox = readonly [number, number, number, number]
export type FigureDocument = DocumentEntry
export type FigureRecord = Figure
export type FiguresFile = FiguresJson

export interface WorkspaceText {
  readonly text: string
  readonly version?: string
}

export interface WorkspaceBytes {
  readonly data: Uint8Array
  readonly version?: string
}

export interface WorkspaceChange {
  readonly version?: string
  readonly absent?: boolean
}

export interface WorkspaceFilesPort {
  read(sessionId: string, path: string, signal: AbortSignal): Promise<WorkspaceText>
  readBytes(sessionId: string, path: string, signal: AbortSignal): Promise<WorkspaceBytes>
  changes?(sessionId: string, path: string, signal: AbortSignal): AsyncIterable<WorkspaceChange>
}

export type JsonPatch =
  | { readonly op: 'add' | 'replace' | 'test'; readonly path: string; readonly value: unknown }
  | { readonly op: 'remove'; readonly path: string }
  | { readonly op: 'move' | 'copy'; readonly from: string; readonly path: string }

export interface UpdateFiguresRequest {
  readonly figures_json: string
  readonly patch: readonly JsonPatch[]
  readonly base_rev: number
}

/** 与 host Remote 返回值同一契约。 */
export type UpdateFiguresResult = FigureEditResult

export type CropPanelsResult = PanelCropResult

/** Host-side RPC; the client never receives a filesystem writer. */
export interface JournalClubRpcPort {
  updateFigures(request: UpdateFiguresRequest, signal?: AbortSignal): Promise<UpdateFiguresResult>
  /** 改框后重裁对应 Panel；旧宿主未提供时工作台跳过重裁。 */
  cropPanels?(request: { readonly figures_json: string; readonly ids: readonly string[] }, signal?: AbortSignal): Promise<CropPanelsResult>
}

export interface WorkspaceResourceDeps {
  readonly files: WorkspaceFilesPort
  readonly updateFigures?: JournalClubRpcPort
  readonly sessionId: string
  readonly projectPath?: string
}

export interface ProjectSnapshot {
  readonly figures?: FiguresFile
  readonly jcText?: string
  readonly versions: Readonly<Record<string, string | undefined>>
  readonly changedFigureIds: readonly string[]
  readonly loadedAt: number
  readonly error?: string
}

export interface ProjectStore {
  readonly getSnapshot: () => ProjectSnapshot
  readonly subscribe: (listener: () => void) => () => void
  readonly refresh: () => Promise<void>
  readonly updateFigures: (request: UpdateFiguresRequest) => Promise<UpdateFiguresResult>
  /** 从 PDF 重裁指定 Panel，让 figures/<id>.png（agent 读取的图）与当前框一致。 */
  readonly cropPanels?: (ids: readonly string[]) => Promise<CropPanelsResult>
  readonly readAsset: (path: string, signal?: AbortSignal) => Promise<string>
  readonly dispose: () => void
}
