import { describe, expect, it } from 'vitest'
import { projectStatus, overviewFocus } from '../src/client/projectStatus.ts'

describe('文件驱动四步状态', () => {
  it('stage 缓存写 done 也不能将缺失产物标为已产出', () => {
    const result = projectStatus('---\ntitle: 测试论文\nstage: done\n---\n备注', [])
    expect(result.title).toBe('测试论文')
    expect(result.stageHint).toBe('done')
    expect(result.steps.every(step => !step.produced)).toBe(true)
  })
  it('只把文件存在显示为产出，不声称确认或完成', () => {
    const result = projectStatus(undefined, ['analysis.md', 'figures.json', 'outline.md', 'slides.md', 'groups.json'])
    expect(result.steps.every(step => step.produced)).toBe(true)
    expect(result.steps[1]?.detail).toContain('尚未读取或无法解析')
    expect(result.confirmationNote).toContain('待对话核对')
  })
  it('figures confirmed 状态不被当成有效确认记录', () => {
    const result = projectStatus('---\ntitle: "论文：A"\nstage: figure-review\n---', ['figures.json'], { revision: 3, status: 'confirmed', figures: [] })
    expect(result.title).toBe('论文：A')
    expect(result.steps[1]?.detail).toContain('revision 3')
    expect(result.steps[1]?.detail).toContain('文件标记已定稿')
    expect(result.confirmationNote).toContain('当前版本是否一致')
  })
  it('不从备注冒认 frontmatter 标题或状态', () => {
    expect(projectStatus('title: 假标题\nstage: done', []).title).toBeUndefined()
  })
})

describe('概览只突出当前真实待办', () => {
  const artifacts = ['analysis.md', 'figures.json', 'outline.md', 'slides.md', 'render/talk.pptx']
  const status = projectStatus('---\nstage: done\n---', artifacts)
  const confirmations = {figures: 'confirmed', outline: 'confirmed', slides: 'confirmed'} as const

  it('确认损坏或失效优先于已有 PPTX，不显示可交付', () => {
    const broken = overviewFocus(status, {artifacts, warning: '确认记录无法解析'}, true, true, true)
    expect(broken.warning).toBe(true)
    expect(broken.action?.path).toBeUndefined()
    const stale = overviewFocus(status, {artifacts, confirmations: {...confirmations, figures: 'stale'}}, true, true, true)
    expect(stale.title).toContain('重新核对')
    expect(stale.action?.view).toBe('figures')
  })

  it('缺产物或缺确认不被 done 阶段缓存和 PPTX 掩盖', () => {
    const partial = artifacts.filter(path => path !== 'slides.md')
    expect(overviewFocus(projectStatus(undefined, partial), {artifacts: partial, confirmations}, true, true, true).title).toBe('下一步：幻灯片分页')
    expect(overviewFocus(status, {artifacts, confirmations: {...confirmations, outline: 'missing'}}, true, true, true).title).toBe('叙事大纲待确认')
  })

  it('确认有效时用实际文件路径打开演示稿，仍要求人工检查', () => {
    const result = overviewFocus(status, {artifacts, confirmations}, true, true, true)
    expect(result.action?.path).toBe('render/talk.pptx')
    expect(result.title).toBe('已有演示稿，可打开检查')
    expect(result.detail).toContain('仍需检查')
  })

  it('局部工具直达已有图源或拼图，不提出完整汇报待办', () => {
    expect(overviewFocus(status, {artifacts: ['figures.json']}, false, true, true).action?.view).toBe('figures')
    expect(overviewFocus(status, {artifacts: ['groups.json']}, false, false, true).action?.view).toBe('compose')
  })

  it('加载及读取失败不显示过期的下一步操作', () => {
    expect(overviewFocus(status, undefined, true, true, true).action).toBeUndefined()
    const result = overviewFocus(status, {artifacts, confirmations}, true, true, true, '读取失败')
    expect(result.warning).toBe(true)
    expect(result.action).toBeUndefined()
  })
})
