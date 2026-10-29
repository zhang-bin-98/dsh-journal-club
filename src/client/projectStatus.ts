import type { FiguresJson } from '../figures/schema.ts'

export interface ProjectStep {
  readonly id: 'analysis' | 'figures' | 'outline' | 'deck'
  readonly label: string
  readonly produced: boolean
  readonly detail: string
}
export interface ProjectStatus {
  readonly title?: string
  readonly stageHint?: string
  readonly steps: readonly ProjectStep[]
  readonly confirmationNote: string
}

/** Artifact presence is an observation, never proof of completeness or confirmation. */
export function projectStatus(jcText: string | undefined, artifacts: readonly string[], figures?: { readonly revision: number; readonly status: FiguresJson['status']; readonly figures: readonly { readonly panels: readonly unknown[] }[] }): ProjectStatus {
  const frontmatter = jcText?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)?.[1]
  function field(name: string): string | undefined {
    const raw = frontmatter?.match(new RegExp(`^${name}:\\s*(.+)$`, 'mu'))?.[1]?.trim()
    if (!raw) return
    if (raw.startsWith('"')) { try { const value: unknown = JSON.parse(raw); return typeof value === 'string' ? value : undefined } catch { return } }
    if (raw.startsWith("'")) return raw.endsWith("'") ? raw.slice(1, -1).replaceAll("''", "'") : undefined
    return raw.replace(/\s+#.*$/u, '').trim() || undefined
  }
  const has = (name: string) => artifacts.includes(name)
  const panelCount = figures?.figures.reduce((sum, figure) => sum + figure.panels.length, 0) ?? 0
  return {
    title: field('title'),
    stageHint: field('stage'),
    steps: [
      { id: 'analysis', label: '论文分析', produced: has('analysis.md'), detail: has('analysis.md') ? 'analysis.md 已产出；内容完整性待核对' : '尚未发现 analysis.md' },
      { id: 'figures', label: '图源核对', produced: has('figures.json'), detail: figures ? `${figures.figures.length} Figure · ${panelCount} Panel · revision ${figures.revision} · ${figures.status === 'confirmed' ? '文件标记已定稿' : '草稿'}` : has('figures.json') ? 'figures.json 已存在；内容尚未读取或无法解析' : '尚未发现 figures.json' },
      { id: 'outline', label: '叙事大纲', produced: has('outline.md'), detail: has('outline.md') ? 'outline.md 已产出' : '尚未发现 outline.md' },
      { id: 'deck', label: '幻灯片分页', produced: has('deck.md'), detail: has('deck.md') ? `deck.md 已产出${has('groups.json') ? '，含图组清单' : ''}` : '尚未发现 deck.md' },
    ],
    confirmationNote: '文件存在不代表内容完整或已确认；确认记录与当前版本是否一致，待对话核对。',
  }
}
