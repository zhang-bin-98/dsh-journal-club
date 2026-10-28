import { readFile } from 'node:fs/promises'
import { z } from 'zod'

/**
 * figures.json v1 数据契约（架构 §4.1）。
 * bbox 一律 PDF 点（pt）、原页旋转后基准，[x0, y0, x1, y1]。
 *
 * `FiguresJsonSchema` 保持基础结构校验，供 crop 等需要报告局部坏项的读取方使用。
 * update_figures 写入前必须调用 `validateFiguresJson`，它还会执行跨字段完整性检查。
 */

const finiteNumber = z.number().refine(Number.isFinite, '必须是有限数字')

export const BBoxSchema = z.tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber])

export const RegionSchema = z.strictObject({
  document: z.string().min(1),
  page: z.int().min(1),
  bbox: BBoxSchema,
})

export const PanelSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().nullable(),
  region_index: z.int().min(0).default(0),
  bbox: BBoxSchema,
  asset: z.string().optional(),
  caption_refs: z.array(z.int().min(0)).default([]),
  flags: z.array(z.string()).default([]),
  origin: z.enum(['auto', 'manual', 'agent']).default('auto'),
})

export const FigureSchema = z.strictObject({
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

export const DocumentEntrySchema = z.strictObject({
  id: z.string().min(1),
  path: z.string(),
  role: z.enum(['main', 'supplement']),
  pages: z.int().min(0),
})

export const FiguresJsonSchema = z.strictObject({
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

function formatIssues(result: { error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } }): string[] {
  return result.error.issues.map(i => `${i.path.map(String).join('.') || '<root>'}: ${i.message}`)
}

function isSafeAssetPath(asset: string, panelId: string): boolean {
  const normalized = asset.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) return false
  const parts = normalized.split('/')
  if (parts.length !== 2 || parts[0] !== 'figures' || parts[1] === '' || parts[1] === '.' || parts[1] === '..') {
    return false
  }
  return parts[1] === `${panelId}.png`
}

function addIssue(issues: string[], path: string, message: string): void {
  issues.push(`${path}: ${message}`)
}

function bboxHasArea(bbox: BBox): boolean {
  return bbox[0] < bbox[2] && bbox[1] < bbox[3]
}

function bboxContains(outer: BBox, inner: BBox): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]
}

/**
 * 对已通过基础 schema 的数据执行 figures.json 的跨字段约束。
 * 文件存在性不在这里检查：asset 可以在 crop 写回 JSON 的同一工作流中刚刚生成，
 * 但路径必须是该 panel 的约定相对路径。
 */
export function validateFiguresJson(data: FiguresJson): FiguresJson {
  const issues: string[] = []
  const documentIds = new Set<string>()
  const figureIds = new Set<string>()
  const panelIds = new Set<string>()

  for (const [index, document] of data.documents.entries()) {
    if (documentIds.has(document.id)) addIssue(issues, `documents.${index}.id`, `ID 重复：${document.id}`)
    documentIds.add(document.id)
  }

  const documents = new Map(data.documents.map(document => [document.id, document]))
  for (const [figureIndex, figure] of data.figures.entries()) {
    if (figureIds.has(figure.id)) addIssue(issues, `figures.${figureIndex}.id`, `ID 重复：${figure.id}`)
    figureIds.add(figure.id)

    for (const [regionIndex, region] of figure.regions.entries()) {
      const document = documents.get(region.document)
      if (document === undefined) {
        addIssue(issues, `figures.${figureIndex}.regions.${regionIndex}.document`, `未引用已登记文档：${region.document}`)
      } else if (document.pages > 0 && region.page > document.pages) {
        addIssue(
          issues,
          `figures.${figureIndex}.regions.${regionIndex}.page`,
          `页码 ${region.page} 超出文档 ${document.id} 的 ${document.pages} 页`,
        )
      }
      if (!bboxHasArea(region.bbox) || region.bbox.some(value => value < 0)) {
        addIssue(issues, `figures.${figureIndex}.regions.${regionIndex}.bbox`, 'bbox 必须是非负且具有正面积')
      }
    }

    if (figure.caption !== undefined) {
      const maxPages = Math.max(...data.documents.map(document => document.pages), 0)
      if (maxPages > 0 && figure.caption.page > maxPages) {
        addIssue(issues, `figures.${figureIndex}.caption.page`, `页码 ${figure.caption.page} 超出文档范围`)
      }
    }

    for (const [panelIndex, panel] of figure.panels.entries()) {
      if (panelIds.has(panel.id)) addIssue(issues, `figures.${figureIndex}.panels.${panelIndex}.id`, `ID 重复：${panel.id}`)
      panelIds.add(panel.id)

      const region = figure.regions[panel.region_index]
      if (region === undefined) {
        addIssue(
          issues,
          `figures.${figureIndex}.panels.${panelIndex}.region_index`,
          `region_index 越界：${panel.region_index}`,
        )
      }

      if (!bboxHasArea(panel.bbox) || panel.bbox.some(value => value < 0)) {
        addIssue(issues, `figures.${figureIndex}.panels.${panelIndex}.bbox`, 'bbox 必须是非负且具有正面积')
      }
      if (region !== undefined && !bboxContains(region.bbox, panel.bbox)) {
        addIssue(issues, `figures.${figureIndex}.panels.${panelIndex}.bbox`, 'Panel bbox 必须位于关联 region 内')
      }

      if (figure.caption === undefined && panel.caption_refs.length > 0) {
        addIssue(issues, `figures.${figureIndex}.panels.${panelIndex}.caption_refs`, '没有 caption 时不能存在引用')
      } else if (figure.caption !== undefined) {
        const refs = new Set<number>()
        for (const [refIndex, sentenceIndex] of panel.caption_refs.entries()) {
          if (sentenceIndex >= figure.caption.sentences.length) {
            addIssue(
              issues,
              `figures.${figureIndex}.panels.${panelIndex}.caption_refs.${refIndex}`,
              `引用句子越界：${sentenceIndex}`,
            )
          }
          if (refs.has(sentenceIndex)) {
            addIssue(
              issues,
              `figures.${figureIndex}.panels.${panelIndex}.caption_refs.${refIndex}`,
              `重复引用句子：${sentenceIndex}`,
            )
          }
          refs.add(sentenceIndex)
        }
      }

      if (panel.asset !== undefined && !isSafeAssetPath(panel.asset, panel.id)) {
        addIssue(
          issues,
          `figures.${figureIndex}.panels.${panelIndex}.asset`,
          `asset 必须是 figures/${panel.id}.png 的相对路径`,
        )
      }
    }
  }

  if (issues.length > 0) throw new FiguresJsonFormatError(issues)
  return data
}

/** 解析并执行基础结构校验；局部诊断工具使用此入口。 */
export function parseFiguresJson(raw: string, source = 'figures.json'): FiguresJson {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new FiguresJsonFormatError([`${source}: JSON 解析失败：${(error as Error).message}`])
  }
  const result = FiguresJsonSchema.safeParse(parsed)
  if (!result.success) throw new FiguresJsonFormatError(formatIssues(result))
  return result.data
}

/** 读取并校验 figures.json 的基础结构；跨字段写入校验由 update_figures 执行。 */
export async function loadFiguresJson(absPath: string): Promise<FiguresJson> {
  let raw: string
  try {
    raw = await readFile(absPath, 'utf8')
  } catch (error) {
    throw new Error(`figures.json 不可读（${absPath}）：${(error as Error).message}`)
  }
  return parseFiguresJson(raw, absPath)
}
