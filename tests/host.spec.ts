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
})
