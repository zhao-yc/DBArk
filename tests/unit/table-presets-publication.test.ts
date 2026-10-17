import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createContext,runInContext} from 'node:vm';
import ts from 'typescript';
import {LocalStore} from '../../src/main/storage';
import {ColumnsMainCapabilities} from '../../src/main/columnsMainCapabilities';
import {TablePresetSources,applyTablePreset} from '../../src/main/tablePresets';
import {validateTablePresetColumns} from '../../src/shared/tablePresets';
import {createPresetDialogGuard} from '../../src/renderer/tablePresetDialogs';

const dirs:string[]=[],stores:LocalStore[]=[],target={connectionId:'ram',database:'ram_db',table:'payload_table'};
const profile={id:'ram',name:'合成连接',dialect:'mysql' as const,host:'offline.invalid',port:3306,user:'RAM',group:'',color:'#123456'};
const configuration={filters:[{column:'payload',operator:'IS NULL' as const}],filterMode:'all' as const,sort:[]};
afterEach(()=>{for(const store of stores.splice(0))store.close();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
/** 原Main case/helper、真实SQLite/owner/source；只把utility响应替换为RAM Promise。 */
async function mainPort(){
 const dir=mkdtempSync(join(tmpdir(),'dbark-preset-publish-'));dirs.push(dir);
 const store=await LocalStore.open(join(dir,'local.sqlite'),createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'),{available:()=>false,encrypt:()=>{throw Error('不用真实密钥');},decrypt:()=>{throw Error('不解密');}});stores.push(store);store.saveConnection(profile);
 const frame={url:'ram://renderer',detached:false,processId:1,frameToken:'main'},contents={mainFrame:frame,isDestroyed:()=>false,on:vi.fn()},window={webContents:contents,isDestroyed:()=>false};
 const owner=new ColumnsMainCapabilities(new Map(),{currentWindow:()=>window as any,rendererURL:frame.url,connectionRevision:()=>store.connectionRevision(),assertAvailable:()=>{},shuttingDown:()=>false,release:async()=>{}});
 owner.trackWindow(window as any);const invocation:any=owner.capture({sender:contents,senderFrame:frame} as any);
 const sources=new TablePresetSources({assert:value=>owner.assertCapturedOwner(value),same:(a,b)=>owner.sharesDocumentOwner(a,b)});
 const empty=store.tablePresets(target),saved=store.saveTablePreset({...target,source:empty.source,expectedRevision:empty.revision,bindingToken:randomUUID(),name:'方案',configuration}),listed=sources.issue(invocation,target,saved);
 const input={...target,source:listed.source,expectedRevision:listed.revision,bindingToken:listed.bindingToken,id:listed.entries[0].id,taskId:randomUUID()};
 let readDone!:(value:any)=>void,stopDone!:()=>void,readFail!:(reason:Error)=>void,stopFail!:(reason:Error)=>void;
 const read=new Promise<any>((resolve,reject)=>{readDone=resolve;readFail=reject;}),stop=new Promise<void>((resolve,reject)=>{stopDone=resolve;stopFail=reject;});
 const reads=new Map(),completion=new Set(),broker={request:vi.fn((command:string)=>command==='metadata.table'?read:stop)};
 const text=readFileSync(new URL('../../src/main/index.ts',import.meta.url),'utf8'),tree=ts.createSourceFile('main.ts',text,ts.ScriptTarget.Latest,true);let clause='',cancel='';
 function visit(node:ts.Node){if(ts.isCaseClause(node)&&node.expression.getText(tree)==="'table.presets.apply'")clause=node.getText(tree);if(ts.isFunctionDeclaration(node)&&node.name?.text==='cancelTablePresetRead')cancel=node.getText(tree);ts.forEachChild(node,visit);}visit(tree);
 const context=createContext({tablePresetReads:reads,completionTasks:completion,tasks:new Map(),savedQueryPages:undefined,historyPages:undefined,tablePresetSources:sources,connectionConfig:{assertAvailable:()=>{}},shuttingDown:false,store,applyTablePreset,broker,Error,AggregateError});
 runInContext(ts.transpileModule(cancel+"\nasync function route(input,columns){switch('table.presets.apply'){"+clause+"}};globalThis.route=route;globalThis.cancel=cancelTablePresetRead;",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 const dispatch=()=>context.route(input,invocation) as Promise<unknown>;
 const publish=async(value:unknown)=>{try{const publication=invocation.presetPublication;let stop=publication?.pendingStop();while(stop){await stop;publication.settledStop(stop);stop=publication.pendingStop();}owner.assertCapturedOwner(invocation);publication?.assertCurrent();return value;}finally{invocation.presetPublication?.release();}};
 return {store,input,invocation,read,readDone,readFail,stopDone,stopFail,reads,completion,context,dispatch,publish,info:{database:target.database,name:target.table,columns:[{name:'payload'}]}};
}
it.each(['cancel','revision','cas','normal'] as const)('helper满足后Main恢复前%s重核且保留严格结算',async mode=>{
 const f=await mainPort();let settled=false;const pending=f.dispatch().then(f.publish).then(value=>({value,error:undefined}),error=>({value:undefined,error})).finally(()=>{settled=true;});
 f.read.then(()=>{if(mode==='cancel')void f.context.cancel(f.input.taskId);if(mode==='revision')f.store.saveConnection({...profile,name:'新显示名'});if(mode==='cas')f.store.deleteTablePreset((({taskId:_taskId,...selected})=>selected)(f.input));});
 f.readDone(f.info);for(let i=0;i<12;i++)await Promise.resolve();
 if(mode==='cancel'){expect(settled).toBe(false);expect(f.completion.has(f.input.taskId)).toBe(true);f.stopDone();}
 const result=await pending;if(mode==='normal'){expect(result.error).toBeUndefined();expect(result.value).toEqual(configuration);}else{expect(result.value).toBeUndefined();expect(result.error).toBeInstanceOf(Error);}
 expect(f.reads.size).toBe(0);expect(f.completion.size).toBe(0);
});
it.each(['cancel','revision','cas'] as const)('实际IPC发布点%s变化仍拒绝，不能在dispatch成功时过早撤销登记',async mode=>{
 const f=await mainPort(),work=f.dispatch();f.readDone(f.info);const result=await work;
 expect(f.completion.has(f.input.taskId)).toBe(true);
 if(mode==='cancel'){void f.context.cancel(f.input.taskId);}
 if(mode==='revision')f.store.saveConnection({...profile,name:'后来修订'});
 if(mode==='cas'){const {taskId:_taskId,...selected}=f.input;f.store.deleteTablePreset(selected);}
 const published=f.publish(result);if(mode==='cancel'){expect(f.completion.has(f.input.taskId)).toBe(true);f.stopDone();}
 await expect(published).rejects.toThrow();expect(f.reads.size).toBe(0);expect(f.completion.size).toBe(0);
});
it('原失败对象不被晚检查替换；双失败以cause/errors保留原貌',async()=>{
 for(const dual of [false,true]){
  const f=await mainPort(),original=Error('原metadata失败'),settlement=Error('严格结算失败');const work=f.dispatch().catch(reason=>reason);
  if(dual){const cancellation=f.context.cancel(f.input.taskId).catch(()=>{});f.readFail(original);f.stopFail(settlement);await cancellation;}else f.readFail(original);
  const failure=await work;if(dual){expect(failure).toBeInstanceOf(AggregateError);const aggregate=failure as AggregateError;expect(aggregate.cause).toBe(original);expect(aggregate.errors).toEqual([original,settlement]);}else expect(failure).toBe(original);
  expect(f.reads.size).toBe(0);
 }
});

/** 执行原canReload/prepare/apply及窗口setter；观察者以可排空的RAM记录提供DOM能力。 */
function parentPort(){
 const source=readFileSync(new URL('../../src/renderer/components/TableTab.tsx',import.meta.url),'utf8'),tree=ts.createSourceFile('tab.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),declarations:string[]=[];
 const names=['reloadBlocked','canReload','preparePresetApply','applyNamedPreset','setShowPreferences','setReferenceDialog'];
 function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)&&names.includes(node.name?.text??''))declarations.push(node.getText(tree));ts.forEachChild(node,visit);}visit(tree);expect(declarations).toHaveLength(names.length);
 let modal=false,records:MutationRecord[]=[];const disconnect=vi.fn();
 class Observer{observe=vi.fn();disconnect=disconnect;takeRecords(){const result=records;records=[];return result;}}
 const setters={setFilters:vi.fn(),setFilterMode:vi.fn(),setSort:vi.fn(),setPageIndex:vi.fn()};
 const document={body:{},querySelector:()=>modal?{}:null},record={hasInput:()=>false,reset:vi.fn()},confirm=vi.fn(()=>true),cancel=vi.fn();
 const context:any=createContext({...setters,document,record,window:{confirm},recordPages:{cancel},collectChanges:()=>[],recordViewZh:{discardPage:'RAM确认'},presetUiEpoch:{current:0},createPresetDialogGuard:(value:any)=>createPresetDialogGuard(value,Observer as any),validateTablePresetColumns,mounted:{current:true},base:target,connectionVersion:1,refreshVersion:0,info:{columns:[{name:'payload'}]},rowsRef:{current:[]},loadGeneration:{current:2},externalStale:false,activeGridEditor:{current:null},presetApplyScope:{current:null},blockedRef:{current:false},showPreferences:false,referenceCount:{current:0},referenceDialog:null});
 context.setShowPreferencesState=(value:boolean)=>{context.showPreferences=value;};context.setReferenceDialogState=(value:any)=>{context.referenceDialog=value;};
 runInContext(ts.transpileModule(declarations.join('\n')+'\nglobalThis.prepare=preparePresetApply;globalThis.apply=applyNamedPreset;globalThis.preferences=setShowPreferences;globalThis.reference=setReferenceDialog;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 return {context,setters,record,confirm,cancel,disconnect,modal:(value:boolean)=>{modal=value;},mutate:(value:MutationRecord[])=>{records.push(...value);}};
}
it.each(['dialog','preferences','reference','activity'] as const)('晚%s上下文无副作用拒绝，不重确认或清后来窗口/输入',mode=>{
 const f=parentPort();expect(f.context.prepare()).toBe(true);const resets=f.record.reset.mock.calls.length,cancels=f.cancel.mock.calls.length;
 if(mode==='dialog')f.modal(true);if(mode==='preferences')f.context.preferences(true);if(mode==='reference')f.context.reference({newContext:true});if(mode==='activity')f.context.referenceCount.current=1;
 expect(f.context.apply(configuration)).toBe(false);expect(f.setters.setFilters).not.toHaveBeenCalled();expect(f.record.reset).toHaveBeenCalledTimes(resets);expect(f.cancel).toHaveBeenCalledTimes(cancels);expect(f.confirm).not.toHaveBeenCalled();
 if(mode==='preferences')expect(f.context.showPreferences).toBe(true);if(mode==='reference')expect(f.context.referenceDialog).toEqual({newContext:true});
});
it.each(['dialog','role','preferences','reference'] as const)('%s ABA即使恢复原值也永久拒绝',mode=>{
 const f=parentPort();expect(f.context.prepare()).toBe(true);
 if(mode==='preferences'){f.context.preferences(true);f.context.preferences(false);}
 if(mode==='reference'){f.context.reference({});f.context.reference(null);}
 const node={nodeType:1,getAttribute:()=>mode==='dialog'?'dialog':null,querySelector:()=>null};
 if(mode==='dialog')f.mutate([{type:'childList',addedNodes:[node],removedNodes:[]} as any,{type:'childList',addedNodes:[],removedNodes:[node]} as any]);
 if(mode==='role')f.mutate([{type:'attributes',target:node,oldValue:'dialog'} as any]);
 expect(f.context.apply(configuration)).toBe(false);expect(f.context.apply(configuration)).toBe(false);expect(f.setters.setFilters).not.toHaveBeenCalled();expect(f.disconnect).toHaveBeenCalledOnce();
});
it('无新增上下文仍整份应用一次，普通DOM变更不误伤',()=>{
 const f=parentPort();expect(f.context.prepare()).toBe(true);f.mutate([{type:'childList',addedNodes:[{nodeType:1,getAttribute:()=>null,querySelector:()=>null}],removedNodes:[]} as any]);
 expect(f.context.apply(configuration)).toBe(true);expect(f.context.apply(configuration)).toBe(false);expect(f.setters.setFilters).toHaveBeenCalledExactlyOnceWith(configuration.filters);
});
