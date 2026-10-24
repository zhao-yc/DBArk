import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TaskEvent } from '../../src/shared/contracts';
import { assertTableFilteredUpdateReleased, type TableFilteredUpdateCancelReleaseProof } from '../helpers/tableFilteredUpdateRelease';
import type { TableValueOptionsConnectionFact } from '../helpers/tableValueOptionsIntegration';

type Fact = TableValueOptionsConnectionFact;
const taskId = '12345678-1234-4234-8234-123456789abc', scope = 'table.filteredUpdate.apply:cancel_wait' as const;
const updateSql = 'UPDATE `dbark_filteredupdate_ram`.`cancel_subject` SET `note` = ? WHERE `id` <=> ?';
/** 此处仅构造RAM观察事实，真实mysql2关闭证据由独立实库专项采集。 */
function fact(id: number, sql: string, terminal = true): Fact {
  const stream = Object.assign(new EventEmitter(), { closed: true }), native = Object.assign(new EventEmitter(), { threadId: id, stream, query() {}, execute() {} });
  const managed = { connection: native } as unknown as ManagedConnection;
  return { managed, native, stream, id, scope, pending: terminal ? 0 : 1, closeCalls: 1, strict: true, closeReturned: true, closeFailed: false, closed: Promise.resolve(), sawClose: true, commands: [{ sql, method: sql.startsWith('UPDATE ') ? 'execute' : 'query', streamed: false, callbackReturned: true, terminal }] };
}
function fixture(end = false) {
  const data = fact(6174, updateSql, end), control = fact(6175, 'KILL CONNECTION 6174');
  data.commands.unshift({ sql: 'START TRANSACTION', method: 'query', streamed: false, callbackReturned: true, terminal: true });
  const terminalEvent: TaskEvent = { taskId, status: 'cancelled', progress: 0, message: 'RAM物理关闭', tableFilteredUpdate: { phase: 'updating', rows: 0, totalRows: 81, snapshotBytes: 1024, dmlMayHaveBeenSent: true, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, transactionProtected: true, outcome: 'unknown' } };
  const proof: TableFilteredUpdateCancelReleaseProof = { scope, taskId, data, update: data.commands[1], updateSql, lockWaitRows: [{ id: 6174, state: 'LOCK WAIT' }], cancelTaskId: taskId, cancelCompleted: true, cancelFailure: undefined, terminalEvent, processRows: [], transactionRows: [] };
  return { data, control, proof, facts: [data, control] };
}

