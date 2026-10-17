import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';
import {queryContextZh} from '../../src/renderer/locales/queryContext.zh-CN';
import {queryStreamZh} from '../../src/renderer/locales/queryStreamExport.zh-CN';
import {queryResultSelectionFixture} from '../fixtures/query-result-selection';

/** 执行真实组件内的发送函数，只隔离React与IPC边界，核对等待、取消和失败不发送写入。 */
function fixture(){
  const selection=queryResultSelectionFixture();
  const source=readFileSync(new URL('../../src/renderer/components/QueryTab.tsx',import.meta.url),'utf8'),file=ts.createSourceFile('QueryTab.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),names=new Set(['runQuery','runStreamExport','prepareExecutionContext','cancelCurrentQuery','invalidateResultSelection']),functions:string[]=[];
  function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)&&node.name&&names.has(node.name.text))functions.push(node.getText(file));ts.forEachChild(node,visit);}visit(file);if(functions.length!==5)throw Error('生产准备函数入口改变');
  const invoke=vi.fn(async(_command:string,_input?:unknown)=>({results:[]})),flushSettings=vi.fn(async()=>{}),ensureSession=vi.fn(async()=>'session'),rememberDatabase=vi.fn(),handleQueryError=vi.fn(async(_reason:unknown)=>{});let serial=0;
  const context=createContext({resultSelection:selection.resultSelection,Error,queryContextZh,queryStreamZh,streamExportSource:'INSERT INTO subject VALUES(1)',streamCancelled:{current:''},streamParameterSession:{current:''},invoke,flushSettings,ensureSession,rememberDatabase,handleQueryError,errorMessage:(reason:unknown)=>reason instanceof Error?reason.message:String(reason),uid:()=>`task${++serial}`,
    busyRef:{current:false},cancelledQuery:{current:''},task:{current:''},parameterSession:{current:''},tab:{id:'tab'},settings:{resultLimit:10},useWorkspace:{getState:()=>({setBusy(){},setDirty(){}})},
    setBusy(){},setQueryRunning(){},setError(){},setSelectedPin(){},setShowPinSql(){},setOutcome(){},setStream(){},setResultIndex(){},setTransaction(){},setTransactionKnown(){}
  });
  runInContext(ts.transpileModule(functions.join('\n')+'\nglobalThis.handlers={runQuery,runStreamExport,cancelCurrentQuery}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return{selection,context,invoke,flushSettings,ensureSession,rememberDatabase,handleQueryError,handlers:context.handlers as{runQuery(source:string):Promise<void>;runStreamExport(options:{taskId:string}):Promise<unknown>;cancelCurrentQuery():Promise<void>}};
}
/** 手动控制真实异步边界，不能靠固定sleep期待取消恰好发生在投递前。 */
function gate(){let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});return{pending,release};}
describe('查询上下文落盘与投递前取消',()=>{
  it.each(['query','stream'] as const)('%s真实执行首次等待前撤销原勾选，配置落盘仍可独立等待',async mode=>{
    const f=fixture(),held=gate();f.flushSettings.mockImplementationOnce(()=>held.pending);
    const running=mode==='query'?f.handlers.runQuery('SELECT 1'):f.handlers.runStreamExport({taskId:'export'});
    expect(f.selection.resultSelection.count(f.selection.binding)).toBe(0);
    await vi.waitFor(()=>expect(f.flushSettings).toHaveBeenCalledOnce());expect(f.invoke).not.toHaveBeenCalled();
    held.release();await running;expect(f.invoke).toHaveBeenCalledOnce();
  });
  it('忙碌分支未启动新执行时保留原选择，且不投递SQL或文件任务',async()=>{
    const f=fixture();f.context.busyRef.current=true;
    await f.handlers.runQuery('SELECT 1');await expect(f.handlers.runStreamExport({taskId:'export'})).rejects.toThrow(queryStreamZh.blocked);
    expect(f.selection.resultSelection.count(f.selection.binding)).toBe(1);expect(f.invoke).not.toHaveBeenCalled();expect(f.ensureSession).not.toHaveBeenCalled();
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
