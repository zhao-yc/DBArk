import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tracingChannel } from 'node:diagnostics_channel';
import { describe, expect, it, vi } from 'vitest';
import type { Query } from 'mysql2';
import { databaseBackupSourceSql, inspectDatabaseBackupSource, type DatabaseBackupSourceRead } from '../../src/engine/databaseBackupSource';
import { DatabaseBackupSourceReader, type DatabaseBackupSourceReadOperation, type DatabaseBackupSourceReaderHooks } from '../../src/engine/databaseBackupSourceReader';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';

/** 仅加载项目锁定驱动的 Query 构造器，不创建 Connection，也不触发网络或文件业务端口。 */
const require = createRequire(import.meta.url);
const NativeQuery = require(join(dirname(require.resolve('mysql2')), 'lib/commands/query.js'));
type RamQuery = Query & { _currentRows: unknown[]; _currentFields: unknown[]; _rowParser: { next(): unknown }; row(packet: unknown, connection: unknown): unknown };
function statement(id: keyof typeof databaseBackupSourceSql = 'tables', maxRows = 2, maxBytes = 1024): DatabaseBackupSourceRead {
  return { id, sql: databaseBackupSourceSql[id], params: ['schemas', 'tables', 'views', 'triggers', 'routines', 'events'].includes(id) ? ['db`汉\\\''] : [], maxRows, maxBytes, sensitiveResult: true };
}
/** 真实 Query 的原生行处理入口加纯 RAM Connection 替身；没有回调汇总或真实连接。 */
function fixture() {
  const controller = new AbortController(), owner = { taskId: 'task', connectionId: 'source', connectionRevision: 'r1', sourceLease: 'l1', threadId: 42 };
  const connection = new EventEmitter() as EventEmitter & { threadId: number; config: { debug: boolean; queryFormat?: () => string }; query: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> };
  connection.threadId = 42; connection.config = { debug: false };
  const queries: RamQuery[] = [], order: string[] = [], registrations: DatabaseBackupSourceReadOperation[] = [];
  const send = (options: { sql: string }, _params?: string[]) => { order.push('send'); const query = new NativeQuery(options) as RamQuery; query._currentRows = []; query._currentFields = []; queries.push(query); return query; };
  connection.query = vi.fn(send); connection.execute = vi.fn(send);
  const managed = { connection, signal: controller.signal, broken: false };
  const finish = vi.fn(() => { order.push('finished'); }); let valid = true, cancelled = false;
  const context = { managed, checkCancelled: vi.fn(() => { if (cancelled) throw Error('私密错误'); }), commandStarted: vi.fn(() => { order.push('started'); return finish; }) } as unknown as StructureTaskContext;
  const hooks: DatabaseBackupSourceReaderHooks = {
    checkOwner: vi.fn(() => { if (!valid) throw Error('私密租约详情'); }),
    register: vi.fn(operation => { order.push('register'); registrations.push(operation); }), requestStop: vi.fn(() => undefined),
  };
  const reader = new DatabaseBackupSourceReader(context, owner, hooks);
  function fields(query = queries.at(-1)!, text = false) { if (text) query.emit('fields', [{ name: 'name' }]); else query.emit('fields', [{ name: 'name' }], 0); }
  function row(value: unknown, query = queries.at(-1)!) { query._rowParser = { next: () => value }; query.row({ isEOF: () => false }, connection); }
  return { owner, connection, managed, context, hooks, reader, controller, queries, order, registrations, finish, fields, row, invalidate: () => { valid = false; }, cancelTask: () => { cancelled = true; } };
}

