import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';
import {queryContextZh} from '../../src/renderer/locales/queryContext.zh-CN';
import {queryStreamZh} from '../../src/renderer/locales/queryStreamExport.zh-CN';
import {queryResultSelectionFixture} from '../fixtures/query-result-selection';
import {QueryRowDetails} from '../../src/renderer/queryRowDetails';
import {CompletionServerFacts} from '../../src/renderer/completionServerFacts';
import type {ConnectionStatus} from '../../src/shared/contracts';

/** 执行真实组件内的发送函数，只隔离React与IPC边界，核对等待、取消和失败不发送写入。 */
function fixture(){
  const selection=queryResultSelectionFixture();
  const source=readFileSync(new URL('../../src/renderer/components/QueryTab.tsx',import.meta.url),'utf8'),file=ts.createSourceFile('QueryTab.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),names=new Set(['runQuery','runStreamExport','clearFailureSource','prepareExecutionContext','cancelCurrentQuery','invalidateResultSelection']),functions:string[]=[];
  function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)&&node.name&&names.has(node.name.text))functions.push(node.getText(file));ts.forEachChild(node,visit);}visit(file);if(functions.length!==6)throw Error('生产准备函数入口改变');
  const invoke=vi.fn(async(_command:string,_input?:unknown)=>({results:[]})),flushSettings=vi.fn(async()=>{}),ensureSession=vi.fn(async()=>'session'),rememberDatabase=vi.fn(),handleQueryError=vi.fn(async(_reason:unknown)=>{});let serial=0;
  const context=createContext({snapshotOperation:{current:null},resultInsertRef:{current:null},resultInsertActivity:{current:0},resultSelection:selection.resultSelection,failureSource:{current:undefined},
    // 只补齐真实初始详情控制器和React状态端口，不替换生产失效/执行函数。
    rowDetails:new QueryRowDetails(),setRowDetail:vi.fn(),setActiveDetailRow:vi.fn(),
    // 对应未打开筛选面板的真实初始引用，不替换原撤销函数或投递断言。
    comparisonLeaseRef:{current:null},setComparisonLease:vi.fn(),statisticsLeaseRef:{current:null},setStatisticsLease:vi.fn(),sortLeaseRef:{current:null},setSortLease:vi.fn(),filterLeaseRef:{current:null},setFilterLease:vi.fn(),
    Error,queryContextZh,queryStreamZh,streamExportSource:'INSERT INTO subject VALUES(1)',streamCancelled:{current:''},streamParameterSession:{current:''},invoke,flushSettings,ensureSession,rememberDatabase,handleQueryError,errorMessage:(reason:unknown)=>reason instanceof Error?reason.message:String(reason),uid:()=>`task${++serial}`,
    busyRef:{current:false},cancelledQuery:{current:''},task:{current:''},parameterSession:{current:''},tab:{id:'tab'},settings:{resultLimit:10},useWorkspace:{getState:()=>({setBusy(){},setDirty(){}})},
    setBusy(){},setQueryRunning(){},setError(){},setSelectedPin(){},setShowPinSql(){},setOutcome(){},setStream(){},setResultIndex(){},setTransaction(){},setTransactionKnown(){}
  });
  runInContext(ts.transpileModule(functions.join('\n')+'\nglobalThis.handlers={runQuery,runStreamExport,cancelCurrentQuery}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return{selection,context,invoke,flushSettings,ensureSession,rememberDatabase,handleQueryError,handlers:context.handlers as{runQuery(source:string):Promise<void>;runStreamExport(options:{taskId:string}):Promise<unknown>;cancelCurrentQuery():Promise<void>}};
}
/** 手动控制真实异步边界，不能靠固定sleep期待取消恰好发生在投递前。 */
function gate(){let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});return{pending,release};}

