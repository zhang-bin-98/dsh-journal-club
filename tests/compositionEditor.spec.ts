import { createElement as h } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { CompositionEditor } from '../src/client/composition/CompositionEditor.ts'
import { GroupNavigator } from '../src/client/composition/GroupNavigator.ts'
import { compositionBounds, fitCanvas, fitComposition, resizeImage, suggestGeometry, type CompositionSave, type CompositionState } from '../src/layout/composition.ts'

let view: ReactTestRenderer
afterEach(() => { act(() => view?.unmount()) })
it('自由拼图可添加九张图、调整排列与撤销，紧密导出且保存冲突不丢草稿', async () => {
  const state: CompositionState = { groups: [], digest: 'base', warnings: [], assets: Array.from({length:9},(_,i)=>({id:`p${i}`,label:`Figure 1 · ${i}`,asset:`figures/p${i}.png`,width:80,height:40,digest:`d${i}`})) }
  const save = vi.fn(async (_request: Omit<CompositionSave, 'project'>) => { throw new Error('拼图文件已被修改') })
  await act(async () => { view=create(h(CompositionEditor,{load:async()=>state,save,readAsset:async()=>''})) })
  const button=(text:string)=>view.root.findAllByType('button').find(b=>b.children.includes(text))!
  for (const asset of state.assets) await act(async()=>{view.root.findByProps({'aria-label':`加入 ${asset.label}`}).props.onClick()})
  await act(async()=>{button('建议排版').props.onClick()})
  const before = view.root.findByProps({'aria-label':'按图片外缘导出范围'}).props
  await act(async()=>{button('撤销').props.onClick()})
  await act(async()=>{button('重做').props.onClick()})
  expect(view.root.findByProps({'aria-label':'按图片外缘导出范围'}).props).toEqual(before)
  await act(async()=>{button('保存拼图').props.onClick()})
  expect(save.mock.calls[0]![0]).toMatchObject({create:true,base_digest:'base',geometry:{cells:expect.any(Array)}})
  expect((save.mock.calls[0]![0] as {geometry:{cells:unknown[]}}).geometry.cells).toHaveLength(9)
  expect(view.root.findByProps({role:'alert'}).children.join('')).toContain('已被修改')
  expect(view.root.findByProps({'aria-label':'按图片外缘导出范围'}).props).toEqual(before)
})

it('贴合画布保留相对位置，角点缩放保持比例，密集建议仍产生正尺寸', () => {
  const g={width:900,height:500,gap:0,cells:[{member:'a',x:-50,y:20,width:100,height:40},{member:'b',x:100,y:-10,width:90,height:100}]}
  const fitted=fitCanvas(g)
  expect(fitted).toMatchObject({width:240,height:100})
  expect(fitted.cells[1]!.x-fitted.cells[0]!.x).toBe(150)
  const resized=resizeImage(g.cells[0]!,'nw',-30,-20)
  expect(resized.width/resized.height).toBeCloseTo(2.5)
  expect(resized.x+resized.width).toBeCloseTo(50)
  const suggested=suggestGeometry(Array.from({length:100},(_,i)=>({id:`p${i}`,width:20,height:40})),10,1000)
  expect(suggested.cells).toHaveLength(100)
  expect(suggested.cells.every(c=>c.width>0&&c.height>0)).toBe(true)
})

