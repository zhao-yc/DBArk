import { act } from 'react';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { HistoryPagesDialog } from '../../src/renderer/components/HistoryPagesDialog';
import { historyPagesZh as t } from '../../src/renderer/locales/historyPages.zh-CN';
const { invoke, notify } = vi.hoisted(()=>({invoke:vi.fn(),notify:vi.fn()}));
vi.mock('../../src/renderer/lib',()=>({invoke,errorMessage:String,uid:()=>randomUUID()}));
vi.mock('../../src/renderer/store',()=>({useWorkspace:Object.assign((select:(state:unknown)=>unknown)=>select({connections:[]}),{getState:()=>({notify,openTab:vi.fn()})})}));
const globals=['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]as const);
let doc:ReturnType<typeof memoryDocument>,createRoot:typeof import('react-dom/client')['createRoot'],root:ReturnType<typeof createRoot>|undefined,onClose:ReturnType<typeof vi.fn>;
const page=(cursor?:string)=>({items:[],failures:[],scanned:0,matched:0,failed:0,stoppedOnError:false,...(cursor?{cursor}:{})});
beforeAll(async()=>{
 doc=memoryDocument();(doc as any).oninput=null;const create=doc.createElement.bind(doc);
 doc.createElement=name=>{const node=create(name);if(name==='input'){let type='text';Object.defineProperty(node,'type',{configurable:true,get:()=>type,set:value=>{type=value;node.attributes.set('type',value);}});node.type='text';}if(name==='select')Object.defineProperty(node,'options',{get:()=>node.querySelectorAll('option')});const set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);node.setAttribute=(key,value)=>{set(key.toLowerCase(),value);if(key==='disabled')node.disabled=true;if(key==='type')node.type=value;if(name==='option'&&key==='value')node.value=String(value);};node.removeAttribute=key=>{remove(key.toLowerCase());if(key==='disabled')node.disabled=false;};return node;};
 ({createRoot}=await import('react-dom/client'));
});
beforeEach(()=>{invoke.mockReset().mockImplementation(async command=>command==='history.page'||command==='history.pageContinue'?page():undefined);notify.mockReset();onClose=vi.fn();});
afterEach(async()=>{if(root){await act(async()=>root!.unmount());root=undefined;}vi.restoreAllMocks();});
afterAll(()=>{for(const[name,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});
/** 真实ReactDOM事件委派，未替换时间转换、load、关闭或游标清理逻辑。 */
async function mount(){const host=doc.createElement('div');doc.body.appendChild(host);root=createRoot(host as unknown as Element);await act(async()=>root!.render(<HistoryPagesDialog onClose={onClose} onQueries={vi.fn()}/>));}
function button(label:string){const value=doc.querySelectorAll('button').find(node=>node.textContent===label);if(!value)throw Error('缺少按钮：'+label);return value;}
async function click(label:string){expect(button(label).disabled).toBe(false);await act(async()=>button(label).dispatchEvent(new MemoryEvent('click')));}
async function input(label:string,value:string){const node=doc.querySelector(`input[aria-label="${label}"]`)!;await act(async()=>{node.value=value;node.dispatchEvent(new MemoryEvent('input'));});}
describe('历史时间筛选真实ReactDOM与原IPC端口',()=>{
 it('初始无范围；明确绝对端点原样规范后发送并显示时区及端点说明',async()=>{
  await mount();expect(invoke.mock.calls[0][0]).toBe('history.page');expect(invoke.mock.calls[0][1]).not.toHaveProperty('timeRange');
  expect(doc.body.textContent).toContain(t.timeZone);expect(doc.body.textContent).toContain('结束不包含');
  await input(t.from,'2026-10-17T08:00:00+08:00');await input(t.until,'2026-10-18T08:00:00+08:00');await click(t.searchButton);
  expect(invoke.mock.calls.filter(call=>call[0]==='history.page').at(-1)![1].timeRange).toEqual({from:'2026-10-17T00:00:00.000Z',until:'2026-10-18T00:00:00.000Z'});
  expect(doc.querySelector(`input[aria-label="${t.from}"]`)!.value).toBe('2026-10-17T08:00:00+08:00');
 });
 it('非法或倒序输入不请求、不归一化原文字；清除范围后重新搜索恢复不限',async()=>{
  await mount();await input(t.from,'2026-02-30 12:00');await click(t.searchButton);expect(invoke.mock.calls.filter(call=>call[0]==='history.page')).toHaveLength(1);
  expect(doc.querySelector(`input[aria-label="${t.from}"]`)!.value).toBe('2026-02-30 12:00');expect(doc.body.textContent).toContain('无效');
  await input(t.from,'2026-10-18T00:00:00Z');await input(t.until,'2026-10-17T00:00:00Z');await click(t.searchButton);expect(invoke.mock.calls.filter(call=>call[0]==='history.page')).toHaveLength(1);
  await click(t.clearTime);await click(t.searchButton);expect(invoke.mock.calls.filter(call=>call[0]==='history.page').at(-1)![1]).not.toHaveProperty('timeRange');
 });
 it('筛选修改禁续读，重新搜索释放旧游标；续读只传原cursor和新taskId',async()=>{
  invoke.mockImplementation(async command=>command==='history.page'?page('old'):command==='history.pageContinue'?page('new'):undefined);await mount();await click(t.next);
  const next=invoke.mock.calls.find(call=>call[0]==='history.pageContinue')![1];expect(Object.keys(next).sort()).toEqual(['cursor','taskId']);expect(next.cursor).toBe('old');
  await input(t.from,'2026-10-17T00:00:00Z');expect(button(t.next).disabled).toBe(true);await click(t.searchButton);expect(invoke).toHaveBeenCalledWith('history.pageRelease',{cursor:'new'});
  await click('关闭');expect(invoke).toHaveBeenCalledWith('history.pageRelease',{cursor:'old'});expect(onClose).toHaveBeenCalledTimes(1);
 });
 it('关闭等待活动任务，迟到响应的cursor仍被释放，不复活面板或打开标签',async()=>{
  let resolve!:(value:ReturnType<typeof page>)=>void;invoke.mockImplementation(command=>command==='history.page'?new Promise(done=>{resolve=done;}):Promise.resolve(undefined));await mount();await click('关闭');
  expect(invoke.mock.calls.some(call=>call[0]==='query.cancel')).toBe(true);expect(onClose).not.toHaveBeenCalled();
  await act(async()=>resolve(page('late')));expect(invoke).toHaveBeenCalledWith('history.pageRelease',{cursor:'late'});expect(onClose).toHaveBeenCalledTimes(1);expect(invoke.mock.calls.filter(call=>call[0]==='history.page')).toHaveLength(1);
 });
 it('面板固定本机时区，重复夏令时时刻在DOM中明确拒绝，显式偏移才能搜索',async()=>{
  const original=Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype,'resolvedOptions').mockImplementation(function(this:Intl.DateTimeFormat){return{...original.call(this),timeZone:'America/New_York'};});
  await mount();expect(doc.body.textContent).toContain('America/New_York');await input(t.from,'2024-11-03 01:30');await click(t.searchButton);
  expect(invoke.mock.calls.filter(call=>call[0]==='history.page')).toHaveLength(1);expect(doc.body.textContent).toContain('重复');expect(doc.querySelector(`input[aria-label="${t.from}"]`)!.value).toBe('2024-11-03 01:30');
  await input(t.from,'2024-11-03T01:30:00-05:00');await click(t.searchButton);expect(invoke.mock.calls.filter(call=>call[0]==='history.page').at(-1)![1].timeRange).toEqual({from:'2024-11-03T06:30:00.000Z'});
 });
});
