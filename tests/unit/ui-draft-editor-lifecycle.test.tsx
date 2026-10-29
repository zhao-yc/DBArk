import React, {act} from 'react';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {memoryDocument,MemoryEvent,MemoryNode} from '../fixtures/memory-dom';
import {installNavigationMenuRamPort,navigationMenuRamButton} from '../helpers/navigationMenuRamPort';
import {tableCopyMetadataKey} from '../../src/shared/tableCopySource';
import {draftHistoryZh as text} from '../../src/renderer/locales/draftHistory.zh-CN';
import {zh} from '../../src/renderer/locales/zh-CN';
import type {DraftRow} from '../../src/renderer/dataChanges';
import type {TableInfo} from '../../src/shared/contracts';

const io=vi.hoisted(()=>({rows:[] as DraftRow[],begin:null as any,replace:null as any,notify:null as any}));
/** 只替换网格外界端口；沿实际beta.61的flushSync(updateRow+closeEditor)提交顺序，不派发blur。 */
vi.mock('react-data-grid',async()=>{
 const {useState,useImperativeHandle,createElement}=await import('react'),{flushSync}=await import('react-dom');
 return{SelectColumn:{key:'select-row'},DataGrid(props:any){
  const [editing,setEditing]=useState<any>(null),[epoch,setEpoch]=useState(0);io.rows=props.rows;
  useImperativeHandle(props.ref,()=>({setActivePosition(){},scrollToCell(){}}),[]);
  const column=props.columns.find((item:any)=>item.key==='note');
  io.begin=()=>{props.onActivePositionChange({row:props.rows[0],column});setEditing(props.rows[0]);};io.replace=()=>setEpoch(value=>value+1);
  function close(commit=false){if(commit)flushSync(()=>{if(editing!==props.rows[0])props.onRowsChange(props.rows.with(0,editing));setEditing(null)});else setEditing(null);}
  const editor=editing?column.renderEditCell({row:editing,column,onRowChange:(row:any,commit=false)=>{if(commit)flushSync(()=>{props.onRowsChange(props.rows.with(0,row));setEditing(null)});else setEditing(row)},onClose:close}):null;
  io.notify=editor?.props.onEditingChange;
  function key(event:any){let prevented=false;event.preventGridDefault=()=>{prevented=true};props.onCellKeyDown({mode:editing?'EDIT':'ACTIVE',row:editing??props.rows[0],column},event);if(prevented||!editing)return;if(event.key==='Enter'||event.key==='Tab')close(true);else if(event.key==='Escape')close(false);}
  return createElement('div',{role:'grid',onKeyDown:key},editing?createElement(React.Fragment,{key:epoch},editor):createElement('div',{role:'gridcell',onDoubleClick:io.begin},String(props.rows[0]?.data.note??'')));
 }};
});
vi.mock('../../src/renderer/components/SqlEditor',()=>({SqlEditor:()=>null}));