it('素材预览不添加图片，加入后保留卡片且定位不切换标签或重复加入', async () => {
  const assets = [{id:'a',label:'Figure 1 · A',asset:'figures/a.png',width:80,height:40,digest:'a'}, {id:'b',label:'Figure 2 · B',asset:'figures/b.png',width:40,height:80,digest:'b'}]
  const save = vi.fn(async (_request: Omit<CompositionSave,'project'>) => ({digest:'saved',asset:'groups/group_1.png'}))
  await act(async () => { view=create(h(CompositionEditor,{load:async()=>({groups:[],digest:'base',warnings:[],assets}),save,readAsset:async()=> 'data:image/png;base64,test'})) })
  const button=(text:string)=>view.root.findAllByType('button').find(b=>b.children.includes(text))!
  const tab=(text:string)=>view.root.findAllByProps({role:'tab'}).find(b=>b.children.includes(text))!
  expect(tab('素材').props['aria-selected']).toBe(true)
  await act(async()=>{view.root.findByProps({'aria-label':'预览 Figure 1 · A'}).props.onClick({currentTarget:{focus:()=>{}}})})
  expect(view.root.findByProps({'aria-label':'素材预览 Figure 1 · A'})).toBeDefined()
  expect(button('保存拼图').props.disabled).toBe(true)
  expect(save).not.toHaveBeenCalled()
  await act(async()=>{button('关闭预览').props.onClick()})
  await act(async()=>{view.root.findByProps({'aria-label':'加入 Figure 1 · A'}).props.onClick()})
  expect(view.root.findByProps({'aria-label':'预览 Figure 1 · A'})).toBeDefined()
  await act(async()=>{view.root.findByProps({'aria-label':'定位 Figure 1 · A'}).props.onClick()})
  expect(tab('素材').props['aria-selected']).toBe(true)
  expect(view.root.findByProps({'aria-label':'定位 Figure 1 · A'}).props['aria-pressed']).toBe(true)
  await act(async()=>{tab('属性').props.onClick()})
  await act(async()=>{view.root.findByProps({'aria-label':'搜索图片'}).props.onChange({target:{value:'Figure 2'}})})
  await act(async()=>{tab('素材').props.onClick()})
  expect(view.root.findAllByProps({'aria-label':'预览 Figure 1 · A'})).toHaveLength(0)
  expect(view.root.findByProps({'aria-label':'预览 Figure 2 · B'})).toBeDefined()
  await act(async()=>{button('保存拼图').props.onClick()})
  expect(save.mock.calls[0]![0].geometry.cells.map(c=>c.member)).toEqual(['a'])
})

it('单张素材读取失败不影响其他图片，大图内可重试且不改变拼图', async () => {
  let failures=0
  const readAsset=vi.fn(async (path:string)=> {
    if(path==='figures/a.png' && failures++<2) throw new Error('暂时不可读')
    return 'data:image/png;base64,test'
  })
  const assets=['a','b'].map(id=>({id,label:`Figure 1 · ${id}`,asset:`figures/${id}.png`,width:100,height:60,digest:id}))
  const save=vi.fn(async()=>({digest:'saved',asset:'groups/group_1.png'}))
  await act(async()=>{view=create(h(CompositionEditor,{load:async()=>({groups:[],digest:'base',warnings:[],assets}),save,readAsset}))})
  expect(view.root.findByProps({alt:'Figure 1 · b'})).toBeDefined()
  await act(async()=>{view.root.findByProps({'aria-label':'预览 Figure 1 · a'}).props.onClick({currentTarget:{focus:()=>{}}})})
  const retry=view.root.findAllByType('button').find(b=>b.children.includes('重试'))!
  await act(async()=>{retry.props.onClick()})
  expect(view.root.findByProps({alt:'Figure 1 · a'})).toBeDefined()
  expect(save).not.toHaveBeenCalled()
})


it('外缘导出去掉容器留白，保留内部间距与负坐标图片，重复规范化不变', () => {
  const geometry={width:960,height:540,gap:12,cells:[{member:'a',x:-100,y:-40,width:200,height:200},{member:'b',x:180,y:0,width:100,height:100}]}
  const assets=[{id:'a',width:200,height:100},{id:'b',width:100,height:100}]
  expect(compositionBounds(geometry,assets)).toEqual({x:-100,y:0,width:380,height:110})
  const tight=fitComposition(geometry,assets)
  expect(tight).toEqual({width:380,height:110,gap:12,cells:[{member:'a',x:0,y:10,width:200,height:100},{member:'b',x:280,y:0,width:100,height:100}]})
  expect(fitComposition(tight,assets)).toEqual(tight)
})

