import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from '../files.ts'

export const JC_STAGES = ['analysis', 'figure-review', 'outline', 'deck', 'render', 'done'] as const
export type JcStage = (typeof JC_STAGES)[number]

export const CONFIRMATION_KINDS = ['figures', 'outline', 'deck'] as const
export type ConfirmationKind = (typeof CONFIRMATION_KINDS)[number]

export interface FiguresConfirmation {
  revision: number
  at: string
}

export interface OutlineConfirmation {
  digest: string
  at: string
}

export interface DeckConfirmation {
  digest: string
  groups_digest: string
  at: string
}

export interface JcConfirmations {
  figures?: FiguresConfirmation
  outline?: OutlineConfirmation
  deck?: DeckConfirmation
}

export interface JcState {
  title: string
  main_paper: string
  supplement?: string
  stage: JcStage
  figures_revision: number
  requirements: string
  confirmations: JcConfirmations
  updated: string
  notes: string
}

export interface CreateJcStateInput {
  title: string
  main_paper: string
  supplement?: string
  stage?: JcStage
  figures_revision?: number
  requirements?: string
  confirmations?: JcConfirmations
  updated?: string
  notes?: string
  now?: Date
}

export interface JcStateUpdate {
  title?: string
  main_paper?: string
  supplement?: string | null
  stage?: JcStage
  figures_revision?: number
  requirements?: string
  confirmations?: Partial<JcConfirmations>
  clear_confirmations?: ConfirmationKind[]
  updated?: string
  notes?: string
  now?: Date
}

export interface CurrentConfirmationSummary {
  figures?: { revision: number }
  outline?: { digest: string }
  deck?: { digest: string; groups_digest: string }
}

export type ConfirmationStatus = 'confirmed' | 'stale' | 'missing'

export interface ConfirmationCheck {
  kind: ConfirmationKind
  status: ConfirmationStatus
  valid: boolean
  recorded?: FiguresConfirmation | OutlineConfirmation | DeckConfirmation
  current?: CurrentConfirmationSummary[ConfirmationKind]
}

export type ConfirmationSummary = Record<ConfirmationKind, ConfirmationCheck>

export class JcMarkdownError extends Error {
  constructor(message: string) {
    super(`jc.md 格式错误：${message}`)
    this.name = 'JcMarkdownError'
  }
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new JcMarkdownError(`${field} 必须是非空字符串`)
}

function assertInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new JcMarkdownError(`${field} 必须是非负整数`)
  }
}

function assertStage(value: unknown): asserts value is JcStage {
  if (typeof value !== 'string' || !(JC_STAGES as readonly string[]).includes(value)) {
    throw new JcMarkdownError(`stage 必须是 ${JC_STAGES.join(' / ')} 之一`)
  }
}

function assertConfirmationAt(value: unknown, field: string): asserts value is string {
  assertString(value, field)
}

function assertDigest(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new JcMarkdownError(`${field} 必须是 sha256:<64 位小写十六进制>`)
  }
}

function cloneConfirmations(confirmations: JcConfirmations = {}): JcConfirmations {
  return {
    ...(confirmations.figures === undefined ? {} : { figures: { ...confirmations.figures } }),
    ...(confirmations.outline === undefined ? {} : { outline: { ...confirmations.outline } }),
    ...(confirmations.deck === undefined ? {} : { deck: { ...confirmations.deck } }),
  }
}

function validateConfirmation(kind: ConfirmationKind, value: unknown): ConfirmationCheck['recorded'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new JcMarkdownError(`confirmations.${kind} 必须是对象`)
  }
  const record = value as Record<string, unknown>
  assertConfirmationAt(record.at, `confirmations.${kind}.at`)
  if (kind === 'figures') {
    assertInteger(record.revision, 'confirmations.figures.revision')
    return { revision: record.revision, at: record.at }
  }
  assertDigest(record.digest, `confirmations.${kind}.digest`)
  if (kind === 'outline') return { digest: record.digest, at: record.at }
  assertDigest(record.groups_digest, 'confirmations.deck.groups_digest')
  return { digest: record.digest, groups_digest: record.groups_digest, at: record.at }
}

function validateConfirmations(value: unknown): JcConfirmations {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new JcMarkdownError('confirmations 必须是对象')
  }
  const record = value as Record<string, unknown>
  const result: JcConfirmations = {}
  for (const key of Object.keys(record)) {
    if (!(CONFIRMATION_KINDS as readonly string[]).includes(key)) throw new JcMarkdownError(`未知确认类型：${key}`)
  }
  for (const kind of CONFIRMATION_KINDS) {
    if (record[kind] !== undefined) {
      const confirmation = validateConfirmation(kind, record[kind])
      if (kind === 'figures') result.figures = confirmation as FiguresConfirmation
      else if (kind === 'outline') result.outline = confirmation as OutlineConfirmation
      else result.deck = confirmation as DeckConfirmation
    }
  }
  return result
}

