import type { Context } from '@deepseek-ai/cordis'
import { apply as applyJournalClub, inject as journalClubInject } from './jcTab.ts'

/**
 * Client side of the Journal Club plugin. The loader activates `apply` only
 * after the host's sidebar, slot and Remote services listed in `inject` are
 * ready; the host remains the owner of all filesystem writes.
 */
export const name = 'dsh-journal-club/client'

export const inject = journalClubInject

export function apply(ctx: Context): void {
  applyJournalClub(ctx)
}