function refreshFixture(): CompositionState {
  const assets = ['a','b'].map(id => ({id,label:`Figure 1 · ${id}`,asset:`figures/${id}.png`,width:100,height:60,digest:`old-${id}`}))
  return {digest:'base',warnings:[],assets,groups:['one','two'].map(id => ({id,asset:`groups/${id}.png`,members:['a','b'],inputs_digest:'old',layout:{kind:'manual',geometry:{width:350,height:100,gap:12,cells:[{member:'a',x:20,y:10,width:100,height:60},{member:'b',x:200,y:10,width:100,height:60}]}}}))}
}

it('适应模式跟随图片外缘且 SVG 高宽比同步，手动放大仍保留', async () => {
  const save=vi.fn(async()=>({digest:'saved',asset:'groups/one.png'}))
  await act(async()=>{view=create(h(CompositionEditor,{load:async()=>refreshFixture(),save,readAsset:async()=>''}))})
  const board=()=>view.root.findByProps({'aria-label':'自由拼图画布'})
  const fit=()=>{
    const [x,y,width,height]=board().props.viewBox.split(' ').map(Number)
    for(const image of board().findAllByType('image')) {
      expect(image.props.x).toBeGreaterThanOrEqual(x)
      expect(image.props.y).toBeGreaterThanOrEqual(y)
      expect(image.props.x+image.props.width).toBeLessThanOrEqual(x+width)
      expect(image.props.y+image.props.height).toBeLessThanOrEqual(y+height)
    }
    const displayWidth=view.root.findByProps({className:'jc-composeBoardWrap'}).props.style.width
    expect(board().props.style.height/displayWidth).toBeCloseTo(height/width)
  }
  const before=board().props.viewBox
  await act(async()=>{view.root.findAllByType('button').find(b=>b.children.includes('Figure 1 · b'))!.props.onClick()})
  for(let i=0;i<75;i++) await act(async()=>{view.root.findByProps({className:'jc-compose'}).props.onKeyDown({key:'ArrowLeft',shiftKey:true,target:{closest:()=>null},preventDefault:()=>{}})})
  expect(board().props.viewBox).not.toBe(before)
  fit()
  await act(async()=>{view.root.findByProps({'aria-label':'拼图缩放'}).props.onChange({target:{value:'2'}})})
  expect(view.root.findByProps({'aria-label':'拼图缩放'}).props.value).toBe(2)
  await act(async()=>{view.root.findByProps({'aria-label':'拼图缩放'}).props.onChange({target:{value:'1'}})})
  fit()
  expect(save).not.toHaveBeenCalled()
})

it('文件变更自动更新已保存布局与缩略图版本，保持当前项和顺序，保护其他手动草稿', async () => {
  let state = refreshFixture()
  const props = {load: async () => structuredClone(state), save: vi.fn(async () => ({digest:'saved',asset:'groups/one.png'})), readAsset: async () => ''}
  await act(async () => { view=create(h(CompositionEditor,{...props,revision:0})) })
  const button=(text:string)=>view.root.findAllByType('button').find(b=>b.children.includes(text))!
  const choose=async(id:string)=>{await act(async()=>{view.root.findByType(GroupNavigator).props.choose(id)})}
  const image=()=>view.root.findByProps({'data-member':'b'}).findByType('image').props
  await act(async()=>{button('Figure 1 · b').props.onClick()})
  await act(async()=>{view.root.findByProps({className:'jc-compose'}).props.onKeyDown({key:'ArrowRight',target:{closest:()=>null},preventDefault:()=>{}})})
  await choose('two')
  state.digest='ai-edited'
  for (const group of state.groups) group.layout!.geometry.cells[1]={...group.layout!.geometry.cells[1]!,x:350}
  await act(async()=>{view.update(h(CompositionEditor,{...props,revision:1}))})
  expect(image().x).toBe(350)
  expect(view.root.findByType(GroupNavigator).props).toMatchObject({current:'two',revision:'ai-edited'})
  expect(view.root.findByType(GroupNavigator).props.items.map((g:{id:string})=>g.id)).toEqual(['one','two'])
  await choose('one')
  expect(image().x).toBe(201)
  expect(button('重新加载布局（放弃当前草稿）')).toBeDefined()
  await act(async()=>{button('撤销').props.onClick()})
  expect(image().x).toBe(200)
  await act(async()=>{button('重新加载布局（放弃当前草稿）').props.onClick()})
  expect(image().x).toBe(350)
  expect(props.save).not.toHaveBeenCalled()
})