function dateOnly(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new JcMarkdownError('now 不是有效日期')
  return date.toISOString().slice(0, 10)
}

function validateState(input: JcState): JcState {
  assertString(input.title, 'title')
  assertString(input.main_paper, 'main_paper')
  if (input.supplement !== undefined) assertString(input.supplement, 'supplement')
  assertStage(input.stage)
  assertInteger(input.figures_revision, 'figures_revision')
  if (typeof input.requirements !== 'string') throw new JcMarkdownError('requirements 必须是字符串')
  if (typeof input.updated !== 'string' || input.updated.length === 0) throw new JcMarkdownError('updated 必须是非空字符串')
  if (typeof input.notes !== 'string') throw new JcMarkdownError('正文备注必须是字符串')
  const confirmations = validateConfirmations(input.confirmations)
  return { ...input, confirmations: cloneConfirmations(confirmations) }
}

export function createJcState(input: CreateJcStateInput): JcState {
  const state: JcState = {
    title: input.title,
    main_paper: input.main_paper,
    ...(input.supplement === undefined ? {} : { supplement: input.supplement }),
    stage: input.stage ?? 'analysis',
    figures_revision: input.figures_revision ?? 0,
    requirements: input.requirements ?? '',
    confirmations: cloneConfirmations(input.confirmations),
    updated: input.updated ?? dateOnly(input.now ?? new Date()),
    notes: input.notes ?? '',
  }
  return validateState(state)
}

export function updateJcState(state: JcState, update: JcStateUpdate): JcState {
  const confirmations = cloneConfirmations(state.confirmations)
  if (update.confirmations !== undefined) {
    for (const kind of CONFIRMATION_KINDS) {
      const value = update.confirmations[kind]
      if (value !== undefined) {
        const validated = validateConfirmation(kind, value)
        if (kind === 'figures') confirmations.figures = validated as FiguresConfirmation
        else if (kind === 'outline') confirmations.outline = validated as OutlineConfirmation
        else confirmations.deck = validated as DeckConfirmation
      }
    }
  }
  for (const kind of update.clear_confirmations ?? []) delete confirmations[kind]
  const next: JcState = {
    ...state,
    ...(update.title === undefined ? {} : { title: update.title }),
    ...(update.main_paper === undefined ? {} : { main_paper: update.main_paper }),
    ...(update.supplement === undefined ? {} : update.supplement === null ? { supplement: undefined } : { supplement: update.supplement }),
    ...(update.stage === undefined ? {} : { stage: update.stage }),
    ...(update.figures_revision === undefined ? {} : { figures_revision: update.figures_revision }),
    ...(update.requirements === undefined ? {} : { requirements: update.requirements }),
    confirmations,
    ...(update.updated === undefined ? {} : { updated: update.updated }),
    ...(update.notes === undefined ? {} : { notes: update.notes }),
  }
  if (update.updated === undefined && update.now !== undefined) next.updated = dateOnly(update.now)
  return validateState(next)
}

function stripInlineComment(value: string): string {
  let quote: '"' | "'" | undefined
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote === '"' && escaped) {
      escaped = false
      continue
    }
    if (quote === '"' && char === '\\') {
      escaped = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = quote === undefined ? char : quote === char ? undefined : quote
    } else if (char === '#' && quote === undefined && (index === 0 || /\s/u.test(value[index - 1] ?? ''))) {
      return value.slice(0, index).trimEnd()
    }
  }
  return value.trim()
}

function splitTopLevel(value: string, delimiter: string): string[] {
  const parts: string[] = []
  let start = 0
  let quote: '"' | "'" | undefined
  let escaped = false
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote === '"' && escaped) {
      escaped = false
      continue
    }
    if (quote === '"' && char === '\\') {
      escaped = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = quote === undefined ? char : quote === char ? undefined : quote
    } else if (quote === undefined && (char === '{' || char === '[')) depth += 1
    else if (quote === undefined && (char === '}' || char === ']')) depth -= 1
    else if (quote === undefined && depth === 0 && value.startsWith(delimiter, index)) {
      parts.push(value.slice(start, index).trim())
      start = index + delimiter.length
      index += delimiter.length - 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts.filter(part => part.length > 0)
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed !== 'string') throw new Error('not string')
      return parsed
    } catch {
      throw new JcMarkdownError(`字符串引号无效：${value}`)
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  return value
}

function parseScalar(value: string): unknown {
  const cleaned = stripInlineComment(value)
  if (cleaned === '') return undefined
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) return unquote(cleaned)
  if (cleaned === 'null' || cleaned === '~') return null
  if (cleaned === 'true') return true
  if (cleaned === 'false') return false
  if (/^-?(?:0|[1-9]\d*)$/u.test(cleaned)) return Number(cleaned)
  return cleaned
}

