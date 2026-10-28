import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'

/**
 * figures.json v1 数据契约（架构 §4.1）。
 * bbox 一律 PDF 点（pt）、原页旋转后基准，[x0, y0, x1, y1]。
 * 本模块是读取与原子落盘的共用底座；M2 的 update_figures 在此之上叠加
 * json-patch + base-rev 乐观锁，crop 的 asset 回写也走同一写入口，
 * 保证「figures.json 只有一个写入实现」。
 */

export const BBoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()])

export const RegionSchema = z.object({
  document: z.string(),
  page: z.int().min(1),
  bbox: BBoxSchema,
})

export const PanelSchema = z.object({
  id: z.string().min(1),
  label: z.string().nullable(),
  region_index: z.int().min(0).default(0),
  bbox: BBoxSchema,
  asset: z.string().optional(),
  caption_refs: z.array(z.int()).default([]),
  flags: z.array(z.string()).default([]),
  origin: z.enum(['auto', 'manual', 'agent']).default('auto'),
})

export const FigureSchema = z.object({
  id: z.string().min(1),
  label: z.string().nullable().default(null),
  status: z.enum(['pending', 'viewed', 'adjusted', 'excluded']).default('pending'),
  regions: z.array(RegionSchema).min(1),
  caption: z
    .object({
      page: z.int().min(1),
      sentences: z.array(z.string()).default([]),
    })
    .optional(),
  panels: z.array(PanelSchema).default([]),
})

export const DocumentEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string(),
  role: z.enum(['main', 'supplement']),
  pages: z.int().min(0),
})

export const FiguresJsonSchema = z.object({
  version: z.literal(1),
  status: z.enum(['draft', 'confirmed']).default('draft'),
  revision: z.int().min(0).default(0),
  documents: z.array(DocumentEntrySchema).min(1),
  figures: z.array(FigureSchema).default([]),
})

export type BBox = z.infer<typeof BBoxSchema>
export type Panel = z.infer<typeof PanelSchema>
export type Figure = z.infer<typeof FigureSchema>
export type DocumentEntry = z.infer<typeof DocumentEntrySchema>
export type FiguresJson = z.infer<typeof FiguresJsonSchema>

export class FiguresJsonFormatError extends Error {
  constructor(
    public readonly issues: string[],
  ) {
    super(`figures.json 契约校验失败：${issues.join('；')}`)
    this.name = 'FiguresJsonFormatError'
  }
}

/** 读取并校验 figures.json；结构不符即抛 FiguresJsonFormatError。 */
export async function loadFiguresJson(absPath: string): Promise<FiguresJson> {
  let raw: string
  try {
    raw = await readFile(absPath, 'utf8')
  } catch (error) {
    throw new Error(`figures.json 不可读（${absPath}）：${(error as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new FiguresJsonFormatError([`JSON 解析失败：${(error as Error).message}`])
  }
  const result = FiguresJsonSchema.safeParse(parsed)
  if (!result.success) {
    throw new FiguresJsonFormatError(result.error.issues.map(i => `${i.path.join('.') || '<root>'}: ${i.message}`))
  }
  return result.data
}

/**
 * 原子写回 figures.json：临时文件 + rename。调用方自行决定 revision 递增
 * （结构变更 +1；M2 的 update_figures 在此之上补 base-rev 乐观锁与 .history/ 滚动快照）。
 */
export async function saveFiguresJson(absPath: string, data: FiguresJson): Promise<void> {
  const body = `${JSON.stringify(data, null, 2)}\n`
  await mkdir(dirname(absPath), { recursive: true })
  const temp = join(dirname(absPath), `.${basename(absPath)}.tmp-${process.pid}-${Date.now()}`)
  try {
    await writeFile(temp, body, 'utf8')
    await rename(temp, absPath)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}
