import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { registerCrop } from '../src/tools/crop.ts'
import { registerRenderPages } from '../src/tools/renderPages.ts'
import { FIXTURES, fixturePath } from './fixtures.ts'

function captureTools(): { ctx: Context; defs: Map<string, ToolDefinition> } {
  const defs = new Map<string, ToolDefinition>()
  const ctx = {
    tools: { register: (def: ToolDefinition) => defs.set(def.name, def) },
  } as unknown as Context
  return { ctx, defs }
}

function runCtx(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext
}

let work: string
let oldCwd: string

beforeEach(async () => {
  oldCwd = process.cwd()
  work = await mkdtemp(join(tmpdir(), 'jc-tools-'))
  process.chdir(work)
})

afterEach(async () => {
  process.chdir(oldCwd)
  await rm(work, { recursive: true, force: true })
})

describe('render_pages 工具', () => {
  it('渲染指定页到 pages/ 并返回清单（相对路径基于会话工作目录）', async () => {
    const project = join(work, 'paper-a')
    await mkdir(project, { recursive: true })
    await cp(fixturePath(FIXTURES[0]!), join(project, 'main.pdf'))
    const { ctx, defs } = captureTools()
    registerRenderPages(ctx)
    const result = (await defs.get('render_pages')!.execute(
      { path: 'paper-a/main.pdf', pages: [1, 2], dpi: 150 },
      runCtx(),
    )) as {
      num_pages: number
      dpi: number
      output_dir: string
      rendered: Array<{ page: number; path: string; width: number; height: number }>
    }
    expect(result.num_pages).toBeGreaterThan(5)
    expect(result.dpi).toBe(150)
    expect(result.output_dir).toBe('paper-a/pages')
    expect(result.rendered.map(r => r.page)).toEqual([1, 2])
    for (const r of result.rendered) {
      expect(r.path).toMatch(/^paper-a\/pages\/main-\d{3}\.png$/)
      const info = await stat(join(work, r.path))
      expect(info.size).toBeGreaterThan(10_000)
    }
  })

  it('页码越界整体报错（不产生部分产物）', async () => {
    const { ctx, defs } = captureTools()
    registerRenderPages(ctx)
    await expect(
      defs.get('render_pages')!.execute(
        { path: fixturePath(FIXTURES[0]!), pages: [1, 99999], dpi: 150 },
        runCtx(),
      ),
    ).rejects.toThrow(/页码越界/)
  })
})

