import type { Context } from '@deepseek-ai/cordis'
import { apply as applyJournalClub, inject as journalClubInject } from './jcTab.ts'
import { registerCards } from './cards.ts'
import remoteContribution from '../../lib/typert.remote-client.js'

/**
 * Client side of the Journal Club plugin. The loader activates `apply` only
 * after the host's sidebar, slot and Remote services listed in `inject` are
 * ready; the host remains the owner of all filesystem writes.
 */
export const name = 'dsh-journal-club/client'

export const inject = [...journalClubInject, 'uiConversation']

export async function apply(ctx: Context): Promise<void> {
  const remote = (ctx as unknown as { remote: { $mount(contribution: unknown): Promise<() => void> } }).remote
  const unmount = await remote.$mount(remoteContribution)
  ctx.effect(() => unmount, 'journal-club: remote contribution')
  ctx.inject(['remote.journalClub'], scope => {
    applyJournalClub(scope)
    registerCards(scope)
  })
}
