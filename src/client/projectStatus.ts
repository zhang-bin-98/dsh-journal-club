import type { FiguresJson } from '../figures/schema.ts'
import type { ProjectOverview } from '../types.ts'

interface OverviewFocus {
  title: string
  detail: string
  warning?: boolean
  action?: {label: string; view?: 'figures' | 'compose'; path?: string}
}

/** Presentation only: derive one next action from file observations, never persist progress. */
export function overviewFocus(status: ProjectStatus, overview: ProjectOverview | undefined, fullProject: boolean, figuresReady: boolean, canCompose: boolean, error?: string): OverviewFocus {
  const resume = {label: '在对话中继续'}
  if (error) return {title: '项目状态暂未更新', detail: error, warning: true}
  if (!overview) return {title: '正在读取项目', detail: '正在核对现有文件与确认记录。'}
  if (overview.warning) return {title: '项目记录需要核对', detail: overview.warning, warning: true, action: fullProject ? resume : figuresReady ? {label: '打开图源核对', view: 'figures'} : canCompose ? {label: '打开自由拼图', view: 'compose'} : undefined}
  if (!fullProject) return {
    title: overview.artifacts.includes('groups.json') ? '继续调整拼图' : '继续核对图源',
    detail: '独立使用现有图源与拼图，无需补齐论文汇报流程。',
    action: overview.artifacts.includes('groups.json') && canCompose ? {label: '打开自由拼图', view: 'compose'} : figuresReady ? {label: '打开图源核对', view: 'figures'} : undefined,
  }
  const stale = status.steps.find(step => step.id !== 'analysis' && overview.confirmations?.[step.id] === 'stale')
  if (stale) return {title: `${stale.label}需要重新核对`, detail: '来源已变化，之前的确认不再对应当前版本。已有演示稿也需要重新核验。', warning: true, action: stale.id === 'figures' && figuresReady ? {label: '去图源核对', view: 'figures'} : resume}
  const next = status.steps.find(step => !step.produced || (step.id !== 'analysis' && overview.confirmations?.[step.id] !== 'confirmed'))
  if (next) return {
    title: next.produced ? `${next.label}待确认` : `下一步：${next.label}`,
    detail: next.produced ? '已有产物；核对内容后，在对话中确认并继续。' : next.detail,
    action: next.id === 'figures' && figuresReady ? {label: '去图源核对', view: 'figures'} : resume,
  }
  const pptx = overview.artifacts.find(path => /\.pptx$/iu.test(path))
  return pptx ? {title: '已有演示稿，可打开检查', detail: '当前内容确认有效；演示稿是否与最新内容一致、排版是否合适，仍需检查。', action: {label: '打开演示稿', path: pptx}}
    : {title: '内容已确认，可以继续渲染', detail: '图源、大纲与幻灯片内容的确认均对应当前版本。', action: resume}
}

export interface ProjectStep {
  readonly id: 'analysis' | 'figures' | 'outline' | 'slides'
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
      { id: 'slides', label: '幻灯片分页', produced: has('slides.md'), detail: has('slides.md') ? `slides.md 已产出${has('groups.json') ? '，含图组清单' : ''}` : '尚未发现 slides.md' },
    ],
    confirmationNote: '文件存在不代表内容完整或已确认；确认记录与当前版本是否一致，待对话核对。',
  }
}
