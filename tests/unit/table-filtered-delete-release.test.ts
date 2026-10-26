import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TaskEvent } from '../../src/shared/contracts';
import { assertTableFilteredDeleteCancelPhysical, assertTableFilteredDeleteReleased, waitTableFilteredDeleteTransactionObservation, type TableFilteredDeleteCancelReleaseProof } from '../helpers/tableFilteredDeleteRelease';
import type { TableValueOptionsConnectionFact } from '../helpers/tableValueOptionsIntegration';

type Fact = TableValueOptionsConnectionFact;
const taskId = '12345678-1234-4234-8234-123456789abc', scope = 'table.filteredDelete.apply:cancel_wait' as const;
const deleteSql = 'DELETE FROM `dbark_filtereddelete_ram`.`cancel_subject` WHERE `note` <=> ? AND `id` <=> ?';
/** 此处仅构造RAM观察事实，真实mysql2关闭证据由独立实库专项采集。 */
function fact(id: number, sql: string, terminal = true): Fact {
  const stream = Object.assign(new EventEmitter(), { closed: true }), native = Object.assign(new EventEmitter(), { threadId: id, stream, query() {}, execute() {} });
  const managed = { connection: native } as unknown as ManagedConnection;
  return { managed, native, stream, id, scope, pending: terminal ? 0 : 1, closeCalls: 1, strict: true, closeReturned: true, closeFailed: false, closed: Promise.resolve(), sawClose: true, commands: [{ sql, method: sql.startsWith('DELETE FROM ') && !sql.endsWith('WHERE 0') ? 'execute' : 'query', streamed: false, callbackReturned: true, terminal }] };
}
function fixture(end = false) {
  const data = fact(6174, deleteSql, end), control = fact(6175, 'KILL CONNECTION 6174');
  data.commands.unshift({ sql: 'START TRANSACTION', method: 'query', streamed: false, callbackReturned: true, terminal: true });
  data.commands.splice(1, 0, { sql: 'DELETE FROM `dbark_filtereddelete_ram`.`cancel_subject` WHERE 0', method: 'query', streamed: false, callbackReturned: true, terminal: true });
  const terminalEvent: TaskEvent = { taskId, status: 'cancelled', progress: 0, message: 'RAM物理关闭', tableFilteredDelete: { phase: 'deleting', rows: 0, totalRows: 81, snapshotBytes: 1024, dmlMayHaveBeenSent: true, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, transactionProtected: true, outcome: 'unknown' } };
  const proof: TableFilteredDeleteCancelReleaseProof = { scope, taskId, data, deletion: data.commands[2], deleteSql, lockWaitRows: [{ id: 6174, state: 'LOCK WAIT' }], cancelTaskId: taskId, cancelCompleted: true, cancelFailure: undefined, terminalEvent, rpcTaskId: taskId, rpcCompleted: true, rpcError: Error('RAM原RPC取消失败终态'), processRows: [], transactionRows: [] };
  return { data, control, proof, facts: [data, control] };
}