describe('crop 工具', () => {
  async function prepareProject() {
    const project = join(work, 'paper-b')
    await mkdir(project, { recursive: true })
    const pdfRel = 'main.pdf'
    await cp(fixturePath(FIXTURES[0]!), join(project, pdfRel))
    return { project, pdfRel }
  }

  it('按 figures.json 裁切：落盘 figures/<id>.png、回写 asset 与 revision+1', async () => {
    const { project, pdfRel } = await prepareProject()
    const figuresJson = {
      version: 1,
      status: 'draft',
      revision: 4,
      documents: [{ id: 'main', path: pdfRel, role: 'main', pages: 30 }],
      figures: [
        {
          id: 'fig1',
          label: 'Figure 1',
          status: 'viewed',
          regions: [{ document: 'main', page: 2, bbox: [0, 0, 612, 792] }],
          caption: { page: 2, sentences: ['Fig 1 caption.'] },
          panels: [
            {
              id: 'fig1_A',
              label: 'A',
              region_index: 0,
              bbox: [40, 60, 300, 400],
              caption_refs: [0],
              flags: [],
              origin: 'auto',
            },
          ],
        },
        {
          id: 'fig2',
          label: 'Figure 2',
          status: 'excluded',
          regions: [{ document: 'main', page: 3, bbox: [0, 0, 612, 792] }],
          panels: [
            { id: 'fig2_A', label: 'A', region_index: 0, bbox: [10, 10, 200, 200], caption_refs: [], flags: [], origin: 'auto' },
          ],
        },
      ],
    }
    const figuresPath = join(project, 'figures.json')
    await writeFile(figuresPath, JSON.stringify(figuresJson), 'utf8')

    const { ctx, defs } = captureTools()
    registerCrop(ctx)
    const result = await defs.get('crop')!.execute({ figures_json: 'paper-b/figures.json' }, runCtx())
    const outputErrors = validateJsonSchemaValue(defs.get('crop')!.output.schema, result)
    expect(outputErrors).toEqual([])
    const typedResult = result as {
      revision: number
      cropped: Array<{ id: string; asset: string; width: number; height: number; clamped: boolean }>
      anomalies: unknown[]
    }
    // 默认只裁已采纳：fig2 被 excluded 跳过。
    expect(typedResult.cropped.map(c => c.id)).toEqual(['fig1_A'])
    expect(typedResult.revision).toBe(5)
    expect(typedResult.anomalies).toEqual([])
    const info = await stat(join(project, 'figures', 'fig1_A.png'))
    expect(info.size).toBeGreaterThan(5_000)
    // figures.json 回写：asset 字段 + revision 5。
    const saved = JSON.parse(await readFile(figuresPath, 'utf8'))
    expect(saved.revision).toBe(5)
    expect(saved.figures[0].panels[0].asset).toBe('figures/fig1_A.png')
    expect(saved.figures[1].panels[0].asset).toBeUndefined()
  })

  it('ids 指定子集与异常项（unknown-id / empty-bbox / invalid-region-index）', async () => {
    const { project, pdfRel } = await prepareProject()
    const figuresJson = {
      version: 1,
      documents: [{ id: 'main', path: pdfRel, role: 'main', pages: 30 }],
      figures: [
        {
          id: 'fig1',
          label: 'Figure 1',
          status: 'pending',
          regions: [{ document: 'main', page: 2, bbox: [0, 0, 612, 792] }],
          panels: [
            { id: 'fig1_A', label: 'A', region_index: 0, bbox: [50, 50, 350, 450], asset: 'figures/fig1_A.png', caption_refs: [], flags: [], origin: 'auto' },
            { id: 'fig1_B', label: 'B', region_index: 7, bbox: [0, 0, 100, 100], caption_refs: [], flags: [], origin: 'auto' },
            { id: 'fig1_C', label: 'C', region_index: 0, bbox: [10, 10, 10.2, 10.2], caption_refs: [], flags: [], origin: 'auto' },
          ],
        },
      ],
    }
    await writeFile(join(project, 'figures.json'), JSON.stringify(figuresJson), 'utf8')
    const { ctx, defs } = captureTools()
    registerCrop(ctx)
    const result = (await defs.get('crop')!.execute(
      { figures_json: 'paper-b/figures.json', ids: ['fig1_A', 'fig1_B', 'fig1_C', 'nope'] },
      runCtx(),
    )) as { revision: number; cropped: Array<{ id: string }>; anomalies: Array<{ id: string; kind: string }> }
    expect(result.cropped.map(c => c.id)).toEqual(['fig1_A'])
    expect(result.anomalies.map(a => a.kind).sort()).toEqual(['bbox-outside-page', 'invalid-region-index', 'unknown-id'])
    // 异常项不阻断其余 panel：已登记 asset 的像素照常替换，revision 不变。
    expect((await stat(join(project, 'figures', 'fig1_A.png'))).size).toBeGreaterThan(1_000)
    expect(result.revision).toBe(0)
  })

  it('部分 panel 异常时，其余新资产一次回写，cropped 与落盘一致', async () => {
    const { project, pdfRel } = await prepareProject()
    const panel = (id: string, bbox: number[]) => ({ id, label: id.slice(-1), region_index: 0, bbox, caption_refs: [], flags: [], origin: 'auto' })
    await writeFile(join(project, 'figures.json'), JSON.stringify({
      version: 1,
      revision: 2,
      documents: [{ id: 'main', path: pdfRel, role: 'main', pages: 30 }],
      figures: [{
        id: 'fig1',
        status: 'pending',
        regions: [{ document: 'main', page: 2, bbox: [0, 0, 2000, 2000] }],
        panels: [panel('fig1_A', [40, 40, 300, 300]), panel('fig1_B', [300, 300, 560, 700]), panel('fig1_C', [1000, 1000, 1100, 1100])],
      }],
    }), 'utf8')
    const { ctx, defs } = captureTools()
    registerCrop(ctx)
    const result = (await defs.get('crop')!.execute({ figures_json: 'paper-b/figures.json' }, runCtx())) as {
      revision: number; cropped: Array<{ id: string; asset: string }>; anomalies: Array<{ id: string; kind: string }>
    }
    expect(result.cropped.map(c => c.id)).toEqual(['fig1_A', 'fig1_B'])
    expect(result.anomalies).toEqual([{ id: 'fig1_C', kind: 'bbox-outside-page', detail: 'bbox=1000,1000,1100,1100' }])
    for (const item of result.cropped) expect((await stat(join(work, item.asset))).size).toBeGreaterThan(1_000)
    const saved = JSON.parse(await readFile(join(project, 'figures.json'), 'utf8'))
    expect(result.revision).toBe(3)
    expect(saved.revision).toBe(3)
    expect(saved.figures[0].panels.map((p: { asset?: string }) => p.asset)).toEqual(['figures/fig1_A.png', 'figures/fig1_B.png', undefined])
    expect(await readdir(join(project, '.history'))).toHaveLength(1)
    expect((await readdir(join(project, 'figures'))).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('落盘失败时撤回本次新登记的 asset，不留下指向缺失文件的引用', async () => {
    const { project, pdfRel } = await prepareProject()
    await writeFile(join(project, 'figures.json'), JSON.stringify({
      version: 1,
      revision: 1,
      documents: [{ id: 'main', path: pdfRel, role: 'main', pages: 30 }],
      figures: [{ id: 'fig1', status: 'pending', regions: [{ document: 'main', page: 2, bbox: [0, 0, 612, 792] }],
        panels: [{ id: 'fig1_A', label: 'A', region_index: 0, bbox: [40, 40, 300, 300], caption_refs: [], flags: [], origin: 'auto' }] }],
    }), 'utf8')
    // 目标路径被目录占用，rename 必然失败。
    await mkdir(join(project, 'figures', 'fig1_A.png', 'blocker'), { recursive: true })
    const { ctx, defs } = captureTools()
    registerCrop(ctx)
    await expect(defs.get('crop')!.execute({ figures_json: 'paper-b/figures.json' }, runCtx())).rejects.toThrow()
    const saved = JSON.parse(await readFile(join(project, 'figures.json'), 'utf8'))
    expect(saved.figures[0].panels[0].asset).toBeUndefined()
    expect((await readdir(join(project, 'figures'))).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('拒绝非法 panel id 且不创建 figures 目录外文件', async () => {
    const { project } = await prepareProject()
    const figuresPath = join(project, 'figures.json')
    await writeFile(figuresPath, JSON.stringify({
      version: 1,
      documents: [{ id: 'main', path: 'main.pdf', role: 'main', pages: 30 }],
      figures: [{ id: 'fig1', status: 'pending', regions: [{ document: 'main', page: 1, bbox: [0, 0, 612, 792] }], panels: [{ id: '../escape', label: 'A', region_index: 0, bbox: [20, 20, 200, 200], caption_refs: [], flags: [], origin: 'auto' }] }],
    }), 'utf8')
    const { ctx, defs } = captureTools()
    registerCrop(ctx)
    const result = await defs.get('crop')!.execute({ figures_json: 'paper-b/figures.json' }, runCtx()) as { anomalies: Array<{ kind: string; detail?: string }> }
    expect(result.anomalies.some(item => item.detail?.includes('非法 panel id'))).toBe(true)
    expect(await stat(join(project, 'escape.png')).catch(() => undefined)).toBeUndefined()
  })

  it('契约不合法的 figures.json 报校验错误', async () => {
    const project = join(work, 'paper-c')
    await mkdir(project, { recursive: true })
    await writeFile(join(project, 'figures.json'), '{"version": 2}', 'utf8')
    const { ctx, defs } = captureTools()
    registerCrop(ctx)
    await expect(
      defs.get('crop')!.execute({ figures_json: 'paper-c/figures.json' }, runCtx()),
    ).rejects.toThrow(/契约校验失败/)
  })
})
