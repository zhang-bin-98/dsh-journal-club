import { describe, expect, it } from 'vitest'
import { workspaceFiles, discoverProjects, type WorkspaceRemote } from '../src/client/workspace.ts'

describe('宿主文件适配', () => {
  it('按宿主行窗口读取完整 JSON，不把第一页当完整文件', async () => {
    const offsets: number[] = []
    const remote = { read: async (_s: string, _p: string, range: {offset: number}) => {
      offsets.push(range.offset)
      return {ok: true, value: {text: range.offset === 1 ? '{\n"version": 1,' : '"figures": []\n}', lines: 2, eof: range.offset > 1, version: 'v1'}}
    }} as unknown as WorkspaceRemote
    const result = await workspaceFiles(remote).read('s', 'figures.json', new AbortController().signal)
    expect(JSON.parse(result.text)).toEqual({version: 1, figures: []})
    expect(offsets).toEqual([1, 3])
  })
  it('分页之间文件变化时拒绝拼接不同版本', async () => {
    const remote = {read: async (_s: string, _p: string, r: {offset: number}) => ({ok: true, value: {text: '{}', lines: 1, eof: r.offset > 1, version: String(r.offset)}})} as unknown as WorkspaceRemote
    await expect(workspaceFiles(remote).read('s', 'f', new AbortController().signal)).rejects.toThrow('改变')
  })
  it('只发现根目录及一级子目录 jc.md，不递归项目树', async () => {
    const visited: string[] = []
    const remote = {list: async (_s: string, p: string) => {
      visited.push(p)
      return {ok: true, value: {truncated: false, entries: p === '.' ? [{name: '论文', type: 'directory'}, {name: '.git', type: 'directory'}] : [{name: 'jc.md', type: 'file'}]}}
    }} as unknown as WorkspaceRemote
    expect(await discoverProjects(remote, 's', new AbortController().signal)).toEqual([{path: '论文', title: '论文'}])
    expect(visited).toEqual(['.', '论文'])
  })
})
