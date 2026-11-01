export type WorkbenchView = 'overview' | 'figures' | 'compose'
export interface BrowseLocation { view?: WorkbenchView; figure?: string; panel?: string; group?: string }
interface SessionLocation { project?: string; locations: Record<string, BrowseLocation> }
export const isWorkbenchView = (v: unknown): v is WorkbenchView => v === 'overview' || v === 'figures' || v === 'compose'
const key = (session: string) => `journal-club.browse.v1.${session}`

/** Only browsing preferences live here. Project data and unsaved drafts never enter storage. */
export function readBrowseLocation(session: string): SessionLocation {
  try {
    const value = JSON.parse(localStorage.getItem(key(session)) ?? '{}') as SessionLocation
    const locations: Record<string, BrowseLocation> = Object.create(null)
    for (const [path, item] of Object.entries(value.locations ?? {})) {
      if (!item || typeof item !== 'object') continue
      locations[path] = {
        view: isWorkbenchView(item.view) ? item.view : undefined,
        figure: typeof item.figure === 'string' ? item.figure : undefined,
        panel: typeof item.panel === 'string' ? item.panel : undefined,
        group: typeof item.group === 'string' ? item.group : undefined,
      }
    }
    return { project: typeof value.project === 'string' ? value.project : undefined, locations }
  } catch { return { locations: Object.create(null) } }
}
export function rememberBrowseLocation(session: string, project: string, update: BrowseLocation = {}): void {
  const saved = readBrowseLocation(session)
  saved.project = project
  saved.locations[project] = { ...saved.locations[project], ...update }
  try { localStorage.setItem(key(session), JSON.stringify(saved)) } catch { /* Browsing still works when storage is unavailable. */ }
}
