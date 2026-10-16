import{SavedQuerySearchCancelled}from'../../src/main/savedQuerySearch';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';
import {queryDatabasePatch} from '../../src/shared/queryContext';
import {persistedQueryError,persistedTaskMessage} from '../../src/main/taskPrivacy';
import type {HistoryEntry,TaskEvent} from '../../src/shared/contracts';

/** 使用生产分派与事件函数原文，替换IO边界，核对历史真正写入的内容及生命周期。 */
function fixture(){
  const source=readFileSync(new URL('../../src/main/index.ts',import.meta.url),'utf8');
  const event=source.slice(source.indexOf('function taskEvent('),source.indexOf('/** 文件只能'));
  const dispatch=source.slice(source.indexOf('async function dispatch('),source.indexOf('/** 按平台生成中文原生菜单'));
  const entries:HistoryEntry[]=[],request=vi.fn<(...args:any[])=>Promise<any>>(async()=>({}));
  const context=createContext({SavedQuerySearchCancelled,savedQuerySearches:{has:()=>false},savedQueryPages:undefined,historyPages:undefined,Date,Map,Set,Error,randomUUID,queryDatabasePatch,persistedQueryError,persistedTaskMessage,window:undefined,
    tasks:new Map(),pendingQueryHistory:new Map(),completionTasks:new Set(),preparingTasks:new Map(),exportProgress:new Map(),structureProgress:new Map(),structureTokens:new Map(),lastPersist:new Map(),files:new Map(),
    sessions:new Map([['s1',{connectionId:'c1',database:'旧库'}],['s2',{connectionId:'c2',database:'更旧的库'}]]),connectionConfig:{assertAvailable(){}},
    store:{saveTask(){},addHistory(entry:HistoryEntry){entries.push(structuredClone(entry));}},persistAuxiliary:(action:()=>void)=>action(),broker:{request},
    resolveFileToken:()=>'/selected/export.json',exportReservations:{acquire:async()=>()=>{}}
  });
  runInContext(ts.transpileModule(event+dispatch+'\nglobalThis.handlers={dispatch,taskEvent}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return{entries,request,context,handlers:context.handlers as{dispatch(command:string,input:unknown):Promise<any>;taskEvent(event:TaskEvent):void}};
}

describe('执行历史的真实默认库归属',()=>{
  it('两个并发标签按任务固定引擎快照，逆序完成不串库，完成事件不会改成脚本最终库',async()=>{
    const f=fixture(),finish=new Map<string,()=>void>();f.request.mockImplementation(async(_command,input)=>{f.handlers.taskEvent({taskId:input.taskId,status:'running',progress:0,message:'执行',executionDatabase:{state:'known',database:input.sessionId==='s1'?'实际A':'实际B'}});await new Promise<void>(resolve=>finish.set(input.taskId,resolve));f.handlers.taskEvent({taskId:input.taskId,status:'completed',progress:100,message:'完成'});return{};});
    const first=f.handlers.dispatch('query.execute',{sessionId:'s1',taskId:'t1',sql:'USE 最终库;SELECT 1',maxRows:10});const second=f.handlers.dispatch('query.execute',{sessionId:'s2',taskId:'t2',sql:'SELECT 2',maxRows:10});
    finish.get('t2')!();await second;finish.get('t1')!();await first;
    expect(f.entries.map(entry=>[entry.sql,entry.database,entry.databaseContext,entry.success])).toEqual([['SELECT 2','实际B',{state:'known',database:'实际B'},true],['USE 最终库;SELECT 1','实际A',{state:'known',database:'实际A'},true]]);expect(f.context.pendingQueryHistory.size).toBe(0);
  });
  it.each(['query.execute','query.executeParameterized','query.exportStream'])('%s保留空库或未知并在失败后释放快照，不回填初始库',async command=>{
    const f=fixture();f.request.mockImplementationOnce(async(_command,input)=>{f.handlers.taskEvent({taskId:input.taskId,status:'running',progress:0,message:'执行',executionDatabase:{state:'known',database:null}});throw Error('驱动失败');});
    await expect(f.handlers.dispatch(command,{sessionId:'s1',taskId:'empty',sql:'SELECT 1',fileToken:'file',format:'json'})).rejects.toThrow('驱动失败');expect(f.entries[0]).toMatchObject({success:false,databaseContext:{state:'known',database:null}});expect(f.entries[0].database).toBeUndefined();
    f.request.mockRejectedValueOnce(Error('会话不存在'));await expect(f.handlers.dispatch(command,{sessionId:'s1',taskId:'unknown',sql:'SELECT 2',fileToken:'file',format:'json'})).rejects.toThrow('会话不存在');expect(f.entries[1].databaseContext).toEqual({state:'unknown'});expect(f.entries[1].database).toBeUndefined();expect(f.context.pendingQueryHistory.size).toBe(0);
  });
});

describe('当前语句历史只来自实际投递片段', () => {
  const input = { sessionId: 's1', taskId: 'current', sql: 'SET @before=1; SELECT 当前; DELETE FROM 后句;', maxRows: 10, currentStatement: { offset: 20 } };
  it('实际片段只接收一次，保留原默认库归属，不落完整源脚本', async () => {
    const f = fixture(); f.request.mockImplementationOnce(async () => {
      f.handlers.taskEvent({ taskId: 'current', status: 'running', progress: 0, message: '执行', executionDatabase: { state: 'known', database: '真实库' } });
      f.handlers.taskEvent({ taskId: 'current', status: 'running', progress: 0, message: '已发送', executionSql: 'SELECT 当前' });
      f.handlers.taskEvent({ taskId: 'current', status: 'running', progress: 1, message: '重复事件', executionSql: '不应覆盖' }); return {};
    });
    await f.handlers.dispatch('query.execute', input); expect(f.entries).toHaveLength(1); expect(f.entries[0]).toMatchObject({ sql: 'SELECT 当前', success: true, database: '真实库' }); expect(f.context.pendingQueryHistory.size).toBe(0);
  });
  it.each(['解析拒绝', '发送前取消', '会话不存在', '返回前未发送'] as const)('%s不得落全文或空SQL历史', async phase => {
    const f = fixture(); f.request.mockImplementationOnce(async () => { if (phase === '返回前未发送') return {}; throw Error(phase); });
    await f.handlers.dispatch('query.execute', input).catch(() => {}); expect(f.entries).toEqual([]); expect(f.context.pendingQueryHistory.size).toBe(0);
  });
  it.each(['执行失败', '发送后取消', '连接断开'])('%s仍保存实际片段且不自动重放', async phase => {
    const f = fixture(); f.request.mockImplementationOnce(async () => { f.handlers.taskEvent({ taskId: 'current', status: 'running', progress: 0, message: '已发送', executionSql: 'SELECT 当前' }); throw Error(phase); });
    await expect(f.handlers.dispatch('query.execute', input)).rejects.toThrow(phase); expect(f.entries).toHaveLength(1); expect(f.entries[0]).toMatchObject({ sql: 'SELECT 当前', success: false }); expect(f.request).toHaveBeenCalledOnce();
  });
  it('空白事件不授权历史，普通执行也不能被executionSql改写', async () => {
    const f = fixture(); f.request.mockImplementation(async (_command, value) => { f.handlers.taskEvent({ taskId: value.taskId, status: 'running', progress: 0, message: '事件', executionSql: value.currentStatement ? '  ' : '其它片段' }); return {}; });
    await f.handlers.dispatch('query.execute', input); expect(f.entries).toEqual([]);
    await f.handlers.dispatch('query.execute', { ...input, taskId: 'ordinary', currentStatement: undefined }); expect(f.entries).toHaveLength(1); expect(f.entries[0].sql).toBe(input.sql);
  });
});
