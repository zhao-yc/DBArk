import { EventEmitter } from 'node:events';
import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseBackupMysqlLock, DatabaseBackupMysqlLockOwners, databaseBackupMysqlLockSql as sql, type DatabaseBackupMysqlLockContext as Context, type DatabaseBackupMysqlLockCommand as Command, type DatabaseBackupMysqlLockOperation as Operation, type DatabaseBackupMysqlLockHooks as Hooks, type DatabaseBackupMysqlLockOptions } from '../../src/engine/databaseBackupMysqlLock';

const uuid = '12345678-1234-1234-1234-123456789abc', thread = '10000000000000000001';
type Row = Record<string, unknown>;
type Sent = { role: 'source' | 'control'; key: keyof typeof sql; params: unknown[]; query: EventEmitter };
const columns = { identity: ['session_id', 'server_uuid', 'server_version', 'server_flavor', 'performance_schema_enabled'], thread: ['thread_id', 'session_id', 'TYPE', 'INSTRUMENTED'], instrument: ['NAME', 'ENABLED', 'TIMED'], consumers: ['NAME', 'ENABLED'], status: ['Variable_name', 'Value'], locks: ['thread_id', 'session_id', 'TYPE', 'INSTRUMENTED', 'OBJECT_TYPE', 'OBJECT_SCHEMA', 'OBJECT_NAME', 'LOCK_TYPE', 'LOCK_DURATION', 'LOCK_STATUS', 'instance_address', 'owner_event_id'] };
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

