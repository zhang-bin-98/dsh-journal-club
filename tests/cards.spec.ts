import { describe, expect, it } from 'vitest'
import { cardConfirmation, cardDefinition, fileResourceAddress, parseCardMarker } from '../src/client/cardMarker.ts'

const text = '<!-- jc-card {"project":"联合治疗","stage":"figures"} -->'
describe('Journal Club 卡片契约', () => {
  it('只接受一个固定阶段和相对项目目录的展示标记', () => {
    expect(parseCardMarker(text)).toEqual({ project: '联合治疗', stage: 'figures' })
    expect(parseCardMarker('正文\n<!-- jc-card {"project":"","stage":"deck"} -->')).toEqual({ project: '', stage: 'deck' })
    for (const value of [text + text, '<!-- jc-card nope -->', '<!-- jc-card {"project":"../secret","stage":"deck"} -->', '<!-- jc-card {"project":"C:/secret","stage":"deck"} -->', '<!-- jc-card {"project":"/secret","stage":"deck"} -->', '<!-- jc-card {"project":"p","stage":"run"} -->', '<!-- jc-card {"project":"p","stage":"deck","command":"delete"} -->']) expect(parseCardMarker(value)).toBeUndefined()
  })
  it('只把落定 assistant 文本变为追加卡片，不认领原消息', () => {
    const event = { type: 'assistant/message', seq: 18, surfaceOp: 'append', data: { message: { content: [{ type: 'text', text }] } } }
    expect(cardDefinition.match['assistant/message'](event)).toEqual({ id: '18', role: 'start' })
    expect(cardDefinition.match['assistant/message']({ ...event, type: 'user/message' })).toBeNull()
    expect(cardDefinition.match['assistant/message']({ ...event, surfaceOp: 'replace' })).toBeNull()
    expect(cardDefinition.match['assistant/message']({ ...event, data: { message: { content: [{ type: 'reasoning', text }] } } })).toBeNull()
    const start = { event, location: { kind: 'step', turn: 1, step: 2 } }
    const context = { key: 'card:18', id: '18', start, matches: [start] }
    const state = cardDefinition.start(context, start)
    expect(cardDefinition.buildViewNode({ ...context, state })).toMatchObject({ key: 'card:18', target: 'chat', kind: 'journal-club-card', anchorSeq: 18, location: start.location, groupTree: 'turn', data: { project: '联合治疗', stage: 'figures' } })
  })
  it('实际宿主混合 reasoning/text 事件生成回合级确认入口', () => {
    const event = { type: 'assistant/message', seq: 65, surfaceOp: 'append', data: { message: { content: [
      { type: 'reasoning', text: '' },
      { type: 'text', text: '测试图源已修正。\n<!-- jc-card {"project":"","stage":"figures"} -->' },
    ] } } }
    expect(cardDefinition.match['assistant/message'](event)).toEqual({ id: '65', role: 'start' })
    const start = { event, location: { kind: 'step', turn: 2, step: 6 } }
    const context = { key: 'card:65', id: '65', start, matches: [start] }
    const state = cardDefinition.start(context, start)
    expect(cardDefinition.buildViewNode({ ...context, state })).toMatchObject({
      groupTree: 'turn', visibility: 'visible', anchorSeq: 65,
      data: { project: '', stage: 'figures', seq: 65 },
    })
  })
  it('按钮请求固定指令并明确项目，不从标记接受执行文本', () => {
    expect(cardConfirmation({ project: 'paper one', stage: 'outline' })).toBe('/jc confirm outline\n项目目录："paper one"')
  })
  it('文件 URI 编码路径片段并保留绝对路径/盘符语义', () => {
    expect(fileResourceAddress('s/1', 'paper one/deck.md')).toBe('dsh-resource://file/session/s%2F1/paper%20one/deck.md')
    expect(fileResourceAddress('s', 'C:\\paper\\deck.md')).toBe('dsh-resource://file/session/s/C:/paper/deck.md')
    expect(fileResourceAddress('s', '/tmp/deck.md')).toBe('dsh-resource://file/session/s//tmp/deck.md')
  })
})
