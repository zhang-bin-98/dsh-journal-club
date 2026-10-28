import { mkdir, rename, rm } from 'node:fs/promises'
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

interface StagedAsset {
  id: string
  figureIndex: number
  panelIndex: number
  tempPath: string
  outPath: string
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
        const dpi = args.dpi ?? 300
        const absFigures = resolveWorkspacePath(args.figures_json, cwd)
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
        const staged: StagedAsset[] = []
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
              cached.file = await PdfFile.open(docPath, exec.signal)
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
            const png = await cached.file.renderRegion(region.page, panel.bbox, dpi, exec.signal)
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
            if (exec.signal.aborted) throw error
            anomalies.push({ id: panel.id, kind: 'render-failed', detail: (error as Error).message })
          }
        }

        let revision = data.revision
        if (cropped.length > 0 && anomalies.length === 0) {
          for (const item of cropped) {
            const stagedItem = staged.find(candidate => candidate.id === item.id)
            if (!stagedItem) throw new Error(`crop 暂存文件丢失：${item.id}`)
            const panel = data.figures[stagedItem.figureIndex]?.panels[stagedItem.panelIndex]
            if (!panel) throw new Error(`crop panel 索引失效：${item.id}`)
            const previousAsset = panel.asset
            const path = `/figures/${stagedItem.figureIndex}/panels/${stagedItem.panelIndex}/asset`
            const patch = [{ op: previousAsset === undefined ? 'add' as const : 'replace' as const, path, value: `figures/${item.id}.png` }]
            const updated = await updateFiguresFile(absFigures, patch, revision, { signal: exec.signal })
            if (!updated.ok) throw new Error(`crop 写入冲突：当前 revision=${updated.revision}`)
            revision = updated.revision
            try {
              await rename(stagedItem.tempPath, stagedItem.outPath)
            } catch (error) {
              const rollback = previousAsset === undefined
                ? [{ op: 'remove' as const, path }]
                : [{ op: 'replace' as const, path, value: previousAsset }]
              await updateFiguresFile(absFigures, rollback, revision, { signal: exec.signal }).catch(() => undefined)
              throw error
            }
            staged.splice(staged.indexOf(stagedItem), 1)
            panel.asset = `figures/${item.id}.png`
          }
        }
        await Promise.all(staged.map(item => rm(item.tempPath, { force: true }).catch(() => {})))
        return {
          figures_json: displayWorkspacePath(absFigures, cwd),
          revision,
          cropped,
          anomalies,
        }
      },
    }),
  )
}
