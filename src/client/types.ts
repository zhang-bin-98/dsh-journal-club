import type { ReactNode } from 'react'

export type BBox = readonly [number, number, number, number]

export interface FigureRegion {
  readonly document: string
  readonly page: number
  readonly bbox: BBox
}

export interface FigurePanel {
  readonly id: string
  readonly label: string | null
  readonly region_index: number
  readonly bbox: BBox
  readonly asset?: string
  readonly caption_refs: readonly number[]
  readonly flags: readonly string[]
  readonly origin: 'auto' | 'manual' | 'agent'
}

export interface FigureCaption {
  readonly page: number
  readonly sentences: readonly string[]
}

export interface FigureDocument {
  readonly id: string
  readonly path: string
  readonly role: 'main' | 'supplement'
  readonly pages: number
}

export interface FigureRecord {
  readonly id: string
  readonly label: string | null
  readonly status: 'pending' | 'viewed' | 'adjusted' | 'excluded'
  readonly regions: readonly FigureRegion[]
  readonly caption?: FigureCaption
  readonly panels: readonly FigurePanel[]
}

export interface FiguresFile {
  readonly version: 1
  readonly status: 'draft' | 'confirmed'
  readonly revision: number
  readonly documents: readonly FigureDocument[]
  readonly figures: readonly FigureRecord[]
}

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

export interface UpdateFiguresSuccess {
  readonly ok: true
  readonly conflict: false
  readonly revision: number
  readonly figures?: FiguresFile
}

export interface UpdateFiguresConflict {
  readonly ok: false
  readonly conflict: true
  readonly revision: number
  readonly current?: FiguresFile
}

export type UpdateFiguresResult = UpdateFiguresSuccess | UpdateFiguresConflict

/** Host-side RPC; the client never receives a filesystem writer. */
export interface JournalClubRpcPort {
  updateFigures(request: UpdateFiguresRequest, signal?: AbortSignal): Promise<UpdateFiguresResult>
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
  readonly readAsset: (path: string, signal?: AbortSignal) => Promise<string>
  readonly dispose: () => void
}

export interface StoreErrorState {
  readonly message: string
  readonly detail?: ReactNode
}

export function isUpdateConflict(result: UpdateFiguresResult): result is UpdateFiguresConflict {
  return result.ok === false && result.conflict === true
}

export function isFiguresFile(value: unknown): value is FiguresFile {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return item.version === 1 && typeof item.revision === 'number' && Array.isArray(item.figures)
}
