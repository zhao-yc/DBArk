import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { TableIndexGetOutput, TableIndexPreviewOutput } from '../../src/shared/tableIndexTasks';
import type { ManagedConnection } from '../../src/engine/connection';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { validateCommand } from '../../src/shared/validation';
import type { StructureTaskContext, StructureTaskOptions } from '../../src/engine/structureDefinition';
import type { IndexColumnMetadata } from '../../src/engine/tableIndexMetadata';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
import { Engine } from '../../src/engine/index';
import { TableIndexPatchTasks } from '../../src/engine/tableIndexPatchTasks';

const profile: ConnectionProfile = { id: 'index-unit', name: '索引单元', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'test' };
const original = 'CREATE TABLE `t` (`id` int NOT NULL,`a` int DEFAULT NULL,`b` int DEFAULT NULL,PRIMARY KEY (`id`),KEY `ia` (`a`)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC';
let engine: Engine, events: TaskEvent[], source: string, afterSql: string, version: string, failSql: RegExp | undefined, holdSql: RegExp | undefined, closeFails: boolean;
let injectedUnknownClose = false;
let connections: ManagedConnection[], sent: { id: number; sql: string }[], nextId: number, headers: Record<string, unknown>[], parts: Record<string, unknown>[];
let held: { connection: ManagedConnection; complete(error?: Error): void } | undefined, warnings: number, generatedPrimaryKeys: number, pageSize: number, expressionConflict: boolean;
let catalogSrid: number, sridHeadersAvailable: boolean;
let nativeTableId: string, nativeIndexId: string, optimizerStatsPatch: Record<string, unknown> | undefined, afterDdl: (() => void) | undefined;
let fixedColumnMetadata: Map<string, IndexColumnMetadata>;
/** 只替换数据库驱动；实际 Engine、短会话状态机、目录交叉读取、计划与后核验均执行生产代码。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++nextId; let mode = '', quote = 0, charset = 'utf8mb4', collation = 'utf8mb4_general_ci', fk = 0, unique = 0, gipk = 0;
  const value = { connection, profile, signal, broken: false, status: { version, dialect: 'mysql', connectionId: threadId }, close: vi.fn(async () => { if (closeFails) { injectedUnknownClose = true; throw new Error('真实关闭失败含私有文本'); } }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push({ id: threadId, sql });
    const complete = (error?: Error): void => queueMicrotask(() => {
      if (error || failSql?.test(sql)) { callback(error ?? Object.assign(new Error('驱动拒绝含私有文本'), { errno: 1227, code: 'ER_SPECIFIC_ACCESS_DENIED_ERROR' })); return; }
      // 原生表/索引角色独立固定，绝不由产品计划或后核结果反推。
      if (sql.startsWith('SELECT CAST(TABLE_ID AS CHAR) AS id, NAME AS name FROM information_schema.INNODB_TABLES')) { callback(null, [{ id: nativeTableId, name: 'db/t' }], []); return; }
      let rows: unknown = [];
      const document = () => parseTableColumnDefinition(source, { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } });
      if (sql === 'SELECT VERSION() AS version, @@version_compile_os AS os, @@lower_case_table_names AS lowerNames LIMIT 2') rows = [{ version, os: 'Linux', lowerNames: 0 }];
      else if (sql.startsWith('SELECT TABLE_SCHEMA AS databaseName, TABLE_NAME AS tableName, TABLE_TYPE AS kind, ENGINE AS engine FROM information_schema.TABLES')) rows = [{ databaseName: 'db', tableName: 't', kind: 'BASE TABLE', engine: 'InnoDB' }];
      else if (sql.startsWith('SELECT PARTITION_NAME AS name FROM information_schema.PARTITIONS')) rows = [{ name: null }];
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@hostname')) rows = [{ sqlMode: mode, hostname: 'unit', port: 3306, serverId: 7, currentUser: 'test@host', connectionId: threadId }];
      else if (sql.startsWith('SET SESSION sql_mode')) mode = /'([^']*)'/.exec(sql)![1];
      else if (sql === 'SET SESSION sql_quote_show_create = 1') quote = 1;
      else if (sql.startsWith('SET NAMES')) { charset = 'utf8mb4'; collation = 'utf8mb4_bin'; }
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote')) rows = [{ sqlMode: mode, quoteShowCreate: quote, charset, collation }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid: 'unit' }];
      else if (sql.startsWith('SHOW CREATE TABLE')) rows = [{ Table: 't', 'Create Table': source }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name,')) rows = document().columns.map(column => { const fixed = fixedColumnMetadata.get(column.name); return { name: column.name, nullable: column.nullable === false ? 'NO' : 'YES', extra: '', charset: fixed ? fixed.CHARACTER_SET_NAME : column.type.raw === 'text' ? 'utf8mb4' : null, collation: fixed ? fixed.COLLATION_NAME : column.type.raw === 'text' ? 'utf8mb4_bin' : null }; });
      else if (sql.startsWith('SET SESSION foreign_key_checks')) { fk = 1; unique = 1; }
      else if (sql.startsWith('SELECT @@SESSION.foreign_key_checks')) rows = [{ fkChecks: fk, uniqueChecks: unique }];
      else if (sql.startsWith('SET SESSION show_gipk')) gipk = 1;
      else if (sql.startsWith('SELECT @@SESSION.show_gipk')) rows = [{ showGipk: gipk, generateGipk: generatedPrimaryKeys }];
      else if (sql.startsWith('SELECT @@restrict_fk')) rows = [{ restrictForeignKeys: 1 }];
      else if (sql.startsWith('SELECT @@lower_case_table_names')) rows = [{ lowerCaseTableNames: 0, compileOs: 'Linux', pageSize }];
      else if (sql.startsWith('SELECT @@innodb_large_prefix')) rows = [{ largePrefix: 1 }];
      else if (sql.startsWith('SELECT ENGINE, ROW_FORMAT')) rows = [{ ENGINE: 'InnoDB', ROW_FORMAT: 'Dynamic' }];
      else if (sql.startsWith('SELECT COLUMN_NAME, DATA_TYPE')) rows = document().columns.map(column => fixedColumnMetadata.get(column.name) ?? ({ COLUMN_NAME: column.name, DATA_TYPE: column.type.raw, COLUMN_TYPE: column.type.raw, IS_NULLABLE: column.nullable === false ? 'NO' : 'YES', EXTRA: '', CHARACTER_SET_NAME: column.type.raw === 'text' ? 'utf8mb4' : null, COLLATION_NAME: column.type.raw === 'text' ? 'utf8mb4_bin' : null, CHARACTER_MAXIMUM_LENGTH: column.type.raw === 'text' ? '65535' : null, CHARACTER_OCTET_LENGTH: column.type.raw === 'text' ? '65535' : null, ...(sql.includes(', SRS_ID') ? { SRS_ID: column.type.raw === 'point' ? catalogSrid : null } : {}) }));
      else if (sql.startsWith('SELECT CHARACTER_SET_NAME, MAXLEN')) rows = [{ CHARACTER_SET_NAME: 'utf8mb4', MAXLEN: 4 }];
      else if (sql.includes("TABLE_NAME = 'COLUMNS' AND COLUMN_NAME = 'SRS_ID'")) rows = sridHeadersAvailable ? [{ COLUMN_NAME: 'SRS_ID' }] : [];
      else if (sql.startsWith("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema'")) rows = ['INDEX_NAME', 'COLUMN_NAME', 'SEQ_IN_INDEX', 'NON_UNIQUE', 'INDEX_TYPE', 'COLLATION', 'SUB_PART', 'INDEX_COMMENT', 'EXPRESSION', 'IS_VISIBLE'].map(COLUMN_NAME => ({ COLUMN_NAME }));
      else if (sql.startsWith('SELECT INDEX_NAME, COLUMN_NAME')) rows = readTableIndexDefinition(document()).indexes.flatMap(index => index.parts.map((part, position) => ({ INDEX_NAME: index.name, COLUMN_NAME: part.columnName, SEQ_IN_INDEX: position + 1, NON_UNIQUE: ['unique', 'primary'].includes(index.kind) ? 0 : 1, INDEX_TYPE: index.kind === 'spatial' ? 'SPATIAL' : index.kind === 'fulltext' ? 'FULLTEXT' : 'BTREE', COLLATION: index.kind === 'fulltext' ? null : part.direction === 'desc' ? 'D' : 'A', SUB_PART: index.kind === 'spatial' ? 32 : part.prefixLength ?? null, INDEX_COMMENT: index.comment, EXPRESSION: expressionConflict && index.name === 'ia' ? 'lower(a)' : null, IS_VISIBLE: index.rawSql.includes('/*!80000 INVISIBLE */') ? 'NO' : 'YES', ...(sql.includes('WHERE CAST(TABLE_SCHEMA AS BINARY)') && index.name === 'ia' ? optimizerStatsPatch : {}) })));
      else if (sql.startsWith('SELECT NAME AS name, CAST(INDEX_ID AS CHAR)')) rows = [{ name: 'PRIMARY', id: '1000', type: '3', fields: '1' }, { name: 'ia', id: nativeIndexId, type: '0', fields: '1' }];
      else if (sql === 'SHOW GRANTS') rows = [{ grant: 'GRANT ALL PRIVILEGES ON *.* TO `ram`@`host`' }];
      else if (sql.includes('FOREIGN_COLS')) rows = parts;
      else if (sql.includes('INNODB_')) rows = headers;
      else if (sql.includes('KEY_COLUMN_USAGE')) rows = [];
      else if (sql.includes('FROM information_schema.PARTITIONS')) rows = [{ PARTITION_NAME: null, PARTITION_METHOD: null, PARTITION_EXPRESSION: null, SUBPARTITION_METHOD: null, SUBPARTITION_EXPRESSION: null }];
      else if (sql.startsWith('ALTER TABLE')) { source = afterSql; afterDdl?.(); rows = { affectedRows: 0, warningStatus: warnings }; }
      else if (sql === 'SHOW WARNINGS LIMIT 20') rows = [{ Code: 1071, Message: '服务器警告' }];
      else { callback(new Error('未定义的测试驱动 SQL：' + sql)); return; }
      callback(null, rows, []);
    });
    if (holdSql?.test(sql)) { held = { connection: value, complete }; return; } complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(value); return value;
}
async function get(revision = 1, includeOptimizerFacts = true): Promise<TableIndexGetOutput> { return engine.handle('schema.indexes.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + nextId, connectionRevision: revision, includeOptimizerFacts }); }
async function preview(snapshot: TableIndexGetOutput, patches?: unknown): Promise<TableIndexPreviewOutput> {
  return engine.handle('schema.indexes.preview', { snapshotId: snapshot.snapshotId, patches: patches ?? [{ op: 'alter', indexRef: snapshot.indexes.find(index => index.name === 'ia')!.indexRef, changes: { optimizerVisible: !snapshot.indexes.find(index => index.name === 'ia')!.optimizer!.visible } }], taskId: 'preview-' + nextId, connectionRevision: 1 });
}
async function apply(value: TableIndexPreviewOutput, taskId = 'apply', acknowledgements = value.requiredAcknowledgements) { return engine.handle('schema.indexes.apply', { previewToken: value.previewToken, acknowledgements, taskId, connectionRevision: 1 }); }
beforeEach(async () => {
  injectedUnknownClose = false; nativeTableId = '100'; nativeIndexId = '1001'; optimizerStatsPatch = undefined; afterDdl = undefined;
  source = original; afterSql = original.replace('KEY `ia` (`a`)', 'KEY `ia` (`a`) /*!80000 INVISIBLE */'); version = '8.4.11'; failSql = undefined; holdSql = undefined; closeFails = false;
  connections = []; sent = []; events = []; nextId = 0; headers = []; parts = []; held = undefined; warnings = 0; generatedPrimaryKeys = 0; pageSize = 16384; expressionConflict = false;
  catalogSrid = 0; sridHeadersAvailable = true; fixedColumnMetadata = new Map();
  mocks.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal));
  mocks.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Object.assign(new Error('命令取消终态'), { errno: 1317 })); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => {
  closeFails = false; holdSql = undefined; held?.complete(new Error('单元收尾'));
  // 无资源证明的旧RAM端口在注入关闭未知后，退出也必须承认仍未释放。
  if (injectedUnknownClose) await expect(engine.closeAll()).rejects.toThrow('资源未确认释放'); else await engine.closeAll();
  vi.restoreAllMocks();
});

