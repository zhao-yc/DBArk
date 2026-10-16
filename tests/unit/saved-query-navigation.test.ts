import {describe,expect,it,vi} from 'vitest';
import type * as monaco from 'monaco-editor';
import {SavedQueryNavigation,SavedQueryNavigationLifetime,sameSavedQueryNavigation,validSavedQuerySpans,type SavedQueryNavigationIdentity,type SavedQueryNavigationState} from '../../src/renderer/savedQueryNavigation';
import type {SavedQueryNavigationSource} from '../../src/shared/savedQuerySearch';

const source=():SavedQueryNavigationSource=>({queryId:'q',digest:'a'.repeat(64),sql:'😀 x x\r\nx',connectionId:'c',connectionVersion:2,occurrences:{ranges:[{offset:3,length:1},{offset:5,length:1},{offset:8,length:1}],limitReached:false}});
const identity=(value=source()):SavedQueryNavigationIdentity=>({sql:value.sql,connectionId:value.connectionId,connectionVersion:value.connectionVersion,sourceBinding:{id:value.queryId,digest:value.digest,context:{state:'unknown'}}});

/** Monaco端口替身只观察装饰、光标与生命周期，不提供任何编辑或SQL执行能力。 */
function fixture(value=source(),modelText=value.sql){
 let current:SavedQueryNavigationIdentity|undefined=identity(value),version=1,text=modelText,disposed=false;
 const events={content:new Set<()=>void>(),model:new Set<()=>void>(),dispose:new Set<()=>void>(),editorDispose:new Set<()=>void>()};
 const listen=(event:keyof typeof events,callback:()=>void)=>{events[event].add(callback);return{dispose:()=>events[event].delete(callback)};};
 const model={getValue:()=>text,getVersionId:()=>version,isDisposed:()=>disposed,getPositionAt:(offset:number)=>({lineNumber:1,column:offset+1}),onDidChangeContent:(callback:()=>void)=>listen('content',callback),onWillDispose:(callback:()=>void)=>listen('dispose',callback)};
 let activeModel:unknown=model;
 const decorations={set:vi.fn(),clear:vi.fn()};
 const editor={getModel:()=>activeModel,createDecorationsCollection:vi.fn(()=>decorations),onDidChangeModel:(callback:()=>void)=>listen('model',callback),onDidDispose:(callback:()=>void)=>listen('editorDispose',callback),setPosition:vi.fn(),revealPositionInCenter:vi.fn(),focus:vi.fn()};
 const states:SavedQueryNavigationState[]=[];
 const navigation=new SavedQueryNavigation(editor as unknown as monaco.editor.IStandaloneCodeEditor,value,()=>current,state=>states.push(state));
 return{navigation,editor,decorations,states,events,setCurrent:(value:SavedQueryNavigationIdentity|undefined)=>{current=value;},version:()=>{version++;},edit:()=>{text+='改';version++;for(const callback of [...events.content])callback();},replaceModel:()=>{activeModel={};for(const callback of [...events.model])callback();},disposeModel:()=>{disposed=true;for(const callback of [...events.dispose])callback();},disposeEditor:()=>{for(const callback of [...events.editorDispose])callback();}};
}
describe('保存查询导航模型与来源租约',()=>{
 it('多处同时装饰，上一处/下一处循环只移动光标，不覆盖命中文本',()=>{
  const test=fixture();expect(test.decorations.set.mock.calls[0][0]).toHaveLength(3);
  expect(test.editor.setPosition).toHaveBeenLastCalledWith({lineNumber:1,column:4});
  test.navigation.move(1);expect(test.states.at(-1)).toMatchObject({index:1,count:3});
  test.navigation.move(-1);test.navigation.move(-1);expect(test.states.at(-1)).toMatchObject({index:2});
  test.navigation.move(1);expect(test.states.at(-1)).toMatchObject({index:0});test.navigation.dispose();
 });
 it('模型编辑立即清理，恢复同一正文或旧回调也不能恢复高亮',()=>{
  const test=fixture(),late=[...test.events.content][0];test.edit();expect(test.decorations.clear).toHaveBeenCalledTimes(1);
  test.setCurrent(identity());test.navigation.move(1);late();expect(test.decorations.set).toHaveBeenCalledTimes(1);expect(test.states.at(-1)?.status).toBe('invalid');
  test.navigation.dispose();expect(test.states.at(-1)?.status).toBe('closed');test.navigation.dispose();expect(test.decorations.clear).toHaveBeenCalledTimes(1);
 });
 it.each(['正文','连接','连接修订','来源id','来源摘要','标签关闭'] as const)('%s变化先清除高亮，切回旧来源不能复活',kind=>{
  const test=fixture(),current=identity();
  if(kind==='正文')current.sql+='改';if(kind==='连接')current.connectionId='other';if(kind==='连接修订')current.connectionVersion++;
  if(kind==='来源id')current.sourceBinding!.id='other';if(kind==='来源摘要')current.sourceBinding!.digest='b'.repeat(64);
  test.setCurrent(kind==='标签关闭'?undefined:current);expect(test.navigation.refresh()).toBe(false);expect(test.decorations.clear).toHaveBeenCalledTimes(1);
  test.setCurrent(identity());test.navigation.move(1);expect(test.decorations.set).toHaveBeenCalledTimes(1);test.navigation.dispose();
 });
 it.each(['换模型','销毁模型','销毁编辑器','修订静默变化','主动取消'] as const)('%s后不再显示或导航旧范围',kind=>{
  const test=fixture();if(kind==='换模型')test.replaceModel();if(kind==='销毁模型')test.disposeModel();if(kind==='销毁编辑器')test.disposeEditor();if(kind==='修订静默变化')test.version();if(kind==='主动取消')test.navigation.dispose();
  test.navigation.move(1);expect(test.decorations.clear).toHaveBeenCalledTimes(1);expect(test.decorations.set).toHaveBeenCalledTimes(1);
  expect(Object.values(test.events).reduce((count,event)=>count+event.size,0)).toBe(0);
 });
 it('初始原文、摘要或有界位置不匹配时从未显示装饰，不能钳制越界继续定位',()=>{
  expect(sameSavedQueryNavigation(source(),{...identity(),sql:'其它正文'})).toBe(false);
  for(const value of [{...source(),digest:'invalid'},{...source(),occurrences:{ranges:[{offset:99,length:1}],limitReached:false}}]){
   const test=fixture(value);expect(test.editor.createDecorationsCollection).not.toHaveBeenCalled();expect(test.editor.setPosition).not.toHaveBeenCalled();expect(test.states.at(-1)?.status).toBe('invalid');
  }
 });
 it('明确保留200处上限事实，不把已显示数量当作全部',()=>{
  const value={...source(),sql:'x'.repeat(201),occurrences:{ranges:Array.from({length:200},(_,offset)=>({offset,length:1})),limitReached:true}};
  const test=fixture(value);expect(test.states.at(-1)).toMatchObject({count:200,limitReached:true});test.navigation.dispose();
 });
 it('设置光标同步重入编辑时不能再发布ready或继续旧导航',()=>{
  const test=fixture();test.editor.setPosition.mockImplementationOnce(()=>test.edit());test.navigation.move(1);
  expect(test.states.at(-1)?.status).toBe('invalid');expect(test.editor.focus).toHaveBeenCalledTimes(1);expect(test.decorations.clear).toHaveBeenCalledTimes(1);
 });
 it('模型正文与已核对原文不完全相等时拒绝，包括行尾被规范化',()=>{
  const test=fixture(source(),source().sql.replace('\r\n','\n'));expect(test.editor.createDecorationsCollection).not.toHaveBeenCalled();expect(test.states.at(-1)?.status).toBe('invalid');
 });
 it('回包对象后续被修改不能篡改已核对范围',()=>{
  const value=source(),test=fixture(value);value.occurrences.ranges[1].offset=99;test.navigation.move(1);expect(test.editor.setPosition).toHaveBeenLastCalledWith({lineNumber:1,column:6});test.navigation.dispose();
 });
});
describe('UTF16位置边界',()=>{
 it('拒绝负数、非整数、越界、重叠、无序、代理对中间及超过200处',()=>{
  for(const ranges of [[{offset:-1,length:1}],[{offset:0.5,length:1}],[{offset:0,length:-1}],[{offset:0,length:99}],[{offset:1,length:1}],[{offset:0,length:1}],[{offset:2,length:1},{offset:2,length:0}],[{offset:3,length:1},{offset:2,length:1}],Array.from({length:201},(_,offset)=>({offset,length:0}))])expect(validSavedQuerySpans('😀xx',ranges,false)).toBe(false);
  expect(validSavedQuerySpans('😀xx',[{offset:0,length:2},{offset:2,length:1},{offset:4,length:0}],false)).toBe(true);
  expect(validSavedQuerySpans('',[{offset:0,length:0}],false)).toBe(true);
  expect(validSavedQuerySpans('x',[{offset:0,length:1}],true)).toBe(false);
 });
});
describe('组件效果重挂载的命中终态',()=>{
 it('同一模型版本的严格模式重订阅保留可用，主动结束后不能重建',()=>{
  const lifetime=new SavedQueryNavigationLifetime(),test=fixture(),value=source(),model=test.editor.getModel() as monaco.editor.ITextModel;
  expect(lifetime.claim('tab',value,model)).toBe(true);expect(lifetime.claim('tab',value,model)).toBe(true);lifetime.end();expect(lifetime.claim('tab',value,model)).toBe(false);test.navigation.dispose();
  const missing=new SavedQueryNavigationLifetime();expect(missing.claim('tab',value,null)).toBe(false);expect(missing.claim('tab',value,model)).toBe(false);
 });
 it('模型或版本换过之后即使换回也不可再用，新的明确搜索来源另建租约',()=>{
  const lifetime=new SavedQueryNavigationLifetime(),test=fixture(),value=source(),model=test.editor.getModel() as monaco.editor.ITextModel;
  expect(lifetime.claim('tab',value,model)).toBe(true);test.version();expect(lifetime.claim('tab',value,model)).toBe(false);expect(lifetime.claim('tab',value,model)).toBe(false);
  expect(lifetime.claim('tab',{...value},model)).toBe(true);const replacement={getVersionId:()=>1,isDisposed:()=>false} as monaco.editor.ITextModel;
  expect(lifetime.claim('tab',value,replacement)).toBe(true);expect(lifetime.claim('tab',value,model)).toBe(false);expect(lifetime.claim('tab',value,replacement)).toBe(false);test.navigation.dispose();
 });
});