describe('全部筛选行删除原收尾的正常end与准确物理关闭分类（仅RAM）', () => {
  it('正常路径仍沿旧callback+end门，不能因socket关闭跳过callback或end', () => {
    const value = fact(7, 'SELECT 1'); expect(assertTableFilteredDeleteReleased([value], true)).toEqual({ completion: 'driver-end', normalEnd: true, physicalClose: false, originalPending: 0 });
    value.commands[0].terminal = false; value.pending = 1; expect(() => assertTableFilteredDeleteReleased([value], true)).toThrow();
    const missingCallback = fact(8, 'SELECT 1'); missingCallback.commands[0].callbackReturned = false; missingCallback.pending = 1;
    expect(() => assertTableFilteredDeleteReleased([missingCallback], true)).toThrow();
  });
  it('精确KILL后的DELETE callback已回但无end，以physical-close单独记账且保留原pending/terminal', () => {
    const f = fixture(), commands = f.data.commands.slice();
    expect(assertTableFilteredDeleteReleased(f.facts, true, f.proof)).toEqual({ completion: 'physical-close', normalEnd: false, physicalClose: true, originalPending: 1, dataThreadId: 6174, deleteCommandIndex: 2, originalDeleteCallback: true, originalDeleteEnd: false });
    expect(f.data.pending).toBe(1); expect(f.proof.deletion.terminal).toBe(false); expect(f.data.commands).toEqual(commands); expect(f.data.commands[2]).toBe(f.proof.deletion);
  });
  it('同一取消若真实收到callback和driver end，仍按driver-end记录', () => { const f = fixture(true); expect(assertTableFilteredDeleteReleased(f.facts, true, f.proof)).toMatchObject({ completion: 'driver-end', normalEnd: true, physicalClose: false, originalPending: 0, originalDeleteCallback: true, originalDeleteEnd: true }); });
  it.each([false, true])('准确物理关闭可缺DELETE callback，原end=%s及watch pending仍如实保留', end => {
    const f = fixture(end); f.proof.deletion.callbackReturned = false; f.data.pending = 1;
    const originalCommand = f.proof.deletion, commands = f.data.commands.slice();
    expect(assertTableFilteredDeleteCancelPhysical(f.facts, true, f.proof)).toMatchObject({ originalDeleteCallback: false, originalDeleteEnd: end, originalPending: 1, processAndTransactionDisappearanceProven: false });
    expect(assertTableFilteredDeleteReleased(f.facts, true, f.proof)).toMatchObject({ completion: 'physical-close', normalEnd: false, physicalClose: true, originalDeleteCallback: false, originalDeleteEnd: end, originalPending: 1 });
    expect(f.proof.deletion).toBe(originalCommand); expect(f.proof.deletion.callbackReturned).toBe(false); expect(f.proof.deletion.terminal).toBe(end); expect(f.data.pending).toBe(1); expect(f.data.commands).toEqual(commands);
    f.proof.transactionRows = [{ id: 6174, state: 'LOCK WAIT' }]; expect(() => assertTableFilteredDeleteReleased(f.facts, true, f.proof)).toThrow();
  });
  it.each(['缺准确KILLcallback', '缺取消结算', 'RPC错task', '缺strictclose返回', '原socket替换'] as const)('缺DELETE callback时%s仍不能冒充物理证明', kind => {
    const f = fixture(); f.proof.deletion.callbackReturned = false;
    if (kind === '缺准确KILLcallback') f.control.commands[0].callbackReturned = false;
    if (kind === '缺取消结算') f.proof.cancelCompleted = false;
    if (kind === 'RPC错task') f.proof.rpcTaskId = '其它task';
    if (kind === '缺strictclose返回') f.data.closeReturned = false;
    if (kind === '原socket替换') f.data.native.stream = Object.assign(new EventEmitter(), { closed: true });
    expect(() => assertTableFilteredDeleteCancelPhysical(f.facts, true, f.proof)).toThrow(); expect(() => assertTableFilteredDeleteReleased(f.facts, true, f.proof)).toThrow();
    expect(f.proof.deletion.callbackReturned).toBe(false); expect(f.data.pending).toBe(1);
  });
  it('物理屏障只允许释放原fixture读锁，不接收或伪造服务器事务消失证据', () => {
    const f = fixture(); f.proof.processRows = [{ ID: 6174 }]; f.proof.transactionRows = [{ id: 6174, state: 'LOCK WAIT' }];
    const { processRows: _processRows, transactionRows: _transactionRows, ...physicalProof } = f.proof;
    const physical = assertTableFilteredDeleteCancelPhysical(f.facts, true, physicalProof);
    expect(physical).toEqual({ barrier: 'rpc-cancel-physical-close', scope, taskId, rpcTaskId: taskId, cancelTaskId: taskId, dataThreadId: 6174, controlThreadId: 6175, deleteCommandIndex: 2, deleteSql, killSql: 'KILL CONNECTION 6174', commitCommands: 0, originalPending: 1, originalDeleteCallback: true, originalDeleteEnd: false, processAndTransactionDisappearanceProven: false });
    expect(physical).not.toHaveProperty('completion'); expect(() => assertTableFilteredDeleteReleased(f.facts, true, f.proof)).toThrow();
    expect(f.data.pending).toBe(1); expect(f.proof.deletion.terminal).toBe(false);
  });
  it('正常driver end也必须经同一RPC/取消/严格物理屏障，仍不声称事务消失', () => {
    const f = fixture(true); expect(assertTableFilteredDeleteCancelPhysical(f.facts, true, f.proof)).toMatchObject({ originalPending: 0, originalDeleteEnd: true, processAndTransactionDisappearanceProven: false });
  });
  it.each([
    '缺DELETEcallback且缺物理close事件', '缺KILLcallback', '缺KILLend', 'KILL错目标', '多KILL', '缺取消结算', '取消失败', '取消错task', '缺RPC结算', 'RPC错task', 'RPC无失败终态', '缺LOCKWAIT', '锁错线程', '原线程仍活跃', '原事务仍活跃', 'scope漂移', 'controlscope漂移', 'data对象被替换', 'DELETE对象被替换', 'native漂移', 'stream漂移', 'thread漂移', 'socket未close', '缺close事件', '仅socket属性', '非strict', 'close未返回', 'close失败', '多次close', '其它命令缺end', '其它命令缺callback', '错误pending', '额外物理连接', '额外queryDELETE', 'data额外COMMIT', 'control额外COMMIT', '缺terminalEvent', '终态错task', '声称commitACK', '声称rollbackACK', 'COMMIT可能已发', 'DML未发', '结果非unknown', '非严格调用',
  ] as const)('%s不能获准使用物理关闭分支', kind => {
    const f = fixture(); let strict = true;
    if (kind === '缺DELETEcallback且缺物理close事件') { f.proof.deletion.callbackReturned = false; f.data.sawClose = false; }
    if (kind === '缺KILLcallback') f.control.commands[0].callbackReturned = false;
    if (kind === '缺KILLend') f.control.commands[0].terminal = false;
    if (kind === 'KILL错目标') f.control.commands[0].sql = 'KILL CONNECTION 6173';
    if (kind === '多KILL') f.control.commands.push({ ...f.control.commands[0] });
    if (kind === '缺取消结算') f.proof.cancelCompleted = false;
    if (kind === '取消失败') f.proof.cancelFailure = Error('RAM取消失败');
    if (kind === '取消错task') f.proof.cancelTaskId = '另一个task';
    if (kind === '缺RPC结算') f.proof.rpcCompleted = false;
    if (kind === 'RPC错task') f.proof.rpcTaskId = '另一个task';
    if (kind === 'RPC无失败终态') f.proof.rpcError = undefined;
    if (kind === '缺LOCKWAIT') f.proof.lockWaitRows = [];
    if (kind === '锁错线程') f.proof.lockWaitRows = [{ id: 6173, state: 'LOCK WAIT' }];
    if (kind === '原线程仍活跃') f.proof.processRows = [{ ID: 6174 }];
    if (kind === '原事务仍活跃') f.proof.transactionRows = [{ id: 6174, state: 'ROLLING BACK' }];
    if (kind === 'scope漂移') f.data.scope = 'table.filteredDelete.apply:other';
    if (kind === 'controlscope漂移') f.control.scope = 'table.filteredDelete.preview:cancel_wait';
    if (kind === 'data对象被替换') f.facts[0] = { ...f.data };
    if (kind === 'DELETE对象被替换') f.proof.deletion = { ...f.proof.deletion };
    if (kind === 'native漂移') f.data.managed.connection = {} as ManagedConnection['connection'];
    if (kind === 'stream漂移') f.data.native.stream = Object.assign(new EventEmitter(), { closed: true });
    if (kind === 'thread漂移') f.data.native.threadId++;
    if (kind === 'socket未close') f.data.stream.closed = false;
    if (kind === '缺close事件') f.data.sawClose = false;
    if (kind === '仅socket属性') { f.data.closeCalls = 0; f.data.closeReturned = false; f.data.sawClose = false; }
    if (kind === '非strict') f.data.strict = false;
    if (kind === 'close未返回') f.data.closeReturned = false;
    if (kind === 'close失败') f.data.closeFailed = true;
    if (kind === '多次close') f.data.closeCalls++;
    if (kind === '其它命令缺end') f.data.commands[0].terminal = false;
    if (kind === '其它命令缺callback') f.data.commands[0].callbackReturned = false;
    if (kind === '错误pending') f.data.pending = 0;
    if (kind === '额外物理连接') f.facts.push(fact(9, 'SELECT 1'));
    if (kind === '额外queryDELETE') f.data.commands.push({ ...f.proof.deletion, method: 'query', terminal: true });
    if (kind === 'data额外COMMIT') f.data.commands.push({ sql: 'COMMIT', method: 'query', streamed: false, callbackReturned: true, terminal: true });
    if (kind === 'control额外COMMIT') f.control.commands.push({ sql: 'COMMIT', method: 'query', streamed: false, callbackReturned: true, terminal: true });
    if (kind === '缺terminalEvent') f.proof.terminalEvent = undefined;
    if (kind === '终态错task') f.proof.terminalEvent!.taskId = '另一个task';
    if (kind === '声称commitACK') f.proof.terminalEvent!.tableFilteredDelete!.commitAcknowledged = true;
    if (kind === '声称rollbackACK') f.proof.terminalEvent!.tableFilteredDelete!.rollbackAcknowledged = true;
    if (kind === 'COMMIT可能已发') f.proof.terminalEvent!.tableFilteredDelete!.commitMayHaveBeenSent = true;
    if (kind === 'DML未发') f.proof.terminalEvent!.tableFilteredDelete!.dmlMayHaveBeenSent = false;
    if (kind === '结果非unknown') f.proof.terminalEvent!.tableFilteredDelete!.outcome = 'rolled-back';
    if (kind === '非严格调用') strict = false;
    if (kind === '原线程仍活跃' || kind === '原事务仍活跃') expect(assertTableFilteredDeleteCancelPhysical(f.facts, strict, f.proof).processAndTransactionDisappearanceProven).toBe(false);
    else expect(() => assertTableFilteredDeleteCancelPhysical(f.facts, strict, f.proof)).toThrow();
    expect(() => assertTableFilteredDeleteReleased(f.facts, strict, f.proof)).toThrow(); expect(f.proof.deletion.terminal).toBe(false);
  });
});