/** 手动安排真实新建查询effect的建连和目录回包；不启动React、客户端或数据库。 */
function newQueryDirectoryFixture(){
  const source=readFileSync(new URL('../../src/renderer/App.tsx',import.meta.url),'utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const component=file.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='NewQueryDialog');
  const effects:ts.ArrowFunction[]=[];
  function visit(node:ts.Node){if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='useEffect'&&ts.isArrowFunction(node.arguments[0]))effects.push(node.arguments[0]);ts.forEachChild(node,visit);}
  if(!component)throw Error('生产新建查询入口改变');visit(component);if(effects.length!==1)throw Error('生产新建查询effect数量改变');
  const opened=valueGate<ConnectionStatus>(),directory=valueGate<string[]>(),cache=new CompletionServerFacts(),workspace={connectionVersions:{c:0} as Record<string,number>};
  const invoke=vi.fn((command:string,_input:unknown)=>{if(command==='connections.open')return opened.pending;if(command==='metadata.databases')return directory.pending;throw Error('非预期RAM命令');});
  const setDatabases=vi.fn(),setBusy=vi.fn(),setError=vi.fn(),context=createContext({connectionId:'c',completionServerFacts:cache,useWorkspace:{getState:()=>workspace},invoke,setDatabases,setBusy,setError,errorMessage:(reason:unknown)=>reason instanceof Error?reason.message:String(reason)});
  runInContext(ts.transpileModule('globalThis.cleanup=('+effects[0].getText(file)+')();',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return{opened,directory,cache,workspace,invoke,setDatabases,setBusy,setError,cleanup:context.cleanup as()=>void};
}
/** 回包由用例显式释放，不以固定等待或网络快慢制造生命周期窗口。 */
function valueGate<T>(){let release!:(value:T)=>void,reject!:(reason:unknown)=>void;const pending=new Promise<T>((yes,no)=>{release=yes;reject=no;});return{pending,release,reject};}
/** 回包释放后让本轮Promise链排空；使用明确事件循环回合，不猜测网络或固定等待时长。 */
async function settleDirectoryCallbacks(){await new Promise<void>(resolve=>setImmediate(resolve));}
const directoryStatus:ConnectionStatus={dialect:'mysql',version:'8.4.11'};

describe('新建查询目录读取的真实effect生命周期',()=>{
  it('当前窗口依次建连和读目录，原事实与项目仅提交一次',async()=>{
    const f=newQueryDirectoryFixture();expect(f.invoke.mock.calls).toEqual([['connections.open',{id:'c'}]]);f.opened.release(directoryStatus);await f.opened.pending;
    expect(f.invoke.mock.calls).toEqual([['connections.open',{id:'c'}],['metadata.databases',{connectionId:'c'}]]);f.directory.release(['原库']);await vi.waitFor(()=>expect(f.setBusy).toHaveBeenLastCalledWith(false));
    expect(f.setDatabases.mock.calls).toEqual([[[]],[['原库']]]);expect(f.cache.get('c',0)).toEqual(directoryStatus);expect(f.setError).not.toHaveBeenCalled();f.cleanup();
  });
  it('窗口已关闭，迟到建连不得继续读取目录',async()=>{
    const f=newQueryDirectoryFixture();f.cleanup();f.opened.release(directoryStatus);await f.opened.pending;await settleDirectoryCallbacks();
    expect(f.invoke.mock.calls).toEqual([['connections.open',{id:'c'}]]);expect(f.setDatabases.mock.calls).toEqual([[[]]]);expect(f.setError).not.toHaveBeenCalled();
  });
  it('已关闭窗口的同修订建连事实继续供首次执行前补全复用，且不追加目录',async()=>{
    const f=newQueryDirectoryFixture();f.cleanup();f.opened.release(directoryStatus);await f.opened.pending;await settleDirectoryCallbacks();
    expect(f.cache.get('c',0)).toEqual(directoryStatus);expect(f.invoke.mock.calls).toEqual([['connections.open',{id:'c'}]]);expect(f.setDatabases.mock.calls).toEqual([[[]]]);
  });
  it('建连期间连接修订变化，迟到结果不得读取新目标目录',async()=>{
    const f=newQueryDirectoryFixture();f.workspace.connectionVersions.c=1;f.opened.release(directoryStatus);await f.opened.pending;await settleDirectoryCallbacks();
    expect(f.invoke.mock.calls).toEqual([['connections.open',{id:'c'}]]);expect(f.cache.get('c',0)).toBeUndefined();f.cleanup();
  });
  it('目录已发送后关闭窗口，迟到项目不会写入已关闭界面',async()=>{
    const f=newQueryDirectoryFixture();f.opened.release(directoryStatus);await f.opened.pending;expect(f.invoke).toHaveBeenCalledTimes(2);f.cleanup();f.directory.release(['迟到库']);await f.directory.pending;await settleDirectoryCallbacks();
    expect(f.setDatabases.mock.calls).toEqual([[[]]]);expect(f.cache.get('c',0)).toEqual(directoryStatus);expect(f.setError).not.toHaveBeenCalled();
  });
  it.each(['success','failure'] as const)('目录已发送后修订改变，迟到%s不会写入旧目录或错误',async mode=>{
    const f=newQueryDirectoryFixture();f.opened.release(directoryStatus);await f.opened.pending;expect(f.invoke).toHaveBeenCalledTimes(2);f.workspace.connectionVersions.c=1;
    if(mode==='success'){f.directory.release(['旧修订库']);await f.directory.pending;}else{const reason=Error('旧修订错误');f.directory.reject(reason);await expect(f.directory.pending).rejects.toBe(reason);}await settleDirectoryCallbacks();
    expect(f.setDatabases.mock.calls).toEqual([[[]]]);expect(f.setError).not.toHaveBeenCalled();expect(f.invoke).toHaveBeenCalledTimes(2);f.cleanup();
  });
  it('旧窗口关闭后同修订新ticket已完成，旧回包不能读目录或覆盖新事实',async()=>{
    const f=newQueryDirectoryFixture();f.cleanup();const next=f.cache.begin('c',0);f.cache.complete(next,{dialect:'mysql',version:'8.4.12'});f.opened.release(directoryStatus);await f.opened.pending;await settleDirectoryCallbacks();
    expect(f.invoke).toHaveBeenCalledOnce();expect(f.cache.get('c',0)?.version).toBe('8.4.12');expect(f.setDatabases.mock.calls).toEqual([[[]]]);
  });
  it('已关闭窗口的建连失败不发布错误或重新请求',async()=>{
    const f=newQueryDirectoryFixture();f.cleanup();const reason=Error('RAM建连失败');f.opened.reject(reason);await expect(f.opened.pending).rejects.toBe(reason);await settleDirectoryCallbacks();
    expect(f.invoke).toHaveBeenCalledOnce();expect(f.setError).not.toHaveBeenCalled();expect(f.cache.get('c',0)).toBeUndefined();
  });
  it('当前目录失败仍显示原错误并保留已取得的服务器事实',async()=>{
    const f=newQueryDirectoryFixture();f.opened.release(directoryStatus);await f.opened.pending;const reason=Error('RAM目录拒绝');f.directory.reject(reason);await expect(f.directory.pending).rejects.toBe(reason);await vi.waitFor(()=>expect(f.setBusy).toHaveBeenLastCalledWith(false));
    expect(f.invoke).toHaveBeenCalledTimes(2);expect(f.setError).toHaveBeenCalledWith('RAM目录拒绝');expect(f.cache.get('c',0)).toEqual(directoryStatus);f.cleanup();
  });
});
describe('查询上下文落盘与投递前取消',()=>{
  it.each(['query','stream'] as const)('%s真实执行首次等待前撤销原勾选，配置落盘仍可独立等待',async mode=>{
    const f=fixture(),held=gate();f.flushSettings.mockImplementationOnce(()=>held.pending);
    const running=mode==='query'?f.handlers.runQuery('SELECT 1'):f.handlers.runStreamExport({taskId:'export'});
    expect(f.selection.resultSelection.count(f.selection.binding)).toBe(0);
    expect(f.context.setRowDetail).toHaveBeenCalledWith(null);expect(f.context.setActiveDetailRow).toHaveBeenCalledWith(null);
    await vi.waitFor(()=>expect(f.flushSettings).toHaveBeenCalledOnce());expect(f.invoke).not.toHaveBeenCalled();
    held.release();await running;expect(f.invoke).toHaveBeenCalledOnce();
  });
  it('忙碌分支未启动新执行时保留原选择，且不投递SQL或文件任务',async()=>{
    const f=fixture();f.context.busyRef.current=true;
    await f.handlers.runQuery('SELECT 1');await expect(f.handlers.runStreamExport({taskId:'export'})).rejects.toThrow(queryStreamZh.blocked);
    expect(f.selection.resultSelection.count(f.selection.binding)).toBe(1);expect(f.invoke).not.toHaveBeenCalled();expect(f.ensureSession).not.toHaveBeenCalled();
    expect(f.context.setRowDetail).not.toHaveBeenCalled();expect(f.context.setActiveDetailRow).not.toHaveBeenCalled();
  });
  it('恢复快照未落盘前不发送SQL，成功确认后仅发送一次',async()=>{
    const f=fixture(),held=gate();f.flushSettings.mockImplementationOnce(()=>held.pending);const running=f.handlers.runQuery('INSERT INTO subject VALUES(1)');await vi.waitFor(()=>expect(f.flushSettings).toHaveBeenCalledTimes(1));expect(f.rememberDatabase).toHaveBeenCalledWith({state:'unknown'});expect(f.invoke).not.toHaveBeenCalled();held.release();await running;expect(f.invoke).toHaveBeenCalledTimes(1);expect(f.invoke.mock.calls[0][0]).toBe('query.execute');expect(f.context.busyRef.current).toBe(false);
  });
  it('本地配置写盘失败不投递用户写SQL，也不会自动重试',async()=>{
    const f=fixture();f.flushSettings.mockRejectedValueOnce(Error('磁盘失败'));await f.handlers.runQuery('INSERT INTO subject VALUES(1)');expect(f.invoke).not.toHaveBeenCalled();expect(f.handleQueryError.mock.calls[0][0]).toHaveProperty('message',queryContextZh.snapshotFailed+'磁盘失败');expect(f.context.busyRef.current).toBe(false);
  });
  it.each(['connection','settings'])('%s准备期间取消使迟到完成不投递写入，下一次明确执行才可发送',async phase=>{
    const f=fixture(),held=gate();if(phase==='connection')f.ensureSession.mockImplementationOnce(async()=>{await held.pending;return'session';});else f.flushSettings.mockImplementationOnce(()=>held.pending);
    const running=f.handlers.runQuery('INSERT INTO subject VALUES(1)');await vi.waitFor(()=>expect(phase==='connection'?f.ensureSession:f.flushSettings).toHaveBeenCalledTimes(1));await f.handlers.cancelCurrentQuery();held.release();await running;expect(f.invoke.mock.calls.map(call=>call[0])).toEqual(['query.cancel']);expect(f.handleQueryError.mock.calls[0][0]).toHaveProperty('message',queryContextZh.cancelledBeforeSend);
    await f.handlers.runQuery('INSERT INTO subject VALUES(2)');expect(f.invoke.mock.calls.map(call=>call[0])).toEqual(['query.cancel','query.execute']);expect(f.context.busyRef.current).toBe(false);
  });
  it('完整导出同样先等恢复信息落盘，期间工具栏取消不会迟到执行或写文件',async()=>{
    const f=fixture(),held=gate();f.flushSettings.mockImplementationOnce(()=>held.pending);const pending=f.handlers.runStreamExport({taskId:'export'}),failure=expect(pending).rejects.toThrow(queryContextZh.cancelledBeforeSend);await vi.waitFor(()=>expect(f.flushSettings).toHaveBeenCalledTimes(1));expect(f.invoke).not.toHaveBeenCalled();await f.handlers.cancelCurrentQuery();held.release();await failure;expect(f.invoke.mock.calls.map(call=>call[0])).toEqual(['query.cancel']);expect(f.context.busyRef.current).toBe(false);
  });
  it('完整导出的配置保存失败不会发送导出请求或重试SQL',async()=>{
    const f=fixture();f.flushSettings.mockRejectedValueOnce(Error('磁盘失败'));await expect(f.handlers.runStreamExport({taskId:'export'})).rejects.toThrow(queryContextZh.snapshotFailed);expect(f.invoke).not.toHaveBeenCalled();expect(f.context.busyRef.current).toBe(false);
  });
});
