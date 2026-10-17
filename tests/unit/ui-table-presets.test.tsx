import React,{act} from 'react';
import {beforeAll,afterAll,beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {memoryDocument,MemoryEvent} from '../fixtures/memory-dom';
import {TablePresetPanel} from '../../src/renderer/components/TablePresetPanel';
import {tablePresetsZh as t} from '../../src/renderer/locales/tablePresets.zh-CN';
import type {TablePresetConfiguration,TablePresetSnapshot} from '../../src/shared/tablePresets';
const {invoke}=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('../../src/renderer/lib',()=>({invoke,errorMessage:(reason:unknown)=>reason instanceof Error?reason.message:String(reason),uid:()=>randomUUID()}));
const globals=['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]as const);
let doc:ReturnType<typeof memoryDocument>,createRoot:typeof import('react-dom/client')['createRoot'],root:ReturnType<typeof createRoot>|undefined,props:React.ComponentProps<typeof TablePresetPanel>;
const id='11111111-1111-4111-8111-111111111111',bindingToken='22222222-2222-4222-8222-222222222222';
const configuration:TablePresetConfiguration={filters:[{column:'payload',operator:'IN',values:['','9007199254740993',' NULL ']},{column:'nullable',operator:'IS NULL'}],filterMode:'any',sort:[{column:'payload',direction:'DESC'}]};
const snapshot:TablePresetSnapshot={version:1,revision:3,bindingToken,source:{connectionRevision:2,connectionDigest:'a'.repeat(64)},entries:[{id,name:'已有方案',connectionDigest:'a'.repeat(64),configuration}]};
beforeAll(async()=>{
 doc=memoryDocument();(doc as any).oninput=null;(window as any).confirm=()=>true;const create=doc.createElement.bind(doc);
 doc.createElement=name=>{const node=create(name);if(name==='input')node.type='text';const set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);node.setAttribute=(key,value)=>{set(key.toLowerCase(),value);if(key==='disabled')node.disabled=true;if(key==='type')node.type=value;if(key==='value'&&name==='option')node.value=String(value);};node.removeAttribute=key=>{remove(key.toLowerCase());if(key==='disabled')node.disabled=false;};
  if(name==='select'){Object.defineProperty(node,'options',{get:()=>node.querySelectorAll('option')});Object.defineProperty(node,'value',{get:()=>node.querySelectorAll('option').find(option=>(option as any).selected)?.value??'',set:value=>{for(const option of node.querySelectorAll('option'))(option as any).selected=option.value===value;}});}return node;};
 ({createRoot}=await import('react-dom/client'));
});
beforeEach(()=>{invoke.mockReset().mockImplementation(async(command)=>command==='table.presets.list'?structuredClone(snapshot):command==='table.presets.apply'?structuredClone(configuration):{...structuredClone(snapshot),revision:4});props={target:{connectionId:'ram',database:'db',table:'t'},connectionVersion:2,refreshVersion:0,columns:['payload','nullable'],configuration:{filters:[],filterMode:'all',sort:[]},disabled:false,beforeApply:vi.fn(()=>true),onApply:vi.fn(()=>true)};});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;doc.body.textContent='';});
afterAll(()=>{for(const[name,value]of globals)if(value)Object.defineProperty(globalThis,name,value);else Reflect.deleteProperty(globalThis,name);});
async function mount(){const host=doc.createElement('div');doc.body.appendChild(host);root=createRoot(host as any);await act(async()=>root!.render(<TablePresetPanel {...props}/>));}
async function render(){await act(async()=>root!.render(<TablePresetPanel {...props}/>));}
function button(text:string){const result=doc.querySelectorAll('button').find(node=>node.textContent===text);if(!result)throw Error('缺少按钮:'+text);return result;}
async function click(text:string){expect(button(text).disabled).toBe(false);await act(async()=>button(text).dispatchEvent(new MemoryEvent('click')));}
async function input(value:string){const node=doc.querySelector('input')!;await act(async()=>{node.value=value;node.dispatchEvent(new MemoryEvent('input'));});}
async function choose(){const node=doc.querySelector('select')!;await act(async()=>{node.value=id;node.dispatchEvent(new MemoryEvent('change'));});}
describe('命名方案真实组件合同（仅RAM IPC）',()=>{
 it('挂载只list不保存/应用；显式保存当前配置并提示值保存在本机，晚回包不清新名称',async()=>{
  await mount();expect(invoke.mock.calls.map(call=>call[0])).toEqual(['table.presets.list']);expect(doc.body.textContent).toContain(t.notice);
  await input('新方案');let finish!:(value:any)=>void;invoke.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click(t.save);await input('后来编辑');finish({...snapshot,revision:4});await act(async()=>{await Promise.resolve();});
  expect(doc.querySelector('input')!.value).toBe('后来编辑');expect(invoke.mock.calls.find(call=>call[0]==='table.presets.save')![1]).toMatchObject({name:'新方案',configuration:props.configuration,expectedRevision:3,bindingToken});expect(props.onApply).not.toHaveBeenCalled();
 });
 it('同名通过独立覆盖动作和CAS，删除精确所选项；不触发条件应用',async()=>{
  await mount();await input('已有方案');expect(button(t.save).disabled).toBe(true);await click(t.replace);expect(invoke.mock.calls.find(call=>call[0]==='table.presets.save')![1]).toMatchObject({replaceId:id,expectedRevision:3});
  await choose();await click(t.remove);expect(invoke.mock.calls.find(call=>call[0]==='table.presets.delete')![1]).toMatchObject({id,expectedRevision:4});expect(props.onApply).not.toHaveBeenCalled();
 });
 it('应用先通过原草稿门再发带任务编号的RPC，精确值/NULL/排序整份恢复',async()=>{
  await mount();await choose();(props.beforeApply as any).mockReturnValueOnce(false);await click(t.apply);expect(invoke.mock.calls.some(call=>call[0]==='table.presets.apply')).toBe(false);
  await click(t.apply);const sent=invoke.mock.calls.find(call=>call[0]==='table.presets.apply')![1];expect(sent).toMatchObject({id,bindingToken,source:snapshot.source});expect(sent.taskId).toMatch(/^[a-f0-9-]{36}$/);expect(props.onApply).toHaveBeenCalledExactlyOnceWith(configuration);
 });
 it('等待中筛选编辑、忙状态或目标换代，晚回包不得覆盖新配置',async()=>{
  await mount();await choose();let finish!:(value:any)=>void;invoke.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click(t.apply);
  const original=props.configuration;props={...props,configuration:{...props.configuration,filterMode:'any'}};await render();props={...props,configuration:original};await render();finish(configuration);await act(async()=>{await Promise.resolve();});expect(props.onApply).not.toHaveBeenCalled();expect(doc.body.textContent).toContain(t.changed);
 });
 it('取消保持pending直到原RPC结算，晚成功不能应用；卸载也取消精确任务',async()=>{
  await mount();await choose();let finish!:(value:any)=>void;invoke.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click(t.apply);const taskId=invoke.mock.calls.find(call=>call[0]==='table.presets.apply')![1].taskId;
  await click(t.cancel);expect(invoke).toHaveBeenCalledWith('query.cancel',{taskId});expect(button(t.apply).disabled).toBe(true);finish(configuration);await act(async()=>{await Promise.resolve();});expect(props.onApply).not.toHaveBeenCalled();expect(button(t.apply).disabled).toBe(false);
 });
 it('目标切换或卸载取消原task，旧回包不能作用于新表',async()=>{
  await mount();await choose();let finish!:(value:any)=>void;invoke.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click(t.apply);const first=invoke.mock.calls.find(call=>call[0]==='table.presets.apply')![1].taskId;
  props={...props,target:{...props.target,table:'next'}};await render();expect(invoke).toHaveBeenCalledWith('query.cancel',{taskId:first});finish(configuration);await act(async()=>{await Promise.resolve();});expect(props.onApply).not.toHaveBeenCalled();
  await choose();invoke.mockImplementationOnce(()=>new Promise(()=>{}));await click(t.apply);const second=invoke.mock.calls.filter(call=>call[0]==='table.presets.apply').at(-1)![1].taskId;await act(async()=>root!.unmount());root=undefined;expect(invoke).toHaveBeenCalledWith('query.cancel',{taskId:second});
 });
 it('缺字段返回或父页拒绝晚应用，整份方案保持原样',async()=>{
  await mount();await choose();invoke.mockImplementationOnce(async()=>({...configuration,sort:[{column:'missing',direction:'ASC'}]}));await click(t.apply);expect(props.onApply).not.toHaveBeenCalled();
  (props.onApply as any).mockReturnValueOnce(false);await click(t.apply);expect(doc.body.textContent).toContain(t.changed);
 });
});
