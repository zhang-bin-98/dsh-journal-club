import sharp from 'sharp'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JournalClubService } from '../lib/index.js'
import { PdfFile } from '../src/pdf/pdf.ts'
import { FIXTURES, fixturePath } from './fixtures.ts'

const tempRoot = resolve('out/host-tmp')
let temporary: string
let workspace: string
let service: JournalClubService
const signal = () => new AbortController().signal
const figures = () => ({
  version: 1, status: 'draft', revision: 0,
  documents: [{ id: 'main', path: 'main.pdf', role: 'main', pages: 1 }],
  figures: [],
})

beforeEach(async () => {
  await mkdir(tempRoot, { recursive: true })
  temporary = await mkdtemp(join(tempRoot, 'host-'))
  workspace = join(temporary, 'workspace')
  await mkdir(join(workspace, 'paper', 'nested'), { recursive: true })
  // Only the session registry is a test stand-in. Path checks, PDF parsing and
  // the shared atomic/CAS writer are the production implementations.
  service = Object.assign(Object.create(JournalClubService.prototype), {
    ctx: { sessions: { get: (id: string) => id === 'active' ? { header: { cwd: workspace } } : undefined } },
  }) as JournalClubService
})

afterEach(async () => {
  await rm(temporary, { recursive: true, force: true })
})

