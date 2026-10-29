import { createHash } from 'node:crypto'
import { open, readFile, rm } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import sharp from 'sharp'
import { atomicWriteFile } from '../files.ts'
import {
  assertInsideDirectory,
  assertSafeAssetId,
  displayWorkspacePath,
  resolveWorkspacePath,
  workspaceCwd,
} from '../paths.ts'
import {
  chooseLayout,
  fitImageToCell,
  type LayoutKind,
  type Rect,
} from '../layout/index.ts'

const CANVAS_WIDTH = 960
const CANVAS_HEIGHT = 540
const GAP_PT = 12

type GroupEntry = {
  id: string
  asset: string
  members: string[]
  inputs_digest: string
  layout?: unknown
}

type GroupsFile = {
  version: 1
  groups: GroupEntry[]
}

type InputImage = {
  id: string
  path: string
  bytes: Buffer
  width: number
  height: number
}

type ComposeResult = {
  output: string
  group: string
  members: string[]
  inputs_digest: string
  layout: {
    kind: LayoutKind
    geometry: {
      width: number
      height: number
      gap: number
      cells: Array<{
        member: string
        x: number
        y: number
        width: number
        height: number
        content: Rect
      }>
    }
  }
}

const queues = new Map<string, Promise<unknown>>()

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('操作已取消')
}

function queueFor<T>(path: string, task: () => Promise<T>): Promise<T> {
  const key = resolve(path)
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(task)
  queues.set(key, current)
  void current.finally(() => {
    if (queues.get(key) === current) queues.delete(key)
  }).catch(() => {})
  return current
}

