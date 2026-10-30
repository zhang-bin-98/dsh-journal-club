import { access, readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { figuresJsonIssues, loadFiguresJson, type FiguresJson, type Panel } from '../figures/figuresJson.ts'
import { digestMembers, readGroups, type GroupsFile } from '../groups.ts'
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

/** 与 compose_panels 登记时相同的成员指纹；成员缺失或路径越界时必然不匹配。 */
async function digestAssets(projectDir: string, panelIds: string[], panels: Map<string, Panel>): Promise<string> {
  const members = await Promise.all(panelIds.map(async id => {
    const panel = panels.get(id)
    if (!panel?.asset) return { id }
    const path = projectPath(projectDir, panel.asset)
    if (!isInsideProject(projectDir, path)) return { id, missing: 'unsafe-path' }
    const bytes = await readFile(path).catch(() => undefined)
    return bytes === undefined ? { id } : { id, bytes }
  }))
  return digestMembers(members)
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
    // 跨字段约束与 update_figures 写入前的校验同源，手工改坏的文件在此报告。
    for (const message of figuresJsonIssues(figures)) errors.push(issue('FIGURES_INVALID', message, { path: 'figures.json' }))
    for (const figure of figures.figures) {
      for (const panel of figure.panels) {
        panels.set(panel.id, panel)
        if (panel.asset) {
          const normalized = normalizeAssetReference(panel.asset)
          panelAssets.set(panel.id, normalized)
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
  try {
    groups = await readGroups(groupsPath)
  } catch (error) {
    errors.push(issue('GROUPS_INVALID', (error as Error).message, { path: 'groups.json' }))
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
              if (digest.replace(/^sha256:/u, '') !== group.inputs_digest.replace(/^sha256:/u, '')) {
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