describe('B01 源读取原生 Query 适配（纯 RAM）', () => {
  it('目录真正用 execute 参数，发送前登记同一操作；原生逐行不累积到驱动回调数组', async () => {
    const f = fixture(), input = statement(), operation = f.reader.start(f.owner, input);
    expect(f.order).toEqual(['register', 'started', 'send']); expect(f.registrations[0]).toBe(operation); expect(operation.query).toBe(f.queries[0]);
    expect(f.connection.query).not.toHaveBeenCalled(); expect(f.connection.execute).toHaveBeenCalledWith({ sql: input.sql, rowsAsArray: false, namedPlaceholders: false, typeCast: true }, [...input.params]);
    f.fields(); f.row({ name: '汉' }); expect(f.queries[0]._currentRows).toEqual([]); expect(f.finish).not.toHaveBeenCalled();
    f.queries[0].emit('end'); await expect(operation.result).resolves.toEqual({ rows: [{ name: '汉' }], complete: true });
    await expect(operation.nativeTerminal).resolves.toBe('query-end'); expect(f.finish).toHaveBeenCalledTimes(1); expect(operation.snapshot().retainedRows).toBe(0);
  });
  it('SHOW 与无值事实走 Query，兼容真实文本 fields 无 index；成功后可串行下一句', async () => {
    const f = fixture(), first = f.reader.start(f.owner, { ...statement('version'), params: [] }); f.fields(undefined, true); f.row({ version: '8.4.11' }); f.queries[0].emit('end'); await first.result;
    const second = f.reader.start(f.owner, { ...statement('version'), id: 'show-table', sql: 'SHOW CREATE TABLE `d``b`.`t汉`', params: [] });
    expect(f.connection.query).toHaveBeenCalledTimes(2); expect(f.connection.execute).not.toHaveBeenCalled(); f.fields(undefined, true); f.row({ 'Create Table': '定义只在RAM' }); f.queries[1].emit('end'); expect((await second.result).complete).toBe(true);
  });
  it('收到第 max+1 行立即拒绝清空；后续行不保留，停止请求不算命令终态', async () => {
    const f = fixture(), operation = f.reader.start(f.owner, statement('tables', 1)); f.fields(); f.row({ name: 'first' }); f.row({ name: 'over' });
    await expect(operation.result).rejects.toMatchObject({ code: 'DBARK_BACKUP_SOURCE_LIMIT' }); expect(operation.snapshot()).toMatchObject({ reading: 'stopped', retainedRows: 0, acceptedRows: 1, nativeEvent: null, stopRequested: true });
    for (let index = 0; index < 100; index++) f.row({ name: '后续私料' }); expect(operation.snapshot().acceptedRows).toBe(1); expect(f.hooks.requestStop).toHaveBeenCalledTimes(1); expect(f.finish).not.toHaveBeenCalled();
    expect(() => f.reader.start(f.owner, statement())).toThrow(); f.queries[0].emit('end'); await operation.nativeTerminal; expect(f.finish).toHaveBeenCalledTimes(1); expect(operation.snapshot().reading).toBe('stopped');
  });
  it('UTF-8 字节与键名逐行计入；等于预算可接纳，下一字节超限拒绝整批', async () => {
    const f = fixture(), operation = f.reader.start(f.owner, statement('tables', 3, 4)); f.fields(); f.row({ a: '汉' }); expect(operation.snapshot().acceptedBytes).toBe(4); f.row({ a: '' });
    await expect(operation.result).rejects.toMatchObject({ code: 'DBARK_BACKUP_SOURCE_LIMIT' }); expect(operation.snapshot()).toMatchObject({ acceptedRows: 1, retainedRows: 0 }); f.queries[0].emit('end');
  });
  it('Buffer/Date 在预算内复制，原行别名不能事后换值', async () => {
    const f = fixture(), operation = f.reader.start(f.owner, statement()); const value = { x: Buffer.from('ab'), y: new Date(0), z: null }; f.fields(); f.row(value); value.x[0] = 99; value.y.setTime(10); f.queries[0].emit('end');
    const rows = (await operation.result).rows; expect(rows[0].x).toEqual(Buffer.from('ab')); expect((rows[0].y as Date).getTime()).toBe(0); expect(operation.snapshot().acceptedBytes).toBe(53);
  });
  it('取消先拒绝读取并登记原操作，迟到行/end/error不会变成完整成功或重复结算', async () => {
    const f = fixture(), operation = f.reader.start(f.owner, statement()); f.fields(); f.row({ name: 'a' }); f.controller.abort();
    await expect(operation.result).rejects.toMatchObject({ reason: 'cancelled' }); expect(f.hooks.requestStop).toHaveBeenCalledWith(operation, 'cancelled'); expect(f.finish).not.toHaveBeenCalled();
    let nativeSettled = false; void operation.nativeTerminal.then(() => { nativeSettled = true; }); await Promise.resolve(); expect(nativeSettled).toBe(false);
    f.row({ name: '迟到' }); f.queries[0].emit('error', Object.assign(Error('password=私料'), { sql: '授权原文' })); f.queries[0].emit('end'); f.queries[0].emit('error', Error('再次迟到'));
    await expect(operation.nativeTerminal).resolves.toBe('query-error'); expect(f.finish).toHaveBeenCalledTimes(1); expect(operation.snapshot()).toMatchObject({ reading: 'stopped', queryEnded: true, queryErrored: true, retainedRows: 0 }); expect(JSON.stringify(operation.snapshot())).not.toContain('私料');
  });
  it('Root 超时只停止读取；即使停止钩子立即返回也保持 native pending', async () => {
    const f = fixture(), operation = f.reader.start(f.owner, statement()); operation.cancel(f.owner, 'timeout'); await expect(operation.result).rejects.toMatchObject({ reason: 'timeout' });
    expect(operation.snapshot().nativeEvent).toBeNull(); expect(f.finish).not.toHaveBeenCalled(); f.queries[0].emit('end'); await operation.nativeTerminal; expect(f.finish).toHaveBeenCalledTimes(1);
  });
  it.each(['end', 'error'] as const)('连接 %s 单独记为原生事件，不冒充成功 SQL 或资源释放', async event => {
    const f = fixture(), operation = f.reader.start(f.owner, statement()); f.connection.emit(event, Error('私密原错')); await expect(operation.result).rejects.toMatchObject({ reason: 'driver-error' });
    await expect(operation.nativeTerminal).resolves.toBe(`connection-${event}`); f.queries[0].emit('end'); f.queries[0].emit('error', Error('迟到')); expect(f.finish).toHaveBeenCalledTimes(1); expect(operation.snapshot().reading).toBe('stopped');
  });
  it('并发与注册回调重入拒绝；同值伪 owner 与原 owner 换绑均不能发送', async () => {
    const f = fixture(); vi.mocked(f.hooks.register).mockImplementation(operation => { f.registrations.push(operation); expect(() => f.reader.start(f.owner, statement())).toThrow(); });
    const operation = f.reader.start(f.owner, statement()); expect(() => f.reader.start(f.owner, statement())).toThrow(); expect(() => operation.cancel({ ...f.owner })).toThrow();
    f.owner.sourceLease = 'changed'; expect(() => operation.cancel(f.owner)).toThrow(); f.fields(); await expect(operation.result).rejects.toMatchObject({ reason: 'lease-invalid' }); expect(f.connection.execute).toHaveBeenCalledTimes(1); f.queries[0].emit('end');
  });
  it('Root 租约失效在下一原生行和成功 end 前均检查，不接纳晚到完整结果', async () => {
    for (const invalidateBeforeRow of [true, false]) {
      const f = fixture(), operation = f.reader.start(f.owner, statement()); f.fields(); if (invalidateBeforeRow) { f.invalidate(); f.row({ name: 'late' }); } else { f.row({ name: 'first' }); f.invalidate(); }
      f.queries[0].emit('end'); await expect(operation.result).rejects.toMatchObject({ reason: 'lease-invalid' }); expect(operation.snapshot().retainedRows).toBe(0); expect(() => f.reader.start(f.owner, statement())).toThrow();
    }
  });
  it('传入语句和值在 register 前复制，注册期输入变更不能换库/预算/SQL', async () => {
    const f = fixture(), input = statement(), originalSql = input.sql, originalParams = [...input.params];
    vi.mocked(f.hooks.register).mockImplementation(() => { input.sql = 'DROP DATABASE x'; (input.params as string[])[0] = 'changed'; input.maxRows = 10000; });
    const operation = f.reader.start(f.owner, input); expect(f.connection.execute).toHaveBeenCalledWith(expect.objectContaining({ sql: originalSql }), originalParams); f.fields(); f.queries[0].emit('end'); await operation.result;
  });
  it('原生发送同步异常保持原命令未知，不伪造 terminal 或重试，直到原连接事件', async () => {
    const f = fixture(); f.connection.execute.mockImplementation(() => { throw Error('sql=私密'); }); const operation = f.reader.start(f.owner, statement());
    await expect(operation.result).rejects.toMatchObject({ reason: 'submission-unknown' }); expect(operation.snapshot()).toMatchObject({ submission: 'unknown', nativeEvent: null }); expect(f.finish).not.toHaveBeenCalled();
    f.connection.emit('end'); await operation.nativeTerminal; expect(f.finish).toHaveBeenCalledTimes(1); expect(f.connection.execute).toHaveBeenCalledTimes(1);
  });
  it('register 内取消及 commandStarted 内取消都不发送，已登记编号仅按未发送结算', async () => {
    const f = fixture(); vi.mocked(f.hooks.register).mockImplementation(operation => operation.cancel(f.owner)); const first = f.reader.start(f.owner, statement()); await expect(first.result).rejects.toMatchObject({ reason: 'cancelled' }); expect(f.connection.execute).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled(); expect(await first.nativeTerminal).toBe('not-submitted');
    const g = fixture(); vi.mocked(g.context.commandStarted).mockImplementation(() => { g.registrations[0].cancel(g.owner); return g.finish; }); const second = g.reader.start(g.owner, statement()); await expect(second.result).rejects.toMatchObject({ reason: 'cancelled' }); expect(g.connection.execute).not.toHaveBeenCalled(); expect(g.finish).toHaveBeenCalledTimes(1); expect(await second.nativeTerminal).toBe('not-submitted');
  });
  it('停止钩子异常不泄露私料、不丢原 Query；终态记账异常不输出 complete', async () => {
    const f = fixture(); vi.mocked(f.hooks.requestStop).mockImplementation(() => { throw Error('密码'); }); const operation = f.reader.start(f.owner, statement()); operation.cancel(f.owner); await expect(operation.result).rejects.toThrow('未完整成功'); expect(operation.query).toBe(f.queries[0]); expect(operation.snapshot().stopRequestFailed).toBe(true); f.queries[0].emit('end');
    const g = fixture(); g.finish.mockImplementation(() => { throw Error('账户'); }); const second = g.reader.start(g.owner, statement()); g.fields(); g.queries[0].emit('end'); await expect(second.result).rejects.toThrow('未完整成功'); expect(second.snapshot().accountingFailed).toBe(true);
  });
  it.each(['missing-fields', 'second-fields', 'second-result', 'unknown-value', 'no-result-index'] as const)('未知协议 %s 不接受为完整目录', async kind => {
    const f = fixture(), operation = f.reader.start(f.owner, statement()); if (kind !== 'missing-fields') f.fields();
    if (kind === 'second-fields') f.fields(); if (kind === 'second-result') f.queries[0].emit('result', { name: 'x' }, 1); if (kind === 'unknown-value') f.row({ nested: { secret: '私料' } }); if (kind === 'no-result-index') f.queries[0].emit('result', { affectedRows: 0 }); f.queries[0].emit('end'); await expect(operation.result).rejects.toMatchObject({ reason: 'protocol-invalid' });
  });
  it.each(['sql', 'name', 'values', 'rows', 'bytes', 'sensitive', 'owner', 'thread', 'signal', 'debug', 'format'] as const)('发送前拒绝 %s 异常，零原生调用', kind => {
    const f = fixture(), input = statement(); if (kind === 'sql') input.sql = 'USE x'; if (kind === 'name') (input.params as string[])[0] = 'bad\0name'; if (kind === 'values') input.params = []; if (kind === 'rows') input.maxRows = 0; if (kind === 'bytes') input.maxBytes = 2097153; if (kind === 'sensitive') input.sensitiveResult = false as true; if (kind === 'owner') f.invalidate(); if (kind === 'thread') f.connection.threadId = 43; if (kind === 'signal') f.controller.abort(); if (kind === 'debug') f.connection.config.debug = true; if (kind === 'format') f.connection.config.queryFormat = () => 'DROP DATABASE x';
    expect(() => f.reader.start(f.owner, input)).toThrow(); expect(f.connection.execute).not.toHaveBeenCalled(); expect(f.context.commandStarted).not.toHaveBeenCalled();
  });
  it('mysql2 敏感诊断订阅存在时拒绝发送，既不记录也不旁路订阅', () => {
    const channel = tracingChannel('mysql2:execute'), listener = vi.fn(), handlers = { start: listener, end: vi.fn(), asyncStart: vi.fn(), asyncEnd: vi.fn(), error: vi.fn() }; channel.subscribe(handlers);
    try { const f = fixture(); expect(() => f.reader.start(f.owner, statement())).toThrow(); expect(f.connection.execute).not.toHaveBeenCalled(); expect(listener).not.toHaveBeenCalled(); } finally { channel.unsubscribe(handlers); }
  });
  it('owner 钩子与输入 getter 在登记前也不能重入；结束记账后再次核租约', async () => {
    const f = fixture(), input = statement(); vi.mocked(f.hooks.checkOwner).mockImplementation(() => { expect(() => f.reader.start(f.owner, statement())).toThrow(); });
    Object.defineProperty(input, 'sql', { enumerable: true, get: () => { expect(() => f.reader.start(f.owner, statement())).toThrow(); return databaseBackupSourceSql.tables; } });
    const operation = f.reader.start(f.owner, input); f.fields(); f.queries[0].emit('end'); await operation.result; expect(f.connection.execute).toHaveBeenCalledTimes(1);
    const g = fixture(); g.finish.mockImplementation(() => { g.invalidate(); }); const second = g.reader.start(g.owner, statement()); g.fields(); g.queries[0].emit('end'); await expect(second.result).rejects.toMatchObject({ reason: 'lease-invalid' });
  });
  it('登记编号后失效仍在发送前拒绝，不对未发送的命令发停止请求', async () => {
    const f = fixture(); vi.mocked(f.context.commandStarted).mockImplementation(() => { f.invalidate(); return f.finish; });
    const operation = f.reader.start(f.owner, statement()); await expect(operation.result).rejects.toMatchObject({ reason: 'registration-failed' }); expect(await operation.nativeTerminal).toBe('not-submitted'); expect(f.finish).toHaveBeenCalledTimes(1); expect(f.hooks.requestStop).not.toHaveBeenCalled(); expect(f.connection.execute).not.toHaveBeenCalled();
  });
  it('命令登记抛错时显式保留记账失败，零发送且不把未发送当作资源释放', async () => {
    const f = fixture(); vi.mocked(f.context.commandStarted).mockImplementation(() => { throw Error('私有登记详情'); }); const operation = f.reader.start(f.owner, statement());
    await expect(operation.result).rejects.toMatchObject({ reason: 'registration-failed' }); expect(await operation.nativeTerminal).toBe('not-submitted'); expect(operation.snapshot()).toMatchObject({ accountingFailed: true, retainedRows: 0 }); expect(f.connection.execute).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled(); expect(f.hooks.requestStop).not.toHaveBeenCalled();
  });
  it('物理连接被换绑时停止接纳，保留原 Query；原方法钩子别名不能事后替换', async () => {
    const f = fixture(), operation = f.reader.start(f.owner, statement()); f.hooks.checkOwner = () => undefined; f.invalidate(); f.fields(); await expect(operation.result).rejects.toMatchObject({ reason: 'lease-invalid' }); f.queries[0].emit('end');
    const g = fixture(), second = g.reader.start(g.owner, statement()); g.managed.connection = new EventEmitter() as typeof g.connection; g.fields(); await expect(second.result).rejects.toMatchObject({ reason: 'lease-invalid' }); expect(second.query).toBe(g.queries[0]); g.queries[0].emit('end');
  });
  it('Source 与 Reader 串行组合实际固定 SQL、零目录及全部定义摘要，仍保留锁阻断', async () => {
    const f = fixture(), querySend = f.connection.query.getMockImplementation()!, executeSend = f.connection.execute.getMockImplementation()!;
    const facts = { hostname: 'ram', port: 3306, serverId: 1, currentUser: 'backup@localhost', currentRole: 'NONE', connectionId: 42, sqlMode: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', quoteShowCreate: 1, characterSetConnection: 'utf8mb4', collationConnection: 'utf8mb4_bin', identifierCase: 0 };
    const response = (sql: string) => {
      if (sql === databaseBackupSourceSql.version) return [{ version: '8.4.11', versionComment: 'MySQL Community Server' }];
      if (sql === databaseBackupSourceSql.facts) return [facts];
      if (sql === databaseBackupSourceSql.uuid) return [{ serverUuid: '11111111-1111-1111-1111-111111111111' }];
      if (sql === databaseBackupSourceSql.gipk) return [{ generatedPrimaryKeyVisible: 1 }];
      if (sql === databaseBackupSourceSql.grants) return [{ grants: 'GRANT SELECT, SHOW VIEW, SHOW DATABASES, TRIGGER, EVENT, RELOAD, LOCK TABLES, PROCESS ON *.* TO `backup`@`localhost`' }];
      if (sql === databaseBackupSourceSql.schemas) return [{ name: 'db', characterSet: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' }];
      if (sql === databaseBackupSourceSql.tables) return [{ name: 't', objectType: 'BASE TABLE', engine: 'InnoDB' }];
      if (sql === 'SHOW CREATE DATABASE `db`') return [{ Database: 'db', 'Create Database': 'CREATE DATABASE `db` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */' }];
      if (sql === 'SHOW CREATE TABLE `db`.`t`') return [{ Table: 't', 'Create Table': 'CREATE TABLE `t` (`id` int NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci' }];
      return [];
    };
    function emit(sql: string, query: RamQuery, text: boolean) { queueMicrotask(() => { f.fields(query, text); response(sql).forEach(value => f.row(value, query)); query.emit('end'); }); return query; }
    f.connection.query.mockImplementation(options => emit(options.sql, querySend(options), true)); f.connection.execute.mockImplementation((options, params) => emit(options.sql, executeSend(options, params), false));
    const inspected = await inspectDatabaseBackupSource(f.reader.context, { ...f.owner, database: 'db', endpoint: 'direct-pinned' });
    expect(inspected.evidence.objects).toHaveLength(2); expect(inspected.evidence.objects.every(value => /^[a-f0-9]{64}$/.test(value.definitionSha256!))).toBe(true);
    expect(Object.values(inspected.evidence.visibility).every(value => value === 'proven')).toBe(true); expect(inspected.blockers.map(value => value.code)).toEqual(['lock-capability-unproven']); expect(inspected.actualLockHeld).toBe(false); expect(f.finish).toHaveBeenCalledTimes(f.queries.length); expect(f.hooks.requestStop).not.toHaveBeenCalled();
  });
  it('直接接源检查 context，version 后取消不产生后续事实 SQL', async () => {
    const f = fixture(), inspection = inspectDatabaseBackupSource(f.reader.context, { ...f.owner, database: 'db', endpoint: 'direct-pinned' });
    expect(f.connection.query).toHaveBeenCalledTimes(1); f.fields(undefined, true); f.row({ version: '8.4.11', versionComment: 'MySQL Community Server' }); f.queries[0].emit('end'); f.cancelTask();
    await expect(inspection).rejects.toMatchObject({ reason: 'lease-invalid' }); expect(f.connection.execute).not.toHaveBeenCalled(); expect(f.connection.query).toHaveBeenCalledTimes(1);
  });
});
