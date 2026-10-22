import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TableColumnGetOutput, TableColumnPreviewOutput, TableColumnApplyOutput } from '../../src/shared/tableColumnPatches';
import type { IndexStructureRead, IndexReferenceNames } from '../../src/engine/tableIndexRead';
import type { TrustedIndexColumn, TrustedIndexDefinition } from '../../src/shared/tableIndexPatches';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';

const seam = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), indexes: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: seam.connect, execute: seam.execute }));
// 本文件明确替换索引目录准备端口；该端口真实完整目录由既有index专项及实库另验，绝不冒称仅mock网络。
vi.mock('../../src/engine/tableIndexRead', async () => ({ ...await vi.importActual<any>('../../src/engine/tableIndexRead'), readIndexStructure: seam.indexes }));
vi.mock('../../src/engine/tableColumnCollationTaskRead', async () => ({ ...await vi.importActual<any>('../../src/engine/tableColumnCollationTaskRead'), readColumnCollationTaskFacts: async () => ({ kind: 'unavailable', reason: '无关列编码能力未注入本专项' }) }));
import { readStructureDefinition, type StructureTaskContext } from '../../src/engine/structureDefinition';
import { Engine } from '../../src/engine/index';

const profile: ConnectionProfile = { id: 'column-auto-ram', name: '列自增RAM', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 3306, user: 'ram' };
const original = "CREATE TABLE t(id bigint NOT NULL COMMENT '保留',k int NOT NULL,v decimal(30,6) DEFAULT NULL,PRIMARY KEY(k),KEY idx_id_k(id,k)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
const enabled = original.replace('bigint NOT NULL', 'bigint NOT NULL AUTO_INCREMENT').replace('ENGINE=InnoDB', 'ENGINE=InnoDB AUTO_INCREMENT=9007199254740994');
/** 完整COLUMNS与源文本各自固定，不按产品计划器反推一份必然成功的响应。 */
function catalog(auto: boolean) { return [
  { name: 'id', ordinal: 1, typeSql: 'bigint', dataType: 'bigint', nullable: 'NO', defaultValue: null, extra: auto ? 'auto_increment' : '', generationExpression: '', charset: null, collation: null, comment: '保留' },
  { name: 'k', ordinal: 2, typeSql: 'int', dataType: 'int', nullable: 'NO', defaultValue: null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' },
  { name: 'v', ordinal: 3, typeSql: 'decimal(30,6)', dataType: 'decimal', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' },
  ...(unrelatedStorage ? [
    { name: 'a', ordinal: 4, typeSql: 'char(5)', dataType: 'char', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: 'utf8mb4', collation: 'utf8mb4_general_ci', comment: '' },
    { name: 'g', ordinal: 5, typeSql: 'varchar(5)', dataType: 'varchar', nullable: 'YES', defaultValue: null, extra: unrelatedStorage + ' GENERATED', generationExpression: '`a`', charset: 'utf8mb4', collation: 'utf8mb4_general_ci', comment: '' },
  ] : []),
]; }
let engine: Engine, events: TaskEvent[], sent: { thread: number; sql: string }[], connections: ManagedConnection[], next: number;
let source: string, afterSource: string, auto: boolean, tableId: string, afterId: string, originalMode: string, version: string, dialect: 'mysql' | 'mariadb';
let patch: Record<string, unknown> | undefined, readbackDropsStrict: boolean, warnings: number | undefined, failClose: boolean, unknownClose: boolean, hold: RegExp | undefined;
let held: { complete(error?: Error): void } | undefined, indexFailure: boolean, lateHook: ((sql: string) => void) | undefined;
let unrelatedStorage: 'STORED' | 'VIRTUAL' | undefined;

/** 独立结构查询使用真实callback/end错误端口，未知SQL严格报错，不吞成权限不足。 */
function connect(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++next; let mode = originalMode, quote = 0, charset = 'utf8mb4', collation = 'utf8mb4_general_ci';
  const managed = { connection, profile, signal, broken: false, status: { dialect, version, connectionId: threadId }, close: vi.fn(async () => { if (failClose) { unknownClose = true; throw Error('合成原资源关闭未知'); } }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push({ thread: threadId, sql });
    const complete = (error?: Error) => queueMicrotask(() => {
      lateHook?.(sql); if (error) { callback(error); return; }
      let rows: unknown;
      if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@hostname')) rows = [{ sqlMode: mode, hostname: 'ram', port: 3306, serverId: 1, currentUser: 'ram@host', connectionId: threadId, characterSetConnection: charset, collationConnection: collation, quoteShowCreate: quote }];
      else if (sql.startsWith('SET SESSION sql_mode')) { mode = /'([^']*)'/.exec(sql)![1]; if (mode.includes('NO_AUTO_VALUE_ON_ZERO')) mode = readbackDropsStrict ? 'NO_AUTO_VALUE_ON_ZERO' : mode.split(',').reverse().join(','); rows = []; }
      else if (sql === 'SELECT @@SESSION.sql_mode AS sqlMode') rows = [{ sqlMode: mode }];
      else if (sql === 'SET SESSION sql_quote_show_create = 1') { quote = 1; rows = []; }
      else if (sql === 'SET NAMES utf8mb4 COLLATE utf8mb4_bin') { charset = 'utf8mb4'; collation = 'utf8mb4_bin'; rows = []; }
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote')) rows = [{ sqlMode: mode, quoteShowCreate: quote, charset, collation }];
      else if (sql === 'SELECT @@server_uuid AS uuid') rows = [{ uuid: 'ram-uuid' }];
      else if (sql.startsWith('SHOW CREATE TABLE')) rows = [{ 'Create Table': source }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable')) rows = catalog(auto).map(({ name, nullable, extra, charset, collation }) => ({ name, nullable, extra, charset, collation }));
      else if (sql.startsWith('SELECT COLUMN_NAME AS name, ORDINAL_POSITION AS ordinal')) rows = catalog(auto).map((column, index) => index === 0 && patch ? { ...column, ...patch } : column);
      else if (sql === 'SELECT VERSION() AS version, @@version_compile_os AS os, @@lower_case_table_names AS lowerNames LIMIT 2') rows = [{ version, os: 'Linux', lowerNames: 0 }];
      else if (sql.startsWith('SELECT TABLE_SCHEMA AS databaseName')) rows = [{ databaseName: 'db', tableName: 't', kind: 'BASE TABLE', engine: 'InnoDB' }];
      else if (sql.startsWith('SELECT PARTITION_NAME AS name')) rows = [{ name: null }];
      else if (sql.startsWith('SELECT CAST(TABLE_ID AS CHAR) AS id, NAME AS name')) rows = [{ id: tableId, name: 'db/t' }];
      else if (sql.startsWith('SELECT CAST(@@SESSION.auto_increment_increment AS CHAR)')) rows = [{ sessionIncrement: '1', sessionOffset: '1', globalIncrement: '1', globalOffset: '1', lockMode: '1', readOnly: '0', ...(dialect === 'mysql' ? { superReadOnly: '0' } : { compressedReadOnly: 'OFF', globalWsrep: 'OFF', sessionWsrep: 'OFF' }), innodbReadOnly: '0', forceRecovery: '0' }];
      else if (sql === 'SHOW GRANTS') rows = [{ grant: 'GRANT ALL PRIVILEGES ON *.* TO `ram`@`host`' }];
      else if (sql.startsWith('ALTER TABLE')) { source = afterSource; auto = /bigint NOT NULL AUTO_INCREMENT/.test(source); tableId = afterId; rows = { affectedRows: 5, warningStatus: warnings }; }
      else if (sql === 'SHOW WARNINGS LIMIT 20') rows = [{ Code: 1265, Level: 'Warning', Message: '合成转换警告' }];
      else { callback(Error('列自增RAM未登记原SQL')); return; }
      callback(null, rows, []);
    });
    if (hold?.test(sql)) held = { complete }; else complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(managed); return managed;
}
/** 索引端口的合成准备仍取当前真实结构读取，保留原稳定字段/索引引用和关系身份。 */
async function indexes(context: StructureTaskContext, target: { connectionId: string; database: string; table: string }, refs?: IndexReferenceNames): Promise<IndexStructureRead> {
  if (indexFailure) throw Error('合成索引目录不可用');
  const base = await readStructureDefinition(context, target, true), definition = parseTableColumnDefinition(base.source, base.context), indexDocument = readTableIndexDefinition(definition);
  const ref = (map: ReadonlyMap<string, string> | undefined, name: string) => [...(map ?? [])].find(([, value]) => value === name)?.[0] ?? name + '-ref';
  const columns = new Map<string, TrustedIndexColumn>(definition.columns.map(column => [ref(refs?.columns, column.name), { name: column.name, dataType: column.type.raw.split(/[ (]/)[0], columnType: column.type.raw, nullable: column.nullable !== false, hidden: false, generated: column.attributes.some(attribute => attribute.kind === 'generated'), prefix: { kind: 'forbidden', reason: '本例无字符串索引' } }]));
  const names = new Map([...columns].map(([ref, column]) => [column.name, ref]));
  const actualIndexes = new Map<string, TrustedIndexDefinition>(indexDocument.indexes.map(parsed => [ref(refs?.indexes, parsed.name), { parsed, definition: { kind: parsed.kind as 'primary' | 'ordinary', name: parsed.name, method: 'BTREE', comment: '', keyParts: parsed.parts.map(part => ({ columnRef: names.get(part.columnName!)!, direction: 'asc' as const })) }, generated: false, visible: true }]));
  return { ...base, model: { definition, indexDocument, columns, indexes: actualIndexes, dependencies: { incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, outgoingComplete: true, foreignKeys: [], autoIncrementColumnRefs: auto ? [names.get('id')!] : [], partition: { kind: 'none' }, hiddenDependencies: [], automaticForeignKeyIndexProvenance: { kind: 'known', indexRefs: [] } } }, catalogDigest: auto ? 'after-catalog' : 'before-catalog', dependencyDigest: auto ? 'after-dependency' : 'before-dependency', warnings: [], bytes: 4096 };
}
const get = (): Promise<TableColumnGetOutput> => engine.handle('schema.columns.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + next, connectionRevision: 1 });
const preview = (snapshot: TableColumnGetOutput, enabled = true): Promise<TableColumnPreviewOutput> => engine.handle('schema.columns.preview', { snapshotId: snapshot.snapshotId, taskId: 'preview-' + next, connectionRevision: 1, patches: [{ kind: 'alter', columnRef: snapshot.columns[0].columnRef, changes: { autoIncrement: enabled } }] });
const apply = (value: TableColumnPreviewOutput, taskId = 'apply'): Promise<TableColumnApplyOutput> => engine.handle('schema.columns.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements, taskId, connectionRevision: 1 });

beforeEach(async () => {
  unrelatedStorage = undefined;
  source = original; afterSource = enabled; auto = false; tableId = '100'; afterId = '200'; originalMode = 'STRICT_TRANS_TABLES'; version = '8.4.11'; dialect = 'mysql'; next = 0; sent = []; events = []; connections = []; patch = undefined; warnings = 0; readbackDropsStrict = failClose = unknownClose = indexFailure = false; hold = held = lateHook = undefined;
  seam.connect.mockReset().mockImplementation(async (_profile, _database, signal) => connect(signal)); seam.indexes.mockReset().mockImplementation(indexes); seam.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Error('原列自增命令已取消')); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => { failClose = false; hold = undefined; held?.complete(Error('本例收尾')); if (unknownClose) await expect(engine.closeAll()).rejects.toThrow('资源未确认释放'); else await engine.closeAll(); });

describe('列自增真实Engine/完整新COLUMNS/模式/令牌与取消（索引准备为明确RAM端口）', () => {
  it.each(['STORED', 'VIRTUAL'] as const)('完整一致的非索引旁%s生成列阻止无关id自增预览，零COPY发送并关闭原短会话', async storage => {
    // g只依赖a；模拟服务器在其它SQL模式下写入过g的合法结构，不能靠目标引用检查推断数据未重算。
    unrelatedStorage = storage;
    source = original.replace('PRIMARY KEY(k)', 'a char(5) DEFAULT NULL,g varchar(5) GENERATED ALWAYS AS (`a`) ' + storage + ',PRIMARY KEY(k)');
    afterSource = source.replace('bigint NOT NULL', 'bigint NOT NULL AUTO_INCREMENT');
    const snapshot = await get();
    expect(snapshot.columns.map(column => column.name)).toEqual(['id', 'k', 'v', 'a', 'g']);
    expect(snapshot.columns[0].autoIncrement?.access.editable).toBe(false);
    await expect(preview(snapshot)).rejects.toThrow();
    expect(sent.some(item => item.sql.startsWith('ALTER TABLE'))).toBe(false);
    expect(sent.some(item => item.sql.includes('NO_AUTO_VALUE_ON_ZERO'))).toBe(false);
    expect(connections.every(connection => vi.mocked(connection.close).mock.calls.length === 1)).toBe(true);
  });
  it('启用和取消均单次DDL，支持原非唯一复合索引与COPY新ID，读取预览不发DDL', async () => {
    const first = await get(); expect(first.columns[0].autoIncrement).toEqual({ enabled: false, access: { editable: true } }); const value = await preview(first);
    expect(sent.filter(item => item.sql.startsWith('ALTER'))).toEqual([]); expect(sent.filter(item => item.sql.includes("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_AUTO_VALUE_ON_ZERO'"))).toEqual([]);
    const output = await apply(value); expect(output).toMatchObject({ ddlCompleted: true, definitionVerified: true }); expect(output.after?.columns[0].autoIncrement?.enabled).toBe(true);
    const ddl = sent.find(item => item.sql.startsWith('ALTER'))!, earlier = sent.filter(item => item.thread === ddl.thread).map(item => item.sql);
    expect(earlier.indexOf("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_AUTO_VALUE_ON_ZERO'")).toBeLessThan(earlier.indexOf(ddl.sql)); expect(earlier[earlier.indexOf(ddl.sql) - 1]).toBe('SELECT @@SESSION.sql_mode AS sqlMode');
    await expect(apply(value)).rejects.toThrow('已使用'); afterSource = original; afterId = '300';
    const removal = await preview(await get(), false); expect(await apply(removal, 'remove')).toMatchObject({ definitionVerified: true }); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(2);
    expect(connections.every(connection => vi.mocked(connection.close).mock.calls.length === 1)).toBe(true);
  });
  it.each([{ extra: 'INVISIBLE' }, { defaultValue: '9' }, { typeSql: 'bigint unsigned' }, { ordinal: '01' }, { comment: '伪注释' }, { generationExpression: 'id+1' }])('新完整COLUMNS伪事实%j不可被其它正常目录洗成可写', async bad => {
    patch = bad; const snapshot = await get(); expect(snapshot.columns[0].autoIncrement?.access.editable).toBe(false); await expect(preview(snapshot)).rejects.toThrow('原快照'); expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
  });
  it('预览后原实体换掉或真实目录改变，消费预览且零DDL', async () => {
    const value = await preview(await get()); tableId = '999'; await expect(apply(value)).rejects.toThrow('已变化'); await expect(apply(value)).rejects.toThrow('已使用'); expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
  });
  it('读回丢原strict模式时拒发DDL，不因只看到NO_AUTO_VALUE_ON_ZERO就放行', async () => {
    const value = await preview(await get()); readbackDropsStrict = true; await expect(apply(value)).rejects.toThrow('完整保留'); expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
  });
  it.each([1, undefined])('warning状态%j保留完成但未核验，原诊断紧跟DDL', async count => {
    warnings = count; const value = await preview(await get()); expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: false }); const index = sent.findIndex(item => item.sql.startsWith('ALTER')); if (count) expect(sent[index + 1].sql).toBe('SHOW WARNINGS LIMIT 20');
  });
  it('已发后取消等待原命令终态，unknown不能生成成功或使用同快照另一预览重放', async () => {
    const snapshot = await get(), first = await preview(snapshot), second = await preview(snapshot); hold = /^ALTER TABLE/;
    const running = apply(first), rejected = expect(running).rejects.toThrow('取消'); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId: 'apply' }); await rejected;
    expect(events.at(-1)?.columnPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' }); await expect(apply(second)).rejects.toThrow('已使用'); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('DDL成功后完整目录矛盾仍保留ddlCompleted，不能回退成未提交或再发', async () => {
    const value = await preview(await get()); let afterDdl = false;
    lateHook = sql => { if (sql.startsWith('ALTER TABLE')) afterDdl = true; if (afterDdl && sql.startsWith('SELECT COLUMN_NAME AS name, ORDINAL_POSITION')) patch = { extra: 'auto_increment UNKNOWN' }; };
    expect(await apply(value)).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: false }); await expect(apply(value)).rejects.toThrow('已使用'); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('DDL成功后核验取消保持成功ACK事实，原查询终态和关闭后返回未核验回执', async () => {
    const value = await preview(await get()); lateHook = sql => { if (sql.startsWith('ALTER TABLE')) hold = /^SELECT @@SESSION.sql_mode AS sqlMode, @@hostname/; };
    const pending = apply(value); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId: 'apply' });
    expect(await pending).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: false }); expect(events.at(-1)?.columnPatch).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('显式释放和重复确认不会复活旧快照的列自增预览', async () => {
    const snapshot = await get(), value = await preview(snapshot); await engine.handle('schema.columns.release', { snapshotId: snapshot.snapshotId }); await expect(apply(value)).rejects.toThrow('失效'); expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
  });
  it('严格资源关闭未知时拒绝发布，即使DDL与定义核验都已完成', async () => {
    const value = await preview(await get()); failClose = true; await expect(apply(value)).rejects.toThrow('关闭'); expect(unknownClose).toBe(true); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1);
  });
});