describe('Journal Club host boundary', () => {
  it('允许工作区内嵌套文件，拒绝相对和绝对越界', async () => {
    const nested = join(workspace, 'paper', 'nested', 'figures.json')
    await writeFile(nested, JSON.stringify(figures()))
    const outside = join(temporary, 'figures.json')
    await writeFile(outside, JSON.stringify(figures()))
    expect(await service.updateFigures('active', { figures_json: 'paper/nested/figures.json', base_rev: 0, patch: [] }, signal()))
      .toEqual({ ok: true, conflict: false, revision: 1 })
    await expect(service.updateFigures('active', { figures_json: '../figures.json', base_rev: 0, patch: [] }, signal())).rejects.toThrow(/路径超出/)
    await expect(service.updateFigures('active', { figures_json: outside, base_rev: 0, patch: [] }, signal())).rejects.toThrow(/路径超出/)
  })

  it('拒绝经目录链接访问工作区外文件', async () => {
    const outside = join(temporary, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'figures.json'), JSON.stringify(figures()))
    const link = join(workspace, 'escaped')
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(service.updateFigures('active', {
      figures_json: 'escaped/figures.json', base_rev: 0, patch: [{ op: 'replace', path: '/status', value: 'confirmed' }],
    }, signal())).rejects.toThrow(/路径超出/)
    expect(JSON.parse(await readFile(join(outside, 'figures.json'), 'utf8')).revision).toBe(0)
  })

  it('真实论文页尺寸正确，嵌套 PDF 的页图路径相对项目目录', async () => {
    const source = fixturePath(FIXTURES[0]!)
    const target = join(workspace, 'paper', 'nested', 'main.pdf')
    await copyFile(source, target)
    const info = await service.pageInfo('active', 'paper', 'nested/main.pdf', 1, signal())
    const pdf = await PdfFile.open(source)
    expect(info).toEqual({ ...await pdf.pageSize(1), path: 'nested/pages/main-001.png' })
    expect(info.width).toBeGreaterThan(300)
    expect(info.height).toBeGreaterThan(300)
    await expect(service.pageInfo('active', 'paper', 'nested/main.pdf', 0, signal())).rejects.toThrow(/页码越界/)
    await expect(service.pageInfo('missing', 'paper', 'nested/main.pdf', 1, signal())).rejects.toThrow(/会话未加载/)
  })

  it('缺失会话和错误目标名不触发写入', async () => {
    const path = join(workspace, 'paper', 'figures.json')
    const raw = JSON.stringify(figures())
    await writeFile(path, raw)
    const request = { figures_json: 'paper/figures.json', base_rev: 0, patch: [] }
    await expect(service.updateFigures('missing', request, signal())).rejects.toThrow(/会话未加载/)
    await expect(service.updateFigures('active', { ...request, figures_json: 'paper/jc.md' }, signal())).rejects.toThrow(/只能修改 figures.json/)
    expect(await readFile(path, 'utf8')).toBe(raw)
    expect(await readdir(join(workspace, 'paper'))).not.toContain('.history')
  })

  it('host 编辑复用真实写入服务：成功留快照，旧 revision 冲突不覆盖', async () => {
    const path = join(workspace, 'paper', 'figures.json')
    const raw = JSON.stringify(figures())
    await writeFile(path, raw)
    expect(await service.updateFigures('active', {
      figures_json: 'paper/figures.json', base_rev: 0,
      patch: [{ op: 'replace', path: '/status', value: 'confirmed' }],
    }, signal())).toEqual({ ok: true, conflict: false, revision: 1 })
    const current = await readFile(path, 'utf8')
    expect(JSON.parse(current)).toMatchObject({ status: 'confirmed', revision: 1 })
    const history = join(workspace, 'paper', '.history')
    const entries = await readdir(history)
    expect(entries).toHaveLength(1)
    expect(await readFile(join(history, entries[0]!), 'utf8')).toBe(raw)
    expect(await service.updateFigures('active', {
      figures_json: 'paper/figures.json', base_rev: 0,
      patch: [{ op: 'replace', path: '/status', value: 'draft' }],
    }, signal())).toEqual({ ok: false, conflict: true, revision: 1 })
    expect(await readFile(path, 'utf8')).toBe(current)
    expect(await readdir(history)).toEqual(entries)
  })

  it('工作台重裁走真实 crop：新资产登记 revision，改框后像素随框更新', async () => {
    await copyFile(fixturePath(FIXTURES[0]!), join(workspace, 'paper', 'main.pdf'))
    const path = join(workspace, 'paper', 'figures.json')
    await writeFile(path, JSON.stringify({
      ...figures(), revision: 4,
      documents: [{ id: 'main', path: 'main.pdf', role: 'main', pages: 30 }],
      figures: [{ id: 'fig1', status: 'pending', regions: [{ document: 'main', page: 2, bbox: [0, 0, 612, 792] }],
        panels: [{ id: 'fig1_A', label: 'A', region_index: 0, bbox: [40, 40, 300, 300], caption_refs: [], flags: [], origin: 'manual' }] }],
    }))
    const request = { figures_json: 'paper/figures.json', ids: ['fig1_A'] }
    expect(await service.cropPanels('active', request, signal())).toEqual({ base_revision: 4, revision: 5, cropped: ['fig1_A'], anomalies: [] })
    const asset = join(workspace, 'paper', 'figures', 'fig1_A.png')
    const first = await readFile(asset)
    // 工作台改框（同一写入服务），再重裁：已有 asset 只换像素、不推进 revision。
    await service.updateFigures('active', { figures_json: 'paper/figures.json', base_rev: 5, patch: [{ op: 'replace', path: '/figures/0/panels/0/bbox', value: [40, 40, 400, 300] }] }, signal())
    expect(await service.cropPanels('active', request, signal())).toEqual({ base_revision: 6, revision: 6, cropped: ['fig1_A'], anomalies: [] })
    const second = await readFile(asset)
    expect(second.equals(first)).toBe(false)
    // 宽度随新框变化（300 DPI：360pt → 1500px），即 agent 读取的图与当前框一致。
    expect(second.readUInt32BE(16)).toBe(1500)
  })

  it('重裁沿用 host 路径边界，不接受其他文件或空列表', async () => {
    await writeFile(join(temporary, 'figures.json'), JSON.stringify(figures()))
    await expect(service.cropPanels('active', { figures_json: '../figures.json', ids: ['a'] }, signal())).rejects.toThrow(/路径超出/)
    await expect(service.cropPanels('active', { figures_json: 'paper/jc.md', ids: ['a'] }, signal())).rejects.toThrow(/只能裁切 figures.json/)
    await expect(service.cropPanels('active', { figures_json: 'paper/figures.json', ids: [] }, signal())).rejects.toThrow(/至少指定一个 Panel/)
    await expect(service.cropPanels('missing', { figures_json: 'paper/figures.json', ids: ['a'] }, signal())).rejects.toThrow(/会话未加载/)
  })
})


