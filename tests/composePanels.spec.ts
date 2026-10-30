import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import sharp from 'sharp'
import { registerComposePanels } from '../src/tools/composePanels.ts'
import { validateProject } from '../src/validate/project.ts'

function captureTool(): ToolDefinition {
  const defs = new Map<string, ToolDefinition>()
  const ctx = {
    tools: { register: (definition: ToolDefinition) => defs.set(definition.name, definition) },
  } as unknown as Context
  registerComposePanels(ctx)
  const definition = defs.get('compose_panels')
  if (!definition) throw new Error('compose_panels 未注册')
  return definition
}

function runCtx(cwd: string): ToolRunContext {
  return {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd } } },
  } as unknown as ToolRunContext
}

async function png(color: { r: number; g: number; b: number }, width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { ...color, alpha: 1 } },
  }).png().toBuffer()
}

let work: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'jc-compose-'))
  await mkdir(join(work, 'paper', 'figures'), { recursive: true })
  await mkdir(join(work, 'paper', 'groups'), { recursive: true })
  await writeFile(join(work, 'paper', 'figures', 'panel-a.png'), await png({ r: 220, g: 40, b: 40 }, 400, 200))
  await writeFile(join(work, 'paper', 'figures', 'panel-b.png'), await png({ r: 40, g: 100, b: 220 }, 200, 400))
  await writeFile(join(work, 'paper', 'figures', 'panel-c.png'), await png({ r: 40, g: 180, b: 80 }, 300, 300))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

describe('compose_panels 工具', () => {
  it('按 1+2 合成 PNG，并登记成员、digest 与布局几何', async () => {
    const tool = captureTool()
    const result = await tool.execute(
      {
        assets: ['paper/figures/panel-a.png', 'paper/figures/panel-b.png', 'paper/figures/panel-c.png'],
        layout_hint: '1+2',
        output: 'paper/groups/fig1_ABC.png',
      },
      runCtx(work),
    ) as {
      output: string
      group: string
      members: string[]
      inputs_digest: string
      layout: { kind: string; geometry: { width: number; height: number; cells: unknown[] } }
    }
    expect(validateJsonSchemaValue(tool.output.schema, result)).toEqual([])
    expect(result.output).toBe('paper/groups/fig1_ABC.png')
    expect(result.group).toBe('fig1_ABC')
    expect(result.members).toEqual(['panel-a', 'panel-b', 'panel-c'])
    expect(result.inputs_digest).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(result.layout.kind).toBe('1+2')
    expect(result.layout.geometry).toMatchObject({ width: 960, height: 540 })
    expect(result.layout.geometry.cells).toHaveLength(3)
    expect((await sharp(join(work, result.output)).metadata()).width).toBe(960)
    expect((await sharp(join(work, result.output)).metadata()).height).toBe(540)
    const groups = JSON.parse(await readFile(join(work, 'paper', 'groups.json'), 'utf8'))
    expect(groups.version).toBe(1)
    expect(groups.groups).toHaveLength(1)
    expect(groups.groups[0]).toMatchObject({ id: 'fig1_ABC', asset: 'groups/fig1_ABC.png', members: result.members, inputs_digest: result.inputs_digest })
    expect(groups.groups[0].layout.kind).toBe('1+2')
  })

  it('compose 登记的成员指纹与 validate 重算一致', async () => {
    await captureTool().execute(
      { assets: ['paper/figures/panel-a.png', 'paper/figures/panel-b.png'], output: 'paper/groups/fig1_AB.png' },
      runCtx(work),
    )
    const panel = (id: string, bbox: number[]) => ({ id, label: id.slice(-1), region_index: 0, bbox, asset: `figures/${id}.png`, caption_refs: [], flags: [], origin: 'auto' })
    await writeFile(join(work, 'paper', 'figures.json'), JSON.stringify({
      version: 1, revision: 1,
      documents: [{ id: 'main', path: 'main.pdf', role: 'main', pages: 1 }],
      figures: [{ id: 'fig1', regions: [{ document: 'main', page: 1, bbox: [0, 0, 600, 800] }], panels: [panel('panel-a', [0, 0, 100, 100]), panel('panel-b', [100, 100, 200, 200])] }],
    }))
    await writeFile(join(work, 'paper', 'deck.md'), '<!-- page 1 -->\n\n![Figure 1A](groups/fig1_AB.png)\n> 来源：Figure 1A · p.1\n\n> 🗣 **讲稿**：Figure 1A。\n')
    const report = await validateProject(join(work, 'paper'))
    expect(report.errors).toEqual([])
    expect(report.warnings.map(item => item.code)).not.toContain('GROUP_DIGEST_STALE')
    await writeFile(join(work, 'paper', 'figures', 'panel-b.png'), await png({ r: 0, g: 0, b: 0 }, 200, 400))
    expect((await validateProject(join(work, 'paper'))).warnings.map(item => item.code)).toContain('GROUP_DIGEST_STALE')
  })

  it('非法布局整体拒绝且不产生 PNG 或 groups.json', async () => {
    const tool = captureTool()
    await expect(tool.execute(
      {
        assets: ['paper/figures/panel-a.png', 'paper/figures/panel-b.png'],
        layout_hint: '1+2',
        output: 'paper/groups/invalid.png',
      },
      runCtx(work),
    )).rejects.toThrow(/1\+2/u)
    await expect(stat(join(work, 'paper', 'groups', 'invalid.png'))).rejects.toThrow()
    await expect(stat(join(work, 'paper', 'groups.json'))).rejects.toThrow()
  })

  it('成员缺失时不产生部分产物', async () => {
    const tool = captureTool()
    await expect(tool.execute(
      {
        assets: ['paper/figures/panel-a.png', 'paper/figures/missing.png'],
        output: 'paper/groups/missing.png',
      },
      runCtx(work),
    )).rejects.toThrow(/成员图片缺失/u)
    await expect(stat(join(work, 'paper', 'groups', 'missing.png'))).rejects.toThrow()
    await expect(stat(join(work, 'paper', 'groups.json'))).rejects.toThrow()
  })

  it('重拼同一 group 会更新 digest 并替换清单条目', async () => {
    const tool = captureTool()
    const first = await tool.execute(
      {
        assets: ['paper/figures/panel-a.png', 'paper/figures/panel-b.png'],
        layout_hint: 'grid',
        output: 'paper/groups/rebuild.png',
      },
      runCtx(work),
    ) as { inputs_digest: string }
    const oldBytes = await readFile(join(work, 'paper', 'groups', 'rebuild.png'))
    await writeFile(join(work, 'paper', 'figures', 'panel-a.png'), await png({ r: 10, g: 220, b: 220 }, 400, 200))
    const second = await tool.execute(
      {
        assets: ['paper/figures/panel-a.png', 'paper/figures/panel-b.png'],
        layout_hint: 'grid',
        output: 'paper/groups/rebuild.png',
      },
      runCtx(work),
    ) as { inputs_digest: string }
    expect(second.inputs_digest).not.toBe(first.inputs_digest)
    expect(await readFile(join(work, 'paper', 'groups', 'rebuild.png'))).not.toEqual(oldBytes)
    const groups = JSON.parse(await readFile(join(work, 'paper', 'groups.json'), 'utf8'))
    expect(groups.groups).toHaveLength(1)
    expect(groups.groups[0].inputs_digest).toBe(second.inputs_digest)
  })
})