it('保存期间收到的文件变更在保存后读取，不丢失后续 AI 布局', async () => {
  let state=refreshFixture(), resolveSave!: (result:{digest:string;asset:string})=>void
  const props={load:vi.fn(async()=>structuredClone(state)),save:()=>new Promise<{digest:string;asset:string}>(resolve=>{resolveSave=resolve}),readAsset:async()=>''}
  await act(async()=>{view=create(h(CompositionEditor,{...props,revision:0}))})
  await act(async()=>{view.root.findAllByType('button').find(b=>b.children.includes('保存拼图'))!.props.onClick()})
  state.digest='later-ai-edit';state.groups[0]!.layout!.geometry.cells[1]={...state.groups[0]!.layout!.geometry.cells[1]!,x:400}
  await act(async()=>{view.update(h(CompositionEditor,{...props,revision:1}))})
  expect(props.load).toHaveBeenCalledTimes(1)
  await act(async()=>{resolveSave({digest:'saved',asset:'groups/one.png'})})
  expect(view.root.findByProps({'data-member':'b'}).findByType('image').props.x).toBe(400)
  expect(view.root.findByType(GroupNavigator).props.current).toBe('one')
})

it('文稿引用顺序改变即重排，移除的图组不被手动草稿复活，新建仍能编辑', async () => {
  let state=refreshFixture();state.order=['two','one']
  const props={load:async()=>structuredClone(state),save:vi.fn(async()=>({digest:'saved',asset:'groups/group_1.png'})),readAsset:async()=>''}
  await act(async()=>{view=create(h(CompositionEditor,{...props,revision:0}))})
  const nav=()=>view.root.findByType(GroupNavigator).props
  const ids=()=>nav().items.map((g:{id:string})=>g.id)
  const button=(text:string)=>view.root.findAllByType('button').find(b=>b.children.includes(text))!
  expect(nav().current).toBe('two');expect(ids()).toEqual(['two','one'])
  await act(async()=>{button('Figure 1 · b').props.onClick()})
  await act(async()=>{view.root.findByProps({className:'jc-compose'}).props.onKeyDown({key:'ArrowRight',target:{closest:()=>null},preventDefault:()=>{}})})
  state.order=['one'] // Only deck changed; groups digest is identical.
  await act(async()=>{view.update(h(CompositionEditor,{...props,revision:1}))})
  expect(ids()).toEqual(['one']);expect(nav().current).toBe('one')
  state.order=['two','one']
  await act(async()=>{view.update(h(CompositionEditor,{...props,revision:2}))})
  await act(async()=>{nav().choose('two')})
  expect(view.root.findByProps({'data-member':'b'}).findByType('image').props.x).toBe(200)
  state.groups=state.groups.filter(g=>g.id!=='two');state.order=['one']
  await act(async()=>{view.update(h(CompositionEditor,{...props,revision:3}))})
  expect(ids()).toEqual(['one'])
  await act(async()=>{button('新建拼图').props.onClick()})
  expect(ids()).toEqual(['one','group_1'])
  await act(async()=>{view.root.findByProps({'aria-label':'加入 Figure 1 · a'}).props.onClick()})
  await act(async()=>{button('保存拼图').props.onClick()})
  expect(ids()).toEqual(['one','group_1'])
  expect(nav().current).toBe('group_1')
  // Once referenced, even a locally created group must disappear when removed.
  state.groups.push({...state.groups[0]!,id:'group_1',asset:'groups/group_1.png'})
  state.order=['one','group_1'];state.digest='referenced'
  await act(async()=>{view.update(h(CompositionEditor,{...props,revision:4}))})
  state.groups=[];state.order=[];state.digest='deleted'
  await act(async()=>{view.update(h(CompositionEditor,{...props,revision:5}))})
  expect(ids()).toEqual([]);expect(nav().current).toBe('')
  await act(async()=>{button('刷新图源').props.onClick()})
  expect(ids()).toEqual([])
  expect(props.save).toHaveBeenCalledTimes(1)
})

