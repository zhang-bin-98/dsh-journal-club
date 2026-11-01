import {createElement as h} from 'react'
import {act, create, type ReactTestRenderer} from 'react-test-renderer'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {JournalClubTab} from '../src/client/jcTab.ts'
import {readBrowseLocation, rememberBrowseLocation} from '../src/client/browseLocation.ts'
import {CompositionEditor} from '../src/client/composition/CompositionEditor.ts'
import type {WorkspaceRemote} from '../src/client/workspace.ts'

let view: ReactTestRenderer
beforeEach(() => {
  const entries = new Map<string,string>()
  vi.stubGlobal('localStorage', {getItem:(key:string)=>entries.get(key),setItem:(key:string,value:string)=>entries.set(key,value)})
  vi.stubGlobal('window', {confirm:vi.fn(()=>false)})
})
afterEach(() => { act(()=>view?.unmount()); vi.unstubAllGlobals() })
const figures = JSON.stringify({version:1,revision:1,status:'draft',documents:[{id:'main',path:'main.pdf',role:'main',pages:1}],figures:[]})
function fixture(localGroups = false) {
  let navigation: {project?: string; view?: string} | undefined
  let guard: (()=>boolean) | undefined
  const projects: Record<string,string[]> = {'': ['figures.json'], paper: localGroups ? ['groups.json'] : ['jc.md','figures.json','slides.md','groups.json']}
  const files: WorkspaceRemote = {
    list: async (_s,path) => ({ok:true,value:{truncated:false,entries: path==='.' ? [...projects['']!.map(name=>({name,type:'file'})),{name:'paper',type:'directory'}] : projects[path]!.map(name=>({name,type:'file'}))}}),
    read: async (_s,path) => {
      const name = path.split('/').at(-1)!, root = path.includes('/')?'paper':''
      if (!projects[root]!.includes(name)) return {ok:false,error:{code:'ENOENT',message:'not found'}}
      return {ok:true,value:{text:name==='jc.md'?'---\ntitle: Test paper\nstage: slides\n---\n':figures,version:'1',lines:1,eof:true}}
    },
    readBytes: async () => ({ok:true,value:{data:new Uint8Array(),version:'1'}}),
    changes: async function* (_s,_p,signal) { if (!signal.aborted) await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true})) },
  }
  const remote = {workspaceFiles:files,journalClub:{
    projectOverview: vi.fn(async (_s:string,p:string) => ({ok:true as const,value:{artifacts:projects[p]!,groupCount:1}})),
    compositionState: vi.fn(async () => ({ok:true as const,value:{digest:'base',assets:[{id:'a',asset:'figures/a.png',label:'A',width:100,height:50,digest:'a'}],warnings:[],groups:[]}})),
    updateFigures: vi.fn(),pageInfo: vi.fn(),saveComposition:vi.fn(),
  }}
  const props = {sessionId:'s',useTabInfo:()=>({tab:{id:'t',navigation:{params:navigation}}}),remote,context:{} as never,
    registerGuard: (_s:string,_t:string,fn:()=>boolean)=>{guard=fn;return ()=>{guard=undefined}}}
  return {props,remote,guard:()=>guard?.(),navigate:(params:typeof navigation)=>{navigation=params}}
}
const settle = async () => { await act(async()=>{await new Promise(resolve=>setTimeout(resolve,15))}) }
const button = (label:string) => view.root.findAllByType('button').find(b=>b.children.includes(label))!
const selectedPage = () => view.root.findByProps({'aria-current':'page'}).children.join('')

it('记住根目录项目和页面；另一个会话没有这份选择，显式入口覆盖记忆', async () => {
  rememberBrowseLocation('s','',{view:'compose',group:'g'})
  expect(readBrowseLocation('other').project).toBeUndefined()
  const f=fixture()
  await act(async()=>{view=create(h(JournalClubTab,f.props))}); await settle()
  expect(selectedPage()).toBe('自由拼图')
  expect(view.root.findAllByProps({'aria-label':'选择项目'})).toHaveLength(0)
  f.navigate({project:'paper',view:'overview'})
  await act(async()=>{view.update(h(JournalClubTab,f.props))}); await settle()
  expect(selectedPage()).toBe('概览')
  expect(readBrowseLocation('s').project).toBe('paper')
  act(()=>view.unmount())
  f.navigate(undefined)
  await act(async()=>{view=create(h(JournalClubTab,f.props))}); await settle()
  expect(selectedPage()).toBe('概览')
  expect(view.root.findAllByProps({'aria-label':'选择项目'})).toHaveLength(0)
})

it('标签切换保留拼图草稿；关闭与切项目使用同一保护，拒绝后仍可继续编辑', async () => {
  rememberBrowseLocation('s','',{view:'compose'})
  const f=fixture()
  await act(async()=>{view=create(h(JournalClubTab,f.props))}); await settle()
  await act(async()=>{view.root.findByProps({'aria-label':'加入 A'}).props.onClick()})
  expect(f.guard()).toBe(false)
  const editor=view.root.findByType(CompositionEditor)
  await act(async()=>{button('概览').props.onClick(); button('自由拼图').props.onClick()})
  expect(view.root.findByType(CompositionEditor)).toBe(editor)
  expect(view.root.findByProps({'aria-label':'定位 A'})).toBeDefined()
  await act(async()=>{button('切换项目').props.onClick()}); await settle()
  await act(async()=>{view.root.findAllByProps({className:'jc-projectItem'})[1]!.props.onClick()})
  expect(readBrowseLocation('s').project).toBe('')
  expect(window.confirm).toHaveBeenCalled()
})

it('仅 groups.json 的项目直达自由拼图，没有完整汇报待办或确认图源按钮', async () => {
  rememberBrowseLocation('s','paper')
  const f=fixture(true)
  await act(async()=>{view=create(h(JournalClubTab,f.props))}); await settle()
  expect(selectedPage()).toBe('自由拼图')
  expect(button('确认图源')).toBeUndefined()
  await act(async()=>{button('概览').props.onClick()})
  expect(view.root.findAllByProps({className:'jc-steps'})).toHaveLength(0)
  expect(button('图源核对')).toBeUndefined()
})

it('存储不可用时仍能选择项目和进入局部切图', async () => {
  vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')}})
  const f=fixture()
  await act(async()=>{view=create(h(JournalClubTab,f.props))}); await settle()
  await act(async()=>{view.root.findAllByProps({className:'jc-projectItem'})[0]!.props.onClick()}); await settle()
  expect(selectedPage()).toBe('图源核对')
})
