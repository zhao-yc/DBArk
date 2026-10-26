import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellValue, ColumnInfo, TableInfo } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { tableFilteredDeleteConfirmation, tableFilteredDeleteLimits, type TableFilteredDeleteApplyInput, type TableFilteredDeletePreviewInput, type TableFilteredDeleteProgress, type TableFilteredDeleteTarget } from '../../src/shared/tableFilteredDelete';
import { TableFilteredDeleteTasks, planTableFilteredDelete, tableFilteredDeleteStatement, type TableFilteredDeleteHost } from '../../src/engine/tableFilteredDelete';
import { TableFilteredUpdateSpool as TableFilteredDeleteSpool } from '../../src/engine/tableFilteredUpdateSpool';
import { tableFilteredDeleteGlobalVisibility, validateTableFilteredDeleteDependencies, tableFilteredDeleteDependenciesSql } from '../../src/engine/tableFilteredDeleteProtocol';
import { buildPageSql, inlineParameters } from '../../src/engine/sql';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';

const hooks = vi.hoisted(() => ({ read: vi.fn(), frames: vi.fn() }));
vi.mock('../../src/engine/incomingReferences', async original => ({ ...await original<typeof import('../../src/engine/incomingReferences')>(), readIncomingReferenceTable: hooks.read }));
vi.mock('../../src/engine/queryStreamProtocol', () => ({ consumeQueryFrames: hooks.frames }));
const owners = new Set<TableFilteredDeleteTasks>(), target: TableFilteredDeleteTarget = { connectionId: 'offline', database: 'db', table: 'subject' };
const column = (name: string, type: string, nullable = false, extra = '', generated = false): ColumnInfo => ({ name, type, nullable, extra, generated, defaultValue: null, characterSet: /^VARCHAR/.test(type) ? 'utf8mb4' : null, comment: '' });
function table(): TableInfo { return { database: 'db', name: 'subject', objectKind: 'table', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', primaryKey: ['id'], editableKey: ['id'], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [], columns: [column('id', 'BIGINT UNSIGNED'), column('amount', 'DECIMAL(30,12)'), column('note', 'VARCHAR(100)', true), column('payload', 'VARBINARY(8)'), column('at', 'TIMESTAMP(6)', true), column('computed', 'DECIMAL(34,12)', true, 'STORED GENERATED', true)], ddl: 'CREATE TABLE `subject` (`id` bigint unsigned NOT NULL, `amount` decimal(30,12) NOT NULL, `note` varchar(100) DEFAULT NULL, `payload` varbinary(8) NOT NULL, `at` timestamp(6) NULL DEFAULT NULL, `computed` decimal(34,12) GENERATED ALWAYS AS (`amount` + 1) STORED, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin' }; }
/** 只构造本例可信目录与对应原DDL，保持其余精度/时间/生成列夹具不变。 */
function addIndex(info: TableInfo, columns: string[], definition: string, unique = false, name = 'secondary'): void { info.indexes.push({ name, unique, columns }); info.ddl = info.ddl.replace(', PRIMARY KEY (`id`)', ', ' + definition + ', PRIMARY KEY (`id`)'); }
const cells = (index: number): CellValue[] => [index === 0 ? '18446744073709551615' : String(index), '9007199254740993.123456789012', index ? ' O\'Reilly\\\0🚢 ' : null, { type: 'binary', base64: index ? '' : 'AP8=' }, index ? '2026-10-24 12:34:56.123456' : null, '9007199254740994.123456789012'];
function request(source: TableInfo, patch: Partial<TableFilteredDeletePreviewInput> = {}): TableFilteredDeletePreviewInput { return { ...target, taskId: randomUUID(), metadataKey: tableCopyMetadataKey(source), filters: [], sort: [], ...patch }; }
function apply(preview: { previewToken: string; target: TableFilteredDeleteTarget; rows: number }, patch: Partial<TableFilteredDeleteApplyInput> = {}): TableFilteredDeleteApplyInput { return { connectionId: target.connectionId, taskId: randomUUID(), previewToken: preview.previewToken, confirmation: tableFilteredDeleteConfirmation(preview), acknowledged: true, ...patch }; }

/** 实际磁盘spool、SQL编译和定义解析均参与；只替换物理数据库传输。 */
function fixture() {
  const f = { dialect:'mysql' as 'mysql'|'mariadb', version:'8.4.11', inheritedForeignKeys:'0', failForeignKeySet:false, foreignKeyReadOverride:undefined as string|undefined, dependencies: [] as Record<string,string>[], failGuard:false, guardAffected:0, guardWarning:0, guardLoseTransaction:false, source: table(), now: 1000, count: 1105, cancelled: false, triggers: false, grants: ['GRANT ALL PRIVILEGES ON *.* TO `offline`@`%`'], zone: 'SYSTEM', systemZone: 'UTC', offset: '0',
    deleted: 0, failDelete: 0, affectedDelete: 0, warningDelete: 0, breakDelete: 0, loseTransaction: 0, failCommit: false, failRollback: false, lateCloseFailure: false, activeCommands: 0, activeRuns: 0,
    commands: [] as { sql: string; values?: unknown[] }[], runs: [] as { progress: TableFilteredDeleteProgress; execution: boolean }[], paths: [] as string[], holdEnd: '', heldEnds: [] as (() => void)[],
    afterDelete: undefined as (() => void) | undefined, beforeClose: undefined as (() => Promise<void>) | undefined,
  };
  const host: TableFilteredDeleteHost = { async stop() { throw Error('RAM原读取不应失去终态'); }, async run<T>(_target: TableFilteredDeleteTarget, _taskId: string, action: (context: StructureTaskContext) => Promise<T>, progress: TableFilteredDeleteProgress, execution: boolean, finalize: (succeeded: boolean) => Promise<void>): Promise<T> {
    f.activeRuns++; f.runs.push({ execution, progress }); let inTransaction = false, mode = 'NO_ENGINE_SUBSTITUTION', timeZone = f.zone, foreignKeys=f.inheritedForeignKeys, failure: unknown, result!: T;
    const connection = new EventEmitter() as EventEmitter & { threadId: number; query: Function; execute: Function }; connection.threadId = 32;
    const managed = { connection, status: { dialect: f.dialect, version: f.version }, broken: false, serverStatus: 2, transactionStateKnown: true, sqlMode: mode };
    const schedule = (sql: string, values: unknown[] | undefined, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) => {
      const operation = new EventEmitter(); f.commands.push({ sql, ...(values ? { values } : {}) });
      queueMicrotask(() => {
        let error: Error | null = null, rows: unknown;
        if (sql.startsWith('SELECT @@version AS version,')) rows = [{ version: f.version, hostname: 'offline-host', port: '3306', serverId: '1', currentUser: 'offline@%', connectionId: '32', quoteShowCreate: '1', charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci', uuid: '00000000-0000-4000-8000-000000000001' }];
        else if (sql.startsWith('SELECT @@SESSION.time_zone AS timeZone,')) rows = [{ timeZone, systemTimeZone: f.systemZone, utcOffset: f.offset }];
        else if (sql === 'SELECT @@SESSION.sql_mode AS sqlMode') rows = [{ sqlMode: mode }];
        else if (sql === 'SELECT @@SESSION.sql_mode AS sqlMode,@@SESSION.time_zone AS timeZone') rows = [{ sqlMode: mode, timeZone }];
        else if (sql === 'SELECT CAST(@@SESSION.foreign_key_checks AS CHAR) AS foreignKeyChecks') rows=[{foreignKeyChecks:f.foreignKeyReadOverride??foreignKeys}];
        else if (sql === 'SHOW GRANTS') rows = f.grants.map(grant => ({ grant }));
        else if (sql.startsWith('SELECT CONSTRAINT_SCHEMA AS databaseName,')) rows = structuredClone(f.dependencies);
        else if (sql.startsWith('SELECT TRIGGER_NAME')) rows = f.triggers ? [{ TRIGGER_NAME: 'unsafe' }] : [];
        else if (sql.startsWith('SELECT 1 FROM') || sql === 'SHOW WARNINGS LIMIT 21') rows = [];
        else {
          if (sql === 'SET SESSION foreign_key_checks=1') {if(f.failForeignKeySet)error=Error('外键约束不能恢复');else foreignKeys='1';}
          else if (sql.startsWith('SET SESSION sql_mode')) { mode = sql.slice(sql.indexOf("'") + 1, -1); managed.sqlMode = mode; }
          else if (sql.startsWith('SET SESSION time_zone')) timeZone = sql.slice(sql.indexOf("'") + 1, -1);
          else if (sql === 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ') { /* 原事务隔离配置。 */ }
          else if (sql === 'START TRANSACTION' || sql === 'START TRANSACTION READ ONLY') inTransaction = true;
          else if (sql === 'COMMIT') { if (f.failCommit) error = Error('本例提交ACK丢失'); else inTransaction = false; }
          else if (sql === 'ROLLBACK' || sql === 'ROLLBACK AND NO CHAIN NO RELEASE') { if (f.failRollback) error = Error('本例回滚ACK丢失'); else inTransaction = false; }
          else if (sql.startsWith('DELETE ') && sql.endsWith(' WHERE 0')) { if(f.failGuard) error=Error('零行写MDL建立失败'); if(f.guardLoseTransaction)inTransaction=false; }
          else if (sql.startsWith('DELETE ')) { f.deleted++; if (f.failDelete === f.deleted) error = Error('本例更新失败'); if (f.breakDelete === f.deleted) managed.broken = true; if (f.loseTransaction === f.deleted) inTransaction = false; f.afterDelete?.(); }
          else throw Error('本例拒绝未声明SQL：' + sql);
          managed.serverStatus = 2 | (inTransaction ? 1 : 0);
          rows = { affectedRows: sql.endsWith(' WHERE 0') ? f.guardAffected : sql.startsWith('DELETE ') && !sql.endsWith(' WHERE 0') ? f.affectedDelete === f.deleted ? 0 : 1 : 0, serverStatus: managed.serverStatus, warningStatus: sql.endsWith(' WHERE 0') ? f.guardWarning : sql.startsWith('DELETE ') && !sql.endsWith(' WHERE 0') && f.warningDelete === f.deleted ? 1 : 0 };
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
  const original = TableFilteredDeleteSpool.create.bind(TableFilteredDeleteSpool); vi.spyOn(TableFilteredDeleteSpool, 'create').mockImplementation(async check => { const value = await original(check); f.paths.push(value.path); return value; });
  const tasks = new TableFilteredDeleteTasks(host, () => f.now); owners.add(tasks); return { f, tasks };
}
beforeEach(() => { hooks.read.mockReset(); hooks.frames.mockReset(); });
afterEach(async () => { for (const tasks of owners) await tasks.close(); owners.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('服务器全部筛选行删除核心', () => {
  it.each([['mysql','5.7.44'],['mariadb','10.11.19-MariaDB'],['mariadb','11.4.13-MariaDB'],['mysql','8.4.12']])('实际版本 %s/%s 在预览零命令拒绝且释放能力', async (dialect,version) => {
    const {f,tasks}=fixture();f.dialect=dialect as 'mysql'|'mariadb';f.version=version;
    await expect(tasks.preview(request(f.source),4)).rejects.toThrow('当前数据库版本尚不能保证');
    expect(f.commands).toEqual([]);expect(f.paths).toEqual([]);expect(f.deleted).toBe(0);expect(f.activeRuns).toBe(0);
    // 被拒绝的能力不占用两份配额，切回已验版本后仍能正常预览。
    f.dialect='mysql';f.version='8.4.11';f.count=1;const preview=await tasks.preview(request(f.source),4);await tasks.release({connectionId:target.connectionId,previewToken:preview.previewToken});
  });
  it('预览后新物理连接版本变化，执行入口在任何配置或DML之前拒绝并清理原spool',async()=>{
    const {f,tasks}=fixture();f.count=1;const preview=await tasks.preview(request(f.source),4);f.commands=[];f.version='5.7.44';
    await expect(tasks.apply(apply(preview),4)).rejects.toThrow('当前数据库版本尚不能保证');
    expect(f.commands).toEqual([]);expect(f.deleted).toBe(0);expect(f.activeRuns).toBe(0);await expect(lstat(f.paths[0])).rejects.toMatchObject({code:'ENOENT'});
  });
  it('完整嵌套/停用/排序沿表页语义，无LIMIT/OFFSET，TIMESTAMP附绝对epoch', () => {
    const source = table(), input = request(source, { filters: [{ column: 'id', operator: '>=', value: '9007199254740993' }, { column: 'note', operator: 'LIKE', value: '%?\\_%' }, { column: 'note', operator: 'IS NULL', enabled: false }], filterMode: 'any', filterGroup: { mode: 'any', children: [0, { mode: 'all', children: [1, 2] }] }, sort: [{ column: 'amount', direction: 'DESC' }] });
    const planned = planTableFilteredDelete(source, input).sql, original = inlineParameters(buildPageSql(source, 1, 50, input.filters, input.sort, input.filterMode, input.filterGroup).sql, buildPageSql(source, 1, 50, input.filters, input.sort, input.filterMode, input.filterGroup).params);
    expect(planned.endsWith(original.slice(original.indexOf(' WHERE '), original.indexOf(' LIMIT ')))).toBe(true); expect(planned).not.toMatch(/\bLIMIT|\bOFFSET/); expect(planned).toContain('CAST(UNIX_TIMESTAMP(`at`) AS CHAR)'); expect(planned).toContain('ORDER BY `amount` DESC, `id` ASC');
  });
  it('1105行只读预览仅十条完整样本，源对象迟改不混入；零行写MDL后逐行prepared删除且一次COMMIT', async () => {
    const { f, tasks } = fixture(), input = request(f.source), preview = await tasks.preview(input, 4);
    expect(preview).toMatchObject({ operation: 'delete', target, rows: 1105, shownRows: 10, sampleOmitted: true }); expect(preview.sql).toMatch(/^DELETE FROM /); expect(preview.sql).not.toContain('UPDATE '); expect(f.deleted).toBe(0); expect(f.commands.some(value => value.sql.startsWith('DELETE '))).toBe(false);
    input.filters.push({ column: 'id', operator: '=', value: '0' });
    expect(await tasks.apply(apply(preview), 4)).toEqual({ operation: 'delete', target, rows: 1105, outcome: 'committed', commitAcknowledged: true });
    const deletes = f.commands.filter(value => value.sql.startsWith('DELETE ')); expect(deletes).toHaveLength(1106); expect(deletes[0]).toEqual({ sql: 'DELETE FROM `db`.`subject` WHERE 0' }); expect(deletes[1].values?.[0]).toBe('18446744073709551615'); expect(deletes[1].values).toContainEqual(Buffer.from([0, 255])); expect(deletes[2].values?.at(-1)).toBe('1792845296.123456'); expect(deletes[1].sql).toContain('BINARY CONVERT(`note` USING utf8mb4)');
    expect(f.commands.filter(value => value.sql === 'COMMIT')).toHaveLength(1); expect(f.activeCommands).toBe(0); expect(f.runs.at(-1)?.progress).toMatchObject({ rows: 1105, commitAcknowledged: true, outcome: 'committed' }); await expect(lstat(f.paths[0])).rejects.toMatchObject({ code: 'ENOENT' }); await expect(tasks.apply(apply(preview), 4)).rejects.toThrow('预览');
  }, 30000);
  it.each(['error', 'conflict', 'warning', 'cancel'] as const)('%s中途故障整批回滚，预览新增不重扫、不重放', async kind => {
    const { f, tasks } = fixture(); f.count = 3; const preview = await tasks.preview(request(f.source), 0); f.count = 999;
    if (kind === 'error') f.failDelete = 2; if (kind === 'conflict') f.affectedDelete = 2; if (kind === 'warning') f.warningDelete = 2; if (kind === 'cancel') f.afterDelete = () => { f.cancelled = true; };
    await expect(tasks.apply(apply(preview), 0)).rejects.toThrow(); expect(f.deleted).toBe(kind === 'cancel' ? 1 : 2); expect(f.commands.filter(value => value.sql === 'ROLLBACK')).toHaveLength(1); expect(f.commands.some(value => value.sql === 'COMMIT')).toBe(false); expect(f.runs.at(-1)?.progress).toMatchObject({ transactionProtected: true, rollbackAcknowledged: true, outcome: 'rolled-back' }); expect(f.activeCommands).toBe(0);
  });
  it.each(['commit', 'rollback', 'disconnect', 'transaction'] as const)('%s证据丢失保留unknown且原token不能再删除', async kind => {
    const { f, tasks } = fixture(); f.count = 3; const preview = await tasks.preview(request(f.source), 0);
    if (kind === 'commit') f.failCommit = true; if (kind === 'rollback') { f.failDelete = 2; f.failRollback = true; } if (kind === 'disconnect') f.breakDelete = 1; if (kind === 'transaction') f.loseTransaction = 1;
    await expect(tasks.apply(apply(preview), 0)).rejects.toThrow('未知'); expect(f.runs.at(-1)?.progress.outcome).toBe('unknown'); if (kind === 'transaction') expect(f.runs.at(-1)?.progress.transactionProtected).toBe(false); const count = f.commands.length; await expect(tasks.apply(apply(preview), 0)).rejects.toThrow(); expect(f.commands).toHaveLength(count); if (kind === 'commit') expect(f.commands.some(value => value.sql === 'ROLLBACK')).toBe(false);
  });
  it.each(['affected', 'warning', 'transaction', 'error'] as const)('零行写MDL的%s不可靠时不发送真实逐行删除', async kind => {
    const { f, tasks } = fixture(); f.count = 1; const preview = await tasks.preview(request(f.source), 0);
    if (kind === 'affected') f.guardAffected = 1; if (kind === 'warning') f.guardWarning = 1; if (kind === 'transaction') f.guardLoseTransaction = true; if (kind === 'error') f.failGuard = true;
    await expect(tasks.apply(apply(preview), 0)).rejects.toThrow(); expect(f.deleted).toBe(0); expect(f.commands.some(value => value.sql === 'COMMIT')).toBe(false);
  });
  it('COMMIT ACK先记账，但原命令end未到不能完成；晚取消/关闭失败不撤回已提交事实', async () => {
    const { f, tasks } = fixture(); f.count = 2; const preview = await tasks.preview(request(f.source), 0); f.holdEnd = 'COMMIT'; f.lateCloseFailure = true;
    let finished = false; const operation = tasks.apply(apply(preview), 0).then(result => { finished = true; return result; }); await vi.waitFor(() => expect(f.heldEnds).toHaveLength(1)); expect(finished).toBe(false); expect(f.activeCommands).toBe(1); expect(f.runs.at(-1)?.progress.commitAcknowledged).toBe(true);
    const closing = tasks.close(); f.cancelled = true; f.heldEnds.shift()!(); expect(await operation).toMatchObject({ operation: 'delete', rows: 2, commitAcknowledged: true }); await closing; expect(f.activeCommands).toBe(0);
  });
  it('预览严格关闭之前不发布能力，完成后release精确删除原spool', async () => {
    const { f, tasks } = fixture(); f.count = 1; let release!: () => void; f.beforeClose = () => new Promise<void>(resolve => { release = resolve; }); let finished = false;
    const operation = tasks.preview(request(f.source), 0).then(value => { finished = true; return value; }); await vi.waitFor(() => expect(release).toBeTypeOf('function')); expect(finished).toBe(false); release(); const value = await operation; await tasks.release({ connectionId: target.connectionId, previewToken: value.previewToken }); await expect(lstat(f.paths[0])).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('清理失败保留原文件和账本，COMMIT ACK不被清理错误改成可重放', async () => {
    const { f, tasks } = fixture(); f.count = 1; const preview = await tasks.preview(request(f.source), 0), original = TableFilteredDeleteSpool.prototype.dispose; let release!: () => void;
    const dispose = vi.spyOn(TableFilteredDeleteSpool.prototype, 'dispose').mockImplementationOnce(async function (this: TableFilteredDeleteSpool) { await new Promise<void>(resolve => { release = resolve; }); throw Error('本例删除快照清理失败'); }); let finished = false;
    const operation = tasks.apply(apply(preview), 0).then(value => { finished = true; return value; }); await vi.waitFor(() => expect(release).toBeTypeOf('function')); expect(finished).toBe(false); expect(f.activeRuns).toBe(1); release(); expect(await operation).toMatchObject({ commitAcknowledged: true }); expect((await lstat(f.paths[0])).isFile()).toBe(true); dispose.mockImplementation(original); await tasks.close(); await expect(lstat(f.paths[0])).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('十分钟从预览完成计，真正定时回收原文件', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); const { f, tasks } = fixture(); f.count = 1; const preview = await tasks.preview(request(f.source), 0); f.now += tableFilteredDeleteLimits.lifetimeMs; await vi.advanceTimersByTimeAsync(tableFilteredDeleteLimits.lifetimeMs); await vi.waitFor(async () => { await expect(lstat(f.paths[0])).rejects.toMatchObject({ code: 'ENOENT' }); }); await expect(tasks.apply(apply(preview), 0)).rejects.toThrow('预览');
  });
  it.each(['spool', 'ddl', 'timezone', 'dependency'] as const)('%s漂移在第一条真实行删除前拒绝', async kind => {
    const { f, tasks } = fixture(); f.count = 2; const preview = await tasks.preview(request(f.source), 0); if (kind === 'spool') await writeFile(f.paths[0], '改变原删除快照'); if (kind === 'ddl') f.source.ddl = f.source.ddl.replace('varchar(100)', 'varchar(101)'); if (kind === 'timezone') f.offset = '3600'; if (kind === 'dependency') f.dependencies = [{ databaseName: 'db', tableName: 'child', constraintName: 'fk', parentDatabase: 'db', parentTable: 'subject', onDelete: 'RESTRICT' }]; await expect(tasks.apply(apply(preview), 0)).rejects.toThrow(); expect(f.deleted).toBe(0);
  });
  it('TIMESTAMP原epoch与NULL完整一致才可编译DELETE，原字节及全部旧列参与定位', () => {
    const source = table(), row = { values: cells(1), timestampEpochs: ['1792845296.123456'] }, statement = tableFilteredDeleteStatement(source, row); expect(statement.sql).toMatch(/^DELETE FROM `db`.`subject` WHERE /); expect(statement.params.at(-1)).toBe('1792845296.123456'); expect(() => tableFilteredDeleteStatement(source, { ...row, timestampEpochs: [null] })).toThrow('TIMESTAMP'); expect(() => tableFilteredDeleteStatement(source, { ...row, timestampEpochs: ['1 OR 1'] })).toThrow('TIMESTAMP');
  });
  it.each(['confirm', 'revision', 'release', 'expiry', 'connection'] as const)('%s失效不建立执行连接；原能力独立且不跨连接释放', async kind => {
    const { f, tasks } = fixture(); f.count = 1; const preview = await tasks.preview(request(f.source), 0), runs = f.runs.length; if (kind === 'release') await tasks.release({ connectionId: target.connectionId, previewToken: preview.previewToken }); if (kind === 'expiry') f.now += tableFilteredDeleteLimits.lifetimeMs;
    await expect(tasks.apply(apply(preview, kind === 'confirm' ? { confirmation: 'db.subject / 删除 / 2' } : kind === 'connection' ? { connectionId: 'other' } : {}), kind === 'revision' ? 1 : 0)).rejects.toThrow(); expect(f.runs).toHaveLength(runs);
  });
  it('空匹配不能提交，两份预算含在途能力', async () => {
    const { f, tasks } = fixture(); f.count = 0; const empty = await tasks.preview(request(f.source), 0); expect(empty).toMatchObject({ rows: 0, shownRows: 0, sql: '' }); await expect(tasks.apply(apply(empty), 0)).rejects.toThrow(); const a = await tasks.preview(request(f.source), 0), b = await tasks.preview(request(f.source), 0); await expect(tasks.preview(request(f.source), 0)).rejects.toThrow('两份'); await tasks.release({ connectionId: target.connectionId, previewToken: a.previewToken }); await tasks.release({ connectionId: target.connectionId, previewToken: b.previewToken });
  });
  it.each(['key', 'engine', 'trigger', 'prefix-key', 'nullable-key'] as const)('%s不能保证可靠定位及整批回滚，扫描前拒绝', async kind => {
    const { f, tasks } = fixture(); if (kind === 'key') f.source.editableKey = []; if (kind === 'engine') f.source.engine = 'MyISAM'; if (kind === 'trigger') f.triggers = true; if (kind === 'prefix-key') f.source.ddl = f.source.ddl.replace('PRIMARY KEY (`id`)', 'UNIQUE KEY `prefix` (`id`(3))'); if (kind === 'nullable-key') f.source.columns[0].nullable = true; await expect(tasks.preview(request(f.source), 0)).rejects.toThrow(); expect(hooks.frames).not.toHaveBeenCalled(); expect(f.deleted).toBe(0);
  });
  it.each(['CASCADE', 'SET NULL', 'SET DEFAULT', 'unknown'])('反向%s可能越出快照，预览扫描前拒绝', async onDelete => {
    const { f, tasks } = fixture(); f.dependencies = [{ databaseName: 'other', tableName: 'child', constraintName: 'fk', parentDatabase: 'db', parentTable: 'subject', onDelete }]; await expect(tasks.preview(request(f.source), 0)).rejects.toThrow('外键'); expect(hooks.frames).not.toHaveBeenCalled(); expect(f.paths).toEqual([]);
  });
  it('正常RESTRICT可预览，原真实FK执行错误整批回滚；不借关闭外键检查绕过', async () => {
    const { f, tasks } = fixture(); f.count = 2; f.dependencies = [{ databaseName: 'other', tableName: 'child', constraintName: 'fk', parentDatabase: 'db', parentTable: 'subject', onDelete: 'RESTRICT' }]; const preview = await tasks.preview(request(f.source), 0); f.failDelete = 2; await expect(tasks.apply(apply(preview), 0)).rejects.toThrow(); expect(f.runs.at(-1)?.progress).toMatchObject({ rollbackAcknowledged: true, outcome: 'rolled-back' }); expect(f.commands.some(value => /(?:foreign_key_checks\s*=\s*0|LOCK TABLES)/i.test(value.sql))).toBe(false); expect(f.commands.filter(value=>value.sql==='SET SESSION foreign_key_checks=1')).toHaveLength(2);
  });
  it('删除过程中新增可见依赖也不能提交，原事务完整回滚', async () => {
    const { f, tasks } = fixture(); f.count = 2; const preview = await tasks.preview(request(f.source), 0); f.afterDelete = () => { f.dependencies = [{ databaseName: 'other', tableName: 'child', constraintName: 'late', parentDatabase: 'db', parentTable: 'subject', onDelete: 'RESTRICT' }]; }; await expect(tasks.apply(apply(preview), 0)).rejects.toThrow('变化'); expect(f.commands.some(value => value.sql === 'COMMIT')).toBe(false); expect(f.runs.at(-1)?.progress.rollbackAcknowledged).toBe(true);
  });
  it.each(['GRANT SELECT, TRIGGER ON `db`.* TO `offline`@`%`', 'GRANT `role` TO `offline`@`%`'])('局部或角色权限不能把隐藏反向FK当空目录：%s', async grant => {
    const { f, tasks } = fixture(); f.grants = [grant]; await expect(tasks.preview(request(f.source), 0)).rejects.toThrow(); expect(hooks.frames).not.toHaveBeenCalled(); expect(f.paths).toEqual([]);
  });
  it('直接全局SELECT证明可见性，部分REVOKE撤销证明；目录损坏或超预算拒绝', () => {
    const context = { dialect: 'mysql' as const, mode: { noBackslashEscapes: false, ansiQuotes: false } }; expect(tableFilteredDeleteGlobalVisibility(['GRANT SELECT ON *.* TO `offline`@`%`'], context)).toBe(true); expect(tableFilteredDeleteGlobalVisibility(['GRANT ALL PRIVILEGES ON *.* TO `offline`@`%`', 'REVOKE SELECT ON `hidden`.* FROM `offline`@`%`'], context)).toBe(false); expect(() => validateTableFilteredDeleteDependencies(Array(4097).fill({}), target)).toThrow('外键'); expect(() => validateTableFilteredDeleteDependencies([{ databaseName: 'db', tableName: 'child', constraintName: 'fk', parentDatabase: 'different', parentTable: 'subject', onDelete: 'RESTRICT' }], target)).toThrow('外键'); expect(tableFilteredDeleteDependenciesSql(target)).toContain('LIMIT 4097');
  });
});

// 删除与填充都可能读取真实GRANT；引用星号只代表字面名字，不能扩大跨库可见性。
describe('删除授权与实际会话外键检查',()=>{
  it.each(['\x60*\x60.*','*.\x60*\x60','\x60*\x60.\x60*\x60'])('引用星号%s不是全局SELECT',scope=>{expect(tableFilteredDeleteGlobalVisibility(['GRANT SELECT ON '+scope+' TO \x60u\x60@\x60%\x60'],{dialect:'mysql',mode:{noBackslashEscapes:false,ansiQuotes:false}})).toBe(false);});
  it('原连接继承FK_CHECKS=0时只恢复独立会话为1并确认，不能绕过RESTRICT',async()=>{const {f,tasks}=fixture();f.count=1;const p=await tasks.preview(request(f.source),0);await tasks.apply(apply(p),0);expect(f.commands.filter(v=>v.sql==='SET SESSION foreign_key_checks=1')).toHaveLength(2);expect(f.commands.some(v=>/SET GLOBAL|foreign_key_checks\s*=\s*0/i.test(v.sql))).toBe(false);});
  it.each(['set','read'] as const)('外键检查%s失败时零扫描和零DELETE',async kind=>{const {f,tasks}=fixture();if(kind==='set')f.failForeignKeySet=true;else f.foreignKeyReadOverride='0';await expect(tasks.preview(request(f.source),0)).rejects.toThrow();expect(hooks.frames).not.toHaveBeenCalled();expect(f.commands.some(v=>v.sql.startsWith('DELETE '))).toBe(false);});
});
