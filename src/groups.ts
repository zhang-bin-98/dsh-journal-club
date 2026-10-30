import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

/**
 * groups.json 图组清单（架构 §4.2）。compose_panels 写入、validate 读取，
 * 成员指纹算法只在这里定义，两端必须一致才能判定拼图是否过期。
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

/** 读取 groups.json；文件不存在时返回空清单，格式错误时抛出。 */
export async function readGroups(path: string): Promise<GroupsFile> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, groups: [] }
    throw error
  }
  try {
    return parseGroups(raw)
  } catch (error) {
    throw new Error(`groups.json 无法解析（${path}）：${(error as Error).message}`)
  }
}

/** 成员内容指纹：按成员顺序的 `<id>:<sha256>`；缺失成员用占位，保证与登记值不匹配。 */
export function digestMembers(members: readonly { id: string; bytes?: Uint8Array; missing?: string }[]): string {
  const parts = members.map(member => `${member.id}:${member.bytes === undefined ? member.missing ?? 'missing' : createHash('sha256').update(member.bytes).digest('hex')}`)
  return `sha256:${createHash('sha256').update(parts.join('\n')).digest('hex')}`
}
