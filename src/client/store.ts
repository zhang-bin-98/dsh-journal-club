import type {
  FiguresFile,
  FigureRecord,
  ProjectSnapshot,
  ProjectStore,
  UpdateFiguresRequest,
  UpdateFiguresResult,
  WorkspaceResourceDeps,
} from './types.ts'
import { parseFiguresJson } from '../figures/schema.ts'

const EMPTY_SNAPSHOT: ProjectSnapshot = {
  versions: {},
  changedFigureIds: [],
  loadedAt: 0,
}

function pathFor(root: string | undefined, name: string): string {
  if (root === undefined || root === '') return name
  return `${root.replace(/[\\/]$/u, '')}/${name}`
}

function parseFigures(text: string): FiguresFile {
  return parseFiguresJson(text)
}

function figureDigest(figure: FigureRecord): string {
  return JSON.stringify({
    status: figure.status,
    regions: figure.regions,
    panels: figure.panels,
    caption: figure.caption,
  })
}

function changedFigures(previous: FiguresFile | undefined, next: FiguresFile): string[] {
  if (previous === undefined) return next.figures.map(figure => figure.id)
  const oldById = new Map(previous.figures.map(figure => [figure.id, figureDigest(figure)]))
  return next.figures
    .filter(figure => oldById.get(figure.id) !== figureDigest(figure))
    .map(figure => figure.id)
}

function dataUrl(path: string, bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : globalThis.Buffer === undefined
      ? ''
      : globalThis.Buffer.from(bytes).toString('base64')
  const lower = path.toLowerCase()
  const mime = lower.endsWith('.jpg') || lower.endsWith('.jpeg')
    ? 'image/jpeg'
    : lower.endsWith('.webp')
      ? 'image/webp'
      : 'image/png'
  return `data:${mime};base64,${base64}`
}

/**
 * File-backed client store. It owns only transient snapshots and request
 * lifetimes; figures.json remains the source of truth and all writes leave via
 * the host updateFigures RPC.
 */
