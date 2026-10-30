import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { atomicWriteFile } from '../files.ts'
import { lockPathFor, withFileLock } from '../fileLock.ts'
import { parseFiguresJson, validateFiguresJson, type FiguresJson } from './schema.ts'

/** RFC 6902 JSON Patch operation. `value` is required by add/replace/test/copy. */
export type JsonPatchOperation =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; from: string; path: string }
  | { op: 'copy'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown }

export interface UpdateFiguresOptions {
  readonly signal?: AbortSignal
  readonly historyLimit?: number
}

export interface UpdateFiguresSuccess {
  readonly ok: true
  readonly conflict: false
  readonly revision: number
  readonly figures: FiguresJson
  readonly historyPath?: string
}

export interface UpdateFiguresConflict {
  readonly ok: false
  readonly conflict: true
  readonly revision: number
  readonly current: FiguresJson
}

export type UpdateFiguresResult = UpdateFiguresSuccess | UpdateFiguresConflict

export class FiguresPatchError extends Error {
  constructor(message: string) {
    super(`figures.json patch 失败：${message}`)
    this.name = 'FiguresPatchError'
  }
}

let snapshotSequence = 0

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('操作已取消')
}

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch (error) {
    throw new FiguresPatchError(`patch value 不是可复制的 JSON 值：${(error as Error).message}`)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function decodePointer(path: string): string[] {
  if (path === '') return []
  if (!path.startsWith('/')) throw new FiguresPatchError(`JSON Pointer 必须以 / 开头：${path}`)
  return path
    .slice(1)
    .split('/')
    .map(token => {
      if (/~(?![01])/u.test(token)) throw new FiguresPatchError(`JSON Pointer 转义非法：${path}`)
      return token.replaceAll('~1', '/').replaceAll('~0', '~')
    })
}

function assertSafeObjectKey(key: string): void {
  if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
    throw new FiguresPatchError(`禁止写入危险对象键：${key}`)
  }
}

function parseArrayIndex(token: string, allowEnd: boolean, length: number): number {
  if (!/^(?:0|[1-9]\d*)$/u.test(token)) {
    throw new FiguresPatchError(`数组索引非法：${token}`)
  }
  const index = Number(token)
  if (!Number.isSafeInteger(index) || index < 0 || (allowEnd ? index > length : index >= length)) {
    throw new FiguresPatchError(`数组索引越界：${token}`)
  }
  return index
}

interface ParentRef {
  parent: Record<string, unknown> | unknown[]
  token: string
}

function resolveParent(root: unknown, tokens: string[], allowEnd: boolean): ParentRef {
  if (tokens.length === 0) throw new FiguresPatchError('根路径没有父节点')
  let current = root
  for (const token of tokens.slice(0, -1)) {
    if (isArray(current)) {
      const index = parseArrayIndex(token, false, current.length)
      current = current[index]
    } else if (isObject(current)) {
      assertSafeObjectKey(token)
      if (!Object.prototype.hasOwnProperty.call(current, token)) {
        throw new FiguresPatchError(`路径不存在：/${tokens.join('/')}`)
      }
      current = current[token]
    } else {
      throw new FiguresPatchError(`路径的父节点不是对象或数组：/${tokens.join('/')}`)
    }
  }
  if (!isArray(current) && !isObject(current)) {
    throw new FiguresPatchError(`路径的父节点不是对象或数组：/${tokens.join('/')}`)
  }
  const token = tokens[tokens.length - 1]!
  if (isArray(current)) {
    if (token !== '-') parseArrayIndex(token, allowEnd, current.length)
  } else {
    assertSafeObjectKey(token)
  }
  return { parent: current, token }
}

function getPath(root: unknown, tokens: string[]): unknown {
  if (tokens.length === 0) {
    if (root === undefined) throw new FiguresPatchError('根路径不存在')
    return root
  }
  let current = root
  for (const token of tokens) {
    if (isArray(current)) {
      if (token === '-') throw new FiguresPatchError('读取路径不能使用 -')
      const index = parseArrayIndex(token, false, current.length)
      current = current[index]
    } else if (isObject(current)) {
      assertSafeObjectKey(token)
      if (!Object.prototype.hasOwnProperty.call(current, token)) throw new FiguresPatchError(`路径不存在：/${tokens.join('/')}`)
      current = current[token]
    } else {
      throw new FiguresPatchError(`路径不存在：/${tokens.join('/')}`)
    }
  }
  return current
}

