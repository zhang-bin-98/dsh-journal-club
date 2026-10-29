import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyJsonPatch, figuresLockPath, updateFiguresFile } from '../src/figures/figuresStore.ts'
import { registerUpdateFigures } from '../src/tools/updateFigures.ts'

function fixtureFigures() {
  return {
    version: 1,
    status: 'draft',
    revision: 0,
    documents: [{ id: 'main', path: 'main.pdf', role: 'main', pages: 4 }],
    figures: [
      {
        id: 'fig1',
        label: 'Figure 1',
        status: 'pending',
        regions: [{ document: 'main', page: 2, bbox: [10, 20, 300, 400] }],
        caption: { page: 2, sentences: ['A caption.', 'Shared legend.'] },
        panels: [
          {
            id: 'fig1_A',
            label: 'A',
            region_index: 0,
            bbox: [20, 30, 100, 120],
            caption_refs: [0],
            flags: [],
            origin: 'auto',
          },
        ],
      },
    ],
  }
}

function captureTools(): { ctx: Context; defs: Map<string, ToolDefinition> } {
  const defs = new Map<string, ToolDefinition>()
  const ctx = { tools: { register: (definition: ToolDefinition) => defs.set(definition.name, definition) } } as unknown as Context
  return { ctx, defs }
}

function runCtx(cwd: string): ToolRunContext {
  return {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd } } },
  } as unknown as ToolRunContext
}

let work: string
let figuresPath: string
let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  work = await mkdtemp(join(tmpdir(), 'jc-update-figures-'))
  process.chdir(work)
  figuresPath = join(work, 'paper', 'figures.json')
  await mkdir(join(work, 'paper'), { recursive: true })
  await writeFile(figuresPath, `${JSON.stringify(fixtureFigures(), null, 2)}\n`, 'utf8')
})

afterEach(async () => {
  process.chdir(originalCwd)
  await rm(work, { recursive: true, force: true })
})

