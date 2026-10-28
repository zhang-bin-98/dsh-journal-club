import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { loadFiguresJson, type FiguresJson, type Panel } from '../figures/figuresJson.ts'
import { normalizeAssetReference, parseDeck, projectPath, readTextIfExists, isSourceLineValid, panelMentionTokens } from './markdown.ts'

export interface ValidationIssue {
  code: string
  message: string
  path?: string
  page?: number
  panel?: string
  group?: string
}

export interface ValidationReport {
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

interface GroupEntry {
  id: string
  asset: string
  members: string[]
  inputs_digest: string
  layout?: unknown
}

interface GroupsFile {
  version: number
  groups: GroupEntry[]
}

function parseGroupsFile(raw: string): GroupsFile {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('groups.json 必须是对象')
  const record = value as Record<string, unknown>
  if (record.version !== 1 || !Array.isArray(record.groups)) throw new Error('groups.json version/groups 不合法')
  const groups: GroupEntry[] = []
  for (const [index, item] of record.groups.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error(`groups[${index}] 必须是对象`)
    const group = item as Record<string, unknown>
    if (typeof group.id !== 'string' || typeof group.asset !== 'string' || typeof group.inputs_digest !== 'string' || !Array.isArray(group.members) || !group.members.every(member => typeof member === 'string')) {
      throw new Error(`groups[${index}] 缺少合法 id/asset/members/inputs_digest`)
    }
    groups.push({ id: group.id, asset: group.asset, members: group.members as string[], inputs_digest: group.inputs_digest, layout: group.layout })
  }
  return { version: 1, groups }
}

function issue(code: string, message: string, extra: Omit<ValidationIssue, 'code' | 'message'> = {}): ValidationIssue {
  return { code, message, ...extra }
}

function isInsideProject(projectDir: string, candidatePath: string): boolean {
  const base = resolve(projectDir)
  const target = resolve(candidatePath)
  const rel = relative(base, target)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function digestAssets(projectDir: string, panelIds: string[], panels: Map<string, Panel>): Promise<string> {
  return Promise.all(panelIds.map(async id => {
    const panel = panels.get(id)
    if (!panel?.asset) return `${id}:missing`
    const path = projectPath(projectDir, panel.asset)
    if (!isInsideProject(projectDir, path)) return `${id}:unsafe-path`
    if (!await exists(path)) return `${id}:missing`
    const bytes = await readFile(path)
    return `${id}:${createHash('sha256').update(bytes).digest('hex')}`
  })).then(parts => createHash('sha256').update(parts.join('\n')).digest('hex'))
}

function normalizeMention(text: string): Set<string> {
  return new Set(panelMentionTokens(text).map(token => token.toLocaleLowerCase().replace(/\s+/gu, '')))
}
export async function validateProject(projectDir: string): Promise<ValidationReport> {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const absProject = resolve(projectDir)
  const figuresPath = projectPath(absProject, 'figures.json')
  let figures: FiguresJson | undefined
  try {
    figures = await loadFiguresJson(figuresPath)
  } catch (error) {
    errors.push(issue('FIGURES_INVALID', (error as Error).message, { path: relative(absProject, figuresPath) }))
  }

  const panels = new Map<string, Panel>()
  const panelAssets = new Map<string, string>()
  if (figures) {
    const documents = new Set<string>()
    for (const document of figures.documents) {
      if (documents.has(document.id)) errors.push(issue('DUPLICATE_DOCUMENT_ID', `重复 document id：${document.id}`, { path: 'figures.json' }))
      documents.add(document.id)
    }
    const figureIds = new Set<string>()
    for (const figure of figures.figures) {
      if (figureIds.has(figure.id)) errors.push(issue('DUPLICATE_FIGURE_ID', `重复 figure id：${figure.id}`, { path: 'figures.json' }))
      figureIds.add(figure.id)
      const regions = figure.regions
      for (const region of regions) {
        const document = figures.documents.find(item => item.id === region.document)
        if (!document) errors.push(issue('UNKNOWN_DOCUMENT', `region 引用未知 document：${region.document}`, { path: 'figures.json', panel: figure.id }))
        else if (document.pages > 0 && region.page > document.pages) errors.push(issue('PAGE_OUT_OF_RANGE', `region 页码超出 document：${region.page}`, { path: 'figures.json', panel: figure.id }))
        if (region.bbox.some(value => !Number.isFinite(value)) || region.bbox[2] <= region.bbox[0] || region.bbox[3] <= region.bbox[1]) errors.push(issue('DEGENERATE_BBOX', `region bbox 无效：${region.bbox.join(',')}`, { path: 'figures.json', panel: figure.id }))
      }
      if (figure.caption) {
        for (const panel of figure.panels) {
          for (const ref of panel.caption_refs) {
            if (ref < 0 || ref >= figure.caption.sentences.length) errors.push(issue('CAPTION_REF_INVALID', `caption_refs 越界：${ref}`, { path: 'figures.json', panel: panel.id }))
          }
        }
      }
      for (const panel of figure.panels) {
        if (panels.has(panel.id)) errors.push(issue('DUPLICATE_PANEL_ID', `重复 panel id：${panel.id}`, { path: 'figures.json', panel: panel.id }))
        panels.set(panel.id, panel)
        if (panel.region_index >= regions.length) errors.push(issue('REGION_INDEX_INVALID', `region_index 无效：${panel.region_index}`, { path: 'figures.json', panel: panel.id }))
        const region = regions[panel.region_index]
        if (region) {
          if (panel.bbox[2] <= panel.bbox[0] || panel.bbox[3] <= panel.bbox[1]) errors.push(issue('DEGENERATE_BBOX', `panel bbox 退化：${panel.bbox.join(',')}`, { path: 'figures.json', panel: panel.id }))
          if (panel.bbox[0] < region.bbox[0] || panel.bbox[1] < region.bbox[1] || panel.bbox[2] > region.bbox[2] || panel.bbox[3] > region.bbox[3]) errors.push(issue('PANEL_OUTSIDE_REGION', `panel bbox 超出所属 region：${panel.id}`, { path: 'figures.json', panel: panel.id }))
        }
        if (panel.asset) {
          const normalized = normalizeAssetReference(panel.asset)
          panelAssets.set(panel.id, normalized)
          if (normalized !== `figures/${panel.id}.png`) warnings.push(issue('ASSET_ID_MISMATCH', `panel asset 与 id 不一致：${panel.asset}`, { path: 'figures.json', panel: panel.id }))
          const assetPath = projectPath(absProject, normalized)
          if (!isInsideProject(absProject, assetPath)) errors.push(issue('ASSET_PATH_ESCAPE', `图片路径超出项目目录：${panel.asset}`, { path: 'figures.json', panel: panel.id }))
          else if (!await exists(assetPath)) errors.push(issue('PANEL_ASSET_MISSING', `panel asset 不存在：${panel.asset}`, { path: 'figures.json', panel: panel.id }))
        }
        for (const flag of panel.flags) if (flag === 'edge-cut' || flag === 'missing-caption' || flag === 'no-label') warnings.push(issue('PANEL_FLAG', `panel 带标记：${flag}`, { path: 'figures.json', panel: panel.id }))
      }
    }
  }

  const groupsPath = projectPath(absProject, 'groups.json')
  let groups: GroupsFile | undefined
  const groupsText = await readTextIfExists(groupsPath)
  if (groupsText !== undefined) {
    try {
      groups = parseGroupsFile(groupsText)
    } catch (error) {
      errors.push(issue('GROUPS_INVALID', `groups.json 无法解析：${(error as Error).message}`, { path: 'groups.json' }))
    }
  }

  const deckText = await readTextIfExists(projectPath(absProject, 'deck.md'))
  const outlineText = await readTextIfExists(projectPath(absProject, 'outline.md'))
  if (deckText === undefined) errors.push(issue('DECK_MISSING', '缺少 deck.md', { path: 'deck.md' }))
  const deck = deckText === undefined ? undefined : parseDeck(deckText)
  const currentRevision = figures?.revision
  if (deck) {
    const declaredRevision = Number(deck.frontmatter.figures_revision)
    if (Number.isInteger(declaredRevision) && currentRevision !== undefined && declaredRevision !== currentRevision) warnings.push(issue('FIGURES_REVISION_STALE', `deck 使用旧 figures revision：${declaredRevision}，当前为 ${currentRevision}`, { path: 'deck.md' }))
    const referencedPanels = new Set<string>()
    const groupDigestCache = new Map<string, Promise<string>>()
    for (const page of deck.pages) {
      if (page.declaredPage === undefined) errors.push(issue('PAGE_HEADER_MISSING', `第 ${page.index} 页缺少 page 注释`, { path: 'deck.md', page: page.index }))
      else if (page.declaredPage !== page.index) errors.push(issue('PAGE_NUMBER_MISMATCH', `页号 ${page.declaredPage} 与顺序 ${page.index} 不一致`, { path: 'deck.md', page: page.index }))
      if (!page.speech) errors.push(issue('SPEECH_MISSING', `第 ${page.index} 页缺少讲稿块`, { path: 'deck.md', page: page.index }))
      for (const image of page.images) {
        const asset = normalizeAssetReference(image.path)
        if (!image.sourceLine || !isSourceLineValid(image.sourceLine)) errors.push(issue('SOURCE_INVALID', `图片来源标注缺失或格式非法：${image.path}`, { path: 'deck.md', page: page.index }))
        if (asset.startsWith('groups/')) {
          const groupId = asset.slice('groups/'.length).replace(/\.png$/u, '')
          const group = groups?.groups.find(item => item.id === groupId)
          if (!group) errors.push(issue('GROUP_MISSING', `引用的图组不存在：${groupId}`, { path: 'deck.md', page: page.index, group: groupId }))
          else {
            const groupAssetPath = projectPath(absProject, group.asset)
            if (!isInsideProject(absProject, groupAssetPath)) errors.push(issue('ASSET_PATH_ESCAPE', `图组路径超出项目目录：${group.asset}`, { path: 'groups.json', group: groupId }))
            else if (!await exists(groupAssetPath)) errors.push(issue('GROUP_ASSET_MISSING', `图组资产不存在：${group.asset}`, { path: 'groups.json', page: page.index, group: groupId }))
            for (const member of group.members) {
              referencedPanels.add(member)
              if (!panels.has(member)) errors.push(issue('GROUP_MEMBER_MISSING', `图组成员不存在：${member}`, { path: 'groups.json', page: page.index, group: groupId, panel: member }))
            }
            if (figures) {
              let digestPromise = groupDigestCache.get(groupId)
              if (!digestPromise) {
                digestPromise = digestAssets(absProject, group.members, panels)
                groupDigestCache.set(groupId, digestPromise)
              }
              const digest = await digestPromise
              const suppliedDigest = group.inputs_digest.replace(/^sha256:/u, '')
              if (digest !== suppliedDigest) {
                warnings.push(issue('GROUP_DIGEST_STALE', `图组成员资产已变化，需要重建：${groupId}`, { path: 'groups.json', page: page.index, group: groupId }))
              }
            }
          }
        } else if (asset.startsWith('figures/')) {
          const id = asset.slice('figures/'.length).replace(/\.png$/u, '')
          referencedPanels.add(id)
          if (!panels.has(id)) errors.push(issue('PANEL_MISSING', `引用的 panel 不存在：${id}`, { path: 'deck.md', page: page.index, panel: id }))
          else if (panelAssets.get(id) !== asset) errors.push(issue('PANEL_ASSET_IDENTITY', `引用的 panel asset 身份不一致：${asset}`, { path: 'deck.md', page: page.index, panel: id }))
        } else errors.push(issue('ASSET_PATH_INVALID', `图片路径必须位于 figures/ 或 groups/：${image.path}`, { path: 'deck.md', page: page.index }))
      }
      const speechMentions = normalizeMention(page.speech)
      const imageText = normalizeMention(page.images.map(image => image.alt).join(' '))
      for (const mention of speechMentions) if (!imageText.has(mention)) warnings.push(issue('SPEECH_IMAGE_MISMATCH', `讲稿提及 ${mention}，但本页未明显放置对应图片`, { path: 'deck.md', page: page.index }))
      for (const image of page.images) {
        if (image.alt) {
          const imageMentions = normalizeMention(image.alt)
          if (![...imageMentions].some(mention => speechMentions.has(mention))) {
            warnings.push(issue('IMAGE_SPEECH_MISMATCH', `本页图片 ${image.alt} 未在讲稿中提及`, { path: 'deck.md', page: page.index }))
          }
        }
      }
    }
    for (const id of panels.keys()) if (!referencedPanels.has(id)) warnings.push(issue('PANEL_UNREFERENCED', `panel 未被 deck 引用：${id}`, { path: 'figures.json', panel: id }))
  }
  if (outlineText !== undefined) {
    const outlineRevision = outlineText.match(/figures_revision\s*:\s*(\d+)/iu)?.[1]
    if (outlineRevision !== undefined && currentRevision !== undefined && Number(outlineRevision) !== currentRevision) warnings.push(issue('OUTLINE_REVISION_STALE', `outline 使用旧 figures revision：${outlineRevision}，当前为 ${currentRevision}`, { path: 'outline.md' }))
  }
  return { errors, warnings }
}
