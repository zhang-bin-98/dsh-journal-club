import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import sharp from 'sharp'
import { composePanels, registerComposePanels } from '../src/tools/composePanels.ts'
import { sha256Hex } from '../src/files.ts'
import { groupsFileDigest } from '../src/groups.ts'
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
  it('改名不能隐式新建；更新保留原 ID/路径，明确另存才能复制相同成员', async () => {
    const tool=captureTool()
    const args={assets:['paper/figures/panel-a.png','paper/figures/panel-b.png'],output:'paper/groups/g3_map.png'}
    await tool.execute({...args,create:true},runCtx(work))
    const manifestPath=join(work,'paper/groups.json')
    const before=await readFile(manifestPath,'utf8'), pngBefore=await readFile(join(work,args.output))
    await expect(tool.execute({...args,output:'paper/groups/g3_ab.png'},runCtx(work))).rejects.toThrow('原 asset')
    await expect(stat(join(work,'paper/groups/g3_ab.png'))).rejects.toThrow()
    await expect(tool.execute({...args,create:true},runCtx(work))).rejects.toThrow('新建不能覆盖')
    expect(await readFile(manifestPath,'utf8')).toBe(before)
    expect(await readFile(join(work,args.output))).toEqual(pngBefore)
    const manifest=JSON.parse(before);manifest.groups[0].id='stable_id'
    await writeFile(manifestPath,JSON.stringify(manifest))
    const updated=await tool.execute({...args,assets:['paper/figures/panel-c.png']},runCtx(work)) as {group:string;output:string}
    expect(updated).toMatchObject({group:'stable_id',output:args.output})
    expect(JSON.parse(await readFile(manifestPath,'utf8')).groups).toHaveLength(1)
    await tool.execute({...args,create:true,output:'paper/groups/new_copy.png'},runCtx(work))
    expect(JSON.parse(await readFile(manifestPath,'utf8')).groups.map((g:{id:string})=>g.id)).toEqual(['stable_id','new_copy'])
  })
  it('修改已有拼图在清单中原位更新，只有新拼图追加到末尾', async () => {
    const tool = captureTool()
    const compose = (id: string, panel = 'a', create = false) => tool.execute({ create, assets: [`paper/figures/panel-${panel}.png`], output: `paper/groups/${id}.png` }, runCtx(work))
    for (const id of ['first', 'middle', 'last']) await compose(id, 'a', true)
    await compose('middle', 'b')
    await compose('first', 'c')
    await compose('new', 'a', true)
    const groups = JSON.parse(await readFile(join(work, 'paper', 'groups.json'), 'utf8')).groups
    expect(groups.map((g: {id: string}) => g.id)).toEqual(['first', 'middle', 'last', 'new'])
    expect(groups[0].members).toEqual(['panel-c'])
    expect(groups[1].members).toEqual(['panel-b'])
  })
  it('按 1+2 合成 PNG，并登记成员、digest 与布局几何', async () => {
    const tool = captureTool()
    const result = await tool.execute(
      {
        assets: ['paper/figures/panel-a.png', 'paper/figures/panel-b.png', 'paper/figures/panel-c.png'],
        layout_hint: '1+2',
        create: true, output: 'paper/groups/fig1_ABC.png',
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
    expect(result.layout.geometry.width).toBeLessThan(960)
    expect(result.layout.geometry.height).toBeLessThanOrEqual(540)
    expect(result.layout.geometry.cells).toHaveLength(3)
    // 未传 scale 时默认 2 倍，与工作台保存一致。
    const info = await sharp(join(work, result.output)).metadata()
    expect([info.width, info.height]).toEqual([Math.ceil(result.layout.geometry.width * 2), Math.ceil(result.layout.geometry.height * 2)])
    const groups = JSON.parse(await readFile(join(work, 'paper', 'groups.json'), 'utf8'))
    expect(groups.version).toBe(1)
    expect(groups.groups).toHaveLength(1)
    expect(groups.groups[0]).toMatchObject({ id: 'fig1_ABC', asset: 'groups/fig1_ABC.png', members: result.members, inputs_digest: result.inputs_digest })
    expect(groups.groups[0].layout.kind).toBe('1+2')
  })

  it('compose 登记的成员指纹与 validate 重算一致', async () => {
    await captureTool().execute(
      { assets: ['paper/figures/panel-a.png', 'paper/figures/panel-b.png'], create: true, output: 'paper/groups/fig1_AB.png' },
      runCtx(work),
    )
    const panel = (id: string, bbox: number[]) => ({ id, label: id.slice(-1), region_index: 0, bbox, asset: `figures/${id}.png`, caption_refs: [], flags: [], origin: 'auto' })
    await writeFile(join(work, 'paper', 'figures.json'), JSON.stringify({
      version: 1, revision: 1,
      documents: [{ id: 'main', path: 'main.pdf', role: 'main', pages: 1 }],
      figures: [{ id: 'fig1', regions: [{ document: 'main', page: 1, bbox: [0, 0, 600, 800] }], panels: [panel('panel-a', [0, 0, 100, 100]), panel('panel-b', [100, 100, 200, 200])] }],
    }))
    await writeFile(join(work, 'paper', 'slides.md'), '<!-- page 1 -->\n\n![Figure 1A](groups/fig1_AB.png)\n> 来源：Figure 1A · p.1\n\n> 🗣 **讲稿**：Figure 1A。\n')
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
        create: true, output: 'paper/groups/invalid.png',
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
        create: true, output: 'paper/groups/missing.png',
      },
      runCtx(work),
    )).rejects.toThrow(/成员图片缺失/u)
    await expect(stat(join(work, 'paper', 'groups', 'missing.png'))).rejects.toThrow()
    await expect(stat(join(work, 'paper', 'groups.json'))).rejects.toThrow()
  })

  it('项目经目录别名访问时，缺图仍报告成员缺失', async () => {
    await symlink(join(work, 'paper'), join(work, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(captureTool().execute({
      assets: ['alias/figures/panel-a.png', 'alias/figures/missing.png'],
      create: true, output: 'alias/groups/missing.png',
    }, runCtx(work))).rejects.toThrow(/成员图片缺失/u)
    await expect(stat(join(work, 'paper', 'groups', 'missing.png'))).rejects.toThrow()
    await expect(stat(join(work, 'paper', 'groups.json'))).rejects.toThrow()
  })

  it('成员目录链接到项目外时仍拒绝读取和导出', async () => {
    await rename(join(work, 'paper', 'figures'), join(work, 'outside'))
    await symlink(join(work, 'outside'), join(work, 'paper', 'figures'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(captureTool().execute({
      assets: ['paper/figures/panel-a.png'],
      create: true, output: 'paper/groups/escaped.png',
    }, runCtx(work))).rejects.toThrow(/路径超出目标目录/u)
    await expect(stat(join(work, 'paper', 'groups', 'escaped.png'))).rejects.toThrow()
    await expect(stat(join(work, 'paper', 'groups.json'))).rejects.toThrow()
  })

  it('重拼同一 group 会更新 digest 并替换清单条目', async () => {
    const tool = captureTool()
    const first = await tool.execute(
      {
        assets: ['paper/figures/panel-a.png', 'paper/figures/panel-b.png'],
        layout_hint: 'grid',
        create: true, output: 'paper/groups/rebuild.png',
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


it('自由布局超过四图、任意比例，像素位置与成员绘制顺序一致', async () => {
  const assets: string[] = []
  for (let i = 0; i < 9; i++) {
    const path = `paper/figures/p${i}.png`
    await writeFile(join(work, path), await png({ r: i === 0 ? 255 : 0, g: i === 8 ? 255 : 0, b: 0 }, 20, 10))
    assets.push(path)
  }
  const geometry = { width: 137, height: 311, cells: Array.from({length: 9}, (_, i) => ({ member: `p${i}`, x: 5, y: i * 25, width: 40, height: 20 })) }
  const result = await composePanels({ create:true, assets, geometry, output: 'paper/groups/free.png', scale: 2 }, work, runCtx(work).signal)
  expect(result.members).toHaveLength(9)
  expect(result.layout.geometry).toMatchObject({ width: 40, height: 220 })
  const {data, info} = await sharp(join(work, result.output)).raw().toBuffer({resolveWithObject:true})
  expect([info.width, info.height]).toEqual([80, 440])
  const pixel = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3))
  expect(pixel(12, 2)).toEqual([255,0,0])
  expect(pixel(12,402)).toEqual([0,255,0])
  expect(pixel(12,45)).toEqual([255,255,255])
  const automatic = await composePanels({create:true, assets, output:'paper/groups/auto9.png'},work,runCtx(work).signal)
  expect(automatic.layout.geometry.cells).toHaveLength(9)
})

it('保存用文件摘要和图源摘要防止覆盖，失败保留原产物', async () => {
  const args = { assets:['paper/figures/panel-a.png'], output:'paper/groups/saved.png' }
  await composePanels({...args,create:true},work,runCtx(work).signal)
  const path = join(work,'paper/groups.json'), base = await groupsFileDigest(path)
  const input = sha256Hex(await readFile(join(work,args.assets[0]!)))
  const original = await readFile(join(work,args.output))
  await writeFile(path,(await readFile(path,'utf8'))+' ')
  await expect(composePanels({...args,base_digest:base},work,runCtx(work).signal)).rejects.toThrow(/已被修改/)
  await writeFile(join(work,args.assets[0]!),await png({r:0,g:0,b:0},40,20))
  await expect(composePanels({...args,base_digest:await groupsFileDigest(path), inputs:[{id:'panel-a',digest:input}]},work,runCtx(work).signal)).rejects.toThrow(/图源已变化/)
  expect(await readFile(join(work,args.output))).toEqual(original)
})

it('移出旧画布或负坐标的图片完整导出，非法几何不落盘；旧 gap/content 入参被忽略且不写回', async () => {
  const args = { assets:['paper/figures/panel-a.png'], output:'paper/groups/clip.png', geometry:{width:27,height:33,gap:0,cells:[{member:'panel-a',x:-10,y:-5,width:40,height:20,content:{x:0,y:0,width:1,height:1}}]} }
  const result = await composePanels({...args,create:true},work,runCtx(work).signal)
  // 默认 2 倍导出：40 参考单位 → 80 像素。
  expect((await sharp(join(work,result.output)).metadata()).width).toBe(80)
  expect(result.layout.geometry).toEqual({width:40,height:20,cells:[{member:'panel-a',x:0,y:0,width:40,height:20}]})
  const saved = JSON.parse(await readFile(join(work,'paper/groups.json'),'utf8')) as { groups: { layout: unknown }[] }
  expect(saved.groups[0]!.layout).toEqual(result.layout)
  const old = await readFile(join(work,result.output))
  await expect(composePanels({...args,geometry:{...args.geometry,width:NaN}},work,runCtx(work).signal)).rejects.toThrow(/宽高/)
  await expect(composePanels({...args,geometry:{...args.geometry,cells:[{...args.geometry.cells[0]!,member:'wrong'}]}},work,runCtx(work).signal)).rejects.toThrow(/成员/)
  expect(await readFile(join(work,result.output))).toEqual(old)
})