describe('figuresStore RFC6902 patch', () => {
  it('首次创建从空数组应用 patch，原子写入 revision 1 且不产生虚构快照', async () => {
    const path = join(work, 'new-paper', 'figures.json')
    const initial = fixtureFigures()
    const result = await updateFiguresFile(path, [
      { op: 'add', path: '/documents/-', value: initial.documents[0] },
      { op: 'add', path: '/figures/-', value: initial.figures[0] },
    ], 0)
    expect(result).toMatchObject({ ok: true, revision: 1, figures: { documents: initial.documents, figures: initial.figures } })
    expect(result.ok && result.historyPath).toBeUndefined()
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ ...initial, revision: 1 })
    expect(await readdir(join(work, 'new-paper'))).toEqual(['figures.json'])
    // The first later edit snapshots the real revision 1, not the virtual base.
    const edited = await updateFiguresFile(path, [{ op: 'replace', path: '/status', value: 'confirmed' }], 1)
    expect(edited.ok && edited.historyPath).toContain('.rev-000000000001-')
  })

  it('首次创建校验或 patch 失败不留主文件、快照或锁', async () => {
    const path = join(work, 'invalid-paper', 'figures.json')
    await expect(updateFiguresFile(path, [], 0)).rejects.toThrow(/documents/)
    await expect(updateFiguresFile(path, [{ op: 'replace', path: '/figures/0/status', value: 'viewed' }], 0)).rejects.toThrow()
    expect(await readdir(join(work, 'invalid-paper'))).toEqual([])
  })

  it('不存在的文件拒绝非零 base_rev', async () => {
    const path = join(work, 'wrong-base', 'figures.json')
    await expect(updateFiguresFile(path, [{ op: 'add', path: '', value: fixtureFigures() }], 1))
      .rejects.toThrow(/首次创建必须使用 base_rev=0/)
    expect(await readdir(join(work, 'wrong-base'))).toEqual([])
  })

  it('并发首次创建只有一个成功，另一个收到已落盘版本冲突', async () => {
    const path = join(work, 'concurrent-new', 'figures.json')
    const results = await Promise.all([
      updateFiguresFile(path, [{ op: 'add', path: '', value: fixtureFigures() }], 0),
      updateFiguresFile(path, [{ op: 'add', path: '', value: { ...fixtureFigures(), status: 'confirmed' } }], 0),
    ])
    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.filter(result => result.conflict)).toHaveLength(1)
    expect(results.find(result => result.conflict)).toMatchObject({ revision: 1, current: { revision: 1 } })
    expect(await readdir(join(work, 'concurrent-new'))).toEqual(['figures.json'])
  })

  it('update_figures 工具可首次创建且省略 history_path', async () => {
    const { ctx, defs } = captureTools()
    registerUpdateFigures(ctx)
    const result = await defs.get('update_figures')!.execute({
      figures_json: 'tool-new/figures.json',
      patch: [{ op: 'add', path: '', value: fixtureFigures() }],
      base_rev: 0,
    }, runCtx(work))
    expect(result).toMatchObject({ ok: true, revision: 1, figures_json: 'tool-new/figures.json' })
    expect(result).not.toHaveProperty('history_path')
  })

  it('支持 add/remove/replace/move/copy/test 与转义 JSON Pointer', () => {
    const input = { name: 'before', items: [1, 2], nested: { a: { 'x/y': 7 } } }
    const output = applyJsonPatch(input, [
      { op: 'add', path: '/items/-', value: 3 },
      { op: 'remove', path: '/items/0' },
      { op: 'replace', path: '/name', value: 'after' },
      { op: 'copy', from: '/nested/a', path: '/nested/b' },
      { op: 'move', from: '/nested/b', path: '/nested/c' },
      { op: 'test', path: '/nested/c/x~1y', value: 7 },
    ])
    expect(output).toEqual({ name: 'after', items: [2, 3], nested: { a: { 'x/y': 7 }, c: { 'x/y': 7 } } })
    expect(input.name).toBe('before')
  })

  it('revision 只由服务递增；拒绝任何非 test 操作触碰 revision', async () => {
    await expect(updateFiguresFile(figuresPath, [{ op: 'replace', path: '/revision', value: 50 }], 0))
      .rejects.toThrow(/不得直接修改 revision/)
    const result = await updateFiguresFile(figuresPath, [{ op: 'test', path: '/revision', value: 0 }], 0)
    expect(result).toMatchObject({ ok: true, revision: 1 })
    const saved = JSON.parse(await readFile(figuresPath, 'utf8'))
    expect(saved.revision).toBe(1)
  })

  it('base_rev 过期返回当前 revision，不应用 patch 或写快照', async () => {
    await updateFiguresFile(figuresPath, [{ op: 'replace', path: '/status', value: 'confirmed' }], 0)
    const before = await readFile(figuresPath, 'utf8')
    const result = await updateFiguresFile(figuresPath, [{ op: 'replace', path: '/status', value: 'draft' }], 0)
    expect(result).toMatchObject({ ok: false, conflict: true, revision: 1, current: { status: 'confirmed' } })
    expect(await readFile(figuresPath, 'utf8')).toBe(before)
    expect(await readdir(join(work, 'paper', '.history'))).toHaveLength(1)
  })

  it('同一 base_rev 并发写入仅一个成功，另一个获得 CAS 冲突', async () => {
    const results = await Promise.all([
      updateFiguresFile(figuresPath, [{ op: 'replace', path: '/figures/0/status', value: 'viewed' }], 0),
      updateFiguresFile(figuresPath, [{ op: 'replace', path: '/figures/0/status', value: 'adjusted' }], 0),
    ])
    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.filter(result => result.conflict)).toHaveLength(1)
    expect(JSON.parse(await readFile(figuresPath, 'utf8')).revision).toBe(1)
    expect(await readdir(join(work, 'paper', '.history'))).toHaveLength(1)
  })

  it('跨字段校验失败时主文件和快照都不改变', async () => {
    const before = await readFile(figuresPath, 'utf8')
    await expect(
      updateFiguresFile(
        figuresPath,
        [{ op: 'add', path: '/figures/0/panels/-', value: fixtureFigures().figures[0]!.panels[0] }],
        0,
      ),
    ).rejects.toThrow(/ID 重复/)
    expect(await readFile(figuresPath, 'utf8')).toBe(before)
    await expect(readdir(join(work, 'paper', '.history'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('snapshot 创建失败时原 figures.json 保持完整且锁被释放', async () => {
    const before = await readFile(figuresPath, 'utf8')
    await writeFile(join(work, 'paper', '.history'), 'not a directory', 'utf8')
    await expect(updateFiguresFile(figuresPath, [{ op: 'replace', path: '/status', value: 'confirmed' }], 0)).rejects.toThrow()
    expect(await readFile(figuresPath, 'utf8')).toBe(before)
    await expect(readFile(figuresLockPath(figuresPath), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('滚动快照最多保留最近 10 份', async () => {
    for (let index = 0; index < 11; index += 1) {
      const result = await updateFiguresFile(figuresPath, [{ op: 'test', path: '/version', value: 1 }], index)
      expect(result).toMatchObject({ ok: true, revision: index + 1 })
    }
    const snapshots = await readdir(join(work, 'paper', '.history'))
    expect(snapshots).toHaveLength(10)
    expect(snapshots.some(name => name.includes('.rev-000000000000-'))).toBe(false)
  })

  it('update_figures 工具按会话 cwd 解析路径并写回统一 revision', async () => {
    const { ctx, defs } = captureTools()
    registerUpdateFigures(ctx)
    const result = (await defs.get('update_figures')!.execute(
      {
        figures_json: 'paper/figures.json',
        patch: [{ op: 'replace', path: '/status', value: 'confirmed' }],
        base_rev: 0,
      },
      runCtx(work),
    )) as { ok: boolean; revision: number; figures_json: string; history_path: string }
    expect(result).toMatchObject({ ok: true, revision: 1, figures_json: 'paper/figures.json' })
    expect(result.history_path).toContain('paper/.history/')
  })
})