describe('全部筛选行填充原收尾的正常end与准确物理关闭分类（仅RAM）', () => {
  it('正常路径仍沿旧callback+end门，不能因socket关闭跳过callback或end', () => {
    const value = fact(7, 'SELECT 1'); expect(assertTableFilteredUpdateReleased([value], true)).toEqual({ completion: 'driver-end', normalEnd: true, physicalClose: false, originalPending: 0 });
    value.commands[0].terminal = false; value.pending = 1; expect(() => assertTableFilteredUpdateReleased([value], true)).toThrow();
  });
  it('精确KILL后的UPDATE callback已回但无end，以physical-close单独记账且保留原pending/terminal', () => {
    const f = fixture(), commands = f.data.commands.slice();
    expect(assertTableFilteredUpdateReleased(f.facts, true, f.proof)).toEqual({ completion: 'physical-close', normalEnd: false, physicalClose: true, originalPending: 1, dataThreadId: 6174, updateCommandIndex: 1, originalUpdateEnd: false });
    expect(f.data.pending).toBe(1); expect(f.proof.update.terminal).toBe(false); expect(f.data.commands).toEqual(commands); expect(f.data.commands[1]).toBe(f.proof.update);
  });
  it('同一取消若真实收到driver end，仍按driver-end记录', () => { const f = fixture(true); expect(assertTableFilteredUpdateReleased(f.facts, true, f.proof)).toMatchObject({ completion: 'driver-end', normalEnd: true, physicalClose: false, originalPending: 0, originalUpdateEnd: true }); });
  it.each([
    '缺UPDATEcallback', '缺KILLcallback', '缺KILLend', 'KILL错目标', '多KILL', '缺取消结算', '取消失败', '取消错task', '缺LOCKWAIT', '锁错线程', '原线程仍活跃', '原事务仍活跃', 'scope漂移', 'controlscope漂移', 'data对象被替换', 'UPDATE对象被替换', 'native漂移', 'stream漂移', 'thread漂移', 'socket未close', '非strict', 'close未返回', 'close失败', '多次close', '其它命令缺end', '其它命令缺callback', '错误pending', '额外物理连接', '缺terminalEvent', '终态错task', '声称commitACK', '声称rollbackACK', 'COMMIT可能已发', 'DML未发', '结果非unknown', '非严格调用',
  ] as const)('%s不能获准使用物理关闭分支', kind => {
    const f = fixture(); let strict = true;
    if (kind === '缺UPDATEcallback') f.proof.update.callbackReturned = false;
    if (kind === '缺KILLcallback') f.control.commands[0].callbackReturned = false;
    if (kind === '缺KILLend') f.control.commands[0].terminal = false;
    if (kind === 'KILL错目标') f.control.commands[0].sql = 'KILL CONNECTION 6173';
    if (kind === '多KILL') f.control.commands.push({ ...f.control.commands[0] });
    if (kind === '缺取消结算') f.proof.cancelCompleted = false;
    if (kind === '取消失败') f.proof.cancelFailure = Error('RAM取消失败');
    if (kind === '取消错task') f.proof.cancelTaskId = '另一个task';
    if (kind === '缺LOCKWAIT') f.proof.lockWaitRows = [];
    if (kind === '锁错线程') f.proof.lockWaitRows = [{ id: 6173, state: 'LOCK WAIT' }];
    if (kind === '原线程仍活跃') f.proof.processRows = [{ ID: 6174 }];
    if (kind === '原事务仍活跃') f.proof.transactionRows = [{ id: 6174, state: 'ROLLING BACK' }];
    if (kind === 'scope漂移') f.data.scope = 'table.filteredUpdate.apply:other';
    if (kind === 'controlscope漂移') f.control.scope = 'table.filteredUpdate.preview:cancel_wait';
    if (kind === 'data对象被替换') f.facts[0] = { ...f.data };
    if (kind === 'UPDATE对象被替换') f.proof.update = { ...f.proof.update };
    if (kind === 'native漂移') f.data.managed.connection = {} as ManagedConnection['connection'];
    if (kind === 'stream漂移') f.data.native.stream = Object.assign(new EventEmitter(), { closed: true });
    if (kind === 'thread漂移') f.data.native.threadId++;
    if (kind === 'socket未close') f.data.stream.closed = false;
    if (kind === '非strict') f.data.strict = false;
    if (kind === 'close未返回') f.data.closeReturned = false;
    if (kind === 'close失败') f.data.closeFailed = true;
    if (kind === '多次close') f.data.closeCalls++;
    if (kind === '其它命令缺end') f.data.commands[0].terminal = false;
    if (kind === '其它命令缺callback') f.data.commands[0].callbackReturned = false;
    if (kind === '错误pending') f.data.pending = 0;
    if (kind === '额外物理连接') f.facts.push(fact(9, 'SELECT 1'));
    if (kind === '缺terminalEvent') f.proof.terminalEvent = undefined;
    if (kind === '终态错task') f.proof.terminalEvent!.taskId = '另一个task';
    if (kind === '声称commitACK') f.proof.terminalEvent!.tableFilteredUpdate!.commitAcknowledged = true;
    if (kind === '声称rollbackACK') f.proof.terminalEvent!.tableFilteredUpdate!.rollbackAcknowledged = true;
    if (kind === 'COMMIT可能已发') f.proof.terminalEvent!.tableFilteredUpdate!.commitMayHaveBeenSent = true;
    if (kind === 'DML未发') f.proof.terminalEvent!.tableFilteredUpdate!.dmlMayHaveBeenSent = false;
    if (kind === '结果非unknown') f.proof.terminalEvent!.tableFilteredUpdate!.outcome = 'rolled-back';
    if (kind === '非严格调用') strict = false;
    expect(() => assertTableFilteredUpdateReleased(f.facts, strict, f.proof)).toThrow(); expect(f.proof.update.terminal).toBe(false);
  });
});