/** 所有连接、SQL、Query和锁状态都在RAM；绝不创建实际连接或申请服务器锁。 */
function fixture(options: DatabaseBackupMysqlLockOptions = {}) {
  const owner = { taskId: 'ram-lock', planToken: 'ram-plan', connectionRevision: 'revision-original', sourceLease: 'source-private', controlLease: 'control-private' };
  let held = false, permit = false, dumpComplete = true, leaveFailure = false, external = false;
  let issuedPermit: ReturnType<Hooks['releasePermit']> | undefined;
  const calls: Sent[] = [], commands: Command[] = [], operations: Operation[] = [], accounting = { source: 0, control: 0 };
  let rewrite: (sent: Sent, rows: Row[]) => Row[] = (_sent, rows) => rows;
  let pending: ((sent: Sent, deliver: () => void) => boolean) | undefined;
  const source = make('source', 101), control = make('control', 202);
  function make(role: 'source' | 'control', id: number) {
    const connection = Object.assign(new EventEmitter(), { threadId: id, config: { debug: false, typeCast: true }, stream: new EventEmitter(), query: vi.fn(), execute: vi.fn() });
    const managed = { connection, broken: false, status: { dialect: 'mysql' }, close: vi.fn(() => { throw Error('禁止关闭原连接'); }) };
    const context = { managed, checkCancelled: vi.fn(() => {}), commandStarted: vi.fn(() => { accounting[role]++; return () => { if (leaveFailure) throw Error('合成记账未离开'); accounting[role]--; }; }) };
    const send = (method: 'query' | 'execute', input: { sql: string }, params: unknown[] = []) => {
      const key = (Object.keys(sql) as (keyof typeof sql)[]).find(key => sql[key] === input.sql); if (!key) throw Error('夹具拒绝任意SQL');
      expect(method).toBe(key === 'thread' || key === 'locks' ? 'execute' : 'query');
      expect(role).toBe(key === 'flush' || key === 'unlock' ? 'source' : role);
      expect(accounting[role]).toBe(1); expect(commands.at(-1)!.snapshot().sendAttempted).toBe(true);
      const query = new EventEmitter(), sent = { role, key, params, query }; calls.push(sent);
      queueMicrotask(() => {
        const deliver = () => {
          let rows: Row[];
          switch (key) {
            case 'identity': rows = [{ session_id: String(id), server_uuid: uuid, server_version: '8.4.11', server_flavor: 'MySQL Community Server - GPL', performance_schema_enabled: 1 }]; break;
            case 'thread': expect(params).toEqual(['101']); rows = [{ thread_id: thread, session_id: '101', TYPE: 'FOREGROUND', INSTRUMENTED: 'NO' }]; break;
            case 'instrument': rows = [{ NAME: 'wait/lock/metadata/sql/mdl', ENABLED: 'YES', TIMED: 'NO' }]; break;
            case 'consumers': rows = [{ NAME: 'global_instrumentation', ENABLED: 'YES' }, { NAME: 'thread_instrumentation', ENABLED: 'NO' }]; break;
            case 'status': rows = ['Performance_schema_metadata_lock_lost', 'Performance_schema_thread_instances_lost', 'Uptime'].map(Variable_name => ({ Variable_name, Value: Variable_name === 'Uptime' ? '1234' : '0' })); break;
            case 'locks': expect(params).toEqual([thread, '101']); rows = held ? ['COMMIT', 'GLOBAL'].map(OBJECT_TYPE => ({ thread_id: thread, session_id: '101', TYPE: 'FOREGROUND', INSTRUMENTED: 'NO', OBJECT_TYPE, OBJECT_SCHEMA: null, OBJECT_NAME: null, LOCK_TYPE: 'SHARED', LOCK_DURATION: 'EXPLICIT', LOCK_STATUS: 'GRANTED', instance_address: OBJECT_TYPE === 'GLOBAL' ? '18446744073709551600' : '18446744073709551599', owner_event_id: '100' })) : []; break;
            default: rows = [];
          }
          rows = rewrite(sent, rows);
          if (key === 'flush' || key === 'unlock') { held = key === 'flush'; query.emit('result', { fieldCount: 0, affectedRows: 0, warningStatus: 0, serverStatus: 2 }, 0); }
          else { query.emit('fields', columns[key].map(name => ({ name }))); for (const row of rows) query.emit('result', row, 0); }
          query.emit('end');
        };
        if (!pending?.(sent, deliver)) deliver();
      }); return query;
    };
    connection.query.mockImplementation((input, params) => send('query', input, params)); connection.execute.mockImplementation((input, params) => send('execute', input, params));
    return { context, connection, managed };
  }
  const hooks: Hooks = {
    checkLease: vi.fn((_owner, allowed) => { if (external) throw Error('合成外部命令'); if (accounting.source + accounting.control > 0) expect(allowed).not.toBeNull(); }),
    registerOperation: vi.fn(operation => { expect(operation.retained(owner).result).toBeInstanceOf(Promise); operations.push(operation); }),
    registerCommand: vi.fn(command => { expect(command.retained(owner).query).toBeNull(); expect(command.retained(owner).result).toBeInstanceOf(Promise); expect(command.snapshot().accountingStarted).toBe(false); commands.push(command); }),
    requestStop: vi.fn(() => {}),
    releasePermit: vi.fn(() => { if (!permit) throw Error('Root未签发许可'); issuedPermit = (dumpComplete ? { owner, originalOperationLeft: true, serverOperationsEnded: true, dumpNeverStarted: true } : { owner, originalOperationLeft: true, serverOperationsEnded: true, dumpNeverStarted: false, dumpProcessClosed: true, dumpStreamsClosed: false }) as ReturnType<Hooks['releasePermit']>; return issuedPermit; }),
  };
  const owners = new DatabaseBackupMysqlLockOwners(), actor = new DatabaseBackupMysqlLock(owner, source.context as unknown as Context, control.context as unknown as Context, hooks, owners, { budgetMs: 2000, ...options });
  return { owner, actor, owners, source, control, hooks, calls, commands, operations, accounting, setRewrite(fn: typeof rewrite) { rewrite = fn; }, setPending(fn: typeof pending) { pending = fn; }, allowRelease() { permit = true; }, revokePermit() { (issuedPermit as unknown as { serverOperationsEnded: boolean }).serverOperationsEnded = false; }, incompleteDump() { permit = true; dumpComplete = false; }, failLeave() { leaveFailure = true; }, external() { external = true; }, held: () => held };
}

