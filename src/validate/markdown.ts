import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export interface DeckImageRef {
  alt: string
  path: string
  sourceLine?: string
  source?: string
}

export interface DeckPage {
  index: number
  declaredPage?: number
  layout?: string
  text: string
  images: DeckImageRef[]
  speech: string
  sourceLines: string[]
}

export interface DeckDocument {
  frontmatter: Record<string, string>
  pages: DeckPage[]
}

const PAGE_HEADER = /^<!--\s*page\s+(\d+)(?:\s*·\s*layout:\s*([^>]+?))?\s*-->\s*$/imu
const IMAGE = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu
const SOURCE = /^>\s*来源：(.+)$/mu
const SPEECH = /^>\s*🗣\s*\*\*讲稿\*\*：?(.*(?:\n>.*)*)$/mu

export async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export function parseFrontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/u)
  if (!match?.[1]) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/u)) {
    const parsed = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/u)
    if (parsed?.[1] && parsed[2] !== undefined) result[parsed[1]] = parsed[2].replace(/^['"]|['"]$/gu, '')
  }
  return result
}

export function parseDeck(text: string): DeckDocument {
  const frontmatter = parseFrontmatter(text)
  const body = text.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/u, '')
  const rawPages = body.split(/^---\s*$/m)
  const pages: DeckPage[] = []
  rawPages.forEach((raw, index) => {
    if (!raw.trim()) return
    const header = raw.match(PAGE_HEADER)
    const images: DeckImageRef[] = []
    for (const match of raw.matchAll(IMAGE)) {
      const alt = match[1] ?? ''
      const path = match[2] ?? ''
      const end = match.index === undefined ? 0 : match.index + match[0].length
      const lineEnd = raw.indexOf('\n', end)
      const currentLineTail = raw.slice(end, lineEnd === -1 ? raw.length : lineEnd).trim()
      const nextLineStart = lineEnd === -1 ? -1 : lineEnd + 1
      const nextLineEnd = nextLineStart === -1 ? -1 : raw.indexOf('\n', nextLineStart)
      const nextLine = nextLineStart === -1
        ? ''
        : raw.slice(nextLineStart, nextLineEnd === -1 ? raw.length : nextLineEnd).trim()
      const sourceCandidate = currentLineTail === '' ? nextLine : currentLineTail
      const sourceMatch = sourceCandidate.match(/^>\s*来源：(.+?)\s*$/u)
      images.push({ alt, path, sourceLine: sourceMatch?.[0], source: sourceMatch?.[1] })
    }
    const speechMatch = raw.match(SPEECH)
    const speech = speechMatch?.[0]
      .split(/\r?\n/u)
      .map(line => line.replace(/^>\s?/u, ''))
      .join('\n') ?? ''
    pages.push({
      index: pages.length + 1,
      declaredPage: header?.[1] === undefined ? undefined : Number(header[1]),
      layout: header?.[2]?.trim(),
      text: raw,
      images,
      speech,
      sourceLines: [...raw.matchAll(/^>\s*来源：.*$/gmu)].map(match => match[0]),
    })
  })
  return { frontmatter, pages }
}

export function normalizeAssetReference(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '')
}

export function panelMentionTokens(text: string): string[] {
  const result = new Set<string>()
  const patterns = [
    /(?:Figure|Fig\.?|图)\s*(\d+)\s*([A-Za-z](?:\s*[–—-]\s*[A-Za-z])?)/giu,
    /(?:Figure|Fig\.?|图)\s*(\d+)/giu,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1] && match[2]) result.add(`Figure ${match[1]}${match[2].replaceAll(/\s+/gu, '')}`)
      else if (match[1]) result.add(`Figure ${match[1]}`)
    }
  }
  return [...result]
}

export function isSourceLineValid(line: string): boolean {
  return /^>\s*来源：(?:Figure|Fig\.?|图)\s*\d+[A-Za-z]*(?:\s*[–—-]\s*[A-Za-z]+)?\s*·\s*p\.\s*\d+(?:\s*·\s*.+)?$/iu.test(line)
}

export function fileNameOfAsset(asset: string): string {
  return basename(normalizeAssetReference(asset))
}

export function projectPath(projectDir: string, path: string): string {
  return join(projectDir, normalizeAssetReference(path))
}