function addPath(root: unknown, tokens: string[], value: unknown): unknown {
  if (tokens.length === 0) return cloneValue(value)
  const { parent, token } = resolveParent(root, tokens, true)
  if (isArray(parent)) {
    if (token === '-') parent.push(cloneValue(value))
    else parent.splice(parseArrayIndex(token, true, parent.length), 0, cloneValue(value))
  } else {
    parent[token] = cloneValue(value)
  }
  return root
}

function removePath(root: unknown, tokens: string[]): unknown {
  if (tokens.length === 0) return undefined
  const { parent, token } = resolveParent(root, tokens, false)
  if (isArray(parent)) {
    parent.splice(parseArrayIndex(token, false, parent.length), 1)
  } else {
    if (!Object.prototype.hasOwnProperty.call(parent, token)) throw new FiguresPatchError(`路径不存在：/${tokens.join('/')}`)
    delete parent[token]
  }
  return root
}

function replacePath(root: unknown, tokens: string[], value: unknown): unknown {
  if (tokens.length === 0) return cloneValue(value)
  const { parent, token } = resolveParent(root, tokens, false)
  if (isArray(parent)) {
    parent[parseArrayIndex(token, false, parent.length)] = cloneValue(value)
  } else {
    if (!Object.prototype.hasOwnProperty.call(parent, token)) throw new FiguresPatchError(`路径不存在：/${tokens.join('/')}`)
    parent[token] = cloneValue(value)
  }
  return root
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => deepEqual(item, right[index]))
  }
  if (isObject(left) || isObject(right)) {
    if (!isObject(left) || !isObject(right)) return false
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]))
  }
  return false
}

function isDescendantPath(from: string[], path: string[]): boolean {
  return path.length > from.length && from.every((token, index) => token === path[index])
}

function assertRevisionUntouched(operation: JsonPatchOperation): void {
  const touchesRevision = (path: string): boolean => {
    const tokens = decodePointer(path)
    return tokens.length > 0 && tokens[0] === 'revision'
  }
  if (operation.op !== 'test' && touchesRevision(operation.path)) {
    throw new FiguresPatchError('revision 由服务统一递增，patch 不得直接修改 revision')
  }
  if (operation.op === 'move' && touchesRevision(operation.from)) {
    throw new FiguresPatchError('revision 由服务统一递增，不能从 revision 移出值')
  }
}

/** 在内存中完整执行 RFC 6902 操作；任何异常都不会修改输入 root。 */
export function applyJsonPatch(input: unknown, patch: readonly JsonPatchOperation[]): unknown {
  let root = cloneValue(input)
  for (const operation of patch) {
    assertRevisionUntouched(operation)
    const pathTokens = decodePointer(operation.path)
    switch (operation.op) {
      case 'add':
        root = addPath(root, pathTokens, operation.value)
        break
      case 'remove':
        root = removePath(root, pathTokens)
        break
      case 'replace':
        root = replacePath(root, pathTokens, operation.value)
        break
      case 'copy':
        root = addPath(root, pathTokens, cloneValue(getPath(root, decodePointer(operation.from))))
        break
      case 'move': {
        const fromTokens = decodePointer(operation.from)
        if (fromTokens.length === pathTokens.length && fromTokens.every((token, index) => token === pathTokens[index])) break
        if (isDescendantPath(fromTokens, pathTokens)) {
          throw new FiguresPatchError(`move 目标不能位于来源路径下：${operation.from} → ${operation.path}`)
        }
        const value = cloneValue(getPath(root, fromTokens))
        root = removePath(root, fromTokens)
        root = addPath(root, pathTokens, value)
        break
      }
      case 'test':
        if (!deepEqual(getPath(root, pathTokens), operation.value)) {
          throw new FiguresPatchError(`test 不匹配：${operation.path}`)
        }
        break
      default:
        throw new FiguresPatchError(`不支持的操作：${(operation as { op?: unknown }).op ?? '<unknown>'}`)
    }
  }
  return root
}

