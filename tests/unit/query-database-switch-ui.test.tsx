import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { QueryDatabaseSwitchDialog } from '../../src/renderer/components/QueryDatabaseSwitchDialog';
import { QueryDatabaseSwitchIntent } from '../../src/renderer/queryDatabaseSwitchIntent';
import { queryDatabaseSwitchZh as t } from '../../src/renderer/locales/queryDatabaseSwitch.zh-CN';
import { queryContextZh } from '../../src/renderer/locales/queryContext.zh-CN';
import { queryDatabaseFromSession, queryDatabasePatch } from '../../src/shared/queryContext';
import type { CompletionSessionState } from '../../src/shared/sqlCompletion';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

const source=readFileSync(new URL('../../src/renderer/components/QueryTab.tsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('QueryTab.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),declarations=new Map<string,string>();
/** 执行正式父层方法及真实Dialog；只替换IPC、工作台储存和Monaco公开端口。 */
function inspect(node:ts.Node):void {if(ts.isFunctionDeclaration(node)&&node.name)declarations.set(node.name.text,node.getText(tree));ts.forEachChild(node,inspect);}
inspect(tree);
const methods=['setCompletionSession','rememberDatabase','prepareExecutionContext','databaseSwitchScope','openDatabaseSwitch','loadDatabaseSwitchChoices','refreshDatabaseSwitchSession','applyDatabaseSwitch','closeDatabaseSwitch'];
if(methods.some(name=>!declarations.has(name)))throw Error('切换默认库正式父层接线不完整');
const globals=['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
let document:ReturnType<typeof memoryDocument>,createRoot:typeof import('react-dom/client')['createRoot'],root:ReturnType<typeof createRoot>|undefined;
const cleanups:Array<()=>void>=[];
beforeAll(async()=>{
  document=memoryDocument();(document as any).oninput=null;const create=document.createElement.bind(document);
  document.createElement=name=>{const node=create(name),set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);
    if(name==='select')Object.defineProperty(node,'options',{configurable:true,get:()=>node.querySelectorAll('option')});
    node.setAttribute=(key,value)=>{set(key.toLowerCase(),value);if(key==='disabled')node.disabled=true;};
    node.removeAttribute=key=>{remove(key.toLowerCase());if(key==='disabled')node.disabled=false;};return node;};
  ({createRoot}=await import('react-dom/client'));
});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;cleanups.splice(0).forEach(clean=>clean());document.body.textContent='';vi.clearAllMocks();});
afterAll(()=>{for(const[name,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});
const state=(database='库A'):CompletionSessionState=>({databaseKnown:true,database,broken:false,busy:false,objectsRevision:7});

/** RAM夹具不等同于服务器USE或原生Undo验收；原模型/结果写入口均记录以防回归。 */
function fixture(){
  const changed=new Set<()=>void>(),events=new Map<string,Set<()=>void>>();
  let sql='SELECT subject FROM 原表',version=1,selection={startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:7},sequence=0,jobSequence=0;
  let completion:CompletionSessionState=state(),sendError:Error|undefined,sendWait:Promise<void>|undefined,directoryWait:Promise<void>|undefined,sessionWait:Promise<void>|undefined;
  const tab:any={id:'q',kind:'query',connectionId:'c',title:'原查询',sql,database:'库A',databaseContext:{state:'known',database:'库A'},sourceBinding:{id:'saved',digest:'原摘要'},fileSourceBinding:undefined};
  const notify=()=>{for(const listener of changed)listener();};
  const workspace:any={settings:{tabs:[tab],activeTabId:'q'},connections:[{id:'c',name:'原连接',database:'配置库'}],connectionVersions:{c:1},activeJobs:{},
    updateTab:vi.fn((_id:string,patch:object)=>{workspace.settings={...workspace.settings,tabs:[{...workspace.settings.tabs[0],...patch}]};notify();}),setDirty:vi.fn()};
  const on=(name:string,fn:()=>void)=>{const set=events.get(name)??new Set();events.set(name,set);set.add(fn);return{dispose:()=>set.delete(fn)};};
  const emit=(name:string)=>{for(const listener of events.get(name)??[])listener();};
  const model={getValue:()=>sql,getVersionId:()=>version,isDisposed:()=>false,onDidChangeContent:(fn:()=>void)=>on('content',fn),onWillDispose:(fn:()=>void)=>on('dispose',fn)};
  const editor={getModel:()=>model,getSelection:()=>selection,onDidChangeModel:(fn:()=>void)=>on('model',fn),onDidDispose:(fn:()=>void)=>on('editor',fn),onDidChangeCursorSelection:(fn:()=>void)=>on('selection',fn),executeEdits:vi.fn(),setValue:vi.fn(),setSelection:vi.fn(),pushUndoStop:vi.fn()};
  const flush=vi.fn(async()=>{}),reuse={dispose:vi.fn()},outcome={results:[{columns:[{name:'subject'}],rows:[['原结果']]}]},filter={rules:[{column:'subject',value:'原结果'}]},sort={rules:[{column:'subject',direction:'desc'}]};
  const invoke=vi.fn(async(command:string,input:any)=>{
    if(command==='metadata.databases'){await directoryWait;return['库A','库B','含`引号库',''];}
    if(command==='query.completionState')return completion;
    if(command==='query.sessionState'){await sessionWait;return{transactionKnown:true,transactionOpen:true,broken:false};}
    if(command==='query.databaseSwitch'){
      await sendWait;if(sendError){completion={databaseKnown:false,broken:false,busy:false};throw sendError;}
      completion=state(input.database);return{sessionId:input.sessionId,taskId:input.taskId,database:input.database,completion,transactionKnown:true,transactionOpen:true,unchanged:input.database==='库A'};
    }
    throw Error('意外IPC：'+command);
  });
  const context:any=createContext({QueryDatabaseSwitchIntent,queryDatabaseFromSession,queryDatabasePatch,queryDatabaseSwitchZh:t,queryContextZh,JSON,Error,invoke,tab,
    useWorkspace:{getState:()=>workspace,subscribe:(fn:()=>void)=>{changed.add(fn);return()=>changed.delete(fn);}},
    acquireWorkspaceBusy:()=>{if(workspace.activeJobs.q)throw Error('其他作业');const generation=++jobSequence;workspace.activeJobs={q:true};notify();let live=true;return{owns:()=>live&&generation===jobSequence&&workspace.activeJobs.q===true,release:()=>{if(!live||generation!==jobSequence)return false;live=false;workspace.activeJobs={q:false};notify();return true;}};},
    flushSettings:flush,uid:()=>`switch-${++sequence}`,errorMessage:(error:any)=>error?.message??String(error),document,
    alive:{current:true},closeRequestRef:{current:null},busyRef:{current:false},sessionRef:{current:'原session'},pendingSession:{current:null},formatting:{current:null},editor:{current:editor},fileSource:{isBusy:()=>false},
    databaseSwitchIntent:{current:null},databaseSwitchOperation:{current:null},databaseSwitchTask:{current:''},databaseSwitchAwaitingRelease:{current:false},completionSessionRef:{current:completion},
    task:{current:'原结果task'},outcome,filter,sort,parameterReuse:{current:reuse},parameterReusePort:{current:{}},columnLeaseRef:{current:{}},presetLeaseRef:{current:{}},activeCurrentIntent:{current:null},analyzeIntent:{current:null},transactionSettingsIntent:{current:null},
    setDatabaseSwitchDialog:(value:any)=>{context.dialog=value;},setBusy:vi.fn(),setError:vi.fn(),setTransaction:vi.fn(),setTransactionKnown:vi.fn(),commitCompletionSession:vi.fn(),invalidateResultSelection:vi.fn(),setColumnLease:vi.fn(),setPresetLease:vi.fn(),setOutcome:vi.fn(),setStream:vi.fn(),setResultIndex:vi.fn(),setSelectedPin:vi.fn(),
  });
  runInContext(ts.transpileModule(methods.map(name=>declarations.get(name)).join('\n')+'\nglobalThis.open=openDatabaseSwitch;globalThis.load=loadDatabaseSwitchChoices;globalThis.apply=applyDatabaseSwitch;globalThis.close=closeDatabaseSwitch;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const original={tab,model,editor,outcome,filter,sort,selection,sql};
  const result={context,workspace,invoke,flush,reuse,original,notify,
    open(){context.open();return context.dialog as QueryDatabaseSwitchIntent;},
    async ready(){const intent=this.open();await context.load(intent);return intent;},
    database(database:string){completion=state(database);},fail(error:Error){sendError=error;},waitSend(wait:Promise<void>){sendWait=wait;},waitDirectory(wait:Promise<void>){directoryWait=wait;},waitSession(wait:Promise<void>){sessionWait=wait;},
    edit(value:string){sql=value;version++;emit('content');},select(){selection={...selection,endColumn:8};emit('selection');},replaceModel(){emit('model');},
    foreignBusy(value:boolean){if(value)jobSequence++;workspace.activeJobs={q:value};notify();},
    sendCalls(){return invoke.mock.calls.filter(([command])=>command==='query.databaseSwitch');},
    dispose(){context.databaseSwitchIntent.current?.dispose();changed.clear();events.clear();},
  };cleanups.push(()=>result.dispose());return result;
}
function button(label:string){const node=document.querySelectorAll('button').find(node=>node.textContent===label||node.getAttribute('aria-label')===label);expect(node,label).toBeDefined();return node!;}
async function click(label:string){expect(button(label).disabled).toBe(false);await act(async()=>button(label).dispatchEvent(new MemoryEvent('click')));}
async function mount(f:ReturnType<typeof fixture>){const intent=f.open(),host=document.createElement('div');document.body.appendChild(host);root=createRoot(host as any);await act(async()=>root!.render(<QueryDatabaseSwitchDialog intent={intent} onLoad={()=>f.context.load(intent)} onApply={database=>f.context.apply(intent,database)} onClose={()=>f.context.close(intent)}/>));return intent;}
async function choose(database='库B'){const select=document.querySelector(`[aria-label="${t.database}"]`)!;expect(select.disabled).toBe(false);await act(async()=>{select.value=database;select.dispatchEvent(new MemoryEvent('change'));});}

it('真实目录与取消入口零切库，禁止空库且只允许原文候选',async()=>{
  const f=fixture();await mount(f);expect(f.invoke.mock.calls.map(([command])=>command)).toEqual(['metadata.databases']);expect(button(t.confirm).disabled).toBe(true);
  expect(document.querySelectorAll('option').map(node=>node.value||node.getAttribute('value'))).toContain('含`引号库');await click(t.close);expect(f.sendCalls()).toHaveLength(0);
});
it('真实Dialog调用正式父方法，保留SQL、模型、选区、原结果task及已应用组织',async()=>{
  const f=fixture();await mount(f);await choose();await click(t.confirm);
  expect(f.sendCalls()).toHaveLength(1);expect(f.sendCalls()[0][1]).toMatchObject({sessionId:'原session',database:'库B',expectedContext:{state:'known',database:'库A'}});
  const tab=f.workspace.settings.tabs[0];expect(tab.sql).toBe(f.original.sql);expect(tab.sourceBinding).toBe(f.original.tab.sourceBinding);expect(f.context.editor.current.getModel()).toBe(f.original.model);expect(f.context.editor.current.getSelection()).toBe(f.original.selection);
  expect(f.context.task.current).toBe('原结果task');expect(f.context.outcome).toBe(f.original.outcome);expect(f.context.filter).toBe(f.original.filter);expect(f.context.sort).toBe(f.original.sort);
  expect(f.context.setOutcome).not.toHaveBeenCalled();expect(f.context.setStream).not.toHaveBeenCalled();expect(f.context.setResultIndex).not.toHaveBeenCalled();expect(f.context.setSelectedPin).not.toHaveBeenCalled();
  expect(f.original.editor.executeEdits).not.toHaveBeenCalled();expect(f.original.editor.setValue).not.toHaveBeenCalled();expect(f.original.editor.setSelection).not.toHaveBeenCalled();expect(f.original.editor.pushUndoStop).not.toHaveBeenCalled();
  expect(tab.databaseContext).toEqual({state:'known',database:'库B'});expect(f.context.setTransaction).toHaveBeenLastCalledWith(true);expect(f.reuse.dispose).toHaveBeenCalledTimes(1);expect(f.context.parameterReuse.current).toBeNull();expect(document.body.textContent).toContain(t.completed+'库B');
});
it('准备落盘失败零投递；正文和原结果保持，必须重新打开后才能再确认',async()=>{
  const f=fixture(),intent=await f.ready();f.flush.mockRejectedValueOnce(Error('SQLite不可写'));
  await expect(f.context.apply(intent,'库B')).rejects.toThrow(queryContextZh.snapshotFailed);expect(f.sendCalls()).toHaveLength(0);expect(f.context.outcome).toBe(f.original.outcome);expect(f.context.task.current).toBe('原结果task');
  await expect(f.context.apply(intent,'库B')).rejects.toThrow(t.changed);expect(f.sendCalls()).toHaveLength(0);
});
it('自己的unknown恢复账本不自失效，发送前仍用真实原库而非恢复unknown',async()=>{
  const f=fixture(),intent=await f.ready();await f.context.apply(intent,'库B');expect(f.flush).toHaveBeenCalledTimes(2);expect(intent.current()).toBe(true);expect(f.sendCalls()[0][1].expectedContext).toEqual({state:'known',database:'库A'});
});
it('服务器确认成功但本地落盘失败明确双事实，无自动重发或建连',async()=>{
  const f=fixture();f.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('磁盘满'));await mount(f);await choose();await click(t.confirm);
  expect(f.sendCalls()).toHaveLength(1);expect(f.workspace.settings.tabs[0].database).toBe('库B');expect(document.body.textContent).toContain(t.saveFailed('库B'));expect(button(t.confirm).disabled).toBe(true);expect(f.invoke.mock.calls.some(([name])=>name==='sessions.open'||name==='connections.open'||name==='query.execute')).toBe(false);
});
it('服务端失败只读取原session新事实，不恢复旧库或清空原结果',async()=>{
  const f=fixture(),intent=await f.ready();f.fail(Error('USE拒绝'));await expect(f.context.apply(intent,'库B')).rejects.toThrow(t.unconfirmed);expect(f.sendCalls()).toHaveLength(1);expect(f.workspace.settings.tabs[0].databaseContext).toEqual({state:'unknown'});expect(f.context.outcome).toBe(f.original.outcome);
  expect(f.invoke.mock.calls.filter(([name])=>name==='query.sessionState')).toHaveLength(1);expect(f.invoke.mock.calls.filter(([name])=>name==='query.completionState')).toHaveLength(2);
});
it('双击确认及发送期间关闭不能重入；原busy持有到发送及状态回读结束',async()=>{
  const f=fixture();let finish!:()=>void;f.waitSend(new Promise(resolve=>{finish=resolve;}));await mount(f);await choose();await click(t.confirm);
  expect(button(t.confirm).disabled).toBe(true);expect(button(t.close).disabled).toBe(true);expect(f.workspace.activeJobs.q).toBe(true);expect(f.context.busyRef.current).toBe(true);expect(f.sendCalls()).toHaveLength(1);
  await act(async()=>{document.body.dispatchEvent(Object.assign(new MemoryEvent('keydown'),{key:'Escape'}));});expect(f.context.dialog).not.toBeNull();await act(async()=>finish());expect(f.workspace.activeJobs.q).toBe(false);expect(f.sendCalls()).toHaveLength(1);
});
it.each(['tab','connection','version','session','active','source','database','body','selection','model','closing'] as const)('%s离开再回来永久撤销原确认',async kind=>{
  const f=fixture(),intent=await f.ready(),tab=f.workspace.settings.tabs[0],connection=f.workspace.connections[0];
  if(kind==='tab'){f.workspace.settings.tabs=[{...tab}];f.notify();f.workspace.settings.tabs=[tab];}
  if(kind==='connection'){f.workspace.connections=[{...connection}];f.notify();f.workspace.connections=[connection];}
  if(kind==='version'){f.workspace.connectionVersions.c=2;f.notify();f.workspace.connectionVersions.c=1;}
  if(kind==='session'){f.context.sessionRef.current='其他session';intent.current();f.context.sessionRef.current='原session';}
  if(kind==='active'){f.workspace.settings.activeTabId='other';f.notify();f.workspace.settings.activeTabId='q';}
  if(kind==='source'){f.workspace.updateTab('q',{sourceBinding:{id:'other'}});f.workspace.settings.tabs=[tab];}
  if(kind==='database'){f.workspace.updateTab('q',queryDatabasePatch({state:'known',database:'库B'}));f.workspace.settings.tabs=[tab];}
  if(kind==='body'){f.edit('SELECT 2');f.edit(f.original.sql);}
  if(kind==='selection')f.select();if(kind==='model')f.replaceModel();
  if(kind==='closing'){f.context.closeRequestRef.current={};intent.current();f.context.closeRequestRef.current=null;}
  f.notify();expect(intent.current()).toBe(false);await expect(f.context.apply(intent,'库B')).rejects.toThrow(t.changed);expect(f.sendCalls()).toHaveLength(0);
});
it('目录晚回被关闭的旧弹窗不能准备新来源；新弹窗独立加载',async()=>{
  const f=fixture();let release!:()=>void;f.waitDirectory(new Promise(resolve=>{release=resolve;}));const old=f.open(),loading=f.context.load(old);f.context.close(old);const fresh=f.open();release();await expect(loading).rejects.toThrow(t.changed);expect(fresh).not.toBe(old);expect(f.sendCalls()).toHaveLength(0);await f.context.load(fresh);expect(fresh.current()).toBe(true);
});
it('已发送晚回时来源ABA不应用到新草稿，也不重新发送',async()=>{
  const f=fixture(),intent=await f.ready();let finish!:()=>void;f.waitSend(new Promise(resolve=>{finish=resolve;}));const applying=f.context.apply(intent,'库B');await vi.waitFor(()=>expect(f.sendCalls()).toHaveLength(1));const before=f.workspace.settings.tabs[0];f.workspace.settings.tabs=[{...before,title:'新来源'}];f.notify();f.workspace.settings.tabs=[before];f.notify();finish();await expect(applying).rejects.toThrow(t.changed);expect(f.context.commitCompletionSession).not.toHaveBeenCalled();expect(f.sendCalls()).toHaveLength(1);
});
it('库缓存发送前改变即拒绝，目录不会授权用配置库猜测',async()=>{
  const f=fixture(),intent=await f.ready();f.database('库B');await expect(f.context.apply(intent,'库B')).rejects.toThrow(t.changed);expect(f.sendCalls()).toHaveLength(0);expect(f.flush).not.toHaveBeenCalled();
});
it('受控unknown写入中的同值tab重入仍永久失效，不能借豁免复活来源',async()=>{
  const f=fixture(),intent=await f.ready();intent.beginSend('库B');
  expect(()=>intent.transition({recovery:{state:'unknown'}},()=>{f.workspace.updateTab('q',queryDatabasePatch({state:'unknown'}));f.workspace.updateTab('q',queryDatabasePatch({state:'unknown'}));})).toThrow(t.changed);
  expect(intent.current()).toBe(false);expect(f.sendCalls()).toHaveLength(0);
});
it('session状态晚回必须再核来源，不覆盖后来默认库',async()=>{
  const f=fixture(),intent=await f.ready();let release!:()=>void;f.waitSession(new Promise(resolve=>{release=resolve;}));const applying=f.context.apply(intent,'库B');
  await vi.waitFor(()=>expect(f.invoke.mock.calls.some(([name])=>name==='query.sessionState')).toBe(true));f.workspace.updateTab('q',queryDatabasePatch({state:'known',database:'库C'}));release();
  await expect(applying).rejects.toThrow(t.changed);expect(f.workspace.settings.tabs[0].database).toBe('库C');expect(f.sendCalls()).toHaveLength(1);expect(f.flush).toHaveBeenCalledTimes(1);
});
it('别人的作业接管后旧finally不释放其busy，晚回不写新来源',async()=>{
  const f=fixture(),intent=await f.ready();let release!:()=>void;f.waitSend(new Promise(resolve=>{release=resolve;}));const applying=f.context.apply(intent,'库B');
  await vi.waitFor(()=>expect(f.sendCalls()).toHaveLength(1));f.foreignBusy(true);release();await expect(applying).rejects.toThrow(t.changed);
  expect(f.workspace.activeJobs.q).toBe(true);expect(f.context.databaseSwitchAwaitingRelease.current).toBe(true);expect(f.context.commitCompletionSession).not.toHaveBeenCalled();expect(f.sendCalls()).toHaveLength(1);
});
it('未连接、隐藏和忙查询不能打开真实入口',()=>{
  for(const kind of ['session','active','busy']){const f=fixture();if(kind==='session')f.context.sessionRef.current='';if(kind==='active')f.workspace.settings.activeTabId='other';if(kind==='busy')f.context.busyRef.current=true;expect(f.open()).toBeUndefined();expect(f.invoke).not.toHaveBeenCalled();}
});