function parseInlineObject(value: string): Record<string, unknown> {
  if (!value.startsWith('{') || !value.endsWith('}')) throw new JcMarkdownError(`内联对象无效：${value}`)
  const result: Record<string, unknown> = {}
  for (const item of splitTopLevel(value.slice(1, -1), ',')) {
    const colon = item.indexOf(':')
    if (colon < 1) throw new JcMarkdownError(`内联对象字段无效：${item}`)
    const key = unquote(item.slice(0, colon).trim())
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) throw new JcMarkdownError(`字段名无效：${key}`)
    result[key] = parseScalar(item.slice(colon + 1).trim())
  }
  return result
}

function parseFrontmatter(raw: string): { values: Record<string, unknown>; notes: string } {
  const normalized = raw.replace(/^\uFEFF/u, '').replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const lines = normalized.split('\n')
  if (lines[0] !== '---') throw new JcMarkdownError('缺少开头的 ---')
  const end = lines.findIndex((line, index) => index > 0 && line === '---')
  if (end < 0) throw new JcMarkdownError('缺少结束的 ---')
  const values: Record<string, unknown> = {}
  let index = 1
  while (index < end) {
    const line = lines[index] ?? ''
    index += 1
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const match = /^(\w[\w-]*):(?:\s*(.*))?$/u.exec(line)
    if (!match || line.startsWith(' ')) throw new JcMarkdownError(`无法解析 frontmatter 行：${line}`)
    const key = match[1] as string
    const value = match[2] ?? ''
    if (key === 'confirmations' && value.trim() === '') {
      const confirmations: Record<string, unknown> = {}
      while (index < end) {
        const child = lines[index] ?? ''
        if (child.trim() === '' || child.trimStart().startsWith('#')) {
          index += 1
          continue
        }
        const childMatch = /^( {2})(\w[\w-]*):(?:\s*(.*))?$/u.exec(child)
        if (!childMatch) break
        index += 1
        const childKey = childMatch[2] as string
        const childValue = childMatch[3] ?? ''
        if (childValue.trim() !== '') {
          confirmations[childKey] = childValue.trim().startsWith('{') ? parseInlineObject(childValue.trim()) : parseScalar(childValue)
          continue
        }
        const nested: Record<string, unknown> = {}
        while (index < end) {
          const nestedLine = lines[index] ?? ''
          const nestedMatch = /^( {4})(\w[\w-]*):(?:\s*(.*))?$/u.exec(nestedLine)
          if (!nestedMatch) break
          index += 1
          nested[nestedMatch[2] as string] = parseScalar(nestedMatch[3] ?? '')
        }
        confirmations[childKey] = nested
      }
      values[key] = confirmations
    } else {
      values[key] = value.trim().startsWith('{') ? parseInlineObject(value.trim()) : parseScalar(value)
    }
  }
  let notes = lines.slice(end + 1).join('\n')
  if (notes.startsWith('\n')) notes = notes.slice(1)
  if (notes.endsWith('\n')) notes = notes.slice(0, -1)
  return { values, notes }
}

export function parseJcMarkdown(raw: string): JcState {
  const { values, notes } = parseFrontmatter(raw)
  assertString(values.title, 'title')
  assertString(values.main_paper, 'main_paper')
  const supplement = values.supplement === null || values.supplement === undefined ? undefined : values.supplement
  if (supplement !== undefined) assertString(supplement, 'supplement')
  assertStage(values.stage)
  assertInteger(values.figures_revision, 'figures_revision')
  if (typeof values.requirements !== 'string') throw new JcMarkdownError('requirements 必须是字符串')
  assertString(values.updated, 'updated')
  const state: JcState = {
    title: values.title,
    main_paper: values.main_paper,
    ...(supplement === undefined ? {} : { supplement }),
    stage: values.stage,
    figures_revision: values.figures_revision,
    requirements: values.requirements,
    confirmations: validateConfirmations(values.confirmations),
    updated: values.updated,
    notes,
  }
  return validateState(state)
}