describe('索引优化器真实Engine原驱动协议（仅替connect/execute）', () => {
  it('optin省略不发新物理查询；打开后原生隐藏/恢复、旧权限保持、零预览DDL', async () => {
    const legacy = await get(1, false); expect(legacy.indexes.find(index => index.name === 'ia')!.optimizer).toBeUndefined();
    expect(sent.some(item => item.sql.startsWith('SELECT NAME AS name, CAST(INDEX_ID'))).toBe(false);
    const first = await get(), value = await preview(first);
    expect(first.indexes.find(index => index.name === 'ia')!.optimizer).toEqual({ visible: true, access: { allowed: true, reasons: [] } });
    expect(value.requiredAcknowledgements).toEqual(['ddl-implicit-commit','external-ddl-window','index-optimizer-change']);
    expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
    const result = await apply(value); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    const hidden = await get(), target = hidden.indexes.find(index => index.name === 'ia')!;
    expect(target.access.drop.allowed).toBe(false); expect(target.optimizer).toEqual({ visible: false, access: { allowed: true, reasons: [] } });
    afterSql = original; expect(await apply(await preview(hidden), 'restore')).toMatchObject({ definitionVerified: true });
    expect(source).toBe(original); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(2);
    expect(connections.every(connection => vi.mocked(connection.close).mock.calls.length === 1)).toBe(true);
  });
  it.each([{ IS_VISIBLE: 'MAYBE' }, { IS_VISIBLE: 'NO' }, { EXPRESSION: 'a+1' }, { SEQ_IN_INDEX: 2 }, { NON_UNIQUE: 0 }, { INDEX_COMMENT: '矛盾' }, { COLLATION: 'D' }])('第二份真实STATISTICS矛盾%j不给新用途资格', async bad => {
    optimizerStatsPatch = bad; const snapshot = await get(); expect(snapshot.indexes.find(index => index.name === 'ia')!.optimizer?.access.allowed).toBe(false);
    await expect(preview(snapshot)).rejects.toThrow(); expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
  });
  it('原生表或索引实体改变会拒发且消费预览', async () => {
    const value = await preview(await get()); nativeIndexId = '9999'; await expect(apply(value)).rejects.toThrow('变化'); await expect(apply(value, 'again')).rejects.toThrow('已使用');
    expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
  });
  it('同快照多预览在首次发送时一起失效，已发未知不重放', async () => {
    const snapshot = await get(), first = await preview(snapshot), second = await preview(snapshot); holdSql = /^ALTER TABLE/;
    const operation = apply(first), rejected = expect(operation).rejects.toThrow(); await vi.waitFor(() => expect(held).toBeDefined());
    await engine.handle('query.cancel', { taskId: 'apply' }); await rejected;
    await expect(apply(second, 'replay')).rejects.toThrow('已使用'); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1);
    expect(events.at(-1)?.indexPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
  });
  it('成功ACK后取消后核保持完成且未核验，原线程关闭后才回包', async () => {
    const value = await preview(await get()); afterDdl = () => { holdSql = /^SET SESSION foreign_key_checks/; };
    const operation = apply(value); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId: 'apply' });
    expect(await operation).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    expect(connections.every(connection => vi.mocked(connection.close).mock.calls.length === 1)).toBe(true);
  });
  it.each(['index-id', 'warning'])('DDL后%s不能完整核验', async reason => {
    const value = await preview(await get()); if (reason === 'index-id') afterDdl = () => { nativeIndexId = '9999'; }; else warnings = 1;
    expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    const index = sent.findIndex(item => item.sql.startsWith('ALTER')); if (reason === 'warning') expect(sent[index + 1].sql).toBe('SHOW WARNINGS LIMIT 20');
  });
  it('释放、修订变化及缺确认均拒发', async () => {
    const snapshot = await get(), value = await preview(snapshot); await expect(apply(value, 'ack', ['ddl-implicit-commit','external-ddl-window'])).rejects.toThrow('确认');
    await expect(apply(value, 'used')).rejects.toThrow('已使用');
    const other = await preview(snapshot); await engine.handle('schema.indexes.release', { snapshotId: snapshot.snapshotId }); await expect(apply(other, 'released')).rejects.toThrow('失效');
    const next = await get(); await expect(engine.handle('schema.indexes.preview', { snapshotId: next.snapshotId, patches: [{ op:'alter',indexRef:next.indexes[1].indexRef,changes:{optimizerVisible:false} }], taskId:'revision', connectionRevision:2 })).rejects.toThrow('配置');
    expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
  });
  it('严格关闭未知时不发布，即使DDL和后核均完成', async () => {
    const value = await preview(await get()); closeFails = true; await expect(apply(value)).rejects.toThrow('关闭');
  });
  it('get等待原host关闭时release使迟到快照永久失效', async () => {
    let finish!: () => void, returned!: () => void;
    const inAction = new Promise<void>(resolve => { returned = resolve; }), closed = new Promise<void>(resolve => { finish = resolve; });
    const context = { managed: managed(), checkCancelled() {}, report() {}, commandStarted: () => () => {} };
    const tasks = new TableIndexPatchTasks({ run: async (_connection, _task, action) => { const result = await action(context); returned(); await closed; return result; } });
    const pending = tasks.get({ connectionId: profile.id, database:'db', table:'t', taskId:'pending', includeOptimizerFacts:true },1), rejected = expect(pending).rejects.toThrow('未发布');
    await inAction; tasks.release(profile.id); finish(); await rejected;
    await context.managed.close();
  });
  it('自然TTL到期拒绝预览，不伪造墙钟或放宽两分钟合同', async () => {
    let now = 1000;
    const tasks = new TableIndexPatchTasks({ run: async (_connection, _task, action) => { const context = { managed: managed(), checkCancelled() {}, report() {}, commandStarted: () => () => {} }; try { return await action(context); } finally { await context.managed.close({strict:true}); } } }, () => now);
    const snapshot = await tasks.get({connectionId:profile.id,database:'db',table:'t',taskId:'clock',includeOptimizerFacts:true},1);
    now += 120001;
    await expect(tasks.preview({snapshotId:snapshot.snapshotId,taskId:'expired',patches:[{op:'alter',indexRef:snapshot.indexes.find(index=>index.name==='ia')!.indexRef,changes:{optimizerVisible:false}}]},1)).rejects.toThrow('失效');
    expect(sent.some(item=>item.sql.startsWith('ALTER'))).toBe(false);
  });
});