it('刷新自动保存失败保留最新图源与手动草稿，不误报成功', async () => {
  const state=refreshFixture()
  const save=vi.fn(async()=>{throw Error('写入失败')})
  await act(async()=>{view=create(h(CompositionEditor,{load:async()=>structuredClone(state),save,readAsset:async()=>''}))})
  const button=(text:string)=>view.root.findAllByType('button').find(b=>b.children.includes(text))!
  await act(async()=>{button('Figure 1 · b').props.onClick()})
  await act(async()=>{view.root.findByProps({className:'jc-compose'}).props.onKeyDown({key:'ArrowRight',target:{closest:()=>null},preventDefault:()=>{}})})
  state.assets[0]!.digest='new-source'
  await act(async()=>{button('刷新图源').props.onClick()})
  expect(save).toHaveBeenCalledTimes(1)
  expect(view.root.findByProps({role:'alert'}).children.join('')).toContain('写入失败')
  expect(view.root.findByProps({'data-member':'b'}).findByType('image').props.x).toBe(201)
  expect(view.root.findByType(GroupNavigator).props.items[0].dirty).toBe(true)
  expect(button('撤销').props.disabled).toBe(false)
})

it('刷新图源自动保存当前拼图，保留另一份草稿和撤销记录', async () => {
  let state = refreshFixture()
  const save = vi.fn(async (_request: Omit<CompositionSave,'project'>) => ({digest:'saved',asset:'groups/one.png'}))
  const readAsset = vi.fn(async (path:string) => `data:${path}:${state.assets[0]!.digest}`)
  await act(async()=>{view=create(h(CompositionEditor,{load:async()=>structuredClone(state),save,readAsset}))})
  const button=(text:string)=>view.root.findAllByType('button').find(b=>b.children.includes(text))!
  const choose=async(id:string)=>{await act(async()=>{view.root.findByType(GroupNavigator).props.choose(id)})}
  const move=async()=>{await act(async()=>{button('Figure 1 · b').props.onClick()});await act(async()=>{view.root.findByProps({className:'jc-compose'}).props.onKeyDown({key:'ArrowRight',shiftKey:true,target:{closest:()=>null},preventDefault:()=>{}})})}
  const image=(id:string)=>view.root.findByProps({'data-member':id}).findByType('image').props
  await move(); await choose('two'); await move(); await choose('one')
  expect(image('b').x).toBe(210)
  state = {...state,assets:state.assets.map(a=>a.id==='a'?{...a,width:50,height:100,digest:'recropped'}:a),groups:state.groups.map(g=>({...g,stale:true}))}
  await act(async()=>{button('刷新图源').props.onClick()})
  expect(save).toHaveBeenCalledTimes(1)
  expect(image('a').href).toContain('recropped')
  expect(image('b').x).toBe(155)
  expect(image('a')).toMatchObject({x:0,y:0,width:30,height:60})
  await act(async()=>{button('撤销').props.onClick()});expect(image('b').x).toBe(200)
  await act(async()=>{button('重做').props.onClick()});expect(image('b').x).toBe(155)
  await choose('two'); expect(image('b').x).toBe(210); expect(image('a').width).toBe(30)
  await choose('one'); await act(async()=>{button('保存拼图').props.onClick()})
  expect(save.mock.calls[0]![0]).toMatchObject({id:'one',create:false,base_digest:'base',inputs:[{id:'a',digest:'recropped'},{id:'b',digest:'old-b'}],geometry:{cells:[{member:'a',x:0,y:0,width:30,height:60},{member:'b',x:155,y:0,width:100,height:60}]}})
  expect(view.root.findByType(GroupNavigator).props.items.map((g:{id:string})=>g.id)).toEqual(['one','two'])
  expect(view.root.findByType(GroupNavigator).props.items[1].stale).toBe(true)
})

