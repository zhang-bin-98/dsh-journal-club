import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'

type SkillRuntime = Context & {
  readonly skills?: {
    register(definition: {
      name: string
      description: string
      source: string
      content: string
      invocation: { modelInvocable: boolean; userInvocable: boolean }
    }): unknown
  }
  readonly logger?: (label: string) => { readonly error?: (value: unknown) => void }
}

/** 将随包的 journal-club SKILL.md 注册到已挂载的 dsh runtime skill registry。 */
export function registerJournalClubSkill(ctx: Context): void {
  // 仅 skill 注册等待 skills 服务；host 工具注册不因此阻塞。
  ctx.inject(['skills'], (scope) => {
    const runtime = scope as SkillRuntime
    if (runtime.skills === undefined) return
    void readFile(new URL('./skills/journal-club/SKILL.md', import.meta.url), 'utf8').then(content => {
      runtime.skills?.register({
        name: 'journal-club',
        description: 'Prepare, validate, recover, and present a biomedical Journal Club project from paper files.',
        source: 'bundled',
        content,
        invocation: { modelInvocable: true, userInvocable: true },
      })
    }).catch(error => {
      runtime.logger?.('journal-club').error?.(error)
    })
  })
}