let document:ReturnType<typeof memoryDocument>,createRoot:typeof import('react-dom/client')['createRoot'],root:ReturnType<typeof createRoot>|undefined;
let TableTab:typeof import('../../src/renderer/components/TableTab')['TableTab'],useWorkspace:typeof import('../../src/renderer/store')['useWorkspace'],flushSettings:typeof import('../../src/renderer/store')['flushSettings'];
let commands:string[],blurEvents=0;
const globalNames=['window','document','navigator','HTMLElement','IS_REACT_ACT_ENVIRONMENT'],globals=globalNames.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
const originalFocus=MemoryNode.prototype.focus,originalQuery=MemoryNode.prototype.querySelector,oldClosest=Object.getOwnPropertyDescriptor(MemoryNode.prototype,'closest'),oldSelect=Object.getOwnPropertyDescriptor(MemoryNode.prototype,'select');
let restoreNavigationMenuPort=()=>{};
beforeAll(async()=>{
 document=memoryDocument();restoreNavigationMenuPort=installNavigationMenuRamPort(document);(document as any).oninput=null;Object.defineProperty(globalThis,'HTMLElement',{value:MemoryNode,configurable:true});
 const create=document.createElement.bind(document);document.createElement=(name:string)=>{const node=create(name);if(name==='input')node.type='text';if(name==='select')Object.defineProperty(node,'options',{get:()=>node.querySelectorAll('option')});
  // ReactDOM按HTML布尔属性写入disabled，测试读回与浏览器一致；不推导产品状态。
  const set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);node.setAttribute=(key,value)=>{set(key,value);if(key==='disabled')node.disabled=true;};node.removeAttribute=key=>{remove(key);if(key==='disabled')node.disabled=false;};return node;};
 // 只补本测试使用的类选择及focusin。removeChild沿原内存DOM实现，明确不会补发focusout/blur。
 Object.defineProperty(MemoryNode.prototype,'closest',{configurable:true,value:function(this:MemoryNode,selector:string){for(let node:MemoryNode|null=this;node;node=node.parentNode)if(selector.split(',').some(part=>part.trim()==='.grid-input'?(node.getAttribute('class')??'').split(' ').includes('grid-input'):part.trim()==='[role="grid"]'?node.getAttribute('role')==='grid':['input','textarea','select'].includes(part.trim())&&node.tagName.toLowerCase()===part.trim()))return node;return null;}});
 Object.defineProperty(MemoryNode.prototype,'select',{configurable:true,value:function(this:MemoryNode){this.setSelectionRange(0,this.value.length)}});
 MemoryNode.prototype.querySelector=function(selector:string){if(selector==='.grid-input'){const walk=(node:MemoryNode):MemoryNode|null=>{for(const child of node.childNodes){if((child.getAttribute('class')??'').split(' ').includes('grid-input'))return child;const found=walk(child);if(found)return found;}return null;};return walk(this)!;}return originalQuery.call(this,selector);};
 MemoryNode.prototype.focus=function(){originalFocus.call(this);this.dispatchEvent(new MemoryEvent('focusin'));};
 document.addEventListener('focusout',()=>{blurEvents++});
 ({createRoot}=await import('react-dom/client'));({TableTab}=await import('../../src/renderer/components/TableTab'));({useWorkspace,flushSettings}=await import('../../src/renderer/store'));
});
afterEach(async()=>{if(root){await act(async()=>root!.unmount());root=undefined;}await flushSettings();});
afterAll(()=>{restoreNavigationMenuPort();MemoryNode.prototype.focus=originalFocus;MemoryNode.prototype.querySelector=originalQuery;for(const[name,descriptor]of [['closest',oldClosest],['select',oldSelect]] as const){if(descriptor)Object.defineProperty(MemoryNode.prototype,name,descriptor);else Reflect.deleteProperty(MemoryNode.prototype,name);}for(const[name,descriptor]of globals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}});

