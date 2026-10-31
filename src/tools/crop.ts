import { rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  loadFiguresJson,
  type DocumentEntry,
  type Figure,
  type Panel,
} from '../figures/figuresJson.ts'
import { updateFiguresFile } from '../figures/figuresStore.ts'
import { atomicWriteFile } from '../files.ts'
import { PdfFile } from '../pdf/pdf.ts'
import { hasIntersection } from '../pdf/coords.ts'
import { assertInsideDirectory, assertSafeAssetId, resolveWorkspacePath, workspaceCwd, displayWorkspacePath } from '../paths.ts'

/**
 * crop：按 figures.json 的 panel bbox 裁剪 viewport 渲染 → figures/<panel_id>.png
 * （架构 §3）。裁切从 PDF 重渲染（无损）；新 asset 路径以单次 patch 经 update_figures
 * 同一写入口回写，已有 asset 只在 revision 未变时替换像素。
 */

interface CroppedEntry {
  id: string
  figure: string
  label: string | null
  document: string
  page: number
  asset: string
  width: number
  height: number
  clamped: boolean
}

interface StagedAsset {
  id: string
  figureIndex: number
  panelIndex: number
  tempPath: string
  outPath: string
}

export interface CropOutcome {
  figures_json: string
  /** 本次裁切读取的 revision；与 revision 不同说明是本次回写推进的版本。 */
  base_revision: number
  revision: number
  cropped: CroppedEntry[]
  anomalies: Anomaly[]
}

interface Anomaly {
  id: string
  kind: 'unknown-id' | 'duplicate-id' | 'invalid-region-index' | 'empty-bbox' | 'bbox-outside-page' | 'document-missing' | 'render-failed'
  detail?: string
}

export function registerCrop(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'crop',
      description:
        '按 figures.json 中的 panel bbox（PDF 点、原页旋转后基准）从对应 PDF 重渲染裁切，' +
        '落盘 figures/<panel_id>.png，新资产路径一次回写 figures.json（至多 revision+1）。默认裁全部已采纳 panel' +
        '（figure.status ≠ excluded）；传 ids 可指定子集。bbox 越界自动截断并标记 clamped。' +
        '异常项列入 anomalies 且不阻断其余 panel；cropped 只列出本次实际落盘的资产。',
      parameters: {
        figures_json: {
          type: 'string',
          required: true,
          description: 'figures.json 路径（相对会话工作目录或绝对路径）',
        },
        ids: {
          type: 'array',
          items: { type: 'string', description: 'panel id' },
          description: '要裁切的 panel id 列表；缺省 = 全部已采纳 panel',
        },
        dpi: {
          type: 'integer',
          enum: [150, 300],
          description: '渲染 DPI，默认 300',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            figures_json: { type: 'string' },
            revision: { type: 'integer', description: '本次回写后的 figures.json revision' },
            cropped: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  figure: { type: 'string' },
                  label: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  document: { type: 'string' },
                  page: { type: 'integer' },
                  asset: { type: 'string' },
                  width: { type: 'integer' },
                  height: { type: 'integer' },
                  clamped: { type: 'boolean' },
                },
              },
            },
            anomalies: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  kind: { type: 'string' },
                  detail: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `crop：${value.figures_json}（revision ${value.revision}）`,
              ...(value.cropped ?? []).map(c =>
                `  ${c.id}${c.label == null ? '' : ` (${c.label})`} → ${c.asset}（${c.width}×${c.height}px${c.clamped ? '，bbox 已截断' : ''}）`,
              ),
              ...(value.anomalies ?? []).map(a =>
                `  ⚠️ ${a.id}: ${a.kind}${a.detail === undefined ? '' : `（${a.detail}）`}`,
              ),
              (value.cropped ?? []).length === 0 && (value.anomalies ?? []).length === 0
                ? '  （无可裁切的 panel）'
                : '',
            ]
              .filter(line => line !== '')
              .join('\n'),
          },
        ],
      },
      async execute(args, exec) {
        const cwd = workspaceCwd(exec)
        const result = await cropFigures(resolveWorkspacePath(args.figures_json, cwd), { ids: args.ids, dpi: args.dpi, cwd, signal: exec.signal })
        return { figures_json: result.figures_json, revision: result.revision, cropped: result.cropped, anomalies: result.anomalies }
      },
    }),
  )
}

/**
 * 按 figures.json 当前 bbox 从 PDF 重渲染裁切；crop 工具与工作台 host RPC 共用。
 * 新 asset 路径一次回写（至多 revision+1），已有 asset 只在 revision 未变时替换像素。
 */
