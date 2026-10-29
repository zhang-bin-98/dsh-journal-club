import { describe, expect, it } from 'vitest'
import { projectStatus } from '../src/client/projectStatus.ts'

describe('文件驱动四步状态', () => {
  it('stage 缓存写 done 也不能将缺失产物标为已产出', () => {
    const result = projectStatus('---\ntitle: 测试论文\nstage: done\n---\n备注', [])
    expect(result.title).toBe('测试论文')
    expect(result.stageHint).toBe('done')
    expect(result.steps.every(step => !step.produced)).toBe(true)
  })
  it('只把文件存在显示为产出，不声称确认或完成', () => {
    const result = projectStatus(undefined, ['analysis.md', 'figures.json', 'outline.md', 'deck.md', 'groups.json'])
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
