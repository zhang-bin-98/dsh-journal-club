import * as fs from 'node:fs/promises'
import { vi } from 'vitest'
vi.mock('node:fs/promises', async importOriginal => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return {...actual, readFile: vi.fn(actual.readFile)} })
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { validateProject } from '../src/validate/project.ts'

async function project(slides: string, groups = true) {
  const dir = await mkdtemp(join(tmpdir(), 'jc-validate-'))
  await mkdir(join(dir, 'figures'), { recursive: true })
  await writeFile(join(dir, 'figures', 'fig1_A.png'), Buffer.from('asset'))
  await writeFile(join(dir, 'figures.json'), JSON.stringify({
    version: 1, status: 'draft', revision: 2,
    documents: [{ id: 'main', path: 'main.pdf', role: 'main', pages: 3 }],
    figures: [{ id: 'fig1', label: 'Figure 1', status: 'viewed', regions: [{ document: 'main', page: 1, bbox: [0, 0, 100, 100] }], caption: { page: 1, sentences: ['caption'] }, panels: [{ id: 'fig1_A', label: 'A', region_index: 0, bbox: [10, 10, 50, 50], asset: 'figures/fig1_A.png', caption_refs: [0], flags: [], origin: 'auto' }] }],
  }, null, 2))
  if (groups) await writeFile(join(dir, 'groups.json'), JSON.stringify({ version: 1, groups: [] }))
  await writeFile(join(dir, 'slides.md'), slides)
  return dir
}

const validSlides = `---\nfigures_revision: 2\n---\n\n<!-- page 1 · layout: figure-text -->\n\n# Result\n\n![Figure 1A](figures/fig1_A.png)\n> 来源：Figure 1A · p.1\n\n> 🗣 **讲稿**：这一页讲 Figure 1A。\n`

it('图源路径无效时校验不读取项目外文件', async () => {
  const dir = await project(validSlides.replace('figures/fig1_A.png', 'groups/g.png'))
  const spy = vi.mocked(fs.readFile)
  try {
    const json = JSON.parse(await readFile(join(dir, 'figures.json'), 'utf8'))
    json.figures[0].panels[0].asset = '../outside.png'
    await writeFile(join(dir, 'figures.json'), JSON.stringify(json))
    await writeFile(join(dir, 'groups.json'), JSON.stringify({version:1, groups:[{id:'g',asset:'groups/g.png',members:['fig1_A'],inputs_digest:'sha256:old'}]}))
    spy.mockClear()
    const report = await validateProject(dir)
    expect(report.errors.some(e => e.code === 'FIGURES_INVALID')).toBe(true)
    expect(spy.mock.calls.map(c => String(c[0]))).not.toContain(join(dir, '..', 'outside.png'))
  } finally { spy.mockRestore(); await rm(dir, {recursive:true,force:true}) }
})