export async function cropFigures(
  absFigures: string,
  options: { ids?: readonly string[]; dpi?: number; cwd: string; signal: AbortSignal },
): Promise<CropOutcome> {
  const { cwd, signal } = options
  const dpi = options.dpi ?? 300
  const data = await loadFiguresJson(absFigures)
  const projectDir = dirname(absFigures)
  const figuresDir = join(projectDir, 'figures')
  const docIndex = new Map<string, DocumentEntry>(data.documents.map(d => [d.id, d]))
  const anomalies: Anomaly[] = []

  // panel id 全局唯一（契约）；重复即标记，后者不再覆盖前者的产物文件。
  const idCounts = new Map<string, number>()
  for (const figure of data.figures) {
    for (const panel of figure.panels) {
      idCounts.set(panel.id, (idCounts.get(panel.id) ?? 0) + 1)
    }
  }
  for (const [id, count] of idCounts) {
    if (count > 1) anomalies.push({ id, kind: 'duplicate-id', detail: `出现 ${count} 次` })
  }

  interface Selected {
    figure: Figure
    panel: Panel
  }
  let selected: Selected[]
  if (options.ids === undefined) {
    selected = data.figures
      .filter(figure => figure.status !== 'excluded')
      .flatMap(figure => figure.panels.map(panel => ({ figure, panel })))
  } else {
    const wanted = new Set(options.ids)
    selected = []
    for (const figure of data.figures) {
      for (const panel of figure.panels) {
        if (wanted.has(panel.id)) {
          wanted.delete(panel.id)
          selected.push({ figure, panel })
        }
      }
    }
    for (const id of wanted) anomalies.push({ id, kind: 'unknown-id' })
  }

  const docFiles = new Map<string, { path: string; file?: PdfFile; missing?: string }>()
  const cropped: CroppedEntry[] = []
  const staged: StagedAsset[] = []
  let revision = data.revision
  try {
    for (const { figure, panel } of selected) {
      if ((idCounts.get(panel.id) ?? 0) > 1) continue
      try {
        assertSafeAssetId(panel.id)
      } catch (error) {
        anomalies.push({ id: panel.id, kind: 'render-failed', detail: (error as Error).message })
        continue
      }
      const region = figure.regions[panel.region_index]
      if (region === undefined) {
        anomalies.push({ id: panel.id, kind: 'invalid-region-index', detail: `region_index=${panel.region_index}` })
        continue
      }
      const entry = docIndex.get(region.document)
      if (entry === undefined) {
        anomalies.push({ id: panel.id, kind: 'document-missing', detail: `未登记的文档 id：${region.document}` })
        continue
      }
      let cached = docFiles.get(entry.id)
      if (cached === undefined) {
        const docPath = isAbsolute(entry.path) ? entry.path : resolve(projectDir, entry.path)
        cached = { path: docPath }
        docFiles.set(entry.id, cached)
        try {
          cached.file = await PdfFile.open(docPath, signal)
        } catch (error) {
          cached.missing = (error as Error).message
        }
      }
      if (cached.file === undefined || cached.missing !== undefined) {
        anomalies.push({ id: panel.id, kind: 'document-missing', detail: cached.missing })
        continue
      }
      if (panel.bbox[2] <= panel.bbox[0] || panel.bbox[3] <= panel.bbox[1]) {
        anomalies.push({ id: panel.id, kind: 'empty-bbox', detail: `bbox=${panel.bbox.join(',')}` })
        continue
      }
      const size = await cached.file.pageSize(region.page)
      if (!hasIntersection(panel.bbox, size.width, size.height)) {
        anomalies.push({ id: panel.id, kind: 'bbox-outside-page', detail: `bbox=${panel.bbox.join(',')}` })
        continue
      }
      try {
        const png = await cached.file.renderRegion(region.page, panel.bbox, dpi, signal)
        const outPath = join(figuresDir, `${panel.id}.png`)
        assertInsideDirectory(outPath, figuresDir)
        const tempPath = `${outPath}.crop-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`
        await atomicWriteFile(tempPath, png.data)
        staged.push({
          id: panel.id,
          figureIndex: data.figures.findIndex(item => item.id === figure.id),
          panelIndex: figure.panels.findIndex(item => item.id === panel.id),
          tempPath,
          outPath,
        })
        cropped.push({
          id: panel.id,
          figure: figure.id,
          label: panel.label,
          document: region.document,
          page: region.page,
          asset: displayWorkspacePath(outPath, cwd),
          width: png.width,
          height: png.height,
          clamped: png.clamped,
        })
      } catch (error) {
        if (signal.aborted) throw error
        anomalies.push({ id: panel.id, kind: 'render-failed', detail: (error as Error).message })
      }
    }

    // 成功裁出的 panel 一次回写 asset（单次 revision）；已有 asset 的只需在
    // revision 未变时替换像素，不制造无意义的版本与快照。
    const assetPath = (item: StagedAsset) => `/figures/${item.figureIndex}/panels/${item.panelIndex}/asset`
    const added = new Set(staged.filter(item => data.figures[item.figureIndex]?.panels[item.panelIndex]?.asset === undefined))
    const patch = [...added].map(item => ({ op: 'add' as const, path: assetPath(item), value: `figures/${item.id}.png` }))
    if (patch.length > 0) {
      const updated = await updateFiguresFile(absFigures, patch, revision, { signal })
      if (!updated.ok) throw new Error(`crop 写入冲突：figures.json 已更新到 revision=${updated.revision}，请按最新框重新裁切`)
      revision = updated.revision
    } else if (staged.length > 0) {
      const current = await loadFiguresJson(absFigures)
      if (current.revision !== revision) {
        throw new Error(`crop 写入冲突：figures.json 已更新到 revision=${current.revision}，请按最新框重新裁切`)
      }
    }
    try {
      while (staged.length > 0) {
        await rename(staged[0]!.tempPath, staged[0]!.outPath)
        staged.shift()
      }
    } catch (error) {
      // 本次新登记但未落盘的 asset 尽力撤回，避免 figures.json 指向不存在的文件。
      const rollback = staged.filter(item => added.has(item)).map(item => ({ op: 'remove' as const, path: assetPath(item) }))
      if (rollback.length > 0) await updateFiguresFile(absFigures, rollback, revision).catch(() => undefined)
      throw error
    }
  } finally {
    await Promise.all(staged.map(item => rm(item.tempPath, { force: true }).catch(() => {})))
  }
  return {
    figures_json: displayWorkspacePath(absFigures, cwd),
    base_revision: data.revision,
    revision,
    cropped,
    anomalies,
  }
}
