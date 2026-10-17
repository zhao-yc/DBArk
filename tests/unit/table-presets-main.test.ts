import {describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import ts from 'typescript';
import {ColumnsMainCapabilities} from '../../src/main/columnsMainCapabilities';
import {TablePresetSources,applyTablePreset} from '../../src/main/tablePresets';
import type {TablePresetConfiguration} from '../../src/shared/tablePresets';
const target={connectionId:'ram',database:'db',table:'t'},configuration:TablePresetConfiguration={filters:[{column:'payload',operator:'IS NULL'}],filterMode:'all',sort:[{column:'payload',direction:'ASC'}]};
const snapshot={version:1 as const,revision:2,entries:[],source:{connectionRevision:1,connectionDigest:'a'.repeat(64)}};
/** Electron端口只用内存对象；执行原真实capture/文档换代，不接受测试自造invocation。 */
function ownership(){
 const listeners=new Map<string,Function[]>(),frame={url:'ram://renderer',detached:false,processId:1,frameToken:'main'};
 const contents={mainFrame:frame,isDestroyed:()=>false,on:(name:string,callback:Function)=>{listeners.set(name,[...listeners.get(name)??[],callback]);}};
 const window={webContents:contents,isDestroyed:()=>false};let current:any=window;
 const owner=new ColumnsMainCapabilities(new Map(),{currentWindow:()=>current,rendererURL:frame.url,connectionRevision:()=>1,assertAvailable:()=>{},shuttingDown:()=>false,release:async()=>{}});
 owner.trackWindow(window as any);const event={sender:contents,senderFrame:frame} as any;
 const sources=new TablePresetSources({assert:value=>owner.assertCapturedOwner(value),same:(left,right)=>owner.sharesDocumentOwner(left,right)});
 return {owner,sources,capture:()=>owner.capture(event),navigate:()=>listeners.get('did-start-navigation')!.forEach(callback=>callback({isMainFrame:true,isSameDocument:false})),replace:()=>{current={...window};}};
}
describe('命名方案Main真实来源及只读字段核对',()=>{
 it('list不调用worker；令牌绑定原窗口/主frame/文档/准确库表和连接来源',()=>{
  const f=ownership(),first=f.capture(),listed=f.sources.issue(first,target,snapshot),input={...target,source:listed.source,bindingToken:listed.bindingToken};
  expect(()=>f.sources.assert(f.capture(),input)).not.toThrow();
  for(const extra of [{table:'other'},{database:'other'},{connectionId:'other'},{bindingToken:randomUUID()},{source:{...snapshot.source,connectionRevision:2}}])expect(()=>f.sources.assert(f.capture(),{...input,...extra})).toThrow();
  expect(()=>f.sources.assert({owner:first.owner} as any,input)).toThrow();f.replace();expect(()=>f.sources.assert(first,input)).toThrow();
 });
 it('同URL文档重载永久拒绝旧能力，回到原连接值也不复活',()=>{
  const f=ownership(),invocation=f.capture(),listed=f.sources.issue(invocation,target,snapshot),input={...target,source:listed.source,bindingToken:listed.bindingToken};f.navigate();
  expect(()=>f.sources.assert(f.capture(),input)).toThrow();expect(()=>f.owner.assertCapturedOwner(invocation)).toThrow();
 });
 it('带taskId调用原metadata端口，只返回整份方案；不调用表数据读取/执行接口',async()=>{
  const raw={...target,source:snapshot.source,expectedRevision:2,bindingToken:randomUUID(),id:randomUUID(),taskId:randomUUID()};
  const port={selected:vi.fn(()=>structuredClone(configuration)),assertCurrent:vi.fn(),metadata:vi.fn(async()=>({database:'db',name:'t',columns:[{name:'payload'}]} as any))};
  expect(await applyTablePreset(raw,port)).toEqual(configuration);expect(port.metadata).toHaveBeenCalledExactlyOnceWith({...target,taskId:raw.taskId});expect(port.assertCurrent).toHaveBeenCalledTimes(2);
 });
 it('缺字段/目标不符整份拒绝；await期间来源失效时不交付晚回包',async()=>{
  const raw={...target,source:snapshot.source,expectedRevision:2,bindingToken:randomUUID(),id:randomUUID(),taskId:randomUUID()};
  for(const info of [{database:'db',name:'t',columns:[]},{database:'db',name:'other',columns:[{name:'payload'}]}])await expect(applyTablePreset(raw,{selected:()=>configuration,assertCurrent:()=>{},metadata:async()=>info as any})).rejects.toThrow();
  let finish!:(value:any)=>void,current=true;const pending=new Promise<any>(resolve=>{finish=resolve;}),entered=vi.fn();
  const work=applyTablePreset(raw,{selected:()=>configuration,assertCurrent:()=>{if(!current)throw Error('原文档失效');},metadata:()=>{entered();return pending;}}).catch(reason=>reason);
  await Promise.resolve();expect(entered).toHaveBeenCalledOnce();current=false;finish({database:'db',name:'t',columns:[{name:'payload'}]});expect(await work).toBeInstanceOf(Error);
 });
 it('Main接线绑定真实IPC并登记metadata任务；取消/导航不把未结算资源当作完成',()=>{
  const source=readFileSync(new URL('../../src/main/index.ts',import.meta.url),'utf8');
  expect(source).toContain("payload.command.startsWith('table.presets.')");
  expect(source).toContain('tablePresetSources.assert(columns,input)');
  expect(source).toContain("state.sent=true;return broker.request('metadata.table',{...target,profile})");
  expect(source).toContain('await state.stop');
  expect(source).toContain('tablePresetReads.has(input.taskId)');
  expect(source).toContain("window.webContents.on('render-process-gone',invalidateTablePresetSources)");
 });
 it('执行原Main apply/cancel：取消ACK前不解除登记，原metadata失败也不能跳过收尾',async()=>{
  const source=readFileSync(new URL('../../src/main/index.ts',import.meta.url),'utf8'),tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);let clause='',cancel='';
  function visit(node:ts.Node){if(ts.isCaseClause(node)&&node.expression.getText(tree)==="'table.presets.apply'")clause=node.getText(tree);if(ts.isFunctionDeclaration(node)&&node.name?.text==='cancelTablePresetRead')cancel=node.getText(tree);ts.forEachChild(node,visit);}visit(tree);expect(clause).not.toBe('');expect(cancel).not.toBe('');
  let releaseRead!:(value:any)=>void,releaseCancel!:()=>void;const read=new Promise(resolve=>{releaseRead=resolve;}),stopped=new Promise<void>(resolve=>{releaseCancel=resolve;});
  const active=new Map(),completion=new Set(),broker={request:vi.fn((command:string,_input?:unknown)=>command==='metadata.table'?read:stopped)},sourcePort={assert:vi.fn()};
  const context=createContext({tablePresetReads:active,completionTasks:completion,tasks:new Map(),savedQueryPages:undefined,historyPages:undefined,tablePresetSources:sourcePort,connectionConfig:{assertAvailable:vi.fn()},shuttingDown:false,store:{connectionRevision:()=>1,selectedTablePreset:()=>configuration,resolveConnection:()=>({id:'ram'})},applyTablePreset,broker,Error});
  const code=cancel+"\nasync function route(input,columns){switch('table.presets.apply'){"+clause+"}};globalThis.route=route;globalThis.cancel=cancelTablePresetRead;";
  runInContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const raw={...target,source:snapshot.source,expectedRevision:2,bindingToken:randomUUID(),id:randomUUID(),taskId:randomUUID()};let settled=false;
  const work=context.route(raw,{}).catch((reason:any)=>reason).finally(()=>{settled=true;});expect(completion.has(raw.taskId)).toBe(true);
  const cancellation=context.cancel(raw.taskId);releaseRead({database:'db',name:'t',columns:[{name:'payload'}]});await Promise.resolve();await Promise.resolve();expect(settled).toBe(false);expect(completion.has(raw.taskId)).toBe(true);
  releaseCancel();await cancellation;expect(await work).toBeInstanceOf(Error);expect(completion.has(raw.taskId)).toBe(false);expect(active.size).toBe(0);
  expect(broker.request).toHaveBeenCalledWith('query.cancel',{taskId:raw.taskId});expect(broker.request.mock.calls[0][1]).toMatchObject({taskId:raw.taskId,profile:{id:'ram'}});
 });
 it('执行原utility metadata分支：Main配置直入带taskId的strictRead，不旁开连接',async()=>{
  const source=readFileSync(new URL('../../src/engine/index.ts',import.meta.url),'utf8'),tree=ts.createSourceFile('engine.ts',source,ts.ScriptTarget.Latest,true);let clause='';
  function visit(node:ts.Node){if(ts.isCaseClause(node)&&node.expression.getText(tree)==="'metadata.table'")clause=node.getText(tree);ts.forEachChild(node,visit);}visit(tree);expect(clause).not.toBe('');
  const info={database:'db',name:'t',columns:[{name:'payload'}]},ended=vi.fn(),metadata={tableInfo:vi.fn(async()=>info)};
  const receiver={copySourceProfile:vi.fn(),withIndependentTask:vi.fn(async(_id:string,_task:string,action:Function)=>action({}, {commandStarted:()=>ended})),withConnection:vi.fn()};
  const context=createContext({metadata});runInContext(ts.transpileModule("globalThis.route=async function(input){switch('metadata.table'){"+clause+"}}",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const input={...target,taskId:randomUUID(),profile:{id:'ram'}};expect(await context.route.call(receiver,input)).toBe(info);
  expect(receiver.copySourceProfile).toHaveBeenCalledWith(input);expect(receiver.withIndependentTask).toHaveBeenCalledWith('ram',input.taskId,expect.any(Function),undefined,'读取表格元数据',true);expect(receiver.withConnection).not.toHaveBeenCalled();expect(ended).toHaveBeenCalledOnce();
 });
 it('执行原TableTab应用入口：原丢稿门先行，后来编辑拒绝，合法整份设置走原表页状态',async()=>{
  const source=readFileSync(new URL('../../src/renderer/components/TableTab.tsx',import.meta.url),'utf8'),tree=ts.createSourceFile('tab.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions:string[]=[];
  function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)&&['preparePresetApply','applyNamedPreset'].includes(node.name?.text??''))functions.push(node.getText(tree));ts.forEachChild(node,visit);}visit(tree);expect(functions).toHaveLength(2);
  const setters={setFilters:vi.fn(),setFilterMode:vi.fn(),setSort:vi.fn(),setPageIndex:vi.fn()},rowsRef={current:[] as unknown[]},canReload=vi.fn(()=>false),info={columns:[{name:'payload'}]},record={hasInput:vi.fn(()=>false)};
  const context=createContext({...setters,rowsRef,canReload,info,record,base:target,connectionVersion:2,refreshVersion:0,externalStale:false,activeGridEditor:{current:null},presetApplyScope:{current:null},mounted:{current:true},loadGeneration:{current:3},blockedRef:{current:false},validateTablePresetColumns:(value:any,columns:string[])=>{expect(columns).toEqual(['payload']);return value;}});
  runInContext(ts.transpileModule(functions.join('\n')+'\nglobalThis.prepare=preparePresetApply;globalThis.apply=applyNamedPreset;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  expect(context.prepare()).toBe(false);expect(context.apply(configuration)).toBe(false);expect(setters.setFilters).not.toHaveBeenCalled();
  canReload.mockReturnValue(true);expect(context.prepare()).toBe(true);rowsRef.current=[];expect(context.apply(configuration)).toBe(false);expect(setters.setFilters).not.toHaveBeenCalled();
  expect(context.prepare()).toBe(true);expect(context.apply(configuration)).toBe(true);expect(setters.setFilters).toHaveBeenCalledExactlyOnceWith(configuration.filters);expect(setters.setFilterMode).toHaveBeenCalledExactlyOnceWith('all');expect(setters.setSort).toHaveBeenCalledExactlyOnceWith(configuration.sort);expect(setters.setPageIndex).toHaveBeenCalledExactlyOnceWith(1);
 });
});
