import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { validateProject } from '../src/validate/project.ts'
import { isSourceLineValid, panelMentionTokens } from '../src/validate/markdown.ts'

async function project(deck: string, groups = true) {
  const dir = await mkdtemp(join(tmpdir(), 'jc-validate-'))
  await mkdir(join(dir, 'figures'), { recursive: true })
  await writeFile(join(dir, 'figures', 'fig1_A.png'), Buffer.from('asset'))
  await writeFile(join(dir, 'figures.json'), JSON.stringify({
    version: 1, status: 'draft', revision: 2,
    documents: [{ id: 'main', path: 'main.pdf', role: 'main', pages: 3 }],
    figures: [{ id: 'fig1', label: 'Figure 1', status: 'viewed', regions: [{ document: 'main', page: 1, bbox: [0, 0, 100, 100] }], caption: { page: 1, sentences: ['caption'] }, panels: [{ id: 'fig1_A', label: 'A', region_index: 0, bbox: [10, 10, 50, 50], asset: 'figures/fig1_A.png', caption_refs: [0], flags: [], origin: 'auto' }] }],
  }, null, 2))
  if (groups) await writeFile(join(dir, 'groups.json'), JSON.stringify({ version: 1, groups: [] }))
  await writeFile(join(dir, 'deck.md'), deck)
  return dir
}

const validDeck = `---\nfigures_revision: 2\n---\n\n<!-- page 1 · layout: figure-text -->\n\n# Result\n\n![Figure 1A](figures/fig1_A.png)\n> 来源：Figure 1A · p.1\n\n> 🗣 **讲稿**：这一页讲 Figure 1A。\n`

describe('validate', () => {
  it('补充图 S 编号来源可通过校验，讲稿不混淆正文图号', async () => {
    const deck = validDeck.replaceAll('Figure 1A', 'Supplementary Figure S9A')
    const dir = await project(deck)
    try {
      const report = await validateProject(dir)
      expect(report.errors).toEqual([])
      expect(report.warnings).toEqual([])
      expect(panelMentionTokens('Supplementary Figure S9A、Fig. s9B–C、Figure 9A'))
        .toEqual(expect.arrayContaining(['Figure S9A', 'Figure S9B–C', 'Figure S9', 'Figure 9A', 'Figure 9']))
      const mismatch = await project(deck.replace('这一页讲 Supplementary Figure S9A', '这一页讲 Figure 9A'))
      try {
        expect((await validateProject(mismatch)).warnings.map(item => item.code)).toContain('SPEECH_IMAGE_MISMATCH')
      } finally { await rm(mismatch, { recursive: true, force: true }) }
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('补充图来源仍要求合法编号和物理页码', () => {
    expect(isSourceLineValid('> 来源：Figure S9 · p.27 · 补充材料')).toBe(true)
    expect(isSourceLineValid('> 来源：Supplementary Figure S9A–C · p.27')).toBe(true)
    expect(isSourceLineValid('> 来源：Supplementary Figure S · p.27')).toBe(false)
    expect(isSourceLineValid('> 来源：Supplementary Figure S9')).toBe(false)
    expect(isSourceLineValid('> 来源：Supplementary Figure S9 · p.?')).toBe(false)
  })

  it('合法项目无 errors', async () => {
    const dir = await project(validDeck)
    try {
      const report = await validateProject(dir)
      expect(report.errors).toEqual([])
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('缺少讲稿、来源和页头会报 error', async () => {
    const dir = await project('# Bad\n\n![bad](figures/nope.png)\n')
    try {
      const report = await validateProject(dir)
      expect(report.errors.map(item => item.code)).toEqual(expect.arrayContaining(['PAGE_HEADER_MISSING', 'SPEECH_MISSING', 'PANEL_MISSING', 'SOURCE_INVALID']))
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('旧 revision 和 panel 未引用是 warning', async () => {
    const dir = await project(validDeck.replace('figures_revision: 2', 'figures_revision: 1'))
    try {
      const report = await validateProject(dir)
      expect(report.warnings.map(item => item.code)).toContain('FIGURES_REVISION_STALE')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('展开图组成员并对 stale inputs_digest 给 warning', async () => {
    const dir = await project(`---\nfigures_revision: 2\n---\n\n<!-- page 1 · layout: figure-text -->\n\n![Figure 1A](groups/fig1_group.png)\n> 来源：Figure 1A · p.1\n\n> 🗣 **讲稿**：Figure 1A。\n`)
    try {
      await mkdir(join(dir, 'groups'), { recursive: true })
      await writeFile(join(dir, 'groups', 'fig1_group.png'), Buffer.from('group'))
      await writeFile(join(dir, 'groups.json'), JSON.stringify({ version: 1, groups: [{ id: 'fig1_group', asset: 'groups/fig1_group.png', members: ['fig1_A'], inputs_digest: 'sha256:stale', layout: { kind: 'grid', geometry: 'test' } }] }))
      const report = await validateProject(dir)
      expect(report.errors).toEqual([])
      expect(report.warnings.map(item => item.code)).toContain('GROUP_DIGEST_STALE')
      expect(report.warnings.map(item => item.code)).not.toContain('PANEL_UNREFERENCED')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('拒绝项目目录外的图组资产路径', async () => {
    const dir = await project(`---\nfigures_revision: 2\n---\n\n<!-- page 1 · layout: figure-text -->\n\n![Figure 1A](groups/escape.png)\n> 来源：Figure 1A · p.1\n\n> 🗣 **讲稿**：Figure 1A。\n`)
    try {
      await writeFile(join(dir, 'groups.json'), JSON.stringify({ version: 1, groups: [{ id: 'escape', asset: '../outside.png', members: ['fig1_A'], inputs_digest: 'sha256:x' }] }))
      const report = await validateProject(dir)
      expect(report.errors.map(item => item.code)).toContain('ASSET_PATH_ESCAPE')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('同页图片来源逐行绑定，不借用后续图片的来源行', async () => {
    const dir = await project(`---\nfigures_revision: 2\n---\n\n<!-- page 1 · layout: two-figures -->\n\n![Figure 1A](figures/fig1_A.png)\n\n![Figure 1B](figures/missing.png)\n> 来源：Figure 1B · p.1\n\n> 🗣 **讲稿**：Figure 1A 和 Figure 1B。\n`)
    try {
      const report = await validateProject(dir)
      expect(report.errors.filter(item => item.code === 'SOURCE_INVALID')).toHaveLength(1)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('损坏 groups 条目返回 GROUPS_INVALID，不抛异常', async () => {
    const dir = await project(validDeck)
    try {
      await writeFile(join(dir, 'groups.json'), JSON.stringify({ version: 1, groups: [null] }))
      const report = await validateProject(dir)
      expect(report.errors.map(item => item.code)).toContain('GROUPS_INVALID')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('讲稿缺失但 figures 存在时仍返回结构化报告', async () => {
    const dir = await project('<!-- page 1 -->\n\n# Text\n')
    try {
      const report = await validateProject(dir)
      expect(report.errors.some(item => item.code === 'SPEECH_MISSING')).toBe(true)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
