import { act, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { queryStreamZh as text } from '../../src/renderer/locales/queryStreamExport.zh-CN';
import { csvExportZh } from '../../src/renderer/locales/csvExport.zh-CN';
import type { QueryStreamExportOutput } from '../../src/shared/queryStreamExport';
vi.mock('../../src/renderer/components/QueryParametersDialog', () => ({ QueryParametersDialog: () => null }));
const descriptors = ['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
let document: ReturnType<typeof memoryDocument>, root: ReturnType<typeof import('react-dom/client').createRoot>|undefined, createRoot: typeof import('react-dom/client').createRoot, Dialog: typeof import('../../src/renderer/components/QueryStreamExportDialog').QueryStreamExportDialog;
let requests: {command:string;input:any}[], execute: ReturnType<typeof vi.fn>, names: ReturnType<typeof vi.fn>, settle: (value:QueryStreamExportOutput)=>void;
beforeAll(async()=>{
  document=memoryDocument();(document as any).oninput=null;Object.assign(window,{setTimeout,clearTimeout});const create=document.createElement.bind(document);
  document.createElement=name=>{const node=create(name);
    // 只反射标准DOM属性，不复制产品配置/选择/执行逻辑。
    if(name==='input'){let type='text';Object.defineProperty(node,'type',{configurable:true,get:()=>type,set:value=>{type=value;node.attributes.set('type',value);}});node.type='text';}
    if(name==='option')Object.defineProperty(node,'value',{configurable:true,get:()=>node.attributes.get('value')??node.textContent,set:value=>node.attributes.set('value',value)});
    if(name==='select'){Object.defineProperty(node,'options',{get:()=>node.querySelectorAll('option')});Object.defineProperty(node,'value',{configurable:true,get:()=>node.querySelectorAll('option').find(option=>(option as any).selected)?.value??'',set:value=>{for(const option of node.querySelectorAll('option'))(option as any).selected=option.value===value;}});}
    const set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);node.setAttribute=(key,value)=>{set(key.toLowerCase(),value);if(key==='disabled')node.disabled=true;};node.removeAttribute=key=>{remove(key.toLowerCase());if(key==='disabled')node.disabled=false;};return node;
  };
  ({createRoot}=await import('react-dom/client'));({QueryStreamExportDialog:Dialog}=await import('../../src/renderer/components/QueryStreamExportDialog'));
});
afterEach(async()=>{if(root){await act(async()=>root!.unmount());root=undefined;}delete(window as any).dbark;document.body.textContent='';});
afterAll(()=>{for(const[name,descriptor]of descriptors)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});
/** 两个正式格式共用真实React状态机；只有IPC、父执行端口和参数编辑器使用RAM替身。 */
async function mount(format:'csv'|'csv-zip',choose?:()=>Promise<any>){
  let file=0;requests=[];execute=vi.fn(()=>new Promise<QueryStreamExportOutput>(resolve=>{settle=resolve;}));names=vi.fn();
  (window as any).dbark={onTask:()=>()=>{},invoke:async(command:string,input:any)=>{requests.push({command,input});if(command==='files.choose')return choose?choose():{token:'file-'+ ++file,name:'已选'+file+'.'+input.format};throw Error('不得访问其它IPC');}};
  const container=document.createElement('div');document.body.appendChild(container);root=createRoot(container as any);
  await act(async()=>root!.render(<StrictMode><Dialog source="固定SQL不得在选择文件时执行" sessionBusy={false} loadNames={names} onExecute={execute} onCancel={vi.fn(async()=>undefined)} onClose={vi.fn()}/></StrictMode>));
  await change(document.querySelector(`select[aria-label="${text.format}"]`)! ,format);
}
function callback(node:any,event='onClick'){const key=Object.keys(node).find(key=>key.startsWith('__reactProps$'));if(!key)throw Error('缺少React真实回调');return node[key][event] as(value?:any)=>void;}
function delimiter(){return document.querySelector(`select[aria-label="${csvExportZh.label}"]`)!;}
function picker(){return document.querySelectorAll('button').find(node=>node.getAttribute('class')==='file-picker')!;}
function start(){return document.querySelectorAll('button').find(node=>node.getAttribute('class')==='primary')!;}
function acknowledgement(){return document.querySelectorAll('input').find(node=>node.type==='checkbox'&&node.parentNode?.textContent.includes(text.acknowledge))!;}
async function change(node:any,value:string){await act(async()=>{node.value=value;node.dispatchEvent(new MemoryEvent('change'));});}
async function click(node:any){expect(node.disabled).toBe(false);await act(async()=>node.dispatchEvent(new MemoryEvent('click')));}
async function acknowledge(){await act(async()=>callback(acknowledgement(),'onChange')({target:{checked:true}}));}
function completed():QueryStreamExportOutput{return{statementsCompleted:1,results:[],fileCommitted:true,transactionKnown:true,preview:{results:[],elapsedMs:0}};}

describe.each(['csv','csv-zip'] as const)('%s完整流式真实表单',format=>{
  it.each([';','\t'])('分隔符%s撤销文件与确认，旧启动/选择回调无效，新文件和确认后只投递一次',async separator=>{
    await mount(format);expect(delimiter().value).toBe(',');expect(delimiter().querySelectorAll('option').map(node=>node.value)).toEqual([',',';','\t']);
    await click(picker());await acknowledge();const oldStart=callback(start()),oldChoose=callback(picker());await change(delimiter(),separator);
    expect(acknowledgement().checked).toBe(false);expect(start().disabled).toBe(true);await act(async()=>{oldStart();oldChoose();});expect(requests).toHaveLength(1);expect(execute).not.toHaveBeenCalled();
    await click(picker());expect(acknowledgement().checked).toBe(false);await acknowledge();await click(start());
    expect(execute).toHaveBeenCalledOnce();expect(execute.mock.calls[0][0]).toMatchObject({format,csvDelimiter:separator,fileToken:'file-2',resultSelection:format==='csv'?{kind:'row-result',ordinal:1}:{kind:'all'}});expect(execute.mock.calls[0][0]).not.toHaveProperty('insertTarget');
    expect(requests.map(value=>value.command)).toEqual(['files.choose','files.choose']);expect(requests.map(value=>value.input.format)).toEqual([format==='csv'?'csv':'zip',format==='csv'?'csv':'zip']);expect(names).not.toHaveBeenCalled();
  });
  it('分隔符A→B→A后旧配置、旧确认和旧执行都不能复活，新的默认请求仍省略字段',async()=>{
    await mount(format);await click(picker());await acknowledge();const oldStart=callback(start()),oldChange=callback(delimiter(),'onChange'),oldAck=callback(acknowledgement(),'onChange');
    await change(delimiter(),';');await change(delimiter(),',');await act(async()=>oldChange({target:{value:';'}}));expect(delimiter().value).toBe(',');
    await click(picker());await act(async()=>oldAck({target:{checked:true}}));expect(acknowledgement().checked).toBe(false);await act(async()=>oldStart());expect(execute).not.toHaveBeenCalled();
    await acknowledge();await click(start());expect(execute).toHaveBeenCalledOnce();expect(execute.mock.calls[0][0]).not.toHaveProperty('csvDelimiter');expect(execute.mock.calls[0][0].fileToken).toBe('file-2');
  });
  it('选择在途配置锁定，排队的旧分隔符事件不能改配置或触发SQL，迟到文件只绑定原配置',async()=>{
    let finish!:(value:any)=>void;const pending=new Promise(resolve=>{finish=resolve;});await mount(format,()=>pending);const oldChange=callback(delimiter(),'onChange');await click(picker());expect(delimiter().disabled).toBe(true);
    await act(async()=>oldChange({target:{value:';'}}));expect(delimiter().value).toBe(',');expect(execute).not.toHaveBeenCalled();await act(async()=>finish({token:'原选择',name:'原文件'}));expect(requests).toHaveLength(1);expect(start().disabled).toBe(true);expect(names).not.toHaveBeenCalled();
  });
  it('执行busy与完成后保持配置锁，旧配置/旧启动不得再次执行',async()=>{
    await mount(format);await click(picker());await acknowledge();const oldChange=callback(delimiter(),'onChange'),oldStart=callback(start());await click(start());expect(delimiter().disabled).toBe(true);await act(async()=>oldChange({target:{value:'\t'}}));expect(delimiter().value).toBe(',');expect(execute).toHaveBeenCalledOnce();
    await act(async()=>settle(completed()));expect(delimiter().disabled).toBe(true);await act(async()=>oldStart());expect(execute).toHaveBeenCalledOnce();
  });
  it('切换JSON后隐藏分隔符且最终请求不夹带CSV状态',async()=>{
    await mount(format);await change(delimiter(),';');await change(document.querySelector(`select[aria-label="${text.format}"]`)!,'json');expect(delimiter()).toBeNull();await click(picker());await acknowledge();await click(start());expect(execute.mock.calls[0][0].format).toBe('json');expect(execute.mock.calls[0][0]).not.toHaveProperty('csvDelimiter');expect(requests).toHaveLength(1);
  });
});