it('自由拼图 Remote 载入真实图源、保存与恢复几何，拒绝过期版本和路径越界', async () => {
  const root=join(workspace,'paper')
  await mkdir(join(root,'figures'))
  await writeFile(join(root,'figures/a.png'),await sharp({create:{width:120,height:80,channels:4,background:'red'}}).png().toBuffer())
  await writeFile(join(root,'figures.json'),JSON.stringify({...figures(),figures:[{id:'f',regions:[{document:'main',page:1,bbox:[0,0,100,100]}],panels:[{id:'a',label:'A',region_index:0,bbox:[0,0,100,100],asset:'figures/a.png',caption_refs:[],flags:[],origin:'auto'}]}]}))
  const state=await service.compositionState('active','paper',signal())
  expect(state.assets[0]).toMatchObject({id:'a',width:120,height:80})
  const request={project:'paper',id:'free',base_digest:state.digest,inputs:state.assets.map(a=>({id:a.id,digest:a.digest})),geometry:{width:143,height:267,gap:0,cells:[{member:'a',x:3,y:20,width:120,height:80}]}}
  const saved=await service.saveComposition('active',{...request,create:true},signal())
  const restored=await service.compositionState('active','paper',signal())
  expect(saved.digest).toBe(restored.digest)
  expect(restored.groups[0]!.stale).toBe(false)
  const savedGeometry={...request.geometry,width:120,height:80,cells:[{...request.geometry.cells[0]!,x:0,y:0}]}
  expect(restored.groups[0]!.layout?.geometry).toEqual(savedGeometry)
  expect((await sharp(join(root,saved.asset)).metadata()).height).toBe(160)
  const beforeRefresh = await readFile(join(root,saved.asset))
  await writeFile(join(root,'figures/a.png'),await sharp({create:{width:80,height:120,channels:4,background:'blue'}}).png().toBuffer())
  const changed=await service.compositionState('active','paper',signal())
  expect(changed.groups[0]!.stale).toBe(true)
  expect(changed.groups[0]!.layout?.geometry).toEqual(savedGeometry)
  await expect(service.saveComposition('active',request,signal())).rejects.toThrow(/已被修改/)
  // Reading refreshed inputs does not render. Saving explicitly recomposes from new pixels.
  expect(await readFile(join(root,saved.asset))).toEqual(beforeRefresh)
  const rebuilt = await service.saveComposition('active',{...request,base_digest:changed.digest,geometry:savedGeometry,inputs:changed.assets.map(a=>({id:a.id,digest:a.digest}))},signal())
  expect(rebuilt.asset).toBe(saved.asset)
  const pixels = await sharp(join(root,rebuilt.asset)).raw().toBuffer({resolveWithObject:true})
  expect(Array.from(pixels.data.subarray(0,3))).toEqual([0,0,255])
  expect((await service.compositionState('active','paper',signal())).groups[0]!.stale).toBe(false)
  await expect(service.saveComposition('active',{...request,id:'../../escape'},signal())).rejects.toThrow()
  await expect(service.compositionState('active','../../outside',signal())).rejects.toThrow()
  // Deck order is derived on read, independently of manifest insertion order.
  const manifest=JSON.parse(await readFile(join(root,'groups.json'),'utf8'))
  for (const id of ['second','unused']) {
    await copyFile(join(root,saved.asset),join(root,`groups/${id}.png`))
    manifest.groups.push({...manifest.groups[0],id,asset:`groups/${id}.png`})
  }
  await writeFile(join(root,'groups.json'),JSON.stringify(manifest))
  await writeFile(join(root,'deck.md'),'![2](./groups/second.png)\n\n---\n\n![1](groups/free.png)\n![again](groups/second.png)')
  const ordered=await service.compositionState('active','paper',signal())
  expect(ordered.order).toEqual(['second','free'])
  expect(ordered.groups.map(g=>g.id)).toEqual(['free','second','unused'])
  await writeFile(join(root,'deck.md'),'![1](groups/free.png)')
  expect((await service.compositionState('active','paper',signal())).order).toEqual(['free'])
  await rm(join(root,'groups/free.png'))
  const deleted=await service.compositionState('active','paper',signal())
  expect(deleted.order).toEqual([])
  expect(deleted.groups.map(g=>g.id)).not.toContain('free')
  const renamed=JSON.parse(await readFile(join(root,'groups.json'),'utf8'))
  renamed.groups.find((g:{id:string})=>g.id==='second').id='stable'
  await writeFile(join(root,'groups.json'),JSON.stringify(renamed))
  const stable=await service.compositionState('active','paper',signal())
  const update={...request,id:'stable',base_digest:stable.digest,inputs:stable.assets.map(a=>({id:a.id,digest:a.digest}))}
  const preserved=await service.saveComposition('active',update,signal())
  expect(preserved.asset).toBe('groups/second.png')
  expect((await service.compositionState('active','paper',signal())).groups.find(g=>g.id==='stable')?.asset).toBe('groups/second.png')
  await expect(service.saveComposition('active',{...update,id:'unexpected-copy',base_digest:preserved.digest},signal())).rejects.toThrow('只有新建')
})
