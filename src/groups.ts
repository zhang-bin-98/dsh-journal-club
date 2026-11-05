import { readFile } from 'node:fs/promises'
import { sha256Hex } from './files.ts'

/**
 * groups.json 图组清单（架构 §4.2）。compose_panels 写入，validate 与自由拼图页读取；
 * 成员指纹算法只在这里定义，各端必须一致才能判定拼图是否过期。
 */

export interface GroupEntry {
  id: string
  asset: string
  members: string[]
  inputs_digest: string
  layout?: unknown
}

export interface GroupsFile {
  version: 1
  groups: GroupEntry[]
}

export function parseGroups(raw: string): GroupsFile {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('groups.json 必须是对象')
  const record = value as Record<string, unknown>
  if (record.version !== 1 || !Array.isArray(record.groups)) throw new Error('groups.json version/groups 不合法')
  const groups = record.groups.map((item, index): GroupEntry => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error(`groups[${index}] 必须是对象`)
    const group = item as Record<string, unknown>
    if (
      typeof group.id !== 'string' ||
      typeof group.asset !== 'string' ||
      typeof group.inputs_digest !== 'string' ||
      !Array.isArray(group.members) ||
      !group.members.every(member => typeof member === 'string')
    ) throw new Error(`groups[${index}] 缺少合法 id/asset/members/inputs_digest`)
    return { id: group.id, asset: group.asset, members: [...group.members] as string[], inputs_digest: group.inputs_digest, layout: group.layout }
  })
  return { version: 1, groups }
}

/**
 * 一次读取 groups.json，同时给出清单与文件摘要（供保存时的并发比对）。
 * 文件不存在时返回空清单与空内容摘要；格式错误时抛出。
 */
export async function readGroupsWithDigest(path: string): Promise<{ groups: GroupsFile; digest: string }> {
  let raw: Buffer
  try {
    raw = await readFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { groups: { version: 1, groups: [] }, digest: sha256Hex('') }
    throw error
  }
  try {
    return { groups: parseGroups(raw.toString('utf8')), digest: sha256Hex(raw) }
  } catch (error) {
    throw new Error(`groups.json 无法解析：${(error as Error).message}`)
  }
}

export async function readGroups(path: string): Promise<GroupsFile> {
  return (await readGroupsWithDigest(path)).groups
}

/** 当前 groups.json 文件摘要；不存在视为空内容。 */
export async function groupsFileDigest(path: string): Promise<string> {
  return (await readFile(path).then(sha256Hex, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return sha256Hex(''); throw error }))
}

/**
 * 成员内容指纹：按成员顺序拼接 `<id>:<单图 sha256>` 后再取 sha256。
 * 单图摘要缺失（未裁切、文件缺失或路径越界）用 `missing` 占位，保证与登记值不匹配。
 */
export function digestMembers(members: readonly { id: string; digest?: string }[]): string {
  return `sha256:${sha256Hex(members.map(member => `${member.id}:${member.digest ?? 'missing'}`).join('\n'))}`
}

/** 登记值可能是手写的无前缀形式；比较时统一去掉 `sha256:`。 */
export function sameDigest(recorded: string, current: string): boolean {
  return recorded.replace(/^sha256:/u, '') === current.replace(/^sha256:/u, '')
}
