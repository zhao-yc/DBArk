import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { ColumnPatch, TableColumnGetOutput, TableColumnPreviewOutput, TableColumnApplyOutput } from '../../src/shared/tableColumnPatches';
const driver = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
// 只替换原驱动边界；真实Engine、结构会话、目录reader、解析/计划、缓存和取消流程均运行。
vi.mock('../../src/engine/connection', () => ({ connect: driver.connect, execute: driver.execute }));
// 与本专项无关的列排序规则明确没有目录权限，不能用它冒充生成列身份/目录事实。
vi.mock('../../src/engine/tableColumnCollationTaskRead', async () => ({ ...await vi.importActual<any>('../../src/engine/tableColumnCollationTaskRead'), readColumnCollationTaskFacts: async () => ({ kind: 'unavailable', reason: 'catalog-permission' }) }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'generated', name: '生成列RAM', group: '', color: '#123456', dialect: 'mysql', host: 'offline.invalid', port: 3306, user: '合成用户' };
interface CatalogColumn { name: string; ordinal: number; typeSql: string; dataType: string; nullable: string; defaultValue: string | null; extra: string; generationExpression: string; charset: string | null; collation: string | null; comment: string; }
const original = 'CREATE TABLE t(a int NOT NULL,b decimal(10,2) DEFAULT NULL,PRIMARY KEY(a)) ENGINE=InnoDB';
const generatedSource = 'CREATE TABLE t(a int NOT NULL,b decimal(10,2) DEFAULT NULL,total decimal(12,2) GENERATED ALWAYS AS ((`a` + (`b` * 2.00))) VIRTUAL COMMENT \'算式\',PRIMARY KEY(a)) ENGINE=InnoDB';
/** 目录由固定样本独立列出，不从产品解析器反推一份永远相等的预期。 */
function originals(): CatalogColumn[] { return [{ name: 'a', ordinal: 1, typeSql: 'int', dataType: 'int', nullable: 'NO', defaultValue: null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' }, { name: 'b', ordinal: 2, typeSql: 'decimal(10,2)', dataType: 'decimal', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' }]; }
function added(storage: 'VIRTUAL' | 'STORED' = 'VIRTUAL'): CatalogColumn { return { name: 'total', ordinal: 3, typeSql: 'decimal(12,2)', dataType: 'decimal', nullable: 'YES', defaultValue: null, extra: storage + ' GENERATED', generationExpression: '`a` + (`b` * 2.00)', charset: null, collation: null, comment: '算式' }; }
let engine: Engine, events: TaskEvent[], connections: ManagedConnection[], sent: { id: number; sql: string }[], source: string, afterSource: string, columns: CatalogColumn[], afterColumns: CatalogColumn[], tableId: string, afterTableId: string, dialect: 'mysql' | 'mariadb', version: string, nextId: number;
let fail: RegExp | undefined, permission: RegExp | undefined, hold: RegExp | undefined, warningCount: number, closeFailure: boolean, unknownClose: boolean, hook: undefined | ((sql: string) => void);
let held: { managed: ManagedConnection; complete(error?: Error): void } | undefined;

/** 全部SQL只走本例RAM回调，无认证、联网或SQL重发；未知语句明确失败。 */
function connect(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++nextId; let quote = 0, charset = 'utf8mb4', collation = 'utf8mb4_general_ci';
  const managed = { connection, profile, signal, broken: false, status: { dialect, version, connectionId: threadId }, close: vi.fn(async () => { if (closeFailure) { unknownClose = true; throw Error('合成关闭状态未知'); } }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push({ id: threadId, sql });
    const complete = (error?: Error) => queueMicrotask(() => {
      hook?.(sql);
      if (error || fail?.test(sql)) { callback(error ?? Error('合成驱动错误，不含表达式')); return; }
      if (permission?.test(sql)) { callback(Object.assign(Error('合成目录拒读'), { errno: 1227, fatal: false })); return; }
      let rows: unknown;
      if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@hostname')) rows = [{ sqlMode: '', hostname: 'ram-server', port: 3306, serverId: 1, currentUser: 'ram@host', connectionId: threadId, characterSetConnection: charset, collationConnection: collation, quoteShowCreate: quote }];
      else if (sql === 'SET SESSION sql_quote_show_create = 1') { quote = 1; rows = []; }
      else if (sql === 'SET NAMES utf8mb4 COLLATE utf8mb4_bin') { charset = 'utf8mb4'; collation = 'utf8mb4_bin'; rows = []; }
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote')) rows = [{ sqlMode: '', quoteShowCreate: quote, charset, collation }];
      else if (sql === 'SELECT @@server_uuid AS uuid') rows = [{ uuid: 'ram-uuid' }];
      else if (sql.startsWith('SHOW CREATE TABLE')) rows = [{ Table: 't', 'Create Table': source }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name, ORDINAL_POSITION AS ordinal')) rows = structuredClone(columns);
      else if (sql.startsWith('SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable')) rows = columns.map(({ name, nullable, extra, charset, collation }) => ({ name, nullable, extra, charset, collation }));
      else if (sql === 'SELECT VERSION() AS version, @@version_compile_os AS os, @@lower_case_table_names AS lowerNames LIMIT 2') rows = [{ version, os: 'Linux', lowerNames: 0 }];
      else if (sql.startsWith('SELECT TABLE_SCHEMA AS databaseName')) rows = [{ databaseName: 'db', tableName: 't', kind: 'BASE TABLE', engine: 'InnoDB' }];
      else if (sql.startsWith('SELECT PARTITION_NAME AS name')) rows = [{ name: null }];
      else if (sql.startsWith('SELECT CAST(TABLE_ID AS CHAR) AS id, NAME AS name')) rows = [{ id: tableId, name: 'db/t' }];
      else if (sql.startsWith('ALTER TABLE')) { source = afterSource; columns = structuredClone(afterColumns); tableId = afterTableId; rows = { affectedRows: 0, warningStatus: warningCount }; }
      else if (sql === 'SHOW WARNINGS LIMIT 20') rows = [{ Level: 'Warning', Code: 1265, Message: '合成数值转换警告' }];
      else { callback(Error('未登记的RAM SQL')); return; }
      callback(null, rows, []);
    });
    if (hold?.test(sql)) held = { managed, complete }; else complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(managed); return managed;
}

/** 沿真实公开Engine入口注入仅Main可提供的修订，SQL永不由apply参数传入。 */
const get = (): Promise<TableColumnGetOutput> => engine.handle('schema.columns.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + nextId, connectionRevision: 1 });
function patch(storage: 'VIRTUAL' | 'STORED' = 'VIRTUAL'): Extract<ColumnPatch, { kind: 'add' }> { return { kind: 'add', clientKey: 'generated-new', name: 'total', type: { kind: 'decimal', precision: 12, scale: 2, unsigned: false }, nullable: true, default: { kind: 'none' }, comment: '算式', position: { kind: 'last' }, generated: { storage, expression: 'a + b * 2.00' } }; }
const preview = (snapshot: TableColumnGetOutput, addedPatch = patch()): Promise<TableColumnPreviewOutput> => engine.handle('schema.columns.preview', { snapshotId: snapshot.snapshotId, taskId: 'preview-' + nextId, patches: [addedPatch], connectionRevision: 1 });
const apply = (value: TableColumnPreviewOutput, taskId = 'apply'): Promise<TableColumnApplyOutput> => engine.handle('schema.columns.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements, taskId, connectionRevision: 1 });

beforeEach(async () => {
  source = original; afterSource = generatedSource; columns = originals(); afterColumns = [...originals(), added()]; tableId = '100'; afterTableId = '100'; dialect = 'mysql'; version = '8.4.11'; nextId = 0; events = []; connections = []; sent = []; fail = undefined; permission = undefined; hold = undefined; warningCount = 0; closeFailure = false; unknownClose = false; held = undefined; hook = undefined;
  driver.connect.mockReset().mockImplementation(async (_profile, _database, signal) => connect(signal)); driver.execute.mockReset().mockImplementation(async (_connection, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Error('已取消原命令')); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => {
  closeFailure = false; hold = undefined; held?.complete(Error('合成测试收尾'));
  if (unknownClose) await expect(engine.closeAll()).rejects.toThrow('资源未确认释放'); else await engine.closeAll();
  vi.restoreAllMocks();
});

describe('新增数值生成列真实Engine与RAM目录证据', () => {
  it.each([['mysql', '5.7.44'], ['mysql', '8.0.46'], ['mysql', '8.4.11'], ['mariadb', '10.11.19'], ['mariadb', '11.4.13']] as const)('%s %s仅目录和身份全部一致才提供候选，预览零DDL', async (kind, exact) => {
    dialect = kind; version = exact; const snapshot = await get(); expect(snapshot.generatedAccess).toEqual({ editable: true }); expect(snapshot.columns.map(column => column.generatedReference)).toEqual([true, true]); const value = await preview(snapshot); expect(value.sql).toContain('GENERATED ALWAYS AS'); expect(value.requiredAcknowledgements).toContain('generated-column-computation'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toEqual([]);
    expect(sent.some(value => value.sql.includes('information_schema.' + (kind === 'mysql' && exact !== '5.7.44' ? 'INNODB_TABLES' : 'INNODB_SYS_TABLES')))).toBe(true); expect(connections.every(connection => vi.mocked(connection.close).mock.calls.length === 1)).toBe(true);
  });
  it.each(['VIRTUAL', 'STORED'] as const)('%s单次ADD后完整交叉核原列和表达式，令牌不重放', async storage => {
    afterSource = generatedSource.replace(' VIRTUAL ', ' ' + storage + ' '); afterColumns[2] = added(storage); afterTableId = '101'; const value = await preview(await get(), patch(storage)), result = await apply(value); expect(result).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true }); expect(result.after?.columns.find(column => column.name === 'total')?.access.type.editable).toBe(false); expect(result.warnings.some(message => message.includes('物理表编号已变化'))).toBe(true); await expect(apply(value)).rejects.toThrow('已使用'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toHaveLength(1); expect(events.at(-1)?.columnPatch).toMatchObject({ ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' });
  });
  it('Maria PERSISTENT后核等价STORED，只规范存储拼写，不改表达式树', async () => {
    dialect = 'mariadb'; version = '10.11.19'; afterSource = generatedSource.replace(' VIRTUAL ', ' PERSISTENT '); afterColumns[2] = added('STORED'); expect(await apply(await preview(await get(), patch('STORED')))).toMatchObject({ definitionVerified: true });
  });
  it('Maria目录SQL NULL原文可核验，带引号文本NULL不能冒充无默认值', async () => {
    dialect = 'mariadb'; version = '11.4.13'; afterColumns[2].defaultValue = 'NULL'; expect(await apply(await preview(await get()))).toMatchObject({ definitionVerified: true });
    source = original; columns = originals(); tableId = '100'; afterColumns = [...originals(), { ...added(), defaultValue: "'NULL'" }]; expect(await apply(await preview(await get()), 'quoted-null')).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });
  it.each(['permission', 'unknown', 'oversized', 'hiddenGenerated'])('附加%s仅关闭新能力，普通编辑与原warnings语义保留', async kind => {
    if (kind === 'permission') permission = /^SELECT CAST\(TABLE_ID/; if (kind === 'unknown') fail = /^SELECT CAST\(TABLE_ID/; if (kind === 'oversized') columns[0].generationExpression = '汉'.repeat(710000); if (kind === 'hiddenGenerated') columns[0].generationExpression = '1 + 2';
    const snapshot = await get(); expect(snapshot.generatedAccess?.editable).toBe(false); expect(snapshot.generatedAccess?.reason).toBeTruthy(); expect(snapshot.columns.every(column => column.generatedReference !== true)).toBe(true); expect(snapshot.warnings.some(message => message.includes('生成列'))).toBe(false); snapshot.generatedAccess = { editable: true }; snapshot.columns[0].generatedReference = true; await expect(preview(snapshot)).rejects.toThrow('原快照没有');
    await expect(engine.handle('schema.columns.preview', { snapshotId: snapshot.snapshotId, patches: [{ kind: 'alter', columnRef: snapshot.columns[1].columnRef, changes: { comment: '普通旁列' } }], taskId: 'ordinary-preview', connectionRevision: 1 })).resolves.toHaveProperty('previewToken'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toHaveLength(0);
  });
  it.each(['tableId', 'catalogDefault', 'catalogType'])('预览后%s漂移在发送前拒绝且消费令牌', async kind => {
    const value = await preview(await get()); if (kind === 'tableId') tableId = '200'; if (kind === 'catalogDefault') columns[0].defaultValue = '7'; if (kind === 'catalogType') columns[0].dataType = 'float'; await expect(apply(value)).rejects.toThrow(); await expect(apply(value)).rejects.toThrow('已使用'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toHaveLength(0);
  });
  it.each(['expression', 'storage', 'extra', 'extraDefaultGenerated', 'oldDefault', 'oldDefinition', 'nullable', 'type', 'attribute', 'missing'])('DDL收到OK但%s反例不能伪报核验成功', async kind => {
    const value = await preview(await get());
    if (kind === 'expression') afterColumns[2].generationExpression = '`a` - (`b` * 2.00)'; if (kind === 'storage') afterColumns[2].extra = 'STORED GENERATED'; if (kind === 'extra') afterColumns[2].extra = 'VIRTUAL GENERATED on update CURRENT_TIMESTAMP'; if (kind === 'extraDefaultGenerated') afterColumns[2].extra = 'VIRTUAL GENERATED DEFAULT_GENERATED'; if (kind === 'oldDefault') afterColumns[0].defaultValue = '9'; if (kind === 'oldDefinition') { afterSource = afterSource.replace('b decimal(10,2)', 'b decimal(11,2)'); afterColumns[1].typeSql = 'decimal(11,2)'; } if (kind === 'nullable') afterColumns[2].nullable = 'NO'; if (kind === 'type') { afterSource = afterSource.replace('total decimal(12,2)', 'total decimal(13,2)'); afterColumns[2].typeSql = 'decimal(13,2)'; } if (kind === 'attribute') afterSource = afterSource.replace("COMMENT '算式'", "COMMENT '算式' STORAGE DISK"); if (kind === 'missing') { afterSource = original; afterColumns = originals(); }
    expect(await apply(value)).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: false }); await expect(apply(value)).rejects.toThrow('已使用'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('EXTRA与SHOW生成方式不一致时get不得开放下次生成，普通列属性仍可查看', async () => {
    source = generatedSource; columns = [...originals(), added('STORED')]; const snapshot = await get(); expect(snapshot.generatedAccess?.editable).toBe(false); expect(snapshot.columns).toHaveLength(3); expect(snapshot.columns[2].access.type.editable).toBe(false);
  });
  it('普通表达式默认值的DEFAULT_GENERATED不能洗掉旁边未知EXTRA', async () => {
    source = original.replace('b decimal(10,2) DEFAULT NULL', 'b decimal(10,2) DEFAULT (1+2)'); columns[1].defaultValue = '(1+2)'; columns[1].extra = 'DEFAULT_GENERATED UNKNOWN_EXTRA';
    const snapshot = await get(); expect(snapshot.generatedAccess?.editable).toBe(false); expect(snapshot.columns.every(column => column.generatedReference !== true)).toBe(true); await expect(preview(snapshot)).rejects.toThrow('原快照没有'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toEqual([]);
  });
  it('预览后连接修订变化及缺确认均消费令牌，不能补确认重放', async () => {
    const value = await preview(await get()); await expect(engine.handle('schema.columns.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements, taskId: 'revision', connectionRevision: 2 })).rejects.toThrow('配置已变化'); await expect(apply(value)).rejects.toThrow('已使用'); const second = await preview(await get()); await expect(engine.handle('schema.columns.apply', { previewToken: second.previewToken, acknowledgements: second.requiredAcknowledgements.filter(item => item !== 'generated-column-computation'), taskId: 'ack', connectionRevision: 1 })).rejects.toThrow('确认'); await expect(apply(second)).rejects.toThrow('已使用'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toEqual([]);
  });
  it('ALTER警告紧随原OK读取，目录失败保留已完成而不重放', async () => {
    const value = await preview(await get()); warningCount = 1; hook = sql => { if (sql.startsWith('ALTER TABLE')) fail = /^SELECT COLUMN_NAME AS name, ORDINAL_POSITION/; }; const result = await apply(value), index = sent.findIndex(value => value.sql.startsWith('ALTER')); expect(sent[index + 1].sql).toBe('SHOW WARNINGS LIMIT 20'); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(result.warnings.some(message => message.includes('合成数值转换警告'))).toBe(true); expect(events.every(event => !event.message.includes('合成数值转换警告'))).toBe(true); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('DDL前目录取消沿原任务真实回调结算，零DDL且不能降级为只读成功', async () => {
    const snapshot = await get(), taskId = 'preview-' + nextId; hold = /^SELECT COLUMN_NAME AS name, ORDINAL_POSITION/; const pending = preview(snapshot), rejected = expect(pending).rejects.toThrow('取消'); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId }); await rejected; expect(held!.managed.close).toHaveBeenCalledOnce(); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toEqual([]);
  });
  it('DDL挂起取消仍只有一次发送、保留unknown并消费预览', async () => {
    const value = await preview(await get()); hold = /^ALTER TABLE/; const pending = apply(value), rejected = expect(pending).rejects.toThrow('取消'); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId: 'apply' }); await rejected; expect(held!.managed.close).toHaveBeenCalledOnce(); expect(events.at(-1)?.columnPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' }); await expect(apply(value)).rejects.toThrow('已使用'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('get收尾关闭未知不能登记快照能力，closeAll也不能把未知补成已释放', async () => {
    closeFailure = true; await expect(get()).rejects.toThrow(); expect(unknownClose).toBe(true); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toEqual([]);
  });
});
