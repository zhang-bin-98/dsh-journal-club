import { readFile, rm, realpath, mkdir } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import sharp from 'sharp'
import { fitComposition, imageRect, validateGeometry, type CompositionGeometry, type CompositionLayout } from '../layout/composition.ts'
import { atomicWriteFile, sha256Hex, throwIfAborted } from '../files.ts'
import { withFileLock } from '../fileLock.ts'
import { digestMembers, groupsFileDigest, readGroupsWithDigest, type GroupEntry, type GroupsFile } from '../groups.ts'
import {
  assertInsideDirectory,
  assertSafeAssetId,
  displayWorkspacePath,
  resolveWorkspacePath,
  workspaceCwd,
} from '../paths.ts'
import {
  chooseLayout,
  DEFAULT_CANVAS,
  type LayoutKind,
} from '../layout/figureGeometry.ts'

/** 拼图导出倍率默认值：工具与工作台保存一致，避免同一张图被不同入口重导后分辨率改变。 */
const DEFAULT_SCALE = 2

type InputImage = {
  id: string
  path: string
  bytes: Buffer
  width: number
  height: number
}

export interface ComposeRequest {
  assets: string[]
  output: string
  create?: boolean
  layout_hint?: LayoutKind
  geometry?: CompositionGeometry
  scale?: number
  base_digest?: string
  inputs?: { id: string; digest: string }[]
}
export interface ComposeResult { output: string; group: string; members: string[]; inputs_digest: string; groups_digest: string; layout: CompositionLayout }

function projectDirForOutput(outputPath: string): string {
  const parent = dirname(outputPath)
  if (basename(parent).toLocaleLowerCase() !== 'groups') {
    throw new Error('output 必须位于项目目录的 groups/ 子目录中')
  }
  return dirname(parent)
}

function panelIdFromAsset(path: string): string {
  const name = basename(path)
  const extension = extname(name)
  const id = extension === '' ? name : name.slice(0, -extension.length)
  assertSafeAssetId(id)
  return id
}

async function composePng(images: readonly InputImage[], geometry: CompositionGeometry, scale: number): Promise<Buffer> {
  const width = Math.max(1, Math.ceil(geometry.width * scale)), height = Math.max(1, Math.ceil(geometry.height * scale))
  const layers: { input: Buffer; left: number; top: number }[] = []
  // Sequential resizing avoids duplicating all decoded inputs in memory at once.
  for (const image of images) {
    const cell = geometry.cells.find(c => c.member === image.id)!
    const content = imageRect(cell, image, scale)
    const left = Math.max(0, content.x), top = Math.max(0, content.y)
    const right = Math.min(width, content.x + content.width), bottom = Math.min(height, content.y + content.height)
    if (right <= left || bottom <= top) continue
    const input = await sharp(image.bytes).resize(content.width, content.height, { fit: 'fill' })
      .extract({ left: left - content.x, top: top - content.y, width: right - left, height: bottom - top }).png().toBuffer()
    layers.push({ input, left, top })
  }
  return sharp({ create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).composite(layers).png().toBuffer()
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
        '读取 Panel PNG，按建议布局或自由几何合成为组合图，原子写入 output，并在其项目目录 groups.json 登记成员、内容指纹和布局几何。' +
        '修改默认沿用 groups.json 的原 asset 路径和 ID，禁止为改布局另起文件名；只有用户明确新建/另存时传 create:true。' +
        'assets 不设张数上限；geometry 可自由指定图片位置；导出按实际图片外缘裁掉外围空白。省略时建议排版；1+2 需3张图。',
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
        geometry: {
          type: 'object', additionalProperties: false, description: '自由布局；width/height 为正参考尺寸，cells 为图片包围框，图片等比适配。输出按实际图片外缘确定尺寸，保留内部间隔和原图内容；不传时自动排版。',
          properties: {
            width: { type: 'number', required: true }, height: { type: 'number', required: true },
            gap: { type: 'number', description: '已废弃，忽略；仅为接受旧 groups.json 的几何。' },
            cells: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
              member: { type: 'string', required: true }, x: { type: 'number', required: true }, y: { type: 'number', required: true }, width: { type: 'number', required: true }, height: { type: 'number', required: true },
              content: { type: 'object', additionalProperties: false, description: '已废弃，忽略；仅为接受旧 groups.json 的几何，导出依据当前图片重新计算。', properties: { x: { type: 'number', required: true }, y: { type: 'number', required: true }, width: { type: 'number', required: true }, height: { type: 'number', required: true } } },
            } } },
          },
        },
        scale: { type: 'number', description: '导出倍率，默认 2（与工作台保存一致）；改变采样尺寸，不改变布局。' },
        create: { type: 'boolean', description: '仅明确新建/另存拼图时为 true，不能覆盖已存在文件；默认更新现有拼图。' },
        output: {
          type: 'string',
          required: true,
          description: '修改时必须使用 groups.json 中原 asset 路径（相对工作区补项目路径）；新建时为 <project>/groups/<group-id>.png。',
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
            groups_digest: { type: 'string' },
            layout: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: ['manual', 'grid', 'rows', '1+2'] },
                geometry: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    width: { type: 'number' },
                    height: { type: 'number' },
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
            text: `compose_panels：${value.output ?? '<unknown>'}\n  group=${value.group ?? '<unknown>'} members=${(value.members ?? []).join(', ')}\n  layout=${value.layout?.kind ?? '<unknown>'} digest=${value.inputs_digest ?? '<unknown>'}`,
          },
        ],
      },
      async execute(args, exec): Promise<ComposeResult> {
        return composePanels(args as unknown as ComposeRequest, workspaceCwd(exec), exec.signal)
      },
    }),
  )
}