function validatePatchShape(patch: readonly JsonPatchOperation[]): void {
  if (!Array.isArray(patch)) throw new FiguresPatchError('patch 必须是数组')
  for (const [index, operation] of patch.entries()) {
    if (!isObject(operation) || typeof operation.op !== 'string' || typeof operation.path !== 'string') {
      throw new FiguresPatchError(`patch[${index}] 不是有效操作`)
    }
    if (operation.op === 'add' || operation.op === 'replace' || operation.op === 'test') {
      if (!Object.prototype.hasOwnProperty.call(operation, 'value')) throw new FiguresPatchError(`patch[${index}] 缺少 value`)
    } else if (operation.op === 'move' || operation.op === 'copy') {
      if (typeof operation.from !== 'string') throw new FiguresPatchError(`patch[${index}] 缺少 from`)
    } else if (operation.op !== 'remove') {
      throw new FiguresPatchError(`patch[${index}] 操作不支持：${operation.op}`)
    }
    decodePointer(operation.path)
    if (operation.op === 'move' || operation.op === 'copy') {
      const from = (operation as { from?: unknown }).from
      if (typeof from !== 'string') throw new FiguresPatchError(`patch[${index}] 缺少 from`)
      decodePointer(from)
    }
  }
}

async function writeSnapshot(absPath: string, raw: string, revision: number): Promise<string> {
  const historyDir = join(dirname(absPath), '.history')
  await mkdir(historyDir, { recursive: true })
  const snapshotName = `${basename(absPath)}.rev-${String(revision).padStart(12, '0')}-${Date.now()}-${process.pid}-${++snapshotSequence}.json`
  const snapshotPath = join(historyDir, snapshotName)
  await atomicWriteFile(snapshotPath, raw)
  return snapshotPath
}

async function pruneSnapshots(absPath: string, limit: number): Promise<void> {
  const historyDir = join(dirname(absPath), '.history')
  let entries
  try {
    entries = await readdir(historyDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const prefix = `${basename(absPath)}.rev-`
  const snapshots = entries
    .filter(entry => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.json'))
    .sort((left, right) => right.name.localeCompare(left.name))
  await Promise.all(snapshots.slice(limit).map(entry => rm(join(historyDir, entry.name), { force: true })))
}

/**
 * figures.json 唯一写入入口（update_figures 工具、host RPC、crop 共用）：
 * 锁内重读并比较 base_rev，应用 patch 与完整校验后，写快照并原子替换。
 */
export async function updateFiguresFile(
  absPath: string,
  patch: readonly JsonPatchOperation[],
  baseRev: number,
  options: UpdateFiguresOptions = {},
): Promise<UpdateFiguresResult> {
  if (!Number.isSafeInteger(baseRev) || baseRev < 0) throw new FiguresPatchError('base_rev 必须是非负整数')
  const historyLimit = options.historyLimit ?? 10
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) throw new FiguresPatchError('historyLimit 必须是大于 0 的整数')
  validatePatchShape(patch)
  const canonicalPath = resolve(absPath)
  await mkdir(dirname(canonicalPath), { recursive: true })
  return withFileLock(canonicalPath, async () => {
    throwIfAborted(options.signal)
    let raw: string | undefined
    try {
      raw = await readFile(canonicalPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (baseRev !== 0) throw new FiguresPatchError('figures.json 不存在，首次创建必须使用 base_rev=0')
    }
    // The empty value exists only inside the lock; the completed patch must
    // satisfy the full schema before anything is persisted.
    const current: FiguresJson = raw === undefined
      ? { version: 1, status: 'draft', revision: 0, documents: [], figures: [] }
      : parseFiguresJson(raw, canonicalPath)
    if (current.revision !== baseRev) {
      return { ok: false, conflict: true, revision: current.revision, current }
    }

    const patchedRaw = applyJsonPatch(current, patch)
    const parsed = parseFiguresJson(JSON.stringify(patchedRaw), canonicalPath)
    if (parsed.revision !== current.revision) {
      throw new FiguresPatchError('revision 由服务统一递增，patch 不得直接修改 revision')
    }
    const next = { ...parsed, revision: current.revision + 1 }
    validateFiguresJson(next)
    throwIfAborted(options.signal)

    const historyPath = raw === undefined ? undefined : await writeSnapshot(canonicalPath, raw, current.revision)
    try {
      await atomicWriteFile(canonicalPath, `${JSON.stringify(next, null, 2)}\n`)
    } catch (error) {
      if (historyPath !== undefined) await rm(historyPath, { force: true }).catch(() => {})
      throw error
    }
    await pruneSnapshots(canonicalPath, historyLimit).catch(() => {})
    return { ok: true, conflict: false, revision: next.revision, figures: next, historyPath }
  }, { signal: options.signal })
}

export function figuresLockPath(absPath: string): string {
  return lockPathFor(absPath)
}
