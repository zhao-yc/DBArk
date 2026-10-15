import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { TableIndexGetOutput, TableIndexPreviewOutput } from '../../src/shared/tableIndexTasks';
import type { ManagedConnection } from '../../src/engine/connection';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { validateCommand } from '../../src/shared/validation';
import type { StructureTaskContext, StructureTaskOptions } from '../../src/engine/structureDefinition';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'index-unit', name: '索引单元', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'test' };
const original = 'CREATE TABLE `t` (`id` int NOT NULL,`a` int DEFAULT NULL,`b` int DEFAULT NULL,PRIMARY KEY (`id`),KEY `ia` (`a`)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC';
let engine: Engine, events: TaskEvent[], source: string, afterSql: string, version: string, failSql: RegExp | undefined, holdSql: RegExp | undefined, closeFails: boolean;
let connections: ManagedConnection[], sent: { id: number; sql: string }[], nextId: number, headers: Record<string, unknown>[], parts: Record<string, unknown>[];
let held: { connection: ManagedConnection; complete(error?: Error): void } | undefined, warnings: number, generatedPrimaryKeys: number, pageSize: number, expressionConflict: boolean;
let catalogSrid: number, sridHeadersAvailable: boolean;
/** 只替换数据库驱动；实际 Engine、短会话状态机、目录交叉读取、计划与后核验均执行生产代码。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++nextId; let mode = '', quote = 0, charset = 'utf8mb4', collation = 'utf8mb4_general_ci', fk = 0, unique = 0, gipk = 0;
  const value = { connection, profile, signal, broken: false, status: { version, dialect: 'mysql', connectionId: threadId }, close: vi.fn(async () => { if (closeFails) throw new Error('真实关闭失败含私有文本'); }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push({ id: threadId, sql });
    const complete = (error?: Error): void => queueMicrotask(() => {
      if (error || failSql?.test(sql)) { callback(error ?? Object.assign(new Error('驱动拒绝含私有文本'), { errno: 1227, code: 'ER_SPECIFIC_ACCESS_DENIED_ERROR' })); return; }
      let rows: unknown = [];
      const document = () => parseTableColumnDefinition(source, { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } });
      if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@hostname')) rows = [{ sqlMode: mode, hostname: 'unit', port: 3306, serverId: 7, currentUser: 'test@host', connectionId: threadId }];
      else if (sql.startsWith('SET SESSION sql_mode')) mode = /'([^']*)'/.exec(sql)![1];
      else if (sql === 'SET SESSION sql_quote_show_create = 1') quote = 1;
      else if (sql.startsWith('SET NAMES')) { charset = 'utf8mb4'; collation = 'utf8mb4_bin'; }
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote')) rows = [{ sqlMode: mode, quoteShowCreate: quote, charset, collation }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid: 'unit' }];
      else if (sql.startsWith('SHOW CREATE TABLE')) rows = [{ Table: 't', 'Create Table': source }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name,')) rows = document().columns.map(column => ({ name: column.name, nullable: column.nullable === false ? 'NO' : 'YES', extra: '', charset: column.type.raw === 'text' ? 'utf8mb4' : null, collation: column.type.raw === 'text' ? 'utf8mb4_bin' : null }));
      else if (sql.startsWith('SET SESSION foreign_key_checks')) { fk = 1; unique = 1; }
      else if (sql.startsWith('SELECT @@SESSION.foreign_key_checks')) rows = [{ fkChecks: fk, uniqueChecks: unique }];
      else if (sql.startsWith('SET SESSION show_gipk')) gipk = 1;
      else if (sql.startsWith('SELECT @@SESSION.show_gipk')) rows = [{ showGipk: gipk, generateGipk: generatedPrimaryKeys }];
      else if (sql.startsWith('SELECT @@restrict_fk')) rows = [{ restrictForeignKeys: 1 }];
      else if (sql.startsWith('SELECT @@lower_case_table_names')) rows = [{ lowerCaseTableNames: 0, compileOs: 'Linux', pageSize }];
      else if (sql.startsWith('SELECT @@innodb_large_prefix')) rows = [{ largePrefix: 1 }];
      else if (sql.startsWith('SELECT ENGINE, ROW_FORMAT')) rows = [{ ENGINE: 'InnoDB', ROW_FORMAT: 'Dynamic' }];
      else if (sql.startsWith('SELECT COLUMN_NAME, DATA_TYPE')) rows = document().columns.map(column => ({ COLUMN_NAME: column.name, DATA_TYPE: column.type.raw, COLUMN_TYPE: column.type.raw, IS_NULLABLE: column.nullable === false ? 'NO' : 'YES', EXTRA: '', CHARACTER_SET_NAME: column.type.raw === 'text' ? 'utf8mb4' : null, COLLATION_NAME: column.type.raw === 'text' ? 'utf8mb4_bin' : null, CHARACTER_MAXIMUM_LENGTH: column.type.raw === 'text' ? '65535' : null, CHARACTER_OCTET_LENGTH: column.type.raw === 'text' ? '65535' : null, ...(sql.includes(', SRS_ID') ? { SRS_ID: column.type.raw === 'point' ? catalogSrid : null } : {}) }));
      else if (sql.startsWith('SELECT CHARACTER_SET_NAME, MAXLEN')) rows = [{ CHARACTER_SET_NAME: 'utf8mb4', MAXLEN: 4 }];
      else if (sql.includes("TABLE_NAME = 'COLUMNS' AND COLUMN_NAME = 'SRS_ID'")) rows = sridHeadersAvailable ? [{ COLUMN_NAME: 'SRS_ID' }] : [];
      else if (sql.startsWith("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema'")) rows = ['INDEX_NAME', 'COLUMN_NAME', 'SEQ_IN_INDEX', 'NON_UNIQUE', 'INDEX_TYPE', 'COLLATION', 'SUB_PART', 'INDEX_COMMENT', 'EXPRESSION', 'IS_VISIBLE'].map(COLUMN_NAME => ({ COLUMN_NAME }));
      else if (sql.startsWith('SELECT INDEX_NAME, COLUMN_NAME')) rows = readTableIndexDefinition(document()).indexes.flatMap(index => index.parts.map((part, position) => ({ INDEX_NAME: index.name, COLUMN_NAME: part.columnName, SEQ_IN_INDEX: position + 1, NON_UNIQUE: ['unique', 'primary'].includes(index.kind) ? 0 : 1, INDEX_TYPE: index.kind === 'spatial' ? 'SPATIAL' : index.kind === 'fulltext' ? 'FULLTEXT' : 'BTREE', COLLATION: index.kind === 'fulltext' ? null : part.direction === 'desc' ? 'D' : 'A', SUB_PART: index.kind === 'spatial' ? 32 : part.prefixLength ?? null, INDEX_COMMENT: index.comment, EXPRESSION: expressionConflict && index.name === 'ia' ? 'lower(a)' : null, IS_VISIBLE: 'YES' })));
      else if (sql.includes('FOREIGN_COLS')) rows = parts;
      else if (sql.includes('INNODB_')) rows = headers;
      else if (sql.includes('KEY_COLUMN_USAGE')) rows = [];
      else if (sql.includes('FROM information_schema.PARTITIONS')) rows = [{ PARTITION_NAME: null, PARTITION_METHOD: null, PARTITION_EXPRESSION: null, SUBPARTITION_METHOD: null, SUBPARTITION_EXPRESSION: null }];
      else if (sql.startsWith('ALTER TABLE')) { source = afterSql; rows = { affectedRows: 0, warningStatus: warnings }; }
      else if (sql === 'SHOW WARNINGS LIMIT 20') rows = [{ Code: 1071, Message: '服务器警告' }];
      else { callback(new Error('未定义的测试驱动 SQL：' + sql)); return; }
      callback(null, rows, []);
    });
    if (holdSql?.test(sql)) { held = { connection: value, complete }; return; } complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(value); return value;
}
async function get(revision = 1): Promise<TableIndexGetOutput> { return engine.handle('schema.indexes.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + nextId, connectionRevision: revision }); }
async function preview(snapshot: TableIndexGetOutput, patches?: unknown): Promise<TableIndexPreviewOutput> {
  return engine.handle('schema.indexes.preview', { snapshotId: snapshot.snapshotId, patches: patches ?? [{ op: 'alter', indexRef: snapshot.indexes.find(index => index.name === 'ia')!.indexRef, changes: { name: 'renamed' } }], taskId: 'preview-' + nextId, connectionRevision: 1 });
}
async function apply(value: TableIndexPreviewOutput, taskId = 'apply', acknowledgements = value.requiredAcknowledgements) { return engine.handle('schema.indexes.apply', { previewToken: value.previewToken, acknowledgements, taskId, connectionRevision: 1 }); }
beforeEach(async () => {
  source = original; afterSql = original.replace('`ia`', '`renamed`'); version = '8.4.11'; failSql = undefined; holdSql = undefined; closeFails = false;
  connections = []; sent = []; events = []; nextId = 0; headers = []; parts = []; held = undefined; warnings = 0; generatedPrimaryKeys = 0; pageSize = 16384; expressionConflict = false;
  catalogSrid = 0; sridHeadersAvailable = true;
  mocks.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal));
  mocks.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Object.assign(new Error('命令取消终态'), { errno: 1317 })); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => { closeFails = false; holdSql = undefined; held?.complete(new Error('单元收尾')); await engine.closeAll(); vi.restoreAllMocks(); });

describe.each(['fulltext', 'spatial'] as const)('真实Engine的%s专属生命周期（驱动替身）', kind => {
  /** 夹具仅指定原DDL和期望DDL，生产代码负责目录交叉、引用、预览及一次性执行。 */
  function fixture() {
    source = 'CREATE TABLE `t` (`id` int NOT NULL,`a` text,`g` point NOT NULL /*!80003 SRID 0 */,PRIMARY KEY (`id`)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC';
    const clause = kind === 'fulltext' ? 'FULLTEXT KEY `special` (`a`)' : 'SPATIAL KEY `special` (`g`)';
    afterSql = source.replace(') ENGINE=', `,${clause}) ENGINE=`);
  }
  async function addition() {
    const snapshot = await get(), column = snapshot.columns.find(c => c.name === (kind === 'fulltext' ? 'a' : 'g'))!;
    expect(column.specialIndexes?.[kind].allowed).toBe(true);
    const value = await preview(snapshot, [{ op: 'add', clientKey: 'new', definition: { name: 'special', kind, method: kind === 'fulltext' ? 'FULLTEXT' : 'RTREE', comment: '', keyParts: [{ columnRef: column.columnRef, direction: 'asc' }] } }]);
    expect(value.requiredAcknowledgements).toEqual(['ddl-implicit-commit', 'external-ddl-window', 'special-index-change']);
    expect(value.warnings.join('')).not.toContain('新增或重建唯一键'); return value;
  }
  it('只预览不投递，新增和删除各只发一条ALTER，公开定义完整后核验且不重放', async () => {
    fixture(); const initial = source, value = await addition(); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0);
    warnings = kind === 'fulltext' ? 1 : 0; expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    if (warnings) { const alter = sent.findIndex(item => item.sql.startsWith('ALTER')); expect(sent[alter + 1].sql).toBe('SHOW WARNINGS LIMIT 20'); }
    await expect(apply(value, 'replay')).rejects.toThrow('已失效或已使用');
    const next = await get(), old = next.indexes.find(index => index.name === 'special')!;
    expect(old).toMatchObject({ kind, access: { drop: { allowed: true }, rename: { allowed: false }, replace: { allowed: false } } });
    const deletion = await preview(next, [{ op: 'drop', indexRef: old.indexRef }]); expect(deletion.requiredAcknowledgements).not.toContain('drop-unique-constraint');
    afterSql = initial; expect(await apply(deletion, 'drop-special')).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(2); expect(connections.every(connection => vi.mocked(connection.close).mock.calls.length === 1)).toBe(true);
  });
  it('执行前源定义变化消费令牌且零DDL', async () => {
    fixture(); const value = await addition(); source = source.replace('ROW_FORMAT=DYNAMIC', 'ROW_FORMAT=DYNAMIC COMMENT=\'changed\'');
    await expect(apply(value)).rejects.toThrow('变化'); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0); await expect(apply(value, 'retry')).rejects.toThrow('已失效或已使用');
  });
  it('目录读取权限失败不投递DDL，服务器拒绝也不重试', async () => {
    fixture(); const value = await addition(); failSql = /^SELECT COLUMN_NAME, DATA_TYPE/;
    await expect(apply(value)).rejects.toThrow(); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0);
    failSql = undefined; const next = await addition(); failSql = /^ALTER TABLE/;
    await expect(apply(next, 'denied')).rejects.toMatchObject({ errno: 1227 }); await expect(apply(next, 'denied-retry')).rejects.toThrow('已失效或已使用');
    expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1); expect(events.at(-1)?.indexPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
  });
  it('取消已投递DDL等待真实收尾，状态未知且令牌不重放', async () => {
    fixture(); const initial = source, value = await addition(); holdSql = /^ALTER TABLE/;
    const pending = apply(value, 'special-cancel').catch(error => error); await vi.waitFor(() => expect(held).toBeDefined());
    await engine.handle('query.cancel', { taskId: 'special-cancel' }); expect(await pending).toBeInstanceOf(Error);
    expect(events.at(-1)).toMatchObject({ status: 'cancelled', indexPatch: { ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' } });
    expect(source).toBe(initial); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1); expect(connections.every(connection => vi.mocked(connection.close).mock.calls.length === 1)).toBe(true);
    await expect(apply(value, 'cancel-replay')).rejects.toThrow('已失效或已使用');
  });
  it('MySQL8 SRID目录变化不会因原DDL未变而放行', async () => {
    fixture(); const value = await addition(); catalogSrid = 4326;
    await expect(apply(value)).rejects.toThrow('变化'); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0);
  });
});