/** Shared by the atomic tool and the manual editor Remote. */
export async function composePanels(args: ComposeRequest, cwd: string, signal: AbortSignal): Promise<ComposeResult> {
  if (args.assets.length < 1) throw new Error('至少添加一张图片')
  const scale = args.scale ?? DEFAULT_SCALE
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('导出倍率必须为正数')
  const outputPath = resolveWorkspacePath(args.output, cwd)
  if (extname(outputPath).toLocaleLowerCase() !== '.png') throw new Error('output 必须是 PNG 文件')
  const projectDir = projectDirForOutput(outputPath)
  const groupsPath = join(projectDir, 'groups.json')
  // output 必在 <project>/groups/ 下（见 projectDirForOutput），登记的相对路径即 groups/<name>.png。
  const groupAsset = relative(projectDir, outputPath).replaceAll('\\', '/')
  let groupId = basename(outputPath, extname(outputPath))
  assertSafeAssetId(groupId)
  assertInsideDirectory(await realpath(projectDir), await realpath(cwd))
  await mkdir(dirname(outputPath), { recursive: true })
  assertInsideDirectory(await realpath(dirname(outputPath)), await realpath(projectDir))
  try { assertInsideDirectory(await realpath(outputPath), await realpath(projectDir)) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  try { assertInsideDirectory(await realpath(groupsPath), await realpath(projectDir)) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }

  const inputPaths = args.assets.map(asset => resolveWorkspacePath(asset, cwd))
  const ids = inputPaths.map(panelIdFromAsset)
  if (new Set(ids).size !== ids.length) throw new Error('assets 包含重复 panel id')
  for (const [index, inputPath] of inputPaths.entries()) {
    const canonicalInput = await realpath(inputPath).catch(error => {
      throw new Error(`成员图片缺失或不可读：${ids[index]}（${inputPath}）：${(error as Error).message}`)
    })
    assertInsideDirectory(canonicalInput, await realpath(projectDir))
    const projectRelative = relative(projectDir, inputPath).replaceAll('\\', '/')
    if (projectRelative !== `figures/${ids[index]}.png`) {
      throw new Error(`成员图片必须是项目内 figures/${ids[index]}.png：${inputPath}`)
    }
  }

  return withFileLock(groupsPath, async () => {
    const { groups, digest: initialDigest } = await readGroupsWithDigest(groupsPath)
    if (args.base_digest !== undefined && args.base_digest !== initialDigest) throw new Error('拼图文件已被修改，草稿已保留；请重新加载后再保存。')
    const previousOutput = await readFile(outputPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    const existing = groups.groups.find(group => group.asset.replaceAll('\\', '/') === groupAsset)
    if (args.create === true) {
      if (existing || groups.groups.some(group => group.id === groupId) || previousOutput !== undefined) throw new Error('新建不能覆盖已有拼图；修改请沿用原输出路径并省略 create。')
    } else {
      if (!existing) throw new Error('输出路径未登记：修改现有拼图请沿用 groups.json 中的原 asset；只有明确新建才传 create:true。')
      groupId = existing.id
      assertSafeAssetId(groupId)
    }
    const images = await Promise.all(inputPaths.map((path, index) => readInput(path, ids[index]!)))
    throwIfAborted(signal)
    if (args.inputs && (args.inputs.length !== images.length || images.some(image => args.inputs!.find(input => input.id === image.id)?.digest !== sha256Hex(image.bytes)))) throw new Error('图源已变化，草稿已保留；请重新加载图源后再保存。')
    const explicit = args.geometry === undefined ? undefined : validateGeometry(args.geometry, ids)
    const chosen = explicit ? undefined : chooseLayout(images.length, images, args.layout_hint)
    const reference: CompositionGeometry = explicit ?? { ...DEFAULT_CANVAS, cells: chosen!.cells.map((cell, i) => ({ member: ids[i]!, ...cell })) }
    const geometry = fitComposition(reference, images)
    const orderedImages = geometry.cells.map(cell => images.find(image => image.id === cell.member)!)
    const png = await composePng(orderedImages, geometry, scale)
    throwIfAborted(signal)
    const inputsDigest = digestMembers(orderedImages.map(image => ({ id: image.id, digest: sha256Hex(image.bytes) })))
    const layout: CompositionLayout = { kind: explicit ? 'manual' : chosen!.kind, geometry }
    if (await groupsFileDigest(groupsPath) !== initialDigest) throw new Error('拼图文件在导出期间发生变化，请重新加载。')
    for (const image of images) if (sha256Hex(await readFile(image.path)) !== sha256Hex(image.bytes)) throw new Error('图源在导出期间发生变化，请重新加载。')
    const entry: GroupEntry = {
      id: groupId,
      asset: groupAsset,
      members: orderedImages.map(image => image.id),
      inputs_digest: inputsDigest,
      layout,
    }
    const nextGroups: GroupsFile = {
      version: 1,
      groups: groups.groups.some(group => group.id === groupId)
        ? groups.groups.map(group => group.id === groupId ? entry : group)
        : [...groups.groups, entry],
    }
    const nextText = `${JSON.stringify(nextGroups, null, 2)}\n`
    await atomicWriteFile(outputPath, png)
    try {
      await atomicWriteFile(groupsPath, nextText)
    } catch (error) {
      await restoreOutput(outputPath, previousOutput).catch(() => {})
      throw error
    }
    return {
      output: displayWorkspacePath(outputPath, cwd),
      group: groupId,
      members: entry.members,
      inputs_digest: inputsDigest,
      groups_digest: sha256Hex(nextText),
      layout: entry.layout as ComposeResult['layout'],
    }
  }, { signal })
}
