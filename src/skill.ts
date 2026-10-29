import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

type SkillRuntime = Context & {
  readonly skills?: {
    register(definition: {
      name: string
      description: string
      source: string
      content: string
      invocation: { modelInvocable: boolean; userInvocable: boolean }
    }): () => void
  }
}

/** Packaged path: `files` ships src/skills/journal-club/SKILL.md; resolves from both src/ and lib/. */
const SKILL_URL = new URL('../src/skills/journal-club/SKILL.md', import.meta.url)

export interface ParsedSkill {
  readonly name: string
  readonly description: string
  readonly content: string
}

/** Split YAML frontmatter (name/description) from the skill body. */
export function parseSkillFile(raw: string): ParsedSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (match?.[1] === undefined) throw new Error('journal-club: SKILL.md has no YAML frontmatter')
  const field = (key: string): string | undefined =>
    new RegExp(`^${key}:\\s*(.+)$`, 'mu').exec(match[1] ?? '')?.[1]?.trim()
  const name = field('name')
  const description = field('description')
  if (name === undefined || description === undefined || description.length === 0) {
    throw new Error('journal-club: SKILL.md frontmatter needs name and description')
  }
  return { name, description, content: raw.slice(match[0].length).trim() }
}

export function readJournalClubSkill(): ParsedSkill {
  return parseSkillFile(readFileSync(SKILL_URL, 'utf8'))
}

/** 将随包的 journal-club SKILL.md 注册到已挂载的 dsh runtime skill registry。 */
export function registerJournalClubSkill(ctx: Context): void {
  // 仅 skill 注册等待 skills 服务；host 工具注册不因此阻塞。
  ctx.inject(['skills'], (scope) => {
    const runtime = scope as SkillRuntime
    if (runtime.skills === undefined) return
    const skill = readJournalClubSkill()
    runtime.skills.register({
      name: skill.name,
      description: skill.description,
      source: 'bundled',
      content: `Skill directory: ${fileURLToPath(new URL('.', SKILL_URL))}\nProject helper: ${fileURLToPath(new URL('../lib/project.js', import.meta.url))}\n\n${skill.content}`,
      invocation: { modelInvocable: true, userInvocable: true },
    })
  })
}