it('刷新不能解除外部布局冲突，缺失素材时保留成员并禁止保存，失败刷新不丢草稿', async () => {
  let state = refreshFixture(), fail=false
  const save=vi.fn(async (_request:Omit<CompositionSave,'project'>)=>{throw Error('拼图文件已被修改')})
  await act(async()=>{view=create(h(CompositionEditor,{load:async()=>{if(fail)throw Error('读取失败');return structuredClone(state)},save,readAsset:async()=>''}))})
  const button=(text:string)=>view.root.findAllByType('button').find(b=>b.children.includes(text))!
  state={...state,digest:'external',assets:[]}
  await act(async()=>{button('刷新图源').props.onClick()})
  expect(button('保存拼图').props.disabled).toBe(true)
  expect(view.root.findAllByProps({'data-member':'a'})).toHaveLength(1)
  state={...state,assets:refreshFixture().assets}
  await act(async()=>{button('刷新图源').props.onClick()})
  await act(async()=>{button('保存拼图').props.onClick()})
  expect(save.mock.calls[0]![0].base_digest).toBe('base')
  expect(button('重新加载布局（放弃当前草稿）')).toBeDefined()
  fail=true; await act(async()=>{button('刷新图源').props.onClick()})
  expect(view.root.findByProps({'data-member':'b'}).findByType('image').props.x).toBe(200)
})

it('加入对话先保存草稿再插入，阻止连续点击重复保存，已保存图直接引用', async () => {
  let resolveSave!: (value:{digest:string;asset:string})=>void
  const save=vi.fn(()=>new Promise<{digest:string;asset:string}>(resolve=>{resolveSave=resolve}))
  const insert=vi.fn(), prepareConversation=vi.fn(()=>insert)
  await act(async()=>{view=create(h(CompositionEditor,{load:async()=>refreshFixture(),save,readAsset:async()=>'',prepareConversation}))})
  const button=(text:string)=>view.root.findAllByType('button').find(b=>b.children.includes(text))!
  await act(async()=>{button('加入对话').props.onClick()})
  expect(save).not.toHaveBeenCalled();expect(prepareConversation).toHaveBeenLastCalledWith('one');expect(insert).toHaveBeenLastCalledWith('groups/one.png')
  insert.mockClear()
  await act(async()=>{button('Figure 1 · b').props.onClick()})
  await act(async()=>{view.root.findByProps({className:'jc-compose'}).props.onKeyDown({key:'ArrowRight',target:{closest:()=>null},preventDefault:()=>{}})})
  const click=button('加入对话').props.onClick
  await act(async()=>{click();click()})
  expect(save).toHaveBeenCalledTimes(1);expect(insert).not.toHaveBeenCalled()
  expect(button('加入对话').props.disabled).toBe(true)
  await act(async()=>{resolveSave({digest:'saved',asset:'groups/one.png'})})
  expect(insert).toHaveBeenCalledTimes(1)
  expect(insert).toHaveBeenCalledWith('groups/one.png')
})

it('保存失败不加入旧图；插入失败可重试且不重存成功的布局', async () => {
  let failSave=true, failInsert=true
  const state=refreshFixture();state.groups[0]!.stale=true
  const save=vi.fn(async()=>{if(failSave)throw Error('保存冲突');return{digest:'saved',asset:'groups/one.png'}})
  const insert=vi.fn(()=>{if(failInsert)throw Error('输入框已变化')})
  await act(async()=>{view=create(h(CompositionEditor,{load:async()=>state,save,readAsset:async()=>'',prepareConversation:()=>insert}))})
  const click=()=>view.root.findAllByType('button').find(b=>b.children.includes('加入对话'))!.props.onClick()
  await act(async()=>{click()});expect(insert).not.toHaveBeenCalled()
  failSave=false;await act(async()=>{click()});expect(insert).toHaveBeenCalledTimes(1)
  failInsert=false;await act(async()=>{click()});expect(save).toHaveBeenCalledTimes(2);expect(insert).toHaveBeenCalledTimes(2)
})
