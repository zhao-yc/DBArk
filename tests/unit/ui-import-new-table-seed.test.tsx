import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TableCreateDraft } from '../../src/shared/tableCreate';
import { tableCreateAcknowledgements } from '../../src/shared/tableCreate';
import type { ImportNewTableSeed } from '../../src/shared/importNewTable';
import type { FileImportPreflightInput, FileImportPreflightReport } from '../../src/shared/fileImportPreflight';
import { tableCreateZh as createText } from '../../src/renderer/locales/tableCreate.zh-CN';
import { fileImportTransactionZh as transactionText } from '../../src/renderer/locales/fileImportTransaction.zh-CN';
import { importPreflightZh as preflightText } from '../../src/renderer/locales/importPreflight.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

const port=vi.hoisted(()=>({invoke:vi.fn<(command:string,input?:any)=>Promise<any>>(),get:vi.fn(),preview:vi.fn(),apply:vi.fn(),release:vi.fn(),cancel:vi.fn()}));
vi.mock('../../src/renderer/lib',async original=>({...await original<typeof import('../../src/renderer/lib')>(),invoke:port.invoke}));
vi.mock('../../src/renderer/components/ResultsGrid',()=>({ResultsGrid:()=> <div role="grid"/>}));
vi.mock('../../src/renderer/components/SqlEditor',()=>({SqlEditor:({value}:{value:string})=><pre>{value}</pre>}));
vi.mock('../../src/renderer/components/ConnectedExcelTransferDialog',()=>({ConnectedExcelTransferDialog:()=>null}));
vi.mock('../../src/renderer/tableCreateServices',()=>({tableCreateServices:{get:port.get,preview:port.preview,apply:port.apply,release:port.release,cancel:port.cancel,subscribe:()=>()=>{}}}));

