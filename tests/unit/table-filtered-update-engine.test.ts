import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellValue, ColumnInfo, TableInfo } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { tableFilteredUpdateConfirmation, tableFilteredUpdateLimits, type TableFilteredUpdateApplyInput, type TableFilteredUpdatePreviewInput, type TableFilteredUpdateProgress, type TableFilteredUpdateTarget } from '../../src/shared/tableFilteredUpdate';
import { TableFilteredUpdateTasks, planTableFilteredUpdate, tableFilteredUpdateStatement, type TableFilteredUpdateHost } from '../../src/engine/tableFilteredUpdate';
import { TableFilteredUpdateSpool } from '../../src/engine/tableFilteredUpdateSpool';
import { buildPageSql, inlineParameters } from '../../src/engine/sql';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';

const hooks = vi.hoisted(() => ({ read: vi.fn(), frames: vi.fn() }));
vi.mock('../../src/engine/incomingReferences', async original => ({ ...await original<typeof import('../../src/engine/incomingReferences')>(), readIncomingReferenceTable: hooks.read }));
vi.mock('../../src/engine/queryStreamProtocol', () => ({ consumeQueryFrames: hooks.frames }));
const owners = new Set<TableFilteredUpdateTasks>(), target: TableFilteredUpdateTarget = { connectionId: 'offline', database: 'db', table: 'subject' };
const column = (name: string, type: string, nullable = false, extra = '', generated = false): ColumnInfo => ({ name, type, nullable, extra, generated, defaultValue: null, characterSet: /^VARCHAR/.test(type) ? 'utf8mb4' : null, comment: '' });
function table(): TableInfo { return { database: 'db', name: 'subject', objectKind: 'table', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', primaryKey: ['id'], editableKey: ['id'], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [], columns: [column('id', 'BIGINT UNSIGNED'), column('amount', 'DECIMAL(30,12)'), column('note', 'VARCHAR(100)', true), column('payload', 'VARBINARY(8)'), column('at', 'TIMESTAMP(6)', true), column('computed', 'DECIMAL(34,12)', true, 'STORED GENERATED', true)], ddl: 'CREATE TABLE `subject` (`id` bigint unsigned NOT NULL, `amount` decimal(30,12) NOT NULL, `note` varchar(100) DEFAULT NULL, `payload` varbinary(8) NOT NULL, `at` timestamp(6) NULL DEFAULT NULL, `computed` decimal(34,12) GENERATED ALWAYS AS (`amount` + 1) STORED, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin' }; }
/** 只构造本例可信目录与对应原DDL，保持其余精度/时间/生成列夹具不变。 */
function addIndex(info: TableInfo, columns: string[], definition: string, unique = false, name = 'secondary'): void { info.indexes.push({ name, unique, columns }); info.ddl = info.ddl.replace(', PRIMARY KEY (`id`)', ', ' + definition + ', PRIMARY KEY (`id`)'); }
const cells = (index: number): CellValue[] => [index === 0 ? '18446744073709551615' : String(index), '9007199254740993.123456789012', index ? ' O\'Reilly\\\0🚢 ' : null, { type: 'binary', base64: index ? '' : 'AP8=' }, index ? '2026-10-24 12:34:56.123456' : null, '9007199254740994.123456789012'];
function request(source: TableInfo, patch: Partial<TableFilteredUpdatePreviewInput> = {}): TableFilteredUpdatePreviewInput { return { ...target, taskId: randomUUID(), metadataKey: tableCopyMetadataKey(source), filters: [], sort: [], column: 'note', value: '填充\0原文 🚢 ', ...patch }; }
function apply(preview: { previewToken: string; target: TableFilteredUpdateTarget; column: string; rows: number }, patch: Partial<TableFilteredUpdateApplyInput> = {}): TableFilteredUpdateApplyInput { return { connectionId: target.connectionId, taskId: randomUUID(), previewToken: preview.previewToken, confirmation: tableFilteredUpdateConfirmation(preview), acknowledged: true, ...patch }; }

/** 实际磁盘spool、SQL编译和定义解析均参与；只替换物理数据库传输。 */
function fixture() {
  const f = { source: table(), now: 1000, count: 1105, cancelled: false, triggers: false, grants: ['GRANT ALL PRIVILEGES ON *.* TO `offline`@`%`'], zone: 'SYSTEM', systemZone: 'UTC', offset: '0',
    updated: 0, failUpdate: 0, affectedUpdate: 0, warningUpdate: 0, breakUpdate: 0, loseTransaction: 0, failCommit: false, failRollback: false, lateCloseFailure: false, activeCommands: 0, activeRuns: 0,
    commands: [] as { sql: string; values?: unknown[] }[], runs: [] as { progress: TableFilteredUpdateProgress; execution: boolean }[], paths: [] as string[], holdEnd: '', heldEnds: [] as (() => void)[],
    afterUpdate: undefined as (() => void) | undefined, beforeClose: undefined as (() => Promise<void>) | undefined,
  };
  const host: TableFilteredUpdateHost = { async stop() { throw Error('RAM原读取不应失去终态'); }, async run<T>(_target: TableFilteredUpdateTarget, _taskId: string, action: (context: StructureTaskContext) => Promise<T>, progress: TableFilteredUpdateProgress, execution: boolean, finalize: (succeeded: boolean) => Promise<void>): Promise<T> {
    f.activeRuns++; f.runs.push({ execution, progress }); let inTransaction = false, mode = 'NO_ENGINE_SUBSTITUTION', timeZone = f.zone, failure: unknown, result!: T;
    const connection = new EventEmitter() as EventEmitter & { threadId: number; query: Function; execute: Function }; connection.threadId = 32;
    const managed = { connection, status: { dialect: 'mysql', version: '8.4.11' }, broken: false, serverStatus: 2, transactionStateKnown: true, sqlMode: mode };
    const schedule = (sql: string, values: unknown[] | undefined, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) => {
      const operation = new EventEmitter(); f.commands.push({ sql, ...(values ? { values } : {}) });
      queueMicrotask(() => {
        let error: Error | null = null, rows: unknown;
        if (sql.startsWith('SELECT @@version AS version,')) rows = [{ version: '8.4.11', hostname: 'offline-host', port: '3306', serverId: '1', currentUser: 'offline@%', connectionId: '32', quoteShowCreate: '1', charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci', uuid: '00000000-0000-4000-8000-000000000001' }];
        else if (sql.startsWith('SELECT @@SESSION.time_zone AS timeZone,')) rows = [{ timeZone, systemTimeZone: f.systemZone, utcOffset: f.offset }];
        else if (sql === 'SELECT @@SESSION.sql_mode AS sqlMode') rows = [{ sqlMode: mode }];
        else if (sql === 'SELECT @@SESSION.sql_mode AS sqlMode,@@SESSION.time_zone AS timeZone') rows = [{ sqlMode: mode, timeZone }];
        else if (sql === 'SHOW GRANTS') rows = f.grants.map(grant => ({ grant }));
        else if (sql.startsWith('SELECT TRIGGER_NAME')) rows = f.triggers ? [{ TRIGGER_NAME: 'unsafe' }] : [];
        else if (sql.startsWith('SELECT 1 FROM') || sql === 'SHOW WARNINGS LIMIT 21') rows = [];
        else {
          if (sql.startsWith('SET SESSION sql_mode')) { mode = sql.slice(sql.indexOf("'") + 1, -1); managed.sqlMode = mode; }
          else if (sql.startsWith('SET SESSION time_zone')) timeZone = sql.slice(sql.indexOf("'") + 1, -1);
          else if (sql === 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ') { /* 原事务隔离配置。 */ }
          else if (sql === 'START TRANSACTION' || sql === 'START TRANSACTION READ ONLY') inTransaction = true;
          else if (sql === 'COMMIT') { if (f.failCommit) error = Error('本例提交ACK丢失'); else inTransaction = false; }
          else if (sql === 'ROLLBACK' || sql === 'ROLLBACK AND NO CHAIN NO RELEASE') { if (f.failRollback) error = Error('本例回滚ACK丢失'); else inTransaction = false; }
          else if (sql.startsWith('UPDATE ')) { f.updated++; if (f.failUpdate === f.updated) error = Error('本例更新失败'); if (f.breakUpdate === f.updated) managed.broken = true; if (f.loseTransaction === f.updated) inTransaction = false; f.afterUpdate?.(); }
          else throw Error('本例拒绝未声明SQL：' + sql);
          managed.serverStatus = 2 | (inTransaction ? 1 : 0);
          rows = { affectedRows: sql.startsWith('UPDATE ') ? f.affectedUpdate === f.updated ? 0 : 1 : 0, serverStatus: managed.serverStatus, warningStatus: sql.startsWith('UPDATE ') && f.warningUpdate === f.updated ? 1 : 0 };
        }
        callback(error, rows, []); const end = () => operation.emit('end'); if (sql === f.holdEnd) f.heldEnds.push(end); else queueMicrotask(end);
      }); return operation;
    };
    connection.query = (sql: string, callback: Function) => schedule(sql, undefined, callback as never);
    connection.execute = (sql: string, values: unknown[], callback: Function) => schedule(sql, values, callback as never);
    const context = { managed, checkCancelled() { if (f.cancelled) throw Error('本例取消'); }, report() {}, commandStarted() { f.activeCommands++; let ended = false; return () => { if (!ended) { ended = true; f.activeCommands--; } }; } } as unknown as StructureTaskContext;
    try { result = await action(context); await f.beforeClose?.(); if (execution && f.lateCloseFailure) throw Error('本例严格连接关闭失败'); } catch (error) { failure = error; }
    try { await finalize(!failure); } catch (error) { failure ??= error; }
    f.activeRuns--; if (failure) throw failure; return result;
  } };
  hooks.read.mockImplementation(async () => structuredClone(f.source));
  hooks.frames.mockImplementation(async (_managed: unknown, sql: string, wire: string, consumer: { checkCancelled(): void; commandStarted(): () => void; consume(frame: unknown): Promise<void> }) => {
    f.commands.push({ sql }); expect(wire).toBe('binary'); const finished = consumer.commandStarted();
    try {
      await consumer.consume({ kind: 'rows-start', resultOrdinal: 1, rowResultOrdinal: 1, statementOrdinal: 1, columns: [...f.source.columns.map((column, index) => ({ name: column.name, position: index + 1, type: ['LONGLONG', 'NEWDECIMAL', 'VAR_STRING', 'BLOB', 'TIMESTAMP', 'NEWDECIMAL'][index] })), { name: '__dbark_epoch_0', position: f.source.columns.length + 1, type: 'VAR_STRING' }] });
      for (let index = 0; index < f.count; index++) { consumer.checkCancelled(); await consumer.consume({ kind: 'row', resultOrdinal: 1, values: [...cells(index), index ? '1792845296.123456' : null] }); }
      await consumer.consume({ kind: 'rows-end', resultOrdinal: 1, warningCount: 0 });
    } finally { finished(); }
  });
  const original = TableFilteredUpdateSpool.create.bind(TableFilteredUpdateSpool); vi.spyOn(TableFilteredUpdateSpool, 'create').mockImplementation(async check => { const value = await original(check); f.paths.push(value.path); return value; });
  const tasks = new TableFilteredUpdateTasks(host, () => f.now); owners.add(tasks); return { f, tasks };
}
beforeEach(() => { hooks.read.mockReset(); hooks.frames.mockReset(); });
afterEach(async () => { for (const tasks of owners) await tasks.close(); owners.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('服务器全部筛选行填充核心', () => {
  it('条件字节沿真实表页，完整嵌套与停用保持；SELECT无LIMIT/OFFSET并附可靠键排序', () => {
    const source = table(), input = request(source, { filters: [{ column: 'id', operator: '=', value: '18446744073709551615' }, { column: 'note', operator: 'LIKE', value: '%?\\_%' }, { column: 'note', operator: 'IS NULL', enabled: false }], filterMode: 'any', filterGroup: { mode: 'any', children: [0, { mode: 'all', children: [1, 2] }] }, sort: [{ column: 'amount', direction: 'DESC' }] });
    const planned = planTableFilteredUpdate(source, input).sql, page = buildPageSql(source, 1, 1000, input.filters, input.sort, input.filterMode, input.filterGroup);
    const original = inlineParameters(page.sql, page.params), tail = original.slice(original.indexOf(' WHERE '), original.indexOf(' LIMIT '));
    expect(planned.endsWith(tail)).toBe(true); expect(planned).not.toMatch(/\bLIMIT|\bOFFSET/); expect(planned).toContain('CAST(UNIX_TIMESTAMP(`at`) AS CHAR) AS `__dbark_epoch_0`'); expect(planned).toContain('CAST(CAST('); expect(planned).toContain('ORDER BY `amount` DESC, `id` ASC');
  });
  it('预览1105条不写DB且仅十条SQL样本；调用者后改不污染，原全部行逐条prepared并一次COMMIT', async () => {
    const { f, tasks } = fixture(), input = request(f.source), preview = await tasks.preview(input, 4);
    expect(preview).toMatchObject({ target, column: 'note', rows: 1105, shownRows: 10, sampleOmitted: true, timeZone: 'SYSTEM' }); expect(Buffer.byteLength(preview.sql)).toBeLessThanOrEqual(tableFilteredUpdateLimits.previewSqlBytes); expect(f.updated).toBe(0); expect(f.activeCommands).toBe(0);
    input.value = '迟到改值'; input.filters.push({ column: 'id', operator: '=', value: '0' });
    expect(await tasks.apply(apply(preview), 4)).toEqual({ target, column: 'note', rows: 1105, outcome: 'committed', commitAcknowledged: true });
    const updates = f.commands.filter(item => item.sql.startsWith('UPDATE ')); expect(updates).toHaveLength(1105); expect(updates[0].values?.[0]).toBe('填充\0原文 🚢 '); expect(updates[0].values?.[1]).toBe('18446744073709551615'); expect(updates[0].values).toContainEqual(Buffer.from([0, 255])); expect(updates[1].values?.at(-1)).toBe('1792845296.123456');
    expect(updates[0].sql).toContain('BINARY CONVERT(`note` USING utf8mb4)'); expect(updates[0].sql).toContain('UNIX_TIMESTAMP(`at`) <=> CAST(? AS DECIMAL(20,6))'); expect(f.commands.filter(item => item.sql === 'COMMIT')).toHaveLength(1); expect(f.runs.at(-1)?.progress).toMatchObject({ rows: 1105, totalRows: 1105, commitAcknowledged: true, transactionProtected: true, outcome: 'committed' });
    await expect(lstat(f.paths[0])).rejects.toMatchObject({ code: 'ENOENT' }); expect(f.activeRuns).toBe(0); await expect(tasks.apply(apply(preview), 4)).rejects.toThrow('预览');
  }, 30000);
  it.each(['error', 'conflict', 'warning', 'cancel'] as const)('%s中途失败整批ROLLBACK，无中间COMMIT，不混入预览后新行', async kind => {
    const { f, tasks } = fixture(); f.count = 3; const preview = await tasks.preview(request(f.source), 0); f.count = 999;
    if (kind === 'error') f.failUpdate = 2; if (kind === 'conflict') f.affectedUpdate = 2; if (kind === 'warning') f.warningUpdate = 2; if (kind === 'cancel') f.afterUpdate = () => { f.cancelled = true; };
    await expect(tasks.apply(apply(preview), 0)).rejects.toThrow(); expect(f.updated).toBe(kind === 'cancel' ? 1 : 2); expect(f.commands.filter(item => item.sql === 'ROLLBACK')).toHaveLength(1); expect(f.commands.some(item => item.sql === 'COMMIT')).toBe(false); expect(f.runs.at(-1)?.progress).toMatchObject({ transactionProtected: true, rollbackAcknowledged: true, outcome: 'rolled-back' }); expect(f.activeCommands).toBe(0);
  });
  it.each(['commit', 'rollback', 'disconnect', 'transaction'] as const)('%s证据丢失保留unknown，令牌不可重放', async kind => {
    const { f, tasks } = fixture(); f.count = 3; const preview = await tasks.preview(request(f.source), 0);
    if (kind === 'commit') f.failCommit = true; if (kind === 'rollback') { f.failUpdate = 2; f.failRollback = true; } if (kind === 'disconnect') f.breakUpdate = 1; if (kind === 'transaction') f.loseTransaction = 1;
    await expect(tasks.apply(apply(preview), 0)).rejects.toThrow('未知'); expect(f.runs.at(-1)?.progress.outcome).toBe('unknown'); if (kind === 'transaction') expect(f.runs.at(-1)?.progress.transactionProtected).toBe(false);
    const count = f.commands.length; await expect(tasks.apply(apply(preview), 0)).rejects.toThrow(); expect(f.commands).toHaveLength(count); if (kind === 'commit') expect(f.commands.some(item => item.sql === 'ROLLBACK')).toBe(false);
  });
  it('COMMIT回调ACK先记账但真实end未到不能完成，晚关闭失败仍返回真实已提交', async () => {
    const { f, tasks } = fixture(); f.count = 2; const preview = await tasks.preview(request(f.source), 0); f.holdEnd = 'COMMIT'; f.lateCloseFailure = true;
    let finished = false; const operation = tasks.apply(apply(preview), 0).then(result => { finished = true; return result; });
    await vi.waitFor(() => expect(f.heldEnds).toHaveLength(1)); expect(finished).toBe(false); expect(f.activeCommands).toBe(1); expect(f.runs.at(-1)?.progress.commitAcknowledged).toBe(true);
    const closing = tasks.close(); f.cancelled = true; expect(finished).toBe(false); f.heldEnds.shift()!(); expect(await operation).toMatchObject({ rows: 2, commitAcknowledged: true }); await closing; expect(f.activeCommands).toBe(0);
  });
  it('严格关闭完成前不发布令牌；关闭失败不泄漏原文件', async () => {
    const { f, tasks } = fixture(); f.count = 1; let release!: () => void; f.beforeClose = () => new Promise<void>(resolve => { release = resolve; });
    let finished = false; const preview = tasks.preview(request(f.source), 0).then(value => { finished = true; return value; });
    await vi.waitFor(() => expect(release).toBeTypeOf('function')); expect(finished).toBe(false); expect(f.activeRuns).toBe(1); release(); const value = await preview; await tasks.release({ connectionId: target.connectionId, previewToken: value.previewToken }); await expect(lstat(f.paths[0])).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('宿主done必须等待快照清理；COMMIT ACK后的清理失败仍留原件账本供显式恢复', async () => {
    const { f, tasks } = fixture(); f.count = 1; const preview = await tasks.preview(request(f.source), 0);
    const original = TableFilteredUpdateSpool.prototype.dispose; let release!: () => void;
    const dispose = vi.spyOn(TableFilteredUpdateSpool.prototype, 'dispose').mockImplementationOnce(async function (this: TableFilteredUpdateSpool) { await new Promise<void>(resolve => { release = resolve; }); throw Error('本例快照清理失败'); });
    let finished = false; const operation = tasks.apply(apply(preview), 0).then(value => { finished = true; return value; });
    await vi.waitFor(() => expect(release).toBeTypeOf('function')); expect(finished).toBe(false); expect(f.activeRuns).toBe(1); expect(f.runs.at(-1)?.progress.commitAcknowledged).toBe(true);
    release(); expect(await operation).toMatchObject({ commitAcknowledged: true }); expect(dispose).toHaveBeenCalledTimes(1); expect((await lstat(f.paths[0])).isFile()).toBe(true);
    dispose.mockImplementation(original); await tasks.close(); await expect(lstat(f.paths[0])).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('闲置预览按完成时开始的十分钟实际回收，不等待另一个请求', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); const { f, tasks } = fixture(); f.count = 1;
    const preview = await tasks.preview(request(f.source), 0); f.now += tableFilteredUpdateLimits.lifetimeMs;
    await vi.advanceTimersByTimeAsync(tableFilteredUpdateLimits.lifetimeMs);
    await vi.waitFor(async () => { await expect(lstat(f.paths[0])).rejects.toMatchObject({ code: 'ENOENT' }); });
    await expect(tasks.apply(apply(preview), 0)).rejects.toThrow('预览');
  });
  it('完整旧值文件被改、DDL漂移和时区漂移都在第一条UPDATE前拒绝', async () => {
    for (const kind of ['spool', 'ddl', 'timezone'] as const) {
      vi.restoreAllMocks(); const { f, tasks } = fixture(); f.count = 2; const preview = await tasks.preview(request(f.source), 0);
      if (kind === 'spool') await writeFile(f.paths[0], '修改原快照'); if (kind === 'ddl') f.source.ddl = f.source.ddl.replace('varchar(100)', 'varchar(101)'); if (kind === 'timezone') f.offset = '3600';
      await expect(tasks.apply(apply(preview), 0)).rejects.toThrow(); expect(f.updated).toBe(0);
    }
  });
  it('正确epoch守卫不能来自客户端，NULL必须和原TIMESTAMP相符', () => {
    const source = table(), row = { values: cells(1), timestampEpochs: ['1792845296.123456'] }, statement = tableFilteredUpdateStatement(source, 'note', 'a', row);
    expect(statement.params.at(-1)).toBe('1792845296.123456'); expect(() => tableFilteredUpdateStatement(source, 'note', 'a', { ...row, timestampEpochs: [null] })).toThrow('TIMESTAMP'); expect(() => tableFilteredUpdateStatement(source, 'note', 'a', { ...row, timestampEpochs: ['1 OR 1'] })).toThrow('TIMESTAMP');
  });
  it('错误行数确认、连接修订、已释放或TTL失效不建执行连接；两份预算含在途', async () => {
    const { f, tasks } = fixture(); f.count = 1;
    for (const kind of ['confirm', 'revision', 'release', 'expiry'] as const) {
      const preview = await tasks.preview(request(f.source), 0), before = f.runs.length;
      if (kind === 'release') await tasks.release({ connectionId: target.connectionId, previewToken: preview.previewToken }); if (kind === 'expiry') f.now += tableFilteredUpdateLimits.lifetimeMs;
      await expect(tasks.apply(apply(preview, kind === 'confirm' ? { confirmation: 'db.subject / note / 2' } : {}), kind === 'revision' ? 1 : 0)).rejects.toThrow(); expect(f.runs).toHaveLength(before);
    }
    const a = await tasks.preview(request(f.source), 0), b = await tasks.preview(request(f.source), 0); await expect(tasks.preview(request(f.source), 0)).rejects.toThrow('两份'); await tasks.release({ connectionId: target.connectionId, previewToken: a.previewToken }); await tasks.release({ connectionId: target.connectionId, previewToken: b.previewToken });
  });
  it('空匹配仅可预览；无可靠键、MyISAM、触发器、生成列/主键填充拒绝', async () => {
    const { f, tasks } = fixture(); f.count = 0; const empty = await tasks.preview(request(f.source), 0); expect(empty).toMatchObject({ rows: 0, shownRows: 0 }); await expect(tasks.apply(apply(empty), 0)).rejects.toThrow();
    for (const kind of ['key', 'engine', 'trigger', 'generated', 'primary'] as const) {
      f.source = table(); f.triggers = kind === 'trigger'; if (kind === 'key') f.source.editableKey = []; if (kind === 'engine') f.source.engine = 'MyISAM';
      await expect(tasks.preview(request(f.source, { column: kind === 'generated' ? 'computed' : kind === 'primary' ? 'id' : 'note' }), 0)).rejects.toThrow(); expect(f.updated).toBe(0);
    }
  });
  it.each([
    { kind: 'secondary unique', unique: true, columns: ['note'], ddl: 'UNIQUE KEY `secondary` (`note`)' },
    { kind: 'nonunique', unique: false, columns: ['note'], ddl: 'KEY `secondary` (`note`)' },
    { kind: 'composite unique', unique: true, columns: ['amount', 'note'], ddl: 'UNIQUE KEY `secondary` (`amount`,`note`)' },
    { kind: 'composite nonunique', unique: false, columns: ['note', 'amount'], ddl: 'KEY `secondary` (`note`,`amount`)' },
    { kind: 'prefix', unique: false, columns: ['note'], ddl: 'KEY `secondary` (`note`(5))' },
    { kind: 'fulltext', unique: false, columns: ['note'], ddl: 'FULLTEXT KEY `secondary` (`note`)' },
  ])('$kind字段不受单行affectedRows伪装范围，预览扫描和spool之前就拒绝', async ({ columns, ddl, unique }) => {
    const { f, tasks } = fixture(); addIndex(f.source, columns, ddl, unique);
    await expect(tasks.preview(request(f.source), 0)).rejects.toThrow('索引'); expect(hooks.frames).not.toHaveBeenCalled(); expect(f.paths).toEqual([]); expect(f.updated).toBe(0); expect(f.commands.some(item => item.sql.startsWith('UPDATE '))).toBe(false);
  });
  it.each(['omitted', 'phantom', 'name', 'order', 'unique', 'duplicate'] as const)('目录与DDL的%s不一致不可省略或猜测为安全依赖', async kind => {
    const { f, tasks } = fixture();
    if (kind === 'omitted') f.source.ddl = f.source.ddl.replace(', PRIMARY KEY (`id`)', ', KEY `secondary` (`note`), PRIMARY KEY (`id`)');
    else if (kind === 'phantom') f.source.indexes.push({ name: 'secondary', unique: false, columns: ['note'] });
    else { addIndex(f.source, kind === 'order' ? ['note', 'amount'] : ['note'], kind === 'order' ? 'KEY `secondary` (`amount`,`note`)' : 'KEY `secondary` (`note`)', kind === 'unique'); if (kind === 'name') f.source.indexes[1].name = 'different'; if (kind === 'duplicate') f.source.indexes[1].name = 'PRIMARY'; }
    await expect(tasks.preview(request(f.source, { column: 'amount', value: '1.000000000000' }), 0)).rejects.toThrow('索引'); expect(hooks.frames).not.toHaveBeenCalled(); expect(f.paths).toEqual([]); expect(f.updated).toBe(0);
  });
  it.each(['expression', 'opaque'] as const)('%s索引依赖不能证明时即使填非索引note也整表拒绝', async kind => {
    const { f, tasks } = fixture(); addIndex(f.source, ['amount'], kind === 'expression' ? 'KEY `secondary` ((abs(`amount`)))' : 'KEY `secondary` (`amount`) INVISIBLE');
    await expect(tasks.preview(request(f.source), 0)).rejects.toThrow('索引'); expect(hooks.frames).not.toHaveBeenCalled(); expect(f.paths).toEqual([]); expect(f.updated).toBe(0);
  });
  it.each(['generated', 'generated-ddl', 'on-update', 'on-update-ddl'] as const)('%s索引列可能随普通列自动变化，不能向未预览child级联', async kind => {
    const { f, tasks } = fixture();
    if (kind.startsWith('generated')) { addIndex(f.source, ['computed'], 'KEY `secondary` (`computed`)'); if (kind === 'generated-ddl') f.source.columns.find(column => column.name === 'computed')!.generated = false; }
    else { addIndex(f.source, ['at'], 'KEY `secondary` (`at`)'); f.source.ddl = f.source.ddl.replace('timestamp(6) NULL DEFAULT NULL', 'timestamp(6) NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6)'); if (kind === 'on-update') f.source.columns.find(column => column.name === 'at')!.extra = 'on update CURRENT_TIMESTAMP(6)'; }
    await expect(tasks.preview(request(f.source), 0)).rejects.toThrow('索引'); expect(hooks.frames).not.toHaveBeenCalled(); expect(f.paths).toEqual([]); expect(f.updated).toBe(0);
  });
  it('已证明的普通索引不阻断其它无索引字段，非索引生成列仍保留成功路径', async () => {
    const { f, tasks } = fixture(); f.count = 1; addIndex(f.source, ['amount'], 'KEY `secondary` (`amount`)');
    const preview = await tasks.preview(request(f.source), 0); expect(preview.rows).toBe(1); expect(await tasks.apply(apply(preview), 0)).toMatchObject({ rows: 1, commitAcknowledged: true }); expect(f.updated).toBe(1);
  });
  it('预览后新增索引或变化依赖只回滚原独立事务，不发送第一条UPDATE', async () => {
    const { f, tasks } = fixture(); f.count = 1; const preview = await tasks.preview(request(f.source), 0); addIndex(f.source, ['note'], 'KEY `secondary` (`note`)');
    await expect(tasks.apply(apply(preview), 0)).rejects.toThrow('变化'); expect(f.updated).toBe(0); expect(f.commands.some(item => item.sql === 'COMMIT')).toBe(false); expect(f.commands.filter(item => item.sql === 'ROLLBACK')).toHaveLength(1); expect(f.runs.at(-1)?.progress).toMatchObject({ rollbackAcknowledged: true, outcome: 'not-sent' }); await expect(lstat(f.paths[0])).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
