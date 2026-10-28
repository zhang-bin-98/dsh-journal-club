import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  loadFiguresJson,
  saveFiguresJson,
  type DocumentEntry,
  type Figure,
  type Panel,
} from '../figures/figuresJson.ts'
import { PdfFile } from '../pdf/pdf.ts'
import { isEmptyBBox } from '../pdf/coords.ts'
import { resolveWorkspacePath } from '../paths.ts'
import { displayPath } from './renderPages.ts'

/**
 * crop：按 figures.json 的 panel bbox 裁剪 viewport 渲染 → figures/<panel_id>.png
 * （架构 §3）。裁切从 PDF 重渲染（无损）；asset 路径回写 figures.json（revision+1，
 * 与 M2 的 update_figures 共用同一写入口）。
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

interface Anomaly {
  id: string
  kind: 'unknown-id' | 'duplicate-id' | 'invalid-region-index' | 'empty-bbox' | 'document-missing' | 'render-failed'
  detail?: string
}

export function registerCrop(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'crop',
      description:
        '按 figures.json 中的 panel bbox（PDF 点、原页旋转后基准）从对应 PDF 重渲染裁切，' +
        '落盘 figures/<panel_id>.png 并把 asset 路径回写 figures.json。默认裁全部已采纳 panel' +
        '（figure.status ≠ excluded）；传 ids 可指定子集。bbox 越界自动截断并标记 clamped。',
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
        const dpi = args.dpi ?? 300
        const absFigures = resolveWorkspacePath(args.figures_json)
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
        if (args.ids === undefined) {
          selected = data.figures
            .filter(figure => figure.status !== 'excluded')
            .flatMap(figure => figure.panels.map(panel => ({ figure, panel })))
        } else {
          const wanted = new Set(args.ids)
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
        for (const { figure, panel } of selected) {
          if ((idCounts.get(panel.id) ?? 0) > 1) continue
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
              cached.file = await PdfFile.open(docPath, exec.signal)
            } catch (error) {
              cached.missing = (error as Error).message
            }
          }
          if (cached.file === undefined || cached.missing !== undefined) {
            anomalies.push({ id: panel.id, kind: 'document-missing', detail: cached.missing })
            continue
          }
          if (isEmptyBBox(panel.bbox)) {
            anomalies.push({ id: panel.id, kind: 'empty-bbox', detail: `bbox=${panel.bbox.join(',')}` })
            continue
          }
          try {
            const png = await cached.file.renderRegion(region.page, panel.bbox, dpi, exec.signal)
            const outPath = join(figuresDir, `${panel.id}.png`)
            await mkdir(figuresDir, { recursive: true })
            await writeFile(outPath, png.data)
            panel.asset = `figures/${panel.id}.png`
            cropped.push({
              id: panel.id,
              figure: figure.id,
              label: panel.label,
              document: region.document,
              page: region.page,
              asset: displayPath(outPath),
              width: png.width,
              height: png.height,
              clamped: png.clamped,
            })
          } catch (error) {
            if (exec.signal.aborted) throw error
            anomalies.push({ id: panel.id, kind: 'render-failed', detail: (error as Error).message })
          }
        }

        let revision = data.revision
        if (cropped.length > 0) {
          revision = data.revision + 1
          await saveFiguresJson(absFigures, { ...data, revision })
        }
        return {
          figures_json: displayPath(absFigures),
          revision,
          cropped,
          anomalies,
        }
      },
    }),
  )
}
