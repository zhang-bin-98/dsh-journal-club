import type { Context } from '@deepseek-ai/cordis'
import { registerCrop } from './tools/crop.ts'
import { registerComposePanels } from './tools/composePanels.ts'
import { registerRenderPages } from './tools/renderPages.ts'
import { registerUpdateFigures } from './tools/updateFigures.ts'
import { registerValidate } from './tools/validate.ts'
import { registerJournalClubSkill } from './skill.ts'

/**
 * Host tools: render_pages, crop, compose_panels, update_figures, validate.
 * journal-club skill is registered when the host skill registry is mounted.
 */
export const name = 'dsh-journal-club'
export const inject = ['tools']

export function apply(ctx: Context): void {
  registerJournalClubSkill(ctx)
  registerRenderPages(ctx)
  registerCrop(ctx)
  registerComposePanels(ctx)
  registerUpdateFigures(ctx)
  registerValidate(ctx)
}
