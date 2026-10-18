import {act,StrictMode}from'react';
import{afterAll,afterEach,beforeAll,describe,expect,it,vi}from'vitest';
import{memoryDocument,MemoryEvent}from'../fixtures/memory-dom';
import{queryStreamZh as text}from'../../src/renderer/locales/queryStreamExport.zh-CN';
import{queryInsertZh as insertText}from'../../src/shared/queryInsertExport.zh-CN';
import type{QueryStreamExportOutput}from'../../src/shared/queryStreamExport';
import{readFileSync}from'node:fs';
// 参数编辑器不在本片交互内；只替代Monaco渲染，真实导出表单和控制器仍运行。
vi.mock('../../src/renderer/components/SqlEditor',()=>({SqlEditor:()=>null}));
let document:ReturnType<typeof memoryDocument>,root:ReturnType<typeof import('react-dom/client').createRoot>|undefined,createRoot:typeof import('react-dom/client').createRoot,Dialog:typeof import('../../src/renderer/components/QueryStreamExportDialog').QueryStreamExportDialog;
const descriptors=['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]as const);
let events:Set<(value:any)=>void>,requests:any[],execute:ReturnType<typeof vi.fn>,cancel:ReturnType<typeof vi.fn>,close:ReturnType<typeof vi.fn>,settle:(value:QueryStreamExportOutput)=>void;
beforeAll(async()=>{
  document=memoryDocument();(document as any).oninput=null;Object.assign(window,{setTimeout,clearTimeout});const create=document.createElement.bind(document);
  document.createElement=name=>{const node=create(name);
    if(name==='input'){let type='text';Object.defineProperty(node,'type',{configurable:true,get:()=>type,set:value=>{type=value;node.attributes.set('type',value);}});node.type='text';}
    if(name==='option')Object.defineProperty(node,'value',{configurable:true,get:()=>node.attributes.get('value')??node.textContent,set:value=>node.attributes.set('value',value)});
    if(name==='select'){Object.defineProperty(node,'options',{get:()=>node.querySelectorAll('option')});Object.defineProperty(node,'value',{configurable:true,get:()=>node.querySelectorAll('option').find(option=>(option as any).selected)?.value??'',set:value=>{for(const option of node.querySelectorAll('option'))(option as any).selected=option.value===value;}});}
    const set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);node.setAttribute=(key,value)=>{set(key.toLowerCase(),value);if(key==='disabled')node.disabled=true;};node.removeAttribute=key=>{remove(key.toLowerCase());if(key==='disabled')node.disabled=false;};return node;
  };
  ({createRoot}=await import('react-dom/client'));({QueryStreamExportDialog:Dialog}=await import('../../src/renderer/components/QueryStreamExportDialog'));
});
afterEach(async()=>{if(root){await act(async()=>root!.unmount());root=undefined;}delete(window as any).dbark;document.body.textContent='';});
afterAll(()=>{for(const[name,descriptor]of descriptors)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});
async function mount(){
  events=new Set();requests=[];execute=vi.fn(()=>new Promise<QueryStreamExportOutput>(resolve=>{settle=resolve;}));cancel=vi.fn(async()=>undefined);close=vi.fn();
  (window as any).dbark={onTask:(listener:(value:any)=>void)=>{events.add(listener);return()=>events.delete(listener);},invoke:async(command:string,input:any)=>{requests.push({command,input});if(command==='files.choose')return{token:'selected',name:'已选择.sql'};return undefined;}};
  const container=document.createElement('div');document.body.appendChild(container);root=createRoot(container as any);
  await act(async()=>root!.render(<StrictMode><Dialog source="SELECT 精确来源" sessionBusy={false} loadNames={vi.fn()} onExecute={execute} onCancel={cancel} onClose={close}/></StrictMode>));
}
function button(name:string){const node=document.querySelectorAll('button').find(node=>node.textContent.includes(name));expect(node,name).toBeDefined();return node!;}
function callback(node:any,event='onClick'){const key=Object.keys(node).find(key=>key.startsWith('__reactProps$'));if(!key)throw Error('缺少React回调');return node[key][event]as(value?:any)=>void;}
async function click(name:string){const node=button(name);expect(node.disabled).toBe(false);await act(async()=>{node.dispatchEvent(new MemoryEvent('click'));});}
async function change(label:string,value:string,kind='input'){const node=document.querySelector(`${kind}[aria-label="${label}"]`)!;expect(node,label).not.toBeNull();await act(async()=>{node.value=value;node.dispatchEvent(new MemoryEvent(kind==='select'?'change':'input'));});}
async function configure(){await change(text.format,'sql','select');await change(insertText.database,'db');await change(insertText.table,'t');await change(insertText.columns,'id\namount','textarea');await click(text.choose);const box=document.querySelectorAll('input').find(node=>node.type==='checkbox')!;await act(async()=>callback(box,'onChange')({target:{checked:true}}));}
function pending(){const options=execute.mock.calls[0][0];return{taskId:options.taskId,status:'running',progress:0,message:'待发布',queryExport:{phase:'awaiting-confirmation',statementsCompleted:1,rowsWritten:301,bytesWritten:4096,fileCommitted:false,sqlMayHaveExecuted:true,transactionKnown:true},queryInsert:{previewToken:'00000000-0000-4000-8000-000000000001',sql:"INSERT INTO `db`.`t` (`id`, `amount`) VALUES (1, _utf8mb4 X'313233');\n",shownRows:1,totalRows:301,target:{database:'db',table:'t',columns:['id','amount']},encoding:'utf8',bytes:4096,expiresAt:new Date(Date.now()+120000).toISOString()}};}
describe('完整INSERT真实React交互（RAM IPC端口）',()=>{
  it('明确暂存与发布分开；双击启动只执行一次，真实样例及最终确认只调用发布RPC',async()=>{
    await mount();await configure();expect(requests).toEqual([{command:'files.choose',input:{purpose:'export',format:'sql',suggestedName:'SQL完整结果.sql',queryInsertExport:true}}]);expect(execute).not.toHaveBeenCalled();
    const start=callback(button(insertText.start));await act(async()=>{start();start();});expect(execute).toHaveBeenCalledOnce();expect(execute.mock.calls[0][0]).toMatchObject({format:'sql',insertTarget:{database:'db',table:'t',columns:['id','amount']}});
    await act(async()=>events.forEach(listener=>listener(pending())));expect(document.body.textContent).toContain('完整301行');expect(document.body.textContent).toContain('4096字节');expect(document.querySelector(`pre[aria-label="${insertText.preview}"]`)!.textContent).toContain('VALUES (1,');expect(document.body.textContent).not.toContain(insertText.completed);
    expect(button(insertText.publish).disabled).toBe(true);await change(insertText.confirmation,'db.t');const box=document.querySelector(`input[aria-label="${insertText.acknowledge}"]`);await act(async()=>callback(box,'onChange')({target:{checked:true}}));
    const publish=callback(button(insertText.publish));await act(async()=>{publish();publish();});expect(requests.filter(value=>value.command==='query.confirmInsertExport')).toHaveLength(1);expect(execute).toHaveBeenCalledOnce();expect(button(insertText.publish).disabled).toBe(true);
    await act(async()=>settle({statementsCompleted:1,results:[],fileCommitted:true,transactionKnown:true,preview:{results:[],elapsedMs:0}}));expect(document.body.textContent).toContain(insertText.completed);
  });
  it('配置变化使旧启动闭包失效；运行中旧目标修改回调不能改变映射或复活确认',async()=>{
    await mount();await configure();const oldStart=callback(button(insertText.start));await change(insertText.table,'changed');await act(async()=>oldStart());expect(execute).not.toHaveBeenCalled();
    const box=document.querySelectorAll('input').find(node=>node.type==='checkbox')!;await act(async()=>callback(box,'onChange')({target:{checked:true}}));const table=document.querySelector(`input[aria-label="${insertText.table}"]`)!,oldChange=callback(table,'onChange');await click(insertText.start);await act(async()=>oldChange({target:{value:'误改'}}));expect(table.value).toBe('changed');expect(execute).toHaveBeenCalledOnce();
  });
  it('卸载仅取消自有原任务，旧启动和发布回调不能再执行',async()=>{
    await mount();await configure();const start=callback(button(insertText.start));await click(insertText.start);const taskId=execute.mock.calls[0][0].taskId;await act(async()=>root!.unmount());root=undefined;expect(cancel).toHaveBeenCalledWith(taskId);await act(async()=>start());expect(execute).toHaveBeenCalledOnce();
  });
  it('正式QueryTab的INSERT分支保留原outcome，不清原返回行；CSV/JSON原路径仍更新预览',()=>{
    const source=readFileSync(new URL('../../src/renderer/components/QueryTab.tsx',import.meta.url),'utf8'),start=source.indexOf('async function runStreamExport('),end=source.indexOf('/** 会话尚在建立时取消',start),body=source.slice(start,end);
    expect(body).toContain("if(options.format!=='sql'){setSelectedPin(''); setShowPinSql(false);setOutcome(null); setStream([]); setResultIndex(0);}");expect(body).toContain("if(options.format!=='sql')setOutcome(result.preview)");
  });
});