describe('真实索引生命周期的驱动边界', () => {
  it('原生改名只发一次 ALTER，不重述索引且完整后核验；准备连接均真实释放', async () => {
    const snapshot = await get(), value = await preview(snapshot); expect(snapshot.writable).toBe(true); expect(snapshot.indexes.find(index => index.name === 'ia')?.access.drop.allowed).toBe(true);
    expect(value.sql).toBe('ALTER TABLE `db`.`t` RENAME INDEX `ia` TO `renamed`;'); expect(value.requiredAcknowledgements).toEqual(['ddl-implicit-commit', 'external-ddl-window']);
    expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false); const result = await apply(value);
    expect(result).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true });
    expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1); expect(connections.every(connection => vi.mocked(connection.close).mock.calls.length === 1)).toBe(true);
    expect(events.at(-1)?.indexPatch).toMatchObject({ ddlCompleted: true, definitionVerified: true }); expect(events.every(event => !event.columnPatch)).toBe(true);
    await expect(apply(value, 'again')).rejects.toThrow('已失效或已使用');
  });
  it('新增复合键保留列序和 DESC，删除普通键也走同一计划与后核验', async () => {
    const snapshot = await get(), a = snapshot.columns.find(column => column.name === 'a')!, b = snapshot.columns.find(column => column.name === 'b')!;
    const value = await preview(snapshot, [{ op: 'add', clientKey: 'new', definition: { kind: 'ordinary', name: 'iba', method: 'BTREE', keyParts: [{ columnRef: b.columnRef, direction: 'desc' }, { columnRef: a.columnRef, direction: 'asc' }], comment: '复合' } }]);
    afterSql = original.replace(') ENGINE=', ',KEY `iba` (`b` DESC,`a`) COMMENT \'复合\') ENGINE=');
    expect(await apply(value)).toMatchObject({ definitionVerified: true });
    const next = await get(), drop = await preview(next, [{ op: 'drop', indexRef: next.indexes.find(index => index.name === 'ia')!.indexRef }]);
    afterSql = afterSql.replace(',KEY `ia` (`a`)', ''); expect(await apply(drop, 'drop')).toMatchObject({ definitionVerified: true });
  });
  it('仅在专用会话开启 FK/unique 检查及 GIPK 显示，不影响已有查询会话', async () => {
    const session = await engine.handle('sessions.open', { connectionId: profile.id }); const queryConnection = connections.at(-1)!;
    expect(session.sessionId).toBeTruthy(); await get();
    expect(sent.filter(item => item.id === queryConnection.connection.threadId)).toEqual([]);
    expect(sent.some(item => item.sql.startsWith('SET SESSION foreign_key_checks = 1, unique_checks = 1'))).toBe(true);
    expect(sent.some(item => item.sql.startsWith('SET SESSION show_gipk'))).toBe(true);
    expect(sent.every(item => !/SET GLOBAL|foreign_key_checks\s*=\s*0|unique_checks\s*=\s*0/.test(item.sql))).toBe(true);
    expect(queryConnection.close).not.toHaveBeenCalled();
  });
  it.each(['foreign', 'capability', 'gipk', 'revision'] as const)('%s 变化在一次性执行前拒绝且不发送 ALTER', async kind => {
    const snapshot = await get(), value = await preview(snapshot);
    if (kind === 'foreign') { headers = [{ ID: 'other/fk', FOR_NAME: 'other/child', REF_NAME: 'db/t', N_COLS: 1, TYPE: 0 }]; parts = [{ ID: 'other/fk', FOR_COL_NAME: 'pid', REF_COL_NAME: 'id', POS: 1 }]; }
    if (kind === 'capability') pageSize = 8192; if (kind === 'gipk') generatedPrimaryKeys = 1;
    const action = kind === 'revision' ? engine.handle('schema.indexes.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements, taskId: 'changed', connectionRevision: 2 }) : apply(value);
    await expect(action).rejects.toThrow('变化'); expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false); await expect(apply(value, 'again')).rejects.toThrow('已失效或已使用');
  });
  it.each([['extra'], ['ddl-implicit-commit'], ['ddl-implicit-commit', 'external-ddl-window', 'external-ddl-window']].map(acks => ({ acks })))('确认集合不精确时消费令牌，不建立执行连接：$acks', async ({ acks }) => {
    const value = await preview(await get()), count = connections.length;
    await expect(apply(value, 'invalid', acks)).rejects.toThrow('确认项'); expect(connections).toHaveLength(count); await expect(apply(value, 'again')).rejects.toThrow('已失效或已使用');
  });
  it('IPC 拒绝客户端 SQL、连接修订、伪引用目标以及未知确认项', () => {
    expect(() => validateCommand('schema.indexes.preview', { snapshotId: 'x', taskId: 't', patches: [], sql: 'DROP DATABASE x' })).toThrow();
    expect(() => validateCommand('schema.indexes.get', { connectionId: 'x', database: 'db', table: 't', taskId: 't', connectionRevision: 2 })).toThrow();
    expect(() => validateCommand('schema.indexes.apply', { previewToken: 'x', acknowledgements: ['unknown'], taskId: 't' })).toThrow();
  });
  it('目录权限不足保留 partial，不把空列表当无依赖；普通改名仍允许', async () => {
    failSql = /FROM information_schema.INNODB_FOREIGN /; const snapshot = await get();
    expect(snapshot.incomingCoverage).toEqual({ kind: 'partial', reason: 'permission' }); expect(snapshot.indexes.find(index => index.name === 'ia')!.access.drop.allowed).toBe(false);
    const value = await preview(snapshot); expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: true });
  });
  it('未证版本提供只读定义且不能建立预览执行连接', async () => {
    version = '8.4.99'; const snapshot = await get(); expect(snapshot.writable).toBe(false); expect(snapshot.capabilities).toBeUndefined(); const count = connections.length;
    await expect(preview(snapshot)).rejects.toThrow('仅可查看'); expect(connections).toHaveLength(count);
  });
  it('目录 EXPRESSSION 与普通原定义矛盾时不能证明 generated=false 或改旧键', async () => {
    expressionConflict = true; const snapshot = await get(), value = snapshot.indexes.find(index => index.name === 'ia')!;
    expect(value.unsupportedReasons.join('')).toContain('生成'); expect(value.access).toMatchObject({ drop: { allowed: false }, rename: { allowed: false }, replace: { allowed: false } });
    await expect(preview(snapshot)).rejects.toThrow('只读'); expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
  });
  it('DDL OK 后诊断立即读取；服务器自动删其他旧键时保持完成但未核验', async () => {
    const value = await preview(await get()); warnings = 1; afterSql = afterSql.replace(',PRIMARY KEY (`id`)', '');
    const result = await apply(value), ddl = sent.findIndex(item => item.sql.startsWith('ALTER TABLE'));
    expect(sent[ddl + 1].sql).toBe('SHOW WARNINGS LIMIT 20'); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(result.warnings.join('')).toContain('1071');
    expect(events.at(-1)?.indexPatch?.ddlCompleted).toBe(true); expect(sent.filter(item => item.sql.startsWith('ALTER TABLE'))).toHaveLength(1);
  });
  it('警告读取失败仍核验实际定义，不能抹去 DDL 已完成或重放', async () => {
    const value = await preview(await get()); failSql = /^SHOW WARNINGS/; warnings = 1;
    const result = await apply(value); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true }); expect(result.warnings.join('')).toContain('读取失败');
    expect(sent.filter(item => item.sql.startsWith('ALTER TABLE'))).toHaveLength(1);
  });
  it('网络释放失败保留已完成事件证据，一次性预览不能重试', async () => {
    const value = await preview(await get()); closeFails = true;
    await expect(apply(value)).rejects.toThrow('关闭失败');
    expect(events.at(-1)).toMatchObject({ status: 'failed', indexPatch: { ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' } });
    expect(events.at(-1)?.message).not.toContain('私有文本'); closeFails = false;
    await expect(apply(value, 'again')).rejects.toThrow('已失效或已使用'); expect(sent.filter(item => item.sql.startsWith('ALTER TABLE'))).toHaveLength(1);
  });
  it('释放与关闭使索引令牌失效，不能误释放字段用途', async () => {
    const index = await get(), column = await engine.handle('schema.columns.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'column', connectionRevision: 1 });
    await engine.handle('schema.indexes.release', { snapshotId: column.snapshotId }); const value = await preview(index);
    await engine.handle('schema.columns.preview', { snapshotId: column.snapshotId, patches: [{ kind: 'alter', columnRef: column.columns[1].columnRef, changes: { comment: '字段' } }], taskId: 'column-preview', connectionRevision: 1 });
    await engine.handle('connections.close', { id: profile.id }); const count = connections.length;
    await expect(apply(value)).rejects.toThrow('已失效或已使用'); expect(connections).toHaveLength(count);
  });
  it('同表字段与索引执行互斥，冲突的已消费令牌不能稍后重试', async () => {
    const index = await preview(await get()), column = await engine.handle('schema.columns.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'col-get', connectionRevision: 1 });
    const other = await engine.handle('schema.columns.preview', { snapshotId: column.snapshotId, patches: [{ kind: 'alter', columnRef: column.columns[1].columnRef, changes: { comment: '字段' } }], taskId: 'col-preview', connectionRevision: 1 });
    holdSql = /^ALTER TABLE/; const running = apply(index, 'held'); await vi.waitFor(() => expect(held).toBeDefined());
    const second = () => engine.handle('schema.columns.apply', { previewToken: other.previewToken, acknowledgements: other.requiredAcknowledgements, taskId: 'second', connectionRevision: 1 });
    await expect(second()).rejects.toThrow('已有结构变更'); await expect(second()).rejects.toThrow('已失效或已使用');
    held!.complete(); expect(await running).toMatchObject({ definitionVerified: true }); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('关联父表占用覆盖真实关闭阶段，冲突任务不建连接且无部分占用', async () => {
    const host = engine as unknown as { withIndependentTask<T>(connectionId: string, taskId: string, action: (managed: ManagedConnection, control: Omit<StructureTaskContext, 'managed'>) => Promise<T>, options: StructureTaskOptions): Promise<T> };
    const target = { database: 'db', table: 't' }, parent = { database: 'other', table: 'p' };
    const options = (targets: typeof target[]): StructureTaskOptions => ({ label: '关联结构测试', purpose: 'indexes', executionTargets: targets, progress: { phase: 'reading', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' } });
    let allowAction!: () => void, allowClose!: () => void, closeStarted = false;
    const actionGate = new Promise<void>(resolve => { allowAction = resolve; }), closeGate = new Promise<void>(resolve => { allowClose = resolve; });
    const initialConnections = connections.length;
    const running = host.withIndependentTask(profile.id, 'related-held', async () => { await actionGate; return 42; }, options([target, parent]));
    try {
      await vi.waitFor(() => expect(connections).toHaveLength(initialConnections + 1));
      vi.mocked(connections.at(-1)!.close).mockImplementation(async () => { closeStarted = true; await closeGate; });
      allowAction(); await vi.waitFor(() => expect(closeStarted).toBe(true));
      await expect(host.withIndependentTask(profile.id, 'parent-conflict', async () => 0, options([{ database: 'db', table: 'unrelated' }, parent]))).rejects.toThrow('未发送 DDL');
      expect(connections).toHaveLength(initialConnections + 1);
      expect(await host.withIndependentTask(profile.id, 'unrelated-allowed', async () => 7, options([{ database: 'db', table: 'unrelated' }]))).toBe(7);
    } finally { allowAction(); allowClose(); }
    expect(await running).toBe(42);
    expect(await host.withIndependentTask(profile.id, 'parent-after-close', async () => 8, options([parent]))).toBe(8);
  });
  it('长命令取消等待原回调及连接关闭，终态标记未知且不会转为字段任务', async () => {
    const value = await preview(await get()); holdSql = /^ALTER TABLE/; const operation = apply(value, 'cancel-index'), settled = operation.catch(error => error); await vi.waitFor(() => expect(held).toBeDefined());
    await engine.handle('query.cancel', { taskId: 'cancel-index' }); expect(await settled).toBeInstanceOf(Error);
    expect(events.at(-1)).toMatchObject({ taskId: 'cancel-index', status: 'cancelled', indexPatch: { ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' } });
    expect(connections.every(connection => vi.mocked(connection.close).mock.calls.length === 1)).toBe(true); expect(source).toBe(original);
  });
  it('释放进度事件出口异常不能跳过关闭或留下关联目标占用', async () => {
    const host = engine as unknown as { withIndependentTask<T>(connectionId: string, taskId: string, action: (managed: ManagedConnection, control: Omit<StructureTaskContext, 'managed'>) => Promise<T>, options: StructureTaskOptions): Promise<T> };
    const append = events.push.bind(events); let rejectOnce = true;
    vi.spyOn(events, 'push').mockImplementation((...items) => {
      if (rejectOnce && items.some(item => item.indexPatch?.phase === 'releasing')) { rejectOnce = false; throw new Error('测试事件出口失败'); }
      return append(...items);
    });
    const options = (): StructureTaskOptions => ({ label: '异常收尾测试', purpose: 'indexes', executionTargets: [{ database: 'db', table: 't' }, { database: 'db', table: 'p' }], progress: { phase: 'reading', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' } });
    await expect(host.withIndependentTask(profile.id, 'event-error', async () => 1, options())).rejects.toThrow('事件出口失败');
    expect(connections.at(-1)!.close).toHaveBeenCalledOnce();
    expect(await host.withIndependentTask(profile.id, 'after-event-error', async () => 2, options())).toBe(2);
  });
});