/** 独立模拟官方last_read缓存规则；物理状态变化与目录读回分离，每次目录读取均重置last_read。 */
function transactionDirectoryCache(initial: readonly { id: string; state: string }[]) {
  let now = 1000, lastRead = 0, refreshes = 0;
  let physical = initial.map(row => ({ ...row })), cached: { id: string; state: string }[] = [];
  return {
    get now() { return now; }, get refreshes() { return refreshes; },
    replace(rows: readonly { id: string; state: string }[]) { physical = rows.map(row => ({ ...row })); },
    async wait(milliseconds: number) { now += milliseconds; },
    read() { if (now - lastRead > 100) { cached = physical.map(row => ({ ...row })); refreshes++; } lastRead = now; return cached.map(row => ({ ...row })); },
  };
}

describe('删除事务目录观察的缓存空闲窗口（仅RAM）', () => {
  it.each(['锁等待出现', '事务消失'] as const)('%s时旧20ms连续读取仍旧，新观察间隔取得物理新状态', async kind => {
    const waiting = [{ id: '6174', state: 'LOCK WAIT' }], initial = kind === '锁等待出现' ? [] : waiting, changed = kind === '锁等待出现' ? waiting : [];
    const cache = transactionDirectoryCache(initial); expect(cache.read()).toEqual(initial); cache.replace(changed);
    for (let index = 0; index < 100; index++) { await cache.wait(20); expect(cache.read()).toEqual(initial); }
    expect(cache.refreshes).toBe(1);
    const checks: number[] = []; await waitTableFilteredDeleteTransactionObservation(() => { checks.push(cache.now); }, cache.wait);
    expect(checks).toHaveLength(2); expect(checks[1] - checks[0]).toBeGreaterThan(100);
    expect(cache.read()).toEqual(changed); expect(cache.refreshes).toBe(2);
  });
  it('恰好100ms仍不能刷新，新的空闲窗口取得真实消失且没有忽略非空', async () => {
    const waiting = [{ id: '6174', state: 'LOCK WAIT' }], cache = transactionDirectoryCache(waiting);
    expect(cache.read()).toEqual(waiting); cache.replace([]); await cache.wait(100); expect(cache.read()).toEqual(waiting); expect(cache.refreshes).toBe(1);
    await waitTableFilteredDeleteTransactionObservation(() => undefined, cache.wait); expect(cache.read()).toEqual([]); expect(cache.refreshes).toBe(2);
  });
  it('原owner等待前失效时不启动等待或目录查询', async () => {
    const failure = Error('原owner已失效'); let waits = 0, reads = 0;
    const operation = waitTableFilteredDeleteTransactionObservation(() => { throw failure; }, async () => { waits++; }).then(() => { reads++; });
    await expect(operation).rejects.toBe(failure); expect(waits).toBe(0); expect(reads).toBe(0);
  });
  it('等待期间原owner失效时再次核验并传播，不能续期或查询旧资源', async () => {
    const failure = Error('原120秒期限已失效'); let valid = true, checks = 0, reads = 0;
    const operation = waitTableFilteredDeleteTransactionObservation(() => { checks++; if (!valid) throw failure; }, async () => { valid = false; }).then(() => { reads++; });
    await expect(operation).rejects.toBe(failure); expect(checks).toBe(2); expect(reads).toBe(0);
  });
  it('原等待失败仍传播首个错误，不能把中断当作目录已消失', async () => {
    const failure = Error('原等待被中断'); let checks = 0, reads = 0;
    const operation = waitTableFilteredDeleteTransactionObservation(() => { checks++; }, async () => { throw failure; }).then(() => { reads++; });
    await expect(operation).rejects.toBe(failure); expect(checks).toBe(1); expect(reads).toBe(0);
  });
});