let doc:ReturnType<typeof memoryDocument>,createRoot:typeof import('react-dom/client')['createRoot'],root:ReturnType<typeof createRoot>|undefined;
let Transfer:typeof import('../../src/renderer/components/TransferDialog')['TransferDialog'],Schema:typeof import('../../src/renderer/components/SchemaDialog')['SchemaDialog'],store:typeof import('../../src/renderer/store')['useWorkspace'];
const globals=['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
beforeAll(async()=>{
  doc=memoryDocument();(doc as any).oninput=null;Object.assign(window,{setTimeout,clearTimeout,confirm:vi.fn(()=>true)});const create=doc.createElement.bind(doc);
  /** 只补标准属性反射；表单、预检、原确认页与全部异步锁均为真实产品实现。 */
  doc.createElement=name=>{const node=create(name);if(name==='input')node.type='text';
    if(name==='option'){let selected=false;Object.defineProperty(node,'value',{configurable:true,get:()=>node.getAttribute('value')??node.textContent,set:value=>node.setAttribute('value',value)});Object.defineProperty(node,'selected',{get:()=>selected,set:value=>{selected=!!value;if(selected&&node.parentNode?.tagName==='SELECT')for(const other of node.parentNode.querySelectorAll('option'))if(other!==node)Reflect.set(other,'selected',false);}});}
    if(name==='select'){Object.defineProperty(node,'options',{get:()=>node.querySelectorAll('option')});Object.defineProperty(node,'value',{configurable:true,get:()=>node.querySelectorAll('option').find(option=>Reflect.get(option,'selected'))?.value??'',set:value=>{for(const option of node.querySelectorAll('option'))Reflect.set(option,'selected',option.value===value);}});}
    const set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);node.setAttribute=(key,value)=>{set(key.toLowerCase(),value);if(key==='disabled')node.disabled=true;if(key==='type')node.type=value;};node.removeAttribute=key=>{remove(key.toLowerCase());if(key==='disabled')node.disabled=false;};return node;};
  ({createRoot}=await import('react-dom/client'));({TransferDialog:Transfer}=await import('../../src/renderer/components/TransferDialog'));({SchemaDialog:Schema}=await import('../../src/renderer/components/SchemaDialog'));({useWorkspace:store}=await import('../../src/renderer/store'));
});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;doc.body.textContent='';vi.restoreAllMocks();});
afterAll(()=>{for(const[name,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return{promise,resolve};}
function seed():ImportNewTableSeed{return{file:{token:'original-file',name:'original.json'},format:'json',encoding:'utf8',columns:['original','late'],expectedSource:{sha256:'a'.repeat(64),bytes:200},mapping:{original:'original',late:'lateTarget'}};}
function design():TableCreateDraft{return{database:'db',name:'new_table',engine:'InnoDB',charset:'utf8mb4',comment:'建议草稿',columns:[{name:'original',type:'LONGTEXT',nullable:true,autoIncrement:false,comment:''}],indexes:[],foreignKeys:[]};}
function requests(command:string){return port.invoke.mock.calls.filter(([name])=>name===command).map(([,input])=>input);}
function button(text:string){const node=doc.querySelectorAll('button').find(node=>node.textContent===text);expect(node,text).toBeDefined();return node!;}
function props(node:MemoryNode):Record<string,any>{return Reflect.get(node,Object.keys(node).find(key=>key.startsWith('__reactProps$'))!);}
async function click(node:MemoryNode){expect(node.disabled).toBe(false);await act(async()=>{node.dispatchEvent(new MemoryEvent('click'));});}
async function select(source:string,target:string){const node=doc.querySelectorAll('select').find(node=>node.getAttribute('aria-label')===formatText(zh.transfer.text020,source))!;expect(node).toBeDefined();await act(async()=>{node.value=target;node.dispatchEvent(new MemoryEvent('change'));});}
function report(input:FileImportPreflightInput,error=false):FileImportPreflightReport{return{taskId:input.taskId,target:{connectionId:input.connectionId,database:input.database,table:input.table},format:input.format,encoding:input.encoding,checkedRecords:21,validRecords:error?20:21,invalidRecords:error?1:0,issueCount:error?1:0,issues:error?[{record:21,source:'late',target:'lateTarget',code:'invalid-value',message:''}]:[],truncated:false,complete:true,termination:'complete',sourceFingerprint:'a'.repeat(64),sourceBytes:200,schemaFingerprint:'b'.repeat(64),warnings:[]};}
/** 所有请求仅在RAM返回；未列出的数据库、文件选择和DDL端口立即失败。 */
function setup(options:{preflight?:(input:FileImportPreflightInput)=>Promise<FileImportPreflightReport>;import?:()=>Promise<any>;cancel?:()=>Promise<any>;ordinary?:boolean;sample?:string[];parent?:()=>boolean}={}){
  store.setState({connectionVersions:{c:1},connections:[],tasks:[]});
  port.invoke.mockReset().mockImplementation(async(command,input)=>{
    if(command==='metadata.table')return{database:'db',name:'new_table',engine:'InnoDB',columns:[options.ordinary?'original':'renamed','lateTarget'].map(name=>({name,type:'LONGTEXT',nullable:true,generated:false,defaultValue:null,extra:'',comment:''})),indexes:[],foreignKeys:[],primaryKey:[],editableKey:[],ddl:''};
    if(command==='files.preview'){const columns=options.sample??['original'];return{columns,rows:[Object.fromEntries(columns.map(column=>[column,'有限记录样本']))]};}
    if(command==='files.preflight')return options.preflight?options.preflight(input):report(input);
    if(command==='files.import')return options.import?options.import():{rows:21,errors:[]};
    if(command==='query.cancel')return options.cancel?options.cancel():undefined;
    if(command==='files.choose'&&options.ordinary)return{token:'ordinary-file',name:'ordinary.csv'};
    if(command==='files.importPresets.list'&&options.ordinary)return{generation:'00000000-0000-4000-8000-000000000000',revision:0,entries:[]};
    if(command==='connections.open')return;
    throw Error('RAM测试禁止额外端口：'+command);
  });
  port.get.mockReset().mockResolvedValue({target:{connectionId:'c',database:'db'},snapshotId:'snapshot',expiresAt:new Date(Date.now()+60000).toISOString(),serverVersion:'8.4',warnings:[]});
  port.preview.mockReset().mockImplementation(async input=>({target:{connectionId:'c',database:'db',table:input.design.name},previewToken:'preview',expiresAt:new Date(Date.now()+60000).toISOString(),designDigest:'a'.repeat(64),sql:'CREATE TABLE 本次完整草稿;',warnings:[],requiredAcknowledgements:[...tableCreateAcknowledgements]}));
  port.apply.mockReset().mockRejectedValue(Error('RAM测试未授权DDL'));port.release.mockReset().mockResolvedValue(undefined);port.cancel.mockReset().mockResolvedValue(undefined);
  const host=doc.createElement('div');doc.body.appendChild(host);root=createRoot(host as unknown as Element);
}
async function mountTransfer(initialImport:ImportNewTableSeed|undefined,options:Parameters<typeof setup>[0]={}){
  setup(options);const close=vi.fn();const render=(value:ImportNewTableSeed|undefined,invalidated=false)=> <Transfer mode="import" connectionId="c" database="db" table="new_table" initialImport={value} isParentCurrent={options.parent} invalidated={invalidated} onClose={close}/>;await act(async()=>root!.render(render(initialImport)));return{close,render};
}

describe('新表两阶段种子接入真实Schema和Transfer（RAM）',()=>{
  it('建议草稿克隆一次、不添加默认id，设计器改名进入原CREATE确认；关闭等待原release',async()=>{
    setup();const initial=design(),close=vi.fn(),dirty=vi.fn();await act(async()=>root!.render(<Schema connectionId="c" database="db" initialDesign={initial} onClose={close} onApplied={()=>{}} onDirtyChange={dirty}/>));
    initial.columns[0].name='外部修改不能改原草稿';const field=doc.querySelectorAll('input').find(node=>node.getAttribute('aria-label')===formatText(zh.schema.text018,1))!;expect(field.value).toBe('original');
    await act(async()=>{field.value='renamed';field.dispatchEvent(new MemoryEvent('input'));});expect(dirty).toHaveBeenCalledWith(true);await click(button(zh.schema.text049));
    expect(port.preview).toHaveBeenCalledTimes(1);expect(port.preview.mock.calls[0][0].design.columns.map((column:any)=>column.name)).toEqual(['renamed']);expect(port.apply).not.toHaveBeenCalled();expect(requests('files.import')).toHaveLength(0);
    const disk=deferred<void>();port.release.mockImplementation(()=>disk.promise);await click(button(createText.close));expect(close).not.toHaveBeenCalled();await act(async()=>disk.resolve(undefined));expect(close).toHaveBeenCalledTimes(1);
  });
  it.each(['跨库','已有表','非法草稿'] as const)('%s种子明确阻断，不能默默退回手建id或读取已有表',async kind=>{
    setup();const initial=design();if(kind==='跨库')initial.database='other';if(kind==='非法草稿')initial.columns=[];
    await act(async()=>root!.render(<Schema connectionId="c" database="db" table={kind==='已有表'?'existing':undefined} initialDesign={initial} onClose={()=>{}} onApplied={()=>{}}/>));
    expect(doc.body.textContent).toContain('未退回默认建表');expect(doc.querySelectorAll('input')).toHaveLength(0);expect(port.get).not.toHaveBeenCalled();expect(port.invoke).not.toHaveBeenCalled();
  });
  it('initialDesign A→B→A后旧预览事件不能复活原草稿',async()=>{
    setup();const a=design(),b=design(),render=(value:TableCreateDraft)=><Schema connectionId="c" database="db" initialDesign={value} onClose={()=>{}} onApplied={()=>{}}/>;await act(async()=>root!.render(render(a)));const old=props(button(zh.schema.text049)).onClick;
    await act(async()=>root!.render(render(b)));await act(async()=>root!.render(render(a)));await act(async()=>old());expect(port.get).not.toHaveBeenCalled();expect(doc.body.textContent).toContain(createText.mismatch);
  });
  it.each(['false','throw'] as const)('父租约%s且连接版本/子props不变时，原CREATE确认也永久失效并保留释放关闭',async failure=>{
    setup();let valid=true;const close=vi.fn(),initial=design(),parent=()=>{if(!valid&&failure==='throw')throw Error('原父租约已结束');return valid;};
    await act(async()=>root!.render(<Schema connectionId="c" database="db" initialDesign={initial} isParentCurrent={parent} onClose={close} onApplied={()=>{}}/>));await click(button(zh.schema.text049));
    const confirmation=doc.querySelectorAll('input').find(node=>node.getAttribute('aria-label')===createText.confirmation)!;await act(async()=>{confirmation.value='db.new_table';confirmation.dispatchEvent(new MemoryEvent('input'));});
    for(const node of doc.querySelectorAll('input').filter(node=>node.type==='checkbox'))await act(async()=>{node.checked=true;node.dispatchEvent(new MemoryEvent('click'));});
    expect(button(createText.apply).disabled).toBe(false);const old=props(button(createText.apply)).onClick;valid=false;await act(async()=>old());valid=true;await act(async()=>old());expect(port.apply).not.toHaveBeenCalled();expect(store.getState().connectionVersions.c).toBe(1);
    const disk=deferred<void>();port.release.mockImplementation(()=>disk.promise);await click(button(createText.close));expect(close).not.toHaveBeenCalled();await act(async()=>disk.resolve(undefined));expect(close).toHaveBeenCalledTimes(1);
  });
  it('源全集含第21条字段，目标改名后人工选映射；预检完整通过后才显式atomic且仅插入一次',async()=>{
    await mountTransfer(seed());expect(requests('files.choose')).toHaveLength(0);expect(requests('files.importPresets.list')).toHaveLength(0);expect(requests('files.importKeys')).toHaveLength(0);
    const late=doc.querySelectorAll('select').find(node=>node.getAttribute('aria-label')===formatText(zh.transfer.text020,'late'))!;expect(late.value).toBe('lateTarget');expect(button(zh.transfer.text028).disabled).toBe(true);
    expect(doc.querySelectorAll('select').find(node=>node.getAttribute('aria-label')===transactionText.label)!.disabled).toBe(true);expect(doc.querySelectorAll('button').find(node=>node.getAttribute('class')==='file-picker')!.disabled).toBe(true);
    await select('original','renamed');await click(button(preflightText.run));expect(requests('files.preflight')[0]).toMatchObject({expectedSource:seed().expectedSource,mapping:{original:'renamed',late:'lateTarget'}});expect(requests('files.import')).toHaveLength(0);
    const old=props(button(zh.transfer.text028)).onClick;await act(async()=>{old();old();});expect(requests('files.import')).toHaveLength(1);expect(requests('files.import')[0]).toMatchObject({fileToken:'original-file',format:'json',encoding:'utf8',expectedSource:seed().expectedSource,transactionMode:'atomic',mapping:{original:'renamed',late:'lateTarget'}});expect(Object.hasOwn(requests('files.import')[0],'conflict')).toBe(false);
  });
  it('第21条预检错误及不同SHA回证都阻止旧开始按钮，不把有限20条样本当全量通过',async()=>{
    let wrongDigest=false;await mountTransfer(seed(),{preflight:async input=>wrongDigest?{...report(input),sourceFingerprint:'c'.repeat(64)}:report(input,true)});await select('original','renamed');const old=props(button(zh.transfer.text028)).onClick;await click(button(preflightText.run));expect(button(zh.transfer.text028).disabled).toBe(true);expect(doc.body.textContent).toContain('21');await act(async()=>old());expect(requests('files.import')).toHaveLength(0);
    wrongDigest=true;await click(button(preflightText.run));expect(button(zh.transfer.text028).disabled).toBe(true);await act(async()=>props(button(zh.transfer.text028)).onClick());expect(requests('files.import')).toHaveLength(0);
  });
  it('CSV位置源完整保留原编码、分隔符和false标题选项，配置锁定但原建议映射可供预检',async()=>{
    const value:ImportNewTableSeed={...seed(),file:{token:'csv-original',name:'source.csv'},format:'csv',encoding:'gb18030',csvDelimiter:';',csvHasHeader:false,columns:['第1列','第2列'],mapping:{第1列:'renamed',第2列:'lateTarget'}};
    await mountTransfer(value,{sample:['第1列','第2列']});expect(requests('files.preview')[0]).toMatchObject({fileToken:'csv-original',format:'csv',encoding:'gb18030',csvDelimiter:';',csvHasHeader:false});await click(button(preflightText.run));await click(button(zh.transfer.text028));expect(requests('files.import')[0]).toMatchObject({fileToken:'csv-original',format:'csv',encoding:'gb18030',csvDelimiter:';',csvHasHeader:false,transactionMode:'atomic',expectedSource:value.expectedSource,mapping:value.mapping});
  });
  it('预检取消ACK与原任务分别终态前均不放行关闭，最终不能领取已取消报告',async()=>{
    const read=deferred<FileImportPreflightReport>(),cancel=deferred<void>(),f=await mountTransfer(seed(),{preflight:()=>read.promise,cancel:()=>cancel.promise});await select('original','renamed');const close=props(button(zh.common.close)).onClick;await click(button(preflightText.run));await click(button(preflightText.cancel));await act(async()=>read.resolve(report(requests('files.preflight')[0])));await act(async()=>close());expect(f.close).not.toHaveBeenCalled();expect(button(zh.common.close).disabled).toBe(true);
    await act(async()=>cancel.resolve(undefined));await click(button(zh.common.close));expect(f.close).toHaveBeenCalledTimes(1);expect(requests('files.import')).toHaveLength(0);
  });
  it('导入取消也等原import及cancel终态；未知后同种子旧按钮不能重发',async()=>{
    const write=deferred<any>(),cancel=deferred<void>(),f=await mountTransfer(seed(),{import:()=>write.promise,cancel:()=>cancel.promise});await select('original','renamed');await click(button(preflightText.run));const old=props(button(zh.transfer.text028)).onClick;await click(button(zh.transfer.text028));await click(button(zh.transfer.text027));await act(async()=>write.resolve({rows:0,errors:['未确认结果，请核对']}));expect(button(zh.common.done).disabled).toBe(true);expect(f.close).not.toHaveBeenCalled();await act(async()=>cancel.resolve(undefined));await act(async()=>old());expect(requests('files.import')).toHaveLength(1);expect(doc.body.textContent).toContain('不会再次发送');
  });
  it('种子引用与连接版本A→B→A均永久封闭旧指纹和目标',async()=>{
    const a=seed(),f=await mountTransfer(a);await select('original','renamed');await click(button(preflightText.run));const old=props(button(zh.transfer.text028)).onClick;await act(async()=>root!.render(f.render(seed())));await act(async()=>root!.render(f.render(a)));await act(async()=>{store.setState({connectionVersions:{c:2}});store.setState({connectionVersions:{c:1}});old();});expect(requests('files.import')).toHaveLength(0);expect(doc.body.textContent).toContain('永久失效');
  });
  it.each(['false','throw'] as const)('父租约%s先于React重渲染也阻止原Transfer预检和导入，恢复true不能复活',async failure=>{
    let valid=true;const parent=()=>{if(!valid&&failure==='throw')throw Error('父来源失效');return valid;};await mountTransfer(seed(),{parent});await select('original','renamed');await click(button(preflightText.run));const run=props(button(preflightText.run)).onClick,start=props(button(zh.transfer.text028)).onClick;expect(button(zh.transfer.text028).disabled).toBe(false);
    valid=false;await act(async()=>{run();start();});valid=true;await act(async()=>{run();start();});expect(requests('files.preflight')).toHaveLength(1);expect(requests('files.import')).toHaveLength(0);expect(store.getState().connectionVersions.c).toBe(1);
  });
  it('父invalidated同步撤销且改回false不能恢复；迟到预检报告不成为新授权',async()=>{
    const value=seed(),read=deferred<FileImportPreflightReport>(),f=await mountTransfer(value,{parent:()=>true,preflight:()=>read.promise});await select('original','renamed');await click(button(preflightText.run));await act(async()=>root!.render(f.render(value,true)));await act(async()=>root!.render(f.render(value,false)));await act(async()=>read.resolve(report(requests('files.preflight')[0])));expect(button(zh.transfer.text028).disabled).toBe(true);expect(doc.body.textContent).toContain('永久失效');expect(requests('files.import')).toHaveLength(0);await click(button(zh.common.close));expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('父租约结束后保原import/cancel关闭门，迟到成功不发布为当前新表导入结果',async()=>{
    let valid=true;const write=deferred<any>(),cancel=deferred<void>(),f=await mountTransfer(seed(),{parent:()=>valid,import:()=>write.promise,cancel:()=>cancel.promise});await select('original','renamed');await click(button(preflightText.run));await click(button(zh.transfer.text028));valid=false;await act(async()=>props(button(zh.common.close)).onClick());expect(f.close).not.toHaveBeenCalled();await click(button(zh.transfer.text027));await act(async()=>write.resolve({rows:21,errors:[]}));expect(button(zh.common.close).disabled).toBe(true);expect(doc.body.textContent).not.toContain('导入 21');await act(async()=>cancel.resolve(undefined));valid=true;await click(button(zh.common.close));expect(f.close).toHaveBeenCalledTimes(1);expect(requests('files.import')).toHaveLength(1);
  });
  it('普通旧导入仍可选文件、默认batch，同名自动映射且不强制预检或添加expectedSource',async()=>{
    await mountTransfer(undefined,{ordinary:true});await click(doc.querySelectorAll('button').find(node=>node.getAttribute('class')==='file-picker')!);expect(requests('files.preview')).toHaveLength(1);expect(requests('files.preflight')).toHaveLength(0);expect(button(zh.transfer.text028).disabled).toBe(false);await click(button(zh.transfer.text028));const input=requests('files.import')[0];expect(input).toMatchObject({fileToken:'ordinary-file',format:'csv',transactionMode:'batch',mapping:{original:'original'}});expect(Object.hasOwn(input,'expectedSource')).toBe(false);
  });
});