describe('MySQL8.4.11全局读锁原语（纯RAM，不是实际锁能力验收）', () => {
  it('原连接/命令首await前登记，获取两把锁观察后经Root许可正常解锁并核消失', async () => {
    const f = fixture(), operation = f.actor.acquire(f.owner);
    expect(f.operations).toEqual([operation]); expect(f.calls).toHaveLength(0);
    await expect(operation.wait()).resolves.toEqual({ state: 'observed', observation: 1 });
    expect(f.actor.snapshot()).toMatchObject({ phase: 'observed', flushCompleted: true, observedLockRows: 2, unlockAttempted: false });
    expect(f.actor.retained(f.owner).sourceThread).toBe(thread); expect(f.actor.retained(f.owner).locks[1].instance_address).toBe('18446744073709551600');
    expect(f.commands.every(command => command.snapshot().returned && command.snapshot().queryEnded && command.snapshot().accountingLeft)).toBe(true);
    f.allowRelease(); await expect(f.actor.release(f.owner).wait()).resolves.toEqual({ state: 'released', observation: 1 });
    expect(f.actor.snapshot()).toMatchObject({ phase: 'released', unlockCompleted: true, observedLockRows: 0, pendingCommand: false });
    expect(f.calls.filter(call => call.key === 'flush')).toHaveLength(1); expect(f.calls.filter(call => call.key === 'unlock')).toHaveLength(1);
    expect(f.source.managed.close).not.toHaveBeenCalled(); expect(f.control.managed.close).not.toHaveBeenCalled(); expect(f.accounting).toEqual({ source: 0, control: 0 });
  });
  it('单GLOBAL、PENDING、错原thread/session与重复锁全部拒绝，不发全冻结能力', async () => {
    for (const fault of ['single', 'pending', 'thread', 'source', 'duplicate']) {
      const f = fixture(); f.setRewrite((sent, rows) => sent.key !== 'locks' || !rows.length ? rows : fault === 'single' ? rows.slice(1) : rows.map((row, index) => index ? row : { ...row, ...(fault === 'pending' ? { LOCK_STATUS: 'PENDING' } : fault === 'thread' ? { thread_id: '999' } : fault === 'source' ? { session_id: '999' } : { OBJECT_TYPE: 'GLOBAL' }) }));
      await expect(f.actor.acquire(f.owner).wait()).rejects.toThrow('已保留'); expect(f.actor.snapshot()).toMatchObject({ unknown: true, flushCompleted: true, unlockAttempted: false });
      expect(f.hooks.requestStop).toHaveBeenCalledTimes(1); expect(f.calls.some(call => call.key === 'unlock')).toBe(false);
    }
  });
  it('PFS关闭、仪表/consumer关闭、lost非零、缺映射、错实例在FLUSH前阻断', async () => {
    for (const fault of ['pfs', 'instrument', 'consumer', 'lost', 'missing', 'uuid']) {
      const f = fixture(); f.setRewrite((sent, rows) => {
        if (fault === 'pfs' && sent.key === 'identity') return rows.map(row => ({ ...row, performance_schema_enabled: 0 }));
        if (fault === 'instrument' && sent.key === 'instrument') return rows.map(row => ({ ...row, ENABLED: 'NO' }));
        if (fault === 'consumer' && sent.key === 'consumers') return rows.map(row => ({ ...row, ENABLED: 'NO' }));
        if (fault === 'lost' && sent.key === 'status') return rows.map(row => row.Variable_name === 'Performance_schema_metadata_lock_lost' ? { ...row, Value: '1' } : row);
        if (fault === 'missing' && sent.key === 'thread') return [];
        if (fault === 'uuid' && sent.key === 'identity' && sent.role === 'control') return rows.map(row => ({ ...row, server_uuid: 'aaaaaaaa-1234-1234-1234-123456789abc' })); return rows;
      });
      await expect(f.actor.acquire(f.owner).wait()).rejects.toThrow(); expect(f.calls.some(call => call.key === 'flush')).toBe(false);
      expect(f.actor.snapshot().unknown).toBe(true);
    }
  });
  it('Query返回、error、query-end与记账离开分别保留，取消ACK不能补终态或解锁', async () => {
    const f = fixture(); let original: Sent | undefined;
    f.setPending((sent, _deliver) => { if (sent.key !== 'flush') return false; original = sent; return true; });
    const operation = f.actor.acquire(f.owner); await turn(); const command = f.commands.at(-1)!;
    expect(original?.key).toBe('flush'); expect(command.snapshot()).toMatchObject({ returned: true, queryEnded: false, accountingLeft: false });
    f.actor.requestCancel(f.owner); await expect(operation.wait()).rejects.toThrow();
    expect(command.snapshot()).toMatchObject({ queryEnded: false, accountingLeft: false }); expect(f.accounting.source).toBe(1);
    original!.query.emit('error', Error('合成原查询迟到错误')); expect(command.snapshot().queryErrored).toBe(true);
    expect(f.calls.some(call => call.key === 'unlock')).toBe(false); expect(() => f.actor.release(f.owner)).toThrow();
    original!.query.emit('end'); await command.retained(f.owner).nativeEnd;
    expect(command.snapshot()).toMatchObject({ queryEnded: true, accountingLeft: true, queryErrored: true }); expect(f.actor.snapshot().unknown).toBe(true);
  });
  it('原Query迟到error永久撤销已完成观察，旧wait与observe不能再发放证据', async () => {
    const f = fixture(), acquired = f.actor.acquire(f.owner); await acquired.wait(); const original = f.calls.find(call => call.key === 'flush')!;
    original.query.emit('error', Error('合成敏感原异常')); await expect(acquired.wait()).rejects.toThrow();
    expect(f.actor.snapshot().unknown).toBe(true); expect(() => f.actor.observe(f.owner)).toThrow(); expect(f.actor.retained(f.owner).commands).toContain(f.commands.find(command => command.retained(f.owner).query === original.query));
    expect(f.calls.some(call => call.key === 'unlock')).toBe(false);
  });
  it('未签发许可及dump未关闭许可均不发送UNLOCK，原持锁会话保留', async () => {
    for (const incomplete of [false, true]) {
      const f = fixture(); await f.actor.acquire(f.owner).wait();
      if (incomplete) f.incompleteDump();
      await expect(f.actor.release(f.owner).wait()).rejects.toThrow(); expect(f.held()).toBe(true);
      expect(f.actor.snapshot().unknown).toBe(true); expect(f.calls.some(call => call.key === 'unlock')).toBe(false);
    }
  });
  it('解锁成功ACK但control仍见锁或仪表关闭不得确认释放', async () => {
    for (const fault of ['remaining', 'instrument']) {
      const f = fixture(); await f.actor.acquire(f.owner).wait(); f.allowRelease(); let unlocked = false;
      f.setRewrite((sent, rows) => { if (sent.key === 'unlock') unlocked = true; if (unlocked && fault === 'instrument' && sent.key === 'instrument') return rows.map(row => ({ ...row, ENABLED: 'NO' })); if (unlocked && fault === 'remaining' && sent.key === 'locks') return [{ thread_id: thread, session_id: '101', TYPE: 'FOREGROUND', INSTRUMENTED: 'NO', OBJECT_TYPE: 'GLOBAL', OBJECT_SCHEMA: null, OBJECT_NAME: null, LOCK_TYPE: 'SHARED', LOCK_DURATION: 'EXPLICIT', LOCK_STATUS: 'GRANTED', instance_address: '1000', owner_event_id: '100' }]; return rows; });
      await expect(f.actor.release(f.owner).wait()).rejects.toThrow(); expect(f.actor.snapshot()).toMatchObject({ unknown: true, unlockCompleted: true });
    }
  });
  it('最后同步记账钩子使许可失效时不发送UNLOCK，保留未发送的原命令槽位', async () => {
    const f = fixture(); await f.actor.acquire(f.owner).wait(); f.allowRelease();
    f.source.context.commandStarted.mockImplementation(() => { f.accounting.source++; if (f.commands.at(-1)!.retained(f.owner).statement === 'unlock') f.revokePermit(); return () => { f.accounting.source--; }; });
    await expect(f.actor.release(f.owner).wait()).rejects.toThrow(); expect(f.held()).toBe(true);
    expect(f.calls.some(call => call.key === 'unlock')).toBe(false);
    expect(f.commands.at(-1)!.snapshot()).toMatchObject({ accountingStarted: true, accountingLeft: false, sendAttempted: false, returned: false, queryEnded: false });
  });
  it('记账离开抛错保持原Query-end与未确认accounting，绝不补调', async () => {
    const f = fixture(); f.failLeave(); await expect(f.actor.acquire(f.owner).wait()).rejects.toThrow(); const command = f.commands[0];
    expect(command.snapshot()).toMatchObject({ queryEnded: true, accountingAttempted: true, accountingLeft: false, accountingFailed: true });
    expect(f.accounting.source).toBe(1); expect(f.actor.retained(f.owner).commands).toHaveLength(1);
    const g = fixture(); g.source.context.commandStarted.mockImplementation(() => { g.accounting.source++; throw Error('合成预登记后抛错'); });
    await expect(g.actor.acquire(g.owner).wait()).rejects.toThrow(); expect(g.calls).toHaveLength(0);
    expect(g.commands[0].snapshot()).toMatchObject({ accountingStarted: true, accountingLeft: false, accountingFailed: true, queryEnded: false });
  });
  it('整体期限与命令/字节预算有界，挂起Query与原Promise不因超时销账', async () => {
    const f = fixture({ budgetMs: 20 }); f.setPending(() => true); const operation = f.actor.acquire(f.owner);
    await expect(operation.wait()).rejects.toThrow(); expect(f.commands[0].snapshot()).toMatchObject({ returned: true, queryEnded: false, accountingLeft: false });
    expect(f.actor.retained(f.owner).commands[0].retained(f.owner).query).toBe(f.calls[0].query);
    for (const options of [{ maxCommands: 1 }, { maxBytes: 1 }]) { const f = fixture(options); await expect(f.actor.acquire(f.owner).wait()).rejects.toThrow(); expect(f.actor.snapshot().commands).toBeLessThanOrEqual(1); }
  });
  it('原连接/线程换绑、transport关闭和外部命令不能靠后来同样两行恢复', async () => {
    for (const fault of ['connection', 'thread', 'transport', 'external']) {
      const f = fixture(); await f.actor.acquire(f.owner).wait(); const original = f.source.connection;
      if (fault === 'connection') f.source.managed.connection = new EventEmitter() as typeof original;
      if (fault === 'thread') f.source.connection.threadId = 303;
      if (fault === 'transport') f.control.connection.stream.emit('close');
      if (fault === 'external') f.external();
      expect(f.actor.snapshot().unknown).toBe(true); expect(() => f.actor.observe(f.owner)).toThrow(); expect(f.actor.retained(f.owner).sourceConnection).toBe(original);
    }
    const g = fixture(); vi.mocked(g.hooks.checkLease).mockImplementation((_owner, allowed) => { if (allowed?.snapshot().accountingStarted) g.owner.connectionRevision = 'changed-in-hook'; });
    await expect(g.actor.acquire(g.owner).wait()).rejects.toThrow(); expect(g.calls).toHaveLength(0); expect(g.actor.snapshot().unknown).toBe(true);
  });
  it('观察数量、单在途与任务号ABA有界，原账本不被新实例替换', async () => {
    const f = fixture({ maxObservations: 2 }); await f.actor.acquire(f.owner).wait(); await f.actor.observe(f.owner).wait(); expect(() => f.actor.observe(f.owner)).toThrow();
    const g = fixture(); const first = g.actor.acquire(g.owner); expect(() => g.actor.acquire(g.owner)).toThrow(); await expect(first.wait()).rejects.toThrow();
    expect(() => new DatabaseBackupMysqlLock(g.owner, g.source.context as unknown as Context, g.control.context as unknown as Context, g.hooks, g.owners)).toThrow(); expect(g.actor.snapshot().unknown).toBe(true);
  });
  it('JSON和inspect仅状态计数，私有SQL/owner/身份/tuple和异常只留Root显式账本', async () => {
    const f = fixture(); await f.actor.acquire(f.owner).wait();
    for (const value of [f.actor, ...f.operations, ...f.commands]) {
      const output = JSON.stringify(value) + inspect(value, { showHidden: true, getters: true }) + inspect(value, { customInspect: false, showHidden: true, getters: true });
      for (const secret of [uuid, thread, 'revision-original', 'source-private', 'control-private', 'session_id', 'SELECT ', 'FLUSH ', 'UNLOCK ', 'server_uuid', '合成敏感原异常']) expect(output).not.toContain(secret);
      expect(output).not.toContain('allObjectsFrozen');
    }
    expect(() => f.actor.retained({ ...f.owner })).toThrow(); f.allowRelease(); await f.actor.release(f.owner).wait();
  });
});