export function createProjectStore(deps: WorkspaceResourceDeps): ProjectStore {
  let snapshot = EMPTY_SNAPSHOT
  let disposed = false
  let revision = 0
  let refreshController: AbortController | undefined
  let refreshPromise: Promise<void> | undefined
  let refreshQueued = false
  const listeners = new Set<() => void>()
  const watchControllers: AbortController[] = []
  const assetCache = new Map<string, Promise<string>>()

  function emit(): void {
    for (const listener of listeners) listener()
  }

  function setSnapshot(next: ProjectSnapshot): void {
    if (disposed) return
    snapshot = next
    emit()
  }

  async function refresh(): Promise<void> {
    if (disposed) return
    refreshController?.abort()
    const controller = new AbortController()
    refreshController = controller
    const requestRevision = ++revision
    const root = deps.projectPath
    const figuresPath = pathFor(root, 'figures.json')
    const jcPath = pathFor(root, 'jc.md')
    try {
      const [figuresResult, jcResult] = await Promise.allSettled([
        deps.files.read(deps.sessionId, figuresPath, controller.signal),
        deps.files.read(deps.sessionId, jcPath, controller.signal),
      ])
      if (disposed || controller.signal.aborted || requestRevision !== revision) return
      const previousFigures = snapshot.figures
      let figures: FiguresFile | undefined
      let jcText: string | undefined
      let figuresError: string | undefined
      if (figuresResult.status === 'fulfilled') {
        try {
          figures = parseFigures(figuresResult.value.text)
        } catch (error) {
          figuresError = error instanceof Error ? error.message : String(error)
        }
      } else if (!isAbortError(figuresResult.reason) && !isMissingResourceError(figuresResult.reason)) {
        figuresError = `无法读取 figures.json：${messageOf(figuresResult.reason)}`
      }
      if (jcResult.status === 'fulfilled') jcText = jcResult.value.text
      else if (!isAbortError(jcResult.reason) && !isMissingResourceError(jcResult.reason)) {
        figuresError ??= `无法读取 jc.md：${messageOf(jcResult.reason)}`
      }
      const versions: Record<string, string | undefined> = {
        figures: figuresResult.status === 'fulfilled' ? figuresResult.value.version : undefined,
        jc: jcResult.status === 'fulfilled' ? jcResult.value.version : undefined,
      }
      setSnapshot({
        figures,
        jcText,
        versions,
        changedFigureIds: figures === undefined
          ? []
          : versions.figures === snapshot.versions.figures
            ? snapshot.changedFigureIds
            : changedFigures(previousFigures, figures),
        loadedAt: Date.now(),
        error: figuresError,
      })
    } catch (error) {
      if (!disposed && !controller.signal.aborted && requestRevision === revision) {
        setSnapshot({ ...snapshot, loadedAt: Date.now(), error: `读取工作区失败：${messageOf(error)}` })
      }
    } finally {
      if (refreshController === controller) refreshController = undefined
    }
  }

  function scheduleRefresh(): void {
    if (disposed) return
    refreshQueued = true
    if (refreshPromise !== undefined) return
    refreshPromise = (async () => {
      while (refreshQueued && !disposed) {
        refreshQueued = false
        assetCache.clear()
        await refresh()
      }
    })().finally(() => {
      refreshPromise = undefined
    })
  }

  function watch(path: string): void {
    if (deps.files.changes === undefined) return
    const controller = new AbortController()
    watchControllers.push(controller)
    const changes = deps.files.changes(deps.sessionId, path, controller.signal)
    void (async () => {
      try {
        for await (const change of changes) {
          if (controller.signal.aborted || disposed) return
          scheduleRefresh()
        }
      } catch (error) {
        if (!controller.signal.aborted && !disposed) {
          setSnapshot({ ...snapshot, error: `文件监听失败：${messageOf(error)}` })
        }
      }
    })()
  }

  function updateFigures(request: UpdateFiguresRequest): Promise<UpdateFiguresResult> {
    if (deps.updateFigures === undefined) {
      return Promise.reject(new Error('宿主未提供 update_figures RPC；为避免绕过统一写入通道，工作台不会直写文件。'))
    }
    return deps.updateFigures.updateFigures({ ...request, figures_json: pathFor(deps.projectPath, 'figures.json') }).then(result => {
      if (result.ok) scheduleRefresh()
      return result
    })
  }

  function readAsset(path: string, signal?: AbortSignal): Promise<string> {
    const cached = assetCache.get(path)
    if (cached !== undefined && signal?.aborted !== true) return cached
    const promise = deps.files.readBytes(deps.sessionId, pathFor(deps.projectPath, path), signal ?? new AbortController().signal)
      .then(result => dataUrl(path, result.data)).catch(error => { assetCache.delete(path); throw error })
    if (signal?.aborted !== true) assetCache.set(path, promise)
    return promise
  }

  watch(pathFor(deps.projectPath, 'figures.json'))
  watch(pathFor(deps.projectPath, 'jc.md'))
  watch(pathFor(deps.projectPath, 'pages'))
  scheduleRefresh()

  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh: scheduleRefreshAsync,
    updateFigures,
    readAsset,
    dispose: () => {
      if (disposed) return
      disposed = true
      revision += 1
      refreshController?.abort()
      for (const controller of watchControllers) controller.abort()
      watchControllers.length = 0
      assetCache.clear()
      listeners.clear()
    },
  }

  async function scheduleRefreshAsync(): Promise<void> {
    scheduleRefresh()
    while (refreshPromise !== undefined) await refreshPromise
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isMissingResourceError(error: unknown): boolean {
  const message = messageOf(error).toLowerCase()
  return message.includes('not found') || message.includes('no entry') || message.includes('workspace-file/not-found')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
