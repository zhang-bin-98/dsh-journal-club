export interface CardMarker {
  readonly project: string
  readonly stage: 'figures' | 'outline' | 'deck'
}

/** Display-only markers: fixed stages and a workspace-relative folder, never executable text. */
export function parseCardMarker(text: string): CardMarker | undefined {
  const matches = [...text.matchAll(/<!--\s*jc-card\s+(\{[^\r\n]*?\})\s*-->/gu)]
  if (matches.length !== 1 || matches[0]![1]!.length > 2048) return
  try {
    const value: unknown = JSON.parse(matches[0]![1]!)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const record = value as Record<string, unknown>
    if (Object.keys(record).sort().join(',') !== 'project,stage') return
    if (record.stage !== 'figures' && record.stage !== 'outline' && record.stage !== 'deck') return
    if (typeof record.project !== 'string' || record.project.length > 512 || /[\u0000-\u001f\u007f:"<>|?*]/u.test(record.project)) return
    const project = record.project.replaceAll('\\', '/').replace(/\/$/u, '')
    if (project.startsWith('/') || project.split('/').some(part => part === '..' || part === '.')) return
    return { project, stage: record.stage }
  } catch { return }
}

export function fileResourceAddress(sessionId: string, path: string): string {
  const encode = (part: string) => encodeURIComponent(part).replace(/%3A/giu, ':')
  const normalized = path.replaceAll('\\', '/').replace(/^(?:\.\/)+/u, '')
  return `dsh-resource://file/session/${encode(sessionId)}/${normalized.split('/').map(encode).join('/')}`
}

export function cardConfirmation(marker: CardMarker): string {
  return `/jc confirm ${marker.stage}\n项目目录：${JSON.stringify(marker.project || '.')}`
}

interface AssistantEvent {
  readonly type: string
  readonly seq: number
  readonly surfaceOp?: string
  readonly data?: { readonly message?: { readonly content?: readonly { readonly type: string; readonly text?: string }[] } }
}
interface CardState extends CardMarker { readonly seq: number }
interface Match { readonly event: AssistantEvent; readonly location?: unknown }
interface CardContext {
  readonly key: string
  readonly id: string
  readonly state?: CardState
  readonly start?: Match
  readonly matches: readonly Match[]
}

function markerFromEvent(event: AssistantEvent): CardMarker | undefined {
  if (event.type !== 'assistant/message' || event.surfaceOp !== 'append') return
  const content = event.data?.message?.content
  if (!Array.isArray(content)) return
  return parseCardMarker(content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n'))
}

/** Mirrors the host's event Definition contract; adds a node without claiming the assistant message. */
export const cardDefinition = {
  kind: 'journal-club-card',
  target: 'chat',
  match: {
    'assistant/message': (event: AssistantEvent) => {
      const marker = markerFromEvent(event)
      return marker ? { id: String(event.seq), role: 'start' } : null
    },
  },
  start: (_context: CardContext, match: Match): CardState => {
    const marker = markerFromEvent(match.event)
    if (!marker) throw new Error('Journal Club 卡片缺少有效标记。')
    return { ...marker, seq: match.event.seq }
  },
  update: (context: CardContext) => context.state,
  buildViewNode: (context: CardContext) => context.state ? {
    key: context.key,
    id: context.id,
    kind: 'journal-club-card',
    target: 'chat',
    anchorSeq: context.state.seq,
    location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
    visibility: 'visible',
    groupTree: 'turn', // Keep the confirmation entry outside the host's collapsed step process.
    data: context.state,
  } : null,
}
