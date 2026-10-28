import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** 真实论文 fixture：3 篇 arXiv q-bio 开放获取研究论文（M1 验收基线）。 */
export interface Fixture {
  id: string
  file: string
  title: string
}

export const FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'papers')

export const FIXTURES: Fixture[] = [
  {
    id: 'senescent-immune',
    file: '2605.13902.pdf',
    title: 'A senescent-immune reserve niche hypothesis for incomplete lobular involution in the aging breast',
  },
  {
    id: 'spatial-atlas',
    file: '2510.07653.pdf',
    title: 'Large-scale spatial variable gene atlas for spatial transcriptomics',
  },
  {
    id: 'cancer-immunity',
    file: '2601.17669.pdf',
    title: 'Quantitative cancer-immunity cycle modeling to optimize bevacizumab and atezolizumab combination therapy',
  },
]

export function fixturePath(fixture: Fixture): string {
  const p = join(FIXTURES_DIR, fixture.file)
  if (!existsSync(p)) {
    throw new Error(`fixture 缺失：${p}（tests/fixtures/papers/README.md 有下载说明）`)
  }
  return p
}