function formatScalar(value: string): string {
  if (value.length > 0 && !/^[~]|^(?:null|true|false)$/u.test(value) && !/^-?(?:0|[1-9]\d*)$/u.test(value) && !/[\n\r:#{}\[\],"\\]/u.test(value) && value.trim() === value) return value
  return JSON.stringify(value)
}

function formatConfirmation(kind: ConfirmationKind, value: ConfirmationCheck['recorded']): string {
  if (kind === 'figures') {
    const confirmation = value as FiguresConfirmation
    return `{ revision: ${confirmation.revision}, at: ${formatScalar(confirmation.at)} }`
  }
  if (kind === 'outline') {
    const confirmation = value as OutlineConfirmation
    return `{ digest: ${formatScalar(confirmation.digest)}, at: ${formatScalar(confirmation.at)} }`
  }
  const confirmation = value as DeckConfirmation
  return `{ digest: ${formatScalar(confirmation.digest)}, groups_digest: ${formatScalar(confirmation.groups_digest)}, at: ${formatScalar(confirmation.at)} }`
}

export function serializeJcMarkdown(state: JcState): string {
  const validated = validateState(state)
  const lines = [
    '---',
    `title: ${formatScalar(validated.title)}`,
    `main_paper: ${formatScalar(validated.main_paper)}`,
  ]
  if (validated.supplement !== undefined) lines.push(`supplement: ${formatScalar(validated.supplement)}`)
  lines.push(
    `stage: ${validated.stage}`,
    `figures_revision: ${validated.figures_revision}`,
    `requirements: ${formatScalar(validated.requirements)}`,
    'confirmations:',
  )
  for (const kind of CONFIRMATION_KINDS) {
    const confirmation = validated.confirmations[kind]
    if (confirmation !== undefined) lines.push(`  ${kind}: ${formatConfirmation(kind, confirmation)}`)
  }
  lines.push(`updated: ${formatScalar(validated.updated)}`, '---', '')
  if (validated.notes !== '') lines.push(validated.notes)
  return `${lines.join('\n')}\n`
}

export function createJcMarkdown(input: CreateJcStateInput): string {
  return serializeJcMarkdown(createJcState(input))
}

export function updateJcMarkdown(raw: string, update: JcStateUpdate): string {
  return serializeJcMarkdown(updateJcState(parseJcMarkdown(raw), update))
}

export function digestBytes(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export function digestText(value: string): string {
  return digestBytes(Buffer.from(value, 'utf8'))
}

export async function digestFile(path: string): Promise<string> {
  return digestBytes(await readFile(path))
}

export async function createJcFile(path: string, input: CreateJcStateInput): Promise<JcState> {
  const state = createJcState(input)
  // 新建不覆盖已有项目：独占创建，已存在时报 EEXIST。
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, serializeJcMarkdown(state), { encoding: 'utf8', flag: 'wx' })
  return state
}

export async function readJcFile(path: string): Promise<JcState> {
  return parseJcMarkdown(await readFile(path, 'utf8'))
}

export async function updateJcFile(path: string, update: JcStateUpdate): Promise<JcState> {
  const state = updateJcState(await readJcFile(path), update)
  await atomicWriteFile(path, serializeJcMarkdown(state))
  return state
}

export function isConfirmationValid(
  state: JcState,
  kind: ConfirmationKind,
  current: CurrentConfirmationSummary[ConfirmationKind] | undefined,
): boolean {
  const recorded = state.confirmations[kind]
  if (recorded === undefined || current === undefined) return false
  if (kind === 'figures') {
    if (!('revision' in recorded) || !('revision' in current)) return false
    return recorded.revision === current.revision
  }
  if (kind === 'outline') {
    if (!('digest' in recorded) || !('digest' in current)) return false
    return recorded.digest === current.digest
  }
  if (!('digest' in recorded) || !('groups_digest' in recorded) || !('digest' in current) || !('groups_digest' in current)) return false
  return recorded.digest === current.digest && recorded.groups_digest === current.groups_digest
}

export function summarizeConfirmations(state: JcState, current: CurrentConfirmationSummary): ConfirmationSummary {
  return Object.fromEntries(CONFIRMATION_KINDS.map(kind => {
    const recorded = state.confirmations[kind]
    const actual = current[kind]
    const valid = isConfirmationValid(state, kind, actual)
    return [kind, {
      kind,
      status: recorded === undefined ? 'missing' : valid ? 'confirmed' : 'stale',
      valid,
      ...(recorded === undefined ? {} : { recorded }),
      ...(actual === undefined ? {} : { current: actual }),
    }]
  })) as ConfirmationSummary
}

export async function summarizeProjectConfirmations(projectDir: string, state?: JcState): Promise<ConfirmationSummary> {
  const current: CurrentConfirmationSummary = {}
  try {
    const raw = JSON.parse(await readFile(join(projectDir, 'figures.json'), 'utf8')) as { revision?: unknown }
    if (typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision >= 0) current.figures = { revision: raw.revision }
  } catch { /* absent or malformed files are represented as missing, not as confirmed */ }
  try { current.outline = { digest: await digestFile(join(projectDir, 'outline.md')) } } catch { /* missing */ }
  try { current.deck = { digest: await digestFile(join(projectDir, 'deck.md')), groups_digest: await digestFile(join(projectDir, 'groups.json')) } } catch { /* missing */ }
  return summarizeConfirmations(state ?? await readJcFile(join(projectDir, 'jc.md')), current)
}
