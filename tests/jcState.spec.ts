import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { parseFiguresJson, validateFiguresJson } from '../src/figures/figuresJson.ts'
import { isSourceLineValid, parseDeck } from '../src/validate/markdown.ts'
import {
  createJcFile,
  createJcMarkdown,
  createJcState,
  digestText,
  parseJcMarkdown,
  readJcFile,
  serializeJcMarkdown,
  summarizeConfirmations,
  summarizeProjectConfirmations,
  updateJcFile,
  updateJcMarkdown,
  updateJcState,
} from '../src/project/jcState.ts'

const at = '2026-10-28T12:00:00.000Z'
const outline = '# Outline\n\n- Finding one\n'
const deck = '---\ntitle: Deck\n---\n\n<!-- page 1 · layout: text -->\n\n# Result\n\n> 🗣 **讲稿**：Result.\n'
const groups = '{"version":1,"groups":[]}\n'

function baseState() {
  return createJcState({
    title: '联合治疗克服耐药',
    main_paper: 'main.pdf',
    supplement: 'supplement.pdf',
    figures_revision: 3,
    requirements: '15 分钟，重点临床结果',
    updated: '2026-10-28',
    notes: '# 项目备注\n\n保留自由备注。',
  })
}

describe('jc state and confirmation contract', () => {
  it('随 skill 的项目示例符合实际文件解析契约', async () => {
    const reference = await readFile(new URL('../src/skills/journal-club/references/formats.md', import.meta.url), 'utf8')
    const markdown = [...reference.matchAll(/```markdown\n([\s\S]*?)\n```/gu)].map(match => match[1]!)
    const json = [...reference.matchAll(/```json\n([\s\S]*?)\n```/gu)].map(match => match[1]!)
    expect(parseJcMarkdown(markdown[0]!)).toMatchObject({ stage: 'analysis', confirmations: {} })
    const figures = validateFiguresJson(parseFiguresJson(json[0]!, 'skill example'))
    expect(figures.figures[0]?.panels[0]?.id).toBe('fig1_whole')
    expect(JSON.parse(json[1]!)).toEqual({ version: 1, groups: [] })
    const deck = parseDeck(markdown[2]!)
    expect(deck.pages).toHaveLength(1)
    expect(deck.pages[0]?.declaredPage).toBe(1)
    expect(deck.pages[0]?.speech).toContain('讲稿')
    expect(isSourceLineValid(deck.pages[0]!.images[0]!.sourceLine!)).toBe(true)
    expect(deck.pages[0]!.images[0]!.path).toBe(`figures/${figures.figures[0]!.panels[0]!.id}.png`)
  })
  it('创建、序列化、解析 jc.md，并保留正文备注', () => {
    const raw = createJcMarkdown({
      title: '联合治疗克服耐药',
      main_paper: 'main.pdf',
      stage: 'figure-review',
      figures_revision: 3,
      requirements: '15 分钟，重点临床结果',
      updated: '2026-10-28',
      notes: '# 项目备注\n\n保留自由备注。',
    })
    const parsed = parseJcMarkdown(raw)
    expect(parsed).toMatchObject({
      title: '联合治疗克服耐药',
      main_paper: 'main.pdf',
      stage: 'figure-review',
      figures_revision: 3,
      requirements: '15 分钟，重点临床结果',
      notes: '# 项目备注\n\n保留自由备注。',
    })
    expect(raw).toContain('confirmations:\n')
    expect(serializeJcMarkdown(parsed)).toBe(raw)
  })

  it('支持确认记录的内联对象格式并拒绝损坏摘要', () => {
    const state = updateJcState(baseState(), {
      confirmations: {
        figures: { revision: 3, at },
        outline: { digest: digestText(outline), at },
        deck: { digest: digestText(deck), groups_digest: digestText(groups), at },
      },
    })
    const parsed = parseJcMarkdown(serializeJcMarkdown(state))
    expect(parsed.confirmations).toEqual(state.confirmations)
    expect(() => parseJcMarkdown(serializeJcMarkdown(state).replace('sha256:', 'sha256:bad'))).toThrow(/digest/iu)
  })

  it('更新 markdown/state 时可清除确认且不丢失其他字段', () => {
    const initial = updateJcState(baseState(), {
      stage: 'outline',
      confirmations: { figures: { revision: 3, at } },
    })
    const updated = updateJcState(initial, {
      requirements: '只讲主要终点',
      clear_confirmations: ['figures'],
      confirmations: { outline: { digest: digestText(outline), at } },
      now: new Date('2026-10-29T01:02:03.000Z'),
    })
    expect(updated.stage).toBe('outline')
    expect(updated.requirements).toBe('只讲主要终点')
    expect(updated.updated).toBe('2026-10-29')
    expect(updated.confirmations.figures).toBeUndefined()
    expect(updated.confirmations.outline?.digest).toBe(digestText(outline))
    const raw = updateJcMarkdown(serializeJcMarkdown(initial), { stage: 'deck' })
    expect(parseJcMarkdown(raw).stage).toBe('deck')
  })

  it('读取文档中的未加引号时间、摘要和带逗号的字符串', () => {
    const raw = createJcMarkdown(baseState()).replace('confirmations:', [
      'confirmations:',
      '  figures: { revision: 3, at: 2026-10-26T14:00 }',
      `  outline: { digest: ${digestText(outline)}, at: 2026-10-26T14:00:00+08:00 }`,
      `  deck: { digest: ${digestText(deck)}, groups_digest: ${digestText(groups)}, at: "2026-10-26T14:00, reviewed" }`,
    ].join('\n'))
    expect(parseJcMarkdown(raw).confirmations).toEqual({
      figures: { revision: 3, at: '2026-10-26T14:00' },
      outline: { digest: digestText(outline), at: '2026-10-26T14:00:00+08:00' },
      deck: { digest: digestText(deck), groups_digest: digestText(groups), at: '2026-10-26T14:00, reviewed' },
    })
  })

  it('确认摘要区分 missing、confirmed 和 stale', () => {
    const state = updateJcState(baseState(), {
      confirmations: {
        figures: { revision: 3, at },
        outline: { digest: digestText(outline), at },
        deck: { digest: digestText(deck), groups_digest: digestText(groups), at },
      },
    })
    const current = {
      figures: { revision: 3 },
      outline: { digest: digestText(outline) },
      deck: { digest: digestText(deck + 'changed'), groups_digest: digestText(groups) },
    }
    const summary = summarizeConfirmations(state, current)
    expect(summary.figures).toMatchObject({ status: 'confirmed', valid: true })
    expect(summary.outline).toMatchObject({ status: 'confirmed', valid: true })
    expect(summary.deck).toMatchObject({ status: 'stale', valid: false })
    expect(summarizeConfirmations(baseState(), current).figures.status).toBe('missing')
  })

  it('项目摘要从实际文件计算，文件或 revision 变化会使确认失效', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jc-state-'))
    try {
      await mkdir(join(dir, 'parse'), { recursive: true })
      await writeFile(join(dir, 'figures.json'), JSON.stringify({ version: 1, revision: 3 }))
      await writeFile(join(dir, 'outline.md'), outline)
      await writeFile(join(dir, 'deck.md'), deck)
      await writeFile(join(dir, 'groups.json'), groups)
      const state = updateJcState(baseState(), {
        confirmations: {
          figures: { revision: 3, at },
          outline: { digest: digestText(outline), at },
          deck: { digest: digestText(deck), groups_digest: digestText(groups), at },
        },
      })
      await createJcFile(join(dir, 'jc.md'), state)
      expect((await summarizeProjectConfirmations(dir)).figures.status).toBe('confirmed')
      await writeFile(join(dir, 'figures.json'), JSON.stringify({ version: 1, revision: 4 }))
      await writeFile(join(dir, 'outline.md'), `${outline}changed\n`)
      expect((await summarizeProjectConfirmations(dir)).figures.status).toBe('stale')
      expect((await summarizeProjectConfirmations(dir)).outline.status).toBe('stale')
      expect((await summarizeProjectConfirmations(dir)).deck.status).toBe('confirmed')
      const loaded = await readJcFile(join(dir, 'jc.md'))
      expect(loaded.confirmations.deck?.groups_digest).toBe(digestText(groups))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('文件更新写入后保持可读，并且不覆盖已有目标创建', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jc-state-write-'))
    try {
      const path = join(dir, 'nested', 'jc.md')
      await createJcFile(path, baseState())
      await updateJcFile(path, { stage: 'figure-review', figures_revision: 4 })
      expect((await readJcFile(path)).stage).toBe('figure-review')
      expect((await readFile(path, 'utf8'))).toContain('figures_revision: 4')
      await expect(createJcFile(path, baseState())).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