/** TableTab、记录控制器、草稿历史、实际编辑器及ReactDOM均使用生产代码；只提供RAM IPC。 */
async function mount(strict=false){
 commands=[];blurEvents=0;const info:TableInfo={database:'db',name:'items',objectKind:'table',engine:'InnoDB',primaryKey:['id'],editableKey:['id'],foreignKeys:[],indexes:[],ddl:'',columns:['id','note','bytes','doc'].map(name=>({name,type:name==='bytes'?'blob':'text',nullable:true,defaultValue:null,extra:name==='id'?'auto_increment':'',generated:false,comment:''}))};
 const source={id:'18446744073709551615',note:'原值',bytes:{type:'binary',base64:'AAH/'},doc:'{"x":1,"x":-0,"n":900719925474099312345}'};
 (window as any).dbark={onTask:()=>()=>{},invoke:async(command:string,input:any)=>{commands.push(command);if(command==='settings.save'||command==='connections.open'||command==='query.cancel')return;if(command==='table.preferences.get')return null;if(command==='metadata.table')return info;if(command==='table.page')return{page:input.page,pageSize:input.pageSize,hasMore:false,rows:[structuredClone(source)],columns:info.columns.map(column=>({key:column.name,name:column.name,type:column.type})),copyMetadataKey:tableCopyMetadataKey(info)};throw Error('禁止额外IO:'+command);}};
 const tab={id:'表页',kind:'table' as const,connectionId:'连接',database:'db',table:'items',title:'合成表'};
 useWorkspace.setState({settings:{theme:'dark',sidebarWidth:260,resultLimit:1000,pageSize:50,activeTabId:tab.id,tabs:[tab]},connections:[{id:'连接',name:'合成离线连接',group:'',color:'#51bda5',dialect:'mysql',host:'offline.invalid',port:1,user:'offline'}],connectionVersions:{连接:1},activeJobs:{},dirtyTabs:{},tableLayoutDrafts:{}});
 const noop=()=>{};const view=<TableTab tab={tab} onDesign={noop} onTransfer={noop} onColumnPatches={noop} onIndexPatches={noop} onForeignKeyPatches={noop} onTableRename={noop} onTableAutoIncrement={noop} onTableComment={noop} onTableDefaultEncoding={noop}/>;
 const container=document.createElement('div');document.body.appendChild(container);root=createRoot(container as any);await act(async()=>root!.render(strict?<React.StrictMode>{view}</React.StrictMode>:view));expect(io.rows).toHaveLength(1);
}
const buttons=()=>document.body.querySelectorAll('button');
function button(label:string){const found=navigationMenuRamButton(document.body,label);expect(found).toBeDefined();return found!;}
const input=()=>document.body.querySelector('.grid-input');
/** 菜单关闭时不读取隐藏撤销按钮；保留生产禁用表达式，并实际确认更多不会抢走网格输入焦点。 */
async function expectUndoInputBlocked(){
 const source=ts.createSourceFile('TableTab.tsx',readFileSync(new URL('../../src/renderer/components/TableTab.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let blocked='',disabled='';
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='historyBlocked')blocked=node.initializer!.getText(source);if(ts.isJsxOpeningElement(node)&&node.tagName.getText(source)==='button'&&node.attributes.properties.some(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.getText(source)==='aria-label'&&attribute.initializer&&ts.isJsxExpression(attribute.initializer)&&attribute.initializer.expression?.getText(source)==='draftHistoryZh.undo')){const attribute=node.attributes.properties.find(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.getText(source)==='disabled') as ts.JsxAttribute;disabled=(attribute.initializer as ts.JsxExpression).expression!.getText(source);}ts.forEachChild(node,visit);};visit(source);
 expect(blocked).not.toBe('');expect(disabled).not.toBe('');
 const value=runInNewContext(ts.transpileModule(`const historyBlocked=(${blocked});(${disabled})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{blocked:false,editable:true,record:{dirty:false,pending:false,cellKey:null,nodeInput:null,structureInput:null},gridEditing:true,showPreferences:false,referenceDialog:null,pasteInsertDialog:null,batchFillDialog:null,settings:{activeTabId:'原页'},tab:{id:'原页'},history:{status:{undo:1}}});
 expect(value).toBe(true);const before=document.querySelectorAll('[role="menu"]').length,editor=input(),more=button('更多');expect(more.disabled).toBe(true);
 await act(async()=>more.dispatchEvent(new MemoryEvent('click')));expect(document.querySelectorAll('[role="menu"]')).toHaveLength(before);expect(input()).toBe(editor);
}
async function begin(){await act(async()=>io.begin());expect(input()).not.toBeNull();await expectUndoInputBlocked();}
async function type(value:string){const node=input()!;await act(async()=>{node.value=value;node.dispatchEvent(new MemoryEvent('input'));});}
async function key(value:string,composition=false){const event=new MemoryEvent('keydown');event.key=value;Object.assign(event,{isComposing:composition,keyCode:composition?229:13,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false});await act(async()=>input()!.dispatchEvent(event));return event;}
async function click(label:string){const node=button(label);expect(node.disabled).toBe(false);await act(async()=>node.dispatchEvent(new MemoryEvent('click')));}

describe('真实ReactDOM编辑器卸载与父层草稿历史',()=>{
 it('Enter提交不派发blur后编辑器已移除，撤销立即可用且可重做',async()=>{
  await mount();const original=io.rows[0].original;await begin();await type('新值');await key('Enter');expect(input()).toBeNull();expect(io.rows[0].data.note).toBe('新值');expect(blurEvents).toBe(0);
  expect(button(text.undo).textContent).toContain('(1)');expect(button(text.undo).disabled).toBe(false);const before=commands.length;await click(text.undo);expect(io.rows[0].data.note).toBe('原值');await click(text.redo);expect(io.rows[0].data.note).toBe('新值');expect(io.rows[0].original).toBe(original);expect(commands).toHaveLength(before);
 });
 it.each(['Escape','Tab'])('%s无blur结束编辑，取消不记历史、提交只记一步',async action=>{
  await mount();await click(zh.common.add);const id=io.rows[1].id;await begin();await type('暂存新值');await key(action);expect(input()).toBeNull();expect(blurEvents).toBe(0);expect(button(text.undo).disabled).toBe(false);expect(io.rows[0].data.note).toBe(action==='Escape'?'原值':'暂存新值');expect(button(text.undo).textContent).toContain(action==='Escape'?'(1)':'(2)');expect(io.rows[1].id).toBe(id);
 });
 it('IME Enter不提交也不释放编辑占门；结束组合后原Enter只提交一次',async()=>{
  await mount();await begin();await type('组合值');await key('Enter',true);expect(input()).not.toBeNull();await expectUndoInputBlocked();expect(io.rows[0].data.note).toBe('原值');await key('Enter');expect(input()).toBeNull();expect(button(text.undo).disabled).toBe(false);expect(button(text.undo).textContent).toContain('(1)');
 });
 it('编辑器替换后旧卸载不能清掉新编辑占门，结束新会话才可撤销',async()=>{
  await mount();await click(zh.common.add);await begin();const old=input();await act(async()=>io.replace());expect(input()).not.toBe(old);await expectUndoInputBlocked();await key('Escape');expect(input()).toBeNull();expect(button(text.undo).disabled).toBe(false);
 });
 it('StrictMode真实重复effect后可完成提交，回调在改字重渲染间稳定',async()=>{
  await mount(true);await begin();const notify=io.notify;expect(typeof notify).toBe('function');await type('严格模式');expect(io.notify).toBe(notify);await key('Enter');expect(input()).toBeNull();expect(button(text.undo).disabled).toBe(false);
 });
 it('编辑期间CtrlZ保留给原生输入，父层历史不消费按键',async()=>{
  await mount();await click(zh.common.add);await begin();await type('输入草稿');const event=new MemoryEvent('keydown');event.key='z';Object.assign(event,{ctrlKey:true,metaKey:false,shiftKey:false,altKey:false});await act(async()=>input()!.dispatchEvent(event));expect(event.defaultPrevented).toBe(false);expect(io.rows).toHaveLength(2);expect(io.rows[0].data.note).toBe('原值');expect(input()!.value).toBe('输入草稿');await expectUndoInputBlocked();
 });
 it('整页卸载不补blur、不提交未完成输入或发送SQL',async()=>{
  await mount();await begin();await type('未提交字段');const before=commands.length;await act(async()=>root!.unmount());root=undefined;expect(input()).toBeNull();expect(blurEvents).toBe(0);expect(commands.slice(before).filter(command=>command==='table.apply'||command==='table.preview')).toEqual([]);expect(useWorkspace.getState().dirtyTabs.表页??false).toBe(false);
 });
 it('生产生命周期回调在父页卸载后不调用setState，也不修改新旧会话引用',()=>{
  // 直接执行生产回调验证卸载守卫；不以React静默丢弃卸载后setState代替证据。
  const source=ts.createSourceFile('TableTab.tsx',readFileSync(new URL('../../src/renderer/components/TableTab.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback:ts.Expression|undefined;
  const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='onGridEditingChange'&&node.initializer&&ts.isCallExpression(node.initializer))callback=node.initializer.arguments[0];ts.forEachChild(node,visit);};visit(source);expect(callback).toBeDefined();
  const setGridEditing=vi.fn(),activeGridEditor={current:{} as object|null},mounted={current:true};
  // 原例没有打开勾选值预览或全部筛选行填充，补齐真实空意图引用，原生命周期断言保持。
  const notify=runInNewContext(ts.transpileModule(`(${callback!.getText(source)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{mounted,activeGridEditor,setGridEditing,filteredDeleteIntent: { current: null }, filteredUpdateIntent:{current:null},selectedFilterRef:{current:null}}) as (editor:object,editing:boolean)=>void;
  const first={},second={};notify(first,true);notify(second,true);notify(first,false);expect(activeGridEditor.current).toBe(second);expect(setGridEditing.mock.calls).toEqual([[true],[true]]);notify(second,false);expect(setGridEditing).toHaveBeenLastCalledWith(false);
  activeGridEditor.current=second;setGridEditing.mockClear();mounted.current=false;notify(second,false);notify(first,true);expect(activeGridEditor.current).toBe(second);expect(setGridEditing).not.toHaveBeenCalled();
 });
});
