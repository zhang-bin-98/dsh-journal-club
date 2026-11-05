import { expect, it, vi } from 'vitest'
import { prepareCompositionReference } from '../src/client/composition/conversationReference.ts'

it('引用捕获当前会话输入并保留被选文字，支持含空格中文路径且不发送', () => {
  const input = { captureInsertion: () => ({ start: 0, end: 8, draftRev: 3 }), insertText: vi.fn((_text: string, _span: {start:number;end:number;draftRev:number}) => true) }
  const other = { captureInsertion: input.captureInsertion, insertText: vi.fn(() => true) }
  const insert = prepareCompositionReference(input, '论文 研究', 'group_2')
  insert('groups/group_2.png')
  expect(input.insertText).toHaveBeenCalledWith(expect.stringContaining('@"论文 研究/groups/group_2.png"'), {start:8,end:8,draftRev:3})
  expect(input.insertText.mock.calls[0]![0]).toContain('@"论文 研究/groups.json"')
  expect(input.insertText.mock.calls[0]![0]).toContain('"group_2"')
  expect(input.insertText.mock.calls[0]![0]).toContain('output 固定为 "论文 研究/groups/group_2.png"')
  expect(input.insertText.mock.calls[0]![0]).toContain('不要传 create:true')
  expect(other.insertText).not.toHaveBeenCalled()
})

it('输入版本变化、宿主能力缺失和不可表示路径均明确失败，不覆盖输入', () => {
  const input = { captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }), insertText: vi.fn(() => false) }
  expect(() => prepareCompositionReference(undefined, '', 'group_1')).toThrow('输入框')
  expect(() => prepareCompositionReference(input, 'bad\npath', 'group_1')).toThrow('路径')
  expect(input.insertText).not.toHaveBeenCalled()
  expect(() => prepareCompositionReference(input, '.', 'group_1')('groups/group_1.png')).toThrow('再次点击')
  expect(input.insertText).toHaveBeenCalledWith(expect.stringContaining('@"groups/group_1.png"'), {start:0,end:0,draftRev:1})
})
