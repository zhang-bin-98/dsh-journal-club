import type { Context } from '@deepseek-ai/cordis'
import { apply as applyJournalClub } from './jcTab.ts'

/**
 * Client side of the Journal Club plugin. The tab registers only after the
 * host's sidebar, slot and Remote services are ready; the host remains the
 * owner of all filesystem writes.
 */
export const name = 'dsh-journal-club/client'

export function apply(ctx: Context): void {
  applyJournalClub(ctx)
}
