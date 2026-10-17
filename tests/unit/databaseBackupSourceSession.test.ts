import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { inspect } from 'node:util';
import type { Query } from 'mysql2';
import { describe, expect, it, vi } from 'vitest';
import { databaseBackupSourceSql, type DatabaseBackupSourceBinding } from '../../src/engine/databaseBackupSource';
import { DatabaseBackupSourceSession, databaseBackupSourceSessionLimits } from '../../src/engine/databaseBackupSourceSession';
import type { DatabaseBackupSourceReaderOwner, DatabaseBackupSourceReadOperation, DatabaseBackupSourceReadStop } from '../../src/engine/databaseBackupSourceReader';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';

/** 只加载锁定驱动原命令类；Connection是RAM替身，绝不创建真实Connection或Socket。 */
const require = createRequire(import.meta.url), nativeRoot = dirname(require.resolve('mysql2'));
const NativeQuery = require(join(nativeRoot, 'lib/commands/query.js')), NativeExecute = require(join(nativeRoot, 'lib/commands/execute.js'));
type Frame = { query: Query & { _rowParser: { next(): unknown }; _currentFields: unknown[]; row(packet: unknown, connection: unknown): void }; sql: string; params: string[]; mode: string; ended: boolean };
function fixture(auto = true) {
  const owner: DatabaseBackupSourceReaderOwner = { taskId: 'RAM_PRIVATE_TASK', connectionId: 'RAM_PRIVATE_CONNECTION', connectionRevision: 'r1', sourceLease: 'RAM_PRIVATE_LEASE', threadId: 73 };
  const binding: DatabaseBackupSourceBinding = { connectionId: owner.connectionId, connectionRevision: owner.connectionRevision, sourceLease: owner.sourceLease, threadId: 73, database: 'RAM_PRIVATE_DB', endpoint: 'direct-pinned', expectedInstance: undefined };
  const frames: Frame[] = [], order: string[] = [], controller = new AbortController(); let automate = auto, valid = true, commands = 0, finishThrows = false;
  const connection: any = new EventEmitter(); connection.config = { debug: false, typeCast: true }; connection.threadId = 73;
  const managed: any = { connection, signal: controller.signal, broken: false };
  const facts = { hostname: 'RAM_PRIVATE_HOST', port: 3306, serverId: 1, currentUser: 'RAM_PRIVATE_ACCOUNT@localhost', currentRole: 'NONE', connectionId: 73, sqlMode: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', quoteShowCreate: 1, characterSetConnection: 'utf8mb4', collationConnection: 'utf8mb4_bin', identifierCase: 0 };
  const response = (sql: string): Record<string, unknown>[] => {
    if (sql === databaseBackupSourceSql.version) return [{ version: '8.4.11', versionComment: 'MySQL Community Server' }];
    if (sql === databaseBackupSourceSql.facts) return [facts];
    if (sql === databaseBackupSourceSql.uuid) return [{ serverUuid: '11111111-1111-1111-1111-111111111111' }];
    if (sql === databaseBackupSourceSql.gipk) return [{ generatedPrimaryKeyVisible: 1 }];
    if (sql === databaseBackupSourceSql.grants) return [{ grants: 'GRANT SELECT, SHOW VIEW, SHOW DATABASES, TRIGGER, EVENT, RELOAD, LOCK TABLES, PROCESS ON *.* TO `RAM_PRIVATE_ACCOUNT`@`localhost`' }];
    if (sql === databaseBackupSourceSql.schemas) return [{ name: 'RAM_PRIVATE_DB', characterSet: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' }];
    if (sql === databaseBackupSourceSql.tables) return [{ name: 't', objectType: 'BASE TABLE', engine: 'InnoDB' }];
    if (sql === 'SHOW CREATE DATABASE `RAM_PRIVATE_DB`') return [{ Database: 'RAM_PRIVATE_DB', 'Create Database': 'CREATE DATABASE `RAM_PRIVATE_DB` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */' }];
    if (sql === 'SHOW CREATE TABLE `RAM_PRIVATE_DB`.`t`') return [{ Table: 't', 'Create Table': 'CREATE TABLE `t` (`id` int NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci' }];
    return [];
  };
  let rowsFor = response;
  const finish = vi.fn((frame: Frame) => {
    const rows = rowsFor(frame.sql); frame.query.emit('fields', [{ name: 'RAM' }], ...(frame.mode === 'execute' ? [0] : []));
    for (const row of rows) { frame.query._rowParser = { next: () => row }; frame.query._currentFields = []; frame.query.row({ isEOF: () => false }, connection); }
    frame.ended = true; frame.query.emit('end');
  });
  const send = (mode: string, options: { sql: string }, params: string[] = []) => {
    expect(commands).toBe(1); expect(frames.every(frame => frame.ended)).toBe(true); order.push(`send:${frames.length}`);
    const query = (mode === 'query' ? new NativeQuery(options) : new NativeExecute({ ...options, values: params })) as Frame['query'];
    const frame = { query, sql: options.sql, params, mode, ended: false }; frames.push(frame); if (automate) queueMicrotask(() => finish(frame)); return query;
  };
  connection.query = vi.fn((options: { sql: string }) => send('query', options)); connection.execute = vi.fn((options: { sql: string }, params: string[]) => send('execute', options, params));
  const rootFinished = vi.fn();
  const context = { managed, checkCancelled: vi.fn(() => undefined), commandStarted: vi.fn(() => {
    expect(commands).toBe(0); const index = frames.length; commands++; order.push(`start:${index}`);
    return () => { rootFinished(); if (finishThrows) throw Error('RAM_RAW_ERROR'); commands--; order.push(`leave:${index}`); };
  }) } as unknown as StructureTaskContext;
  const hooks = { checkOwner: vi.fn(() => { if (!valid) throw Error('RAM_RAW_ERROR'); }), register: vi.fn((_session: DatabaseBackupSourceSession) => undefined), requestStop: vi.fn((_operation: DatabaseBackupSourceReadOperation, _reason: DatabaseBackupSourceReadStop) => undefined) };
  const session = new DatabaseBackupSourceSession(context, owner, binding, hooks);
  return { owner, binding, facts, context, managed, connection, controller, session, hooks, frames, order, finish, rootFinished, response,
    automate: (value: boolean) => { automate = value; }, respond: (value: typeof response) => { rowsFor = value; }, invalidate: () => { valid = false; }, failAccounting: () => { finishThrows = true; }, commands: () => commands };
}

describe('B01 私有源检查会话（RAM组合）', () => {
  it('完整Source顺序组合真实Query/Execute，稳定Promise先登记；每条原native与记账结束后才下一句', async () => {
    const f = fixture(); const promise = f.session.inspection;
    f.hooks.register.mockImplementation(session => { expect(session).toBe(f.session); expect(session.inspection).toBe(promise); expect(f.frames).toHaveLength(0); expect(() => session.start(f.owner)).toThrow(); });
    expect(f.session.start(f.owner)).toBe(promise); const report = await promise;
    expect(report.evidence.objects).toHaveLength(2); expect(report.facts.currentUser).toBe('RAM_PRIVATE_ACCOUNT@localhost'); expect(report.actualLockHeld).toBe(false); expect(report.blockers.map(value => value.code)).toEqual(['lock-capability-unproven']);
    expect(f.frames).toHaveLength(17); expect(f.commands()).toBe(0); expect(f.rootFinished).toHaveBeenCalledTimes(17);
    const retained = f.session.retained(f.owner); expect(retained.operations).toHaveLength(17); expect(retained.candidate).toBe(report);
    retained.operations.forEach((record, index) => { expect(record.operation.query).toBe(f.frames[index].query); expect(record).toMatchObject({ result: 'fulfilled', nativeEvent: 'query-end', accounting: 'left' }); if (index < 16) expect(f.order.indexOf(`leave:${index}`)).toBeLessThan(f.order.indexOf(`send:${index + 1}`)); });
    expect(f.frames.some(frame => frame.query instanceof NativeExecute)).toBe(true); expect(f.frames.some(frame => frame.query instanceof NativeQuery)).toBe(true); expect(f.session.snapshot()).toMatchObject({ state: 'completed', nativePending: 0, commandsPending: 0 }); expect(() => f.session.start(f.owner)).toThrow();
  });
  it('取消只停止原operation，不把ACK当native结束；晚到error/end仍保留且不再发下一SQL', async () => {
    const f = fixture(false), promise = f.session.start(f.owner), retained = f.session.retained(f.owner), operation = retained.operations[0].operation;
    expect(operation.query).toBe(f.frames[0].query); f.session.cancel(f.owner); await expect(promise).rejects.toMatchObject({ reason: 'cancelled' });
    expect(f.hooks.requestStop).toHaveBeenCalledTimes(1); expect(f.hooks.requestStop.mock.calls[0][0]).toBe(operation); expect(f.session.snapshot()).toMatchObject({ nativePending: 1, commandsPending: 1 }); expect(f.rootFinished).not.toHaveBeenCalled();
    f.frames[0].query.emit('error', Object.assign(Error('RAM_RAW_ERROR'), { sql: 'RAM_SQL_PRIVATE' })); f.frames[0].query.emit('end'); f.frames[0].query.emit('end'); await f.session.retained(f.owner).chain;
    expect(f.frames).toHaveLength(1); expect(f.rootFinished).toHaveBeenCalledTimes(1); expect(f.session.retained(f.owner).operations[0]).toMatchObject({ result: 'rejected', nativeEvent: 'query-error', accounting: 'left' }); expect(f.session.retained(f.owner).operations[0].operation.query).toBe(operation.query); expect(() => f.session.cancel({ ...f.owner })).toThrow();
  });
  it('owner/sourceBinding/物理连接/signal换绑或租约撤销永久停链，原记录仍可由原owner清理', async () => {
    for (const kind of ['owner', 'binding', 'physical', 'signal', 'lease', 'abort']) {
      const f = fixture(false), promise = f.session.start(f.owner), operation = f.session.retained(f.owner).operations[0].operation;
      if (kind === 'owner') (f.owner as { sourceLease: string }).sourceLease = 'changed'; if (kind === 'binding') f.binding.database = 'changed'; if (kind === 'physical') f.managed.connection = new EventEmitter(); if (kind === 'signal') f.managed.signal = new AbortController().signal; if (kind === 'lease') f.invalidate(); if (kind === 'abort') f.controller.abort();
      f.finish(f.frames[0]); await expect(promise).rejects.toBeInstanceOf(Error); await f.session.retained(f.owner).chain; expect(f.frames).toHaveLength(1); expect(f.session.retained(f.owner).operations[0].operation).toBe(operation); expect(f.session.retained(f.owner).owner.sourceLease).toBe('RAM_PRIVATE_LEASE'); expect(() => f.session.start(f.owner)).toThrow();
    }
  });
  it('Source原10000对象/2MiB预算拒绝整批，记录有限且不返回部分inspection', async () => {
    for (const kind of ['objects', 'bytes']) {
      const f = fixture(); f.respond(sql => kind === 'objects' && sql === databaseBackupSourceSql.tables ? Array.from({ length: 10000 }, (_, index) => ({ name: `t${index}`, objectType: 'BASE TABLE', engine: 'InnoDB' })) : kind === 'bytes' && sql === 'SHOW CREATE TABLE `RAM_PRIVATE_DB`.`t`' ? [{ Table: 't', 'Create Table': 'x'.repeat(2 * 1024 * 1024) }] : f.response(sql));
      await expect(f.session.start(f.owner)).rejects.toMatchObject({ code: 'DBARK_BACKUP_SOURCE_LIMIT' }); await f.session.retained(f.owner).chain; const retained = f.session.retained(f.owner);
      expect(retained.candidate).toBeNull(); expect(retained.operations.length).toBeLessThan(databaseBackupSourceSessionLimits.operations); expect(retained.operations.map(record => record.operation.query)).toEqual(f.frames.map(frame => frame.query)); expect(f.session.snapshot().reason).toBe('limit');
    }
  });
  it('原query-end不能覆盖Root记账异常；保留unknown而不继续下一句', async () => {
    const f = fixture(false); f.failAccounting(); const promise = f.session.start(f.owner); f.finish(f.frames[0]); await expect(promise).rejects.toBeInstanceOf(Error); await f.session.retained(f.owner).chain;
    expect(f.session.snapshot()).toMatchObject({ state: 'failed', nativePending: 0, commandsPending: 1 }); expect(f.session.retained(f.owner).operations[0]).toMatchObject({ nativeEvent: 'query-end', accounting: 'unknown' }); expect(f.frames).toHaveLength(1); f.frames[0].query.emit('end'); expect(f.rootFinished).toHaveBeenCalledTimes(1);
  });
  it('通用JSON/inspect/snapshot仅状态计数，显式私有inspection/retained仍返回完整事实与原句柄', async () => {
    const f = fixture(false);
    const check = () => { expect(Object.keys(f.session)).toEqual([]); for (const text of [JSON.stringify(f.session), JSON.stringify(f.session.snapshot()), inspect(f.session, { depth: 9 }), inspect(f.session, { depth: 9, customInspect: false, showHidden: true })]) for (const secret of ['RAM_PRIVATE', 'RAM_RAW_ERROR', '11111111-1111', 'SHOW CREATE', 'GRANT SELECT', 'definers', 'threadId', 'hostname', 'connectionRevision', 'sourceLease']) expect(text).not.toContain(secret); };
    check(); const promise = f.session.start(f.owner); check(); f.automate(true); f.finish(f.frames[0]); const result = await promise; check(); expect(result.evidence.database).toBe('RAM_PRIVATE_DB'); expect(f.session.retained(f.owner).inspection).toBe(promise); expect(f.session.retained(f.owner).operations[0].operation.query).toBe(f.frames[0].query);
  });
  it('同步register里取消不运行inspect或Reader；绑定不匹配在构造时拒绝', async () => {
    const f = fixture(); f.hooks.register.mockImplementation(session => { session.cancel(f.owner); }); const promise = f.session.start(f.owner); await expect(promise).rejects.toMatchObject({ reason: 'cancelled' }); expect(f.frames).toHaveLength(0); expect(f.context.commandStarted).not.toHaveBeenCalled();
    const g = fixture(); g.binding.threadId = 74; expect(() => new DatabaseBackupSourceSession(g.context, g.owner, g.binding, g.hooks)).toThrow();
  });
});