async function acquireLock(path: string, signal: AbortSignal): Promise<Awaited<ReturnType<typeof open>>> {
  const started = Date.now()
  for (;;) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('操作已取消')
    try {
      return await open(path, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (Date.now() - started > 10_000) throw new Error(`等待 groups.json 锁超时：${path}`)
      await new Promise<void>((resolvePromise, reject) => {
        const cleanup = () => signal.removeEventListener('abort', onAbort)
        const timer = setTimeout(() => {
          cleanup()
          resolvePromise()
        }, 20)
        const onAbort = () => {
          clearTimeout(timer)
          cleanup()
          reject(signal.reason instanceof Error ? signal.reason : new Error('操作已取消'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        timer.unref?.()
      })
    }
  }
}

async function withGroupsLock<T>(groupsPath: string, signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  const lockPath = `${groupsPath}.lock`
  const lock = await acquireLock(lockPath, signal)
  try {
    return await task()
  } finally {
    await lock.close().catch(() => {})
    await rm(lockPath, { force: true }).catch(() => {})
  }
}

function projectDirForOutput(outputPath: string): string {
  const parent = dirname(outputPath)
  if (basename(parent).toLocaleLowerCase() !== 'groups') {
    throw new Error('output 必须位于项目目录的 groups/ 子目录中')
  }
  return dirname(parent)
}

function assetReference(projectDir: string, outputPath: string): string {
  const value = relative(projectDir, outputPath).replaceAll('\\', '/')
  if (value === '' || value.startsWith('../') || value === '..' || /^[A-Za-z]:\//u.test(value)) {
    throw new Error(`output 必须位于项目目录内：${outputPath}`)
  }
  return value
}

function panelIdFromAsset(path: string): string {
  const name = basename(path)
  const extension = extname(name)
  const id = extension === '' ? name : name.slice(0, -extension.length)
  assertSafeAssetId(id)
  return id
}

function parseGroups(raw: string, path: string): GroupsFile {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new Error(`groups.json 不可解析（${path}）：${(error as Error).message}`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('groups.json 必须是对象')
  const record = value as Record<string, unknown>
  if (record.version !== 1 || !Array.isArray(record.groups)) throw new Error('groups.json version/groups 不合法')
  const groups: GroupEntry[] = []
  for (const [index, item] of record.groups.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error(`groups[${index}] 必须是对象`)
    const group = item as Record<string, unknown>
    if (
      typeof group.id !== 'string' ||
      typeof group.asset !== 'string' ||
      typeof group.inputs_digest !== 'string' ||
      !Array.isArray(group.members) ||
      !group.members.every(member => typeof member === 'string')
    ) throw new Error(`groups[${index}] 缺少合法 id/asset/members/inputs_digest`)
    groups.push({
      id: group.id,
      asset: group.asset,
      members: [...group.members] as string[],
      inputs_digest: group.inputs_digest,
      layout: group.layout,
    })
  }
  return { version: 1, groups }
}

async function readGroups(groupsPath: string): Promise<GroupsFile> {
  try {
    return parseGroups(await readFile(groupsPath, 'utf8'), groupsPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, groups: [] }
    throw error
  }
}

function digestInputs(images: readonly InputImage[]): string {
  const parts = images.map(image => `${image.id}:${createHash('sha256').update(image.bytes).digest('hex')}`)
  return `sha256:${createHash('sha256').update(parts.join('\n')).digest('hex')}`
}

function round(value: number): number {
  return Number(value.toFixed(6))
}

async function composePng(images: readonly InputImage[], cells: readonly Rect[]): Promise<Buffer> {
  const layers = await Promise.all(images.map(async (image, index) => {
    const cell = cells[index]
    if (!cell) throw new Error(`布局分区缺失：${image.id}`)
    const content = fitImageToCell(cell, image)
    const resized = await sharp(image.bytes)
      .resize(Math.max(1, Math.round(content.width)), Math.max(1, Math.round(content.height)), { fit: 'fill' })
      .png()
      .toBuffer()
    return {
      input: resized,
      left: Math.max(0, Math.round(content.x)),
      top: Math.max(0, Math.round(content.y)),
    }
  }))
  return sharp({
    create: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  }).composite(layers).png().toBuffer()
}

async function readInput(path: string, id: string): Promise<InputImage> {
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (error) {
    throw new Error(`成员图片缺失或不可读：${id}（${path}）：${(error as Error).message}`)
  }
  let metadata
  try {
    metadata = await sharp(bytes).metadata()
  } catch (error) {
    throw new Error(`成员图片不是可读图片：${id}（${path}）：${(error as Error).message}`)
  }
  if (!metadata.width || !metadata.height) throw new Error(`成员图片缺少尺寸：${id}（${path}）`)
  return { id, path, bytes, width: metadata.width, height: metadata.height }
}

async function restoreOutput(path: string, previous: Buffer | undefined): Promise<void> {
  if (previous === undefined) await rm(path, { force: true })
  else await atomicWriteFile(path, previous)
}

export function registerComposePanels(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'compose_panels',
      description:
        '读取 Panel PNG，按有限矩形分区布局合成为组合图，原子写入 output，并在其项目目录 groups.json 登记成员、内容指纹和布局几何。' +
        'assets 相对路径基于会话工作目录；支持 grid、rows、1+2（1+2 需要 3 张图）。',
      parameters: {
        assets: {
          type: 'array',
          required: true,
          items: { type: 'string', description: 'Panel PNG 路径' },
          description: 'Panel 图片路径列表，顺序也是图组成员顺序',
        },
        layout_hint: {
          type: 'string',
          enum: ['grid', 'rows', '1+2'],
          description: '布局提示；缺省时按 SmartJC 有限候选评分选择',
        },
        output: {
          type: 'string',
          required: true,
          description: '组合 PNG 输出路径；通常为 <project>/groups/<group-id>.png',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            output: { type: 'string' },
            group: { type: 'string' },
            members: { type: 'array', items: { type: 'string' } },
            inputs_digest: { type: 'string' },
            layout: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: ['grid', 'rows', '1+2'] },
                geometry: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    width: { type: 'number' },
                    height: { type: 'number' },
                    gap: { type: 'number' },
                    cells: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          member: { type: 'string' },
                          x: { type: 'number' },
                          y: { type: 'number' },
                          width: { type: 'number' },
                          height: { type: 'number' },
                          content: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                              x: { type: 'number' },
                              y: { type: 'number' },
                              width: { type: 'number' },
                              height: { type: 'number' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `compose_panels：${value.output ?? '<unknown>'}\\n  group=${value.group ?? '<unknown>'} members=${(value.members ?? []).join(', ')}\\n  layout=${value.layout?.kind ?? '<unknown>'} digest=${value.inputs_digest ?? '<unknown>'}`,
          },
        ],
      },
      async execute(args, exec): Promise<ComposeResult> {
        if (args.assets.length < 1 || args.assets.length > 4) throw new Error('assets 必须包含 1 至 4 个成员')
        const cwd = workspaceCwd(exec)
        const outputPath = resolveWorkspacePath(args.output, cwd)
        if (extname(outputPath).toLocaleLowerCase() !== '.png') throw new Error('output 必须是 PNG 文件')
        const projectDir = projectDirForOutput(outputPath)
        const groupsPath = join(projectDir, 'groups.json')
        const groupAsset = assetReference(projectDir, outputPath)
        const groupId = basename(outputPath, extname(outputPath))
        assertSafeAssetId(groupId)
        assertInsideDirectory(outputPath, projectDir)

        const inputPaths = args.assets.map(asset => resolveWorkspacePath(asset, cwd))
        const ids = inputPaths.map(panelIdFromAsset)
        if (new Set(ids).size !== ids.length) throw new Error('assets 包含重复 panel id')
        for (const [index, inputPath] of inputPaths.entries()) {
          const projectRelative = relative(projectDir, inputPath).replaceAll('\\', '/')
          if (!projectRelative.startsWith('figures/') || projectRelative !== `figures/${ids[index]}.png`) {
            throw new Error(`成员图片必须是项目内 figures/${ids[index]}.png：${inputPath}`)
          }
        }

        return queueFor(groupsPath, () => withGroupsLock(groupsPath, exec.signal, async () => {
          const groups = await readGroups(groupsPath)
          const previousOutput = await readFile(outputPath).catch(error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
            throw error
          })
          const images = await Promise.all(inputPaths.map((path, index) => readInput(path, ids[index]!)))
          throwIfAborted(exec.signal)
          const chosen = chooseLayout(images.length, images, args.layout_hint as LayoutKind | undefined, GAP_PT)
          const png = await composePng(images, chosen.cells)
          throwIfAborted(exec.signal)
          const inputsDigest = digestInputs(images)
          const cells = chosen.cells.map((cell, index) => {
            const image = images[index]!
            const content = fitImageToCell(cell, image)
            return {
              member: image.id,
              x: round(cell.x),
              y: round(cell.y),
              width: round(cell.width),
              height: round(cell.height),
              content: {
                x: round(content.x),
                y: round(content.y),
                width: round(content.width),
                height: round(content.height),
              },
            }
          })
          const entry: GroupEntry = {
            id: groupId,
            asset: groupAsset,
            members: images.map(image => image.id),
            inputs_digest: inputsDigest,
            layout: {
              kind: chosen.kind,
              geometry: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, gap: GAP_PT, cells },
            },
          }
          const nextGroups: GroupsFile = {
            version: 1,
            groups: [...groups.groups.filter(group => group.id !== groupId), entry],
          }
          await atomicWriteFile(outputPath, png)
          try {
            await atomicWriteFile(groupsPath, `${JSON.stringify(nextGroups, null, 2)}\n`)
          } catch (error) {
            await restoreOutput(outputPath, previousOutput).catch(() => {})
            throw error
          }
          return {
            output: displayWorkspacePath(outputPath, cwd),
            group: groupId,
            members: entry.members,
            inputs_digest: inputsDigest,
            layout: entry.layout as ComposeResult['layout'],
          }
        }))
      },
    }),
  )
}
