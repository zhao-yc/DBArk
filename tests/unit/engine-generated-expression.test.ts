import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { ColumnPatch, TableColumnGetOutput, TableColumnPreviewOutput, TableColumnApplyOutput } from '../../src/shared/tableColumnPatches';

const driver = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
// 仅替换真实驱动的原回调入口；Engine、结构读取、私有事实、计划和令牌消费均走产品实现。
vi.mock('../../src/engine/connection', () => ({ connect: driver.connect, execute: driver.execute }));
// 无关的列排序规则用途明确无权限；不能代替生成表达式所需的真实完整目录和物理编号读取。
vi.mock('../../src/engine/tableColumnCollationTaskRead', async () => ({ ...await vi.importActual<any>('../../src/engine/tableColumnCollationTaskRead'), readColumnCollationTaskFacts: async () => ({ kind: 'unavailable', reason: 'catalog-permission' }) }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'generated-expression', name: '已有生成表达式RAM', group: '', color: '#123456', dialect: 'mysql', host: 'offline.invalid', port: 3306, user: '合成用户' };
interface CatalogColumn { name: string; ordinal: number; typeSql: string; dataType: string; nullable: string; defaultValue: string | null; extra: string; generationExpression: string; charset: string | null; collation: string | null; comment: string; }
/** SHOW样本和目录样本各自固定，不从产品解析器生成对照值。 */
function definition(storage: 'VIRTUAL' | 'STORED' | 'PERSISTENT' = 'VIRTUAL', factor = '2.00'): string {
  return "CREATE TABLE t(a int NOT NULL,b decimal(10,2) DEFAULT NULL,total decimal(12,2) GENERATED ALWAYS AS ((`a` + (`b` * " + factor + "))) " + storage + " COMMENT '算式',other_total decimal(12,2) GENERATED ALWAYS AS ((`a` - `b`)) VIRTUAL COMMENT '旁列',PRIMARY KEY(a)) ENGINE=InnoDB";
}
/** 每项完整目录均为独立期望，包括未修改生成列，防止只核目标新表达式的假阳性。 */
function catalog(storage: 'VIRTUAL' | 'STORED' | 'PERSISTENT' = 'VIRTUAL', factor = '2.00'): CatalogColumn[] {
  return [
    { name: 'a', ordinal: 1, typeSql: 'int', dataType: 'int', nullable: 'NO', defaultValue: null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' },
    { name: 'b', ordinal: 2, typeSql: 'decimal(10,2)', dataType: 'decimal', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' },
    { name: 'total', ordinal: 3, typeSql: 'decimal(12,2)', dataType: 'decimal', nullable: 'YES', defaultValue: null, extra: storage + ' GENERATED', generationExpression: '`a` + (`b` * ' + factor + ')', charset: null, collation: null, comment: '算式' },
    { name: 'other_total', ordinal: 4, typeSql: 'decimal(12,2)', dataType: 'decimal', nullable: 'YES', defaultValue: null, extra: 'VIRTUAL GENERATED', generationExpression: '`a` - `b`', charset: null, collation: null, comment: '旁列' },
  ];
}

let engine: Engine, events: TaskEvent[], connections: ManagedConnection[], sent: { id: number; sql: string }[], source: string, afterSource: string, columns: CatalogColumn[], afterColumns: CatalogColumn[], tableId: string, afterTableId: string, dialect: 'mysql' | 'mariadb', version: string, nextId: number;
let fail: RegExp | undefined, permission: RegExp | undefined, hold: RegExp | undefined, warningCount: number, closeFailure: boolean, unknownClose: boolean, hook: undefined | ((sql: string) => void);
let held: { managed: ManagedConnection; complete(error?: Error): void } | undefined;
let holdClose: boolean, heldClose: { managed: ManagedConnection; finish(): void } | undefined;

/** 原驱动回调必须结算，包括未登记SQL与取消；本夹具不认证、联网、重放或旁路任务状态。 */
function connect(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++nextId; let quote = 0, charset = 'utf8mb4', collation = 'utf8mb4_general_ci';
  const managed: ManagedConnection = { connection, profile, signal, broken: false, status: { dialect, version, connectionId: threadId }, close: vi.fn(async () => { if (holdClose) await new Promise<void>(finish => { heldClose = { managed, finish }; }); if (closeFailure) { unknownClose = true; throw Error('合成关闭状态未知'); } }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push({ id: threadId, sql });
    const complete = (error?: Error) => queueMicrotask(() => {
      hook?.(sql);
      if (error || fail?.test(sql)) { callback(error ?? Error('合成驱动错误，不含表达式')); return; }
      if (permission?.test(sql)) { callback(Object.assign(Error('合成目录拒读'), { errno: 1142, code: 'ER_TABLEACCESS_DENIED_ERROR', fatal: false })); return; }
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
      else if (sql === 'SHOW WARNINGS LIMIT 20') rows = [{ Level: 'Warning', Code: 1265, Message: '合成表达式重算警告' }];
      else { callback(Error('未登记的生成表达式RAM SQL')); return; }
      callback(null, rows, []);
    });
    if (hold?.test(sql)) held = { managed, complete }; else complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(managed); return managed;
}

/** 真实入口沿Main注入的修订与原snapshot/columnRef调用，不向apply传入SQL。 */
const get = (): Promise<TableColumnGetOutput> => engine.handle('schema.columns.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + nextId, connectionRevision: 1 });
function patch(snapshot: TableColumnGetOutput, expression = 'a + b * 3.00', name = 'total'): Extract<ColumnPatch, { kind: 'alter' }> {
  return { kind: 'alter', columnRef: snapshot.columns.find(column => column.name === name)!.columnRef, changes: { generation: { expression } } };
}
const preview = (snapshot: TableColumnGetOutput, patches: ColumnPatch[] = [patch(snapshot)]): Promise<TableColumnPreviewOutput> => engine.handle('schema.columns.preview', { snapshotId: snapshot.snapshotId, taskId: 'preview-' + nextId, patches, connectionRevision: 1 });
const apply = (value: TableColumnPreviewOutput, taskId = 'apply'): Promise<TableColumnApplyOutput> => engine.handle('schema.columns.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements, taskId, connectionRevision: 1 });

beforeEach(async () => {
  source = definition(); afterSource = definition('VIRTUAL', '3.00'); columns = catalog(); afterColumns = catalog('VIRTUAL', '3.00'); tableId = '100'; afterTableId = '101'; dialect = 'mysql'; version = '8.4.11'; nextId = 0; events = []; connections = []; sent = []; fail = undefined; permission = undefined; hold = undefined; warningCount = 0; closeFailure = false; unknownClose = false; held = undefined; hook = undefined; holdClose = false; heldClose = undefined;
  driver.connect.mockReset().mockImplementation(async (_profile, _database, signal) => connect(signal));
  driver.execute.mockReset().mockImplementation(async (_connection, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Error('已取消原命令')); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => {
  closeFailure = false; hold = undefined; holdClose = false; heldClose?.finish(); held?.complete(Error('合成测试收尾'));
  if (unknownClose) await expect(engine.closeAll()).rejects.toThrow('资源未确认释放'); else await engine.closeAll();
  vi.restoreAllMocks();
});

describe('已有生成表达式修改的真实Engine与独立RAM目录', () => {
  it.each([['mysql', '5.7.44'], ['mysql', '8.0.46'], ['mysql', '8.4.11'], ['mariadb', '10.11.19'], ['mariadb', '11.4.13']] as const)('%s %s用完整事实开放独立generation能力，原七项仍只读', async (kind, exact) => {
    dialect = kind; version = exact; const snapshot = await get(), total = snapshot.columns[2];
    expect(total.generation).toMatchObject({ storage: 'VIRTUAL', access: { editable: true } }); expect(total.generation?.expression).toContain('2.00');
    expect(Object.keys(total.access).sort()).toEqual(['comment', 'default', 'name', 'nullable', 'onUpdate', 'position', 'type']); expect(Object.values(total.access).every(value => value.editable === false)).toBe(true);
    expect(snapshot.columns.map(column => column.generatedReference === true)).toEqual([true, true, false, false]); expect(snapshot.columns[0].generation).toBeUndefined();
    const value = await preview(snapshot); expect(value.sql).toContain('MODIFY COLUMN'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toEqual([]); expect(connections.every(connection => vi.mocked(connection.close).mock.calls.length === 1)).toBe(true);
  });
  it.each(['VIRTUAL', 'STORED'] as const)('%s保持原四列，仅表达式改变；COPY重建编号不误判失败', async storage => {
    source = definition(storage); columns = catalog(storage); afterSource = definition(storage, '3.00'); afterColumns = catalog(storage, '3.00'); const value = await preview(await get());
    expect(value.sql).toContain('ALGORITHM=COPY'); expect(value.sql.includes('WITH VALIDATION')).toBe(storage === 'VIRTUAL'); expect(value.sql).not.toContain('ADD COLUMN');
    expect(value.requiredAcknowledgements).toHaveLength(4); expect(new Set(value.requiredAcknowledgements).size).toBe(4); expect(value.requiredAcknowledgements).toContain('generated-column-computation'); expect(value.requiredAcknowledgements).toContain('generated-expression-recalculation');
    const result = await apply(value); expect(result).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true }); expect(result.after?.columns.map(column => column.name)).toEqual(['a', 'b', 'total', 'other_total']);
    expect(result.after?.columns[2].generation).toMatchObject({ storage, access: { editable: true } }); expect(result.after?.columns[2].generation?.expression).toContain('3.00'); expect(result.after?.columns[3].generation?.expression).not.toContain('3.00');
    expect(result.warnings.some(message => message.includes('物理表编号已变化'))).toBe(true); await expect(apply(value)).rejects.toThrow('已使用'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toHaveLength(1); expect(events.at(-1)?.columnPatch).toMatchObject({ ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' });
  });
  it('Maria PERSISTENT沿原存储及SQL NULL目录，无WITH VALIDATION且不改变其它生成列', async () => {
    dialect = 'mariadb'; version = '11.4.13'; source = definition('PERSISTENT'); afterSource = definition('PERSISTENT', '3.00'); columns = catalog('PERSISTENT'); afterColumns = catalog('PERSISTENT', '3.00'); for (const row of [...columns, ...afterColumns]) if (row.extra) row.defaultValue = 'NULL';
    const snapshot = await get(); expect(snapshot.columns[2].generation).toMatchObject({ storage: 'STORED', access: { editable: true } }); const value = await preview(snapshot); expect(value.sql).toContain('ALGORITHM=COPY'); expect(value.sql).not.toContain('WITH VALIDATION'); expect(await apply(value)).toMatchObject({ definitionVerified: true });
  });
  it.each(['ordinary', 'unchanged', 'position', 'type', 'comment', 'mixed-targets', 'self-reference', 'later-reference'])('%s不能借专用属性绕过单列、无差异或引用门，零DDL', async kind => {
    const snapshot = await get(), changed = patch(snapshot); let patches: ColumnPatch[] = [changed];
    if (kind === 'ordinary') patches = [patch(snapshot, 'a * 3.00', 'b')];
    if (kind === 'unchanged') patches = [patch(snapshot, '((a + (b * 2.00)))')];
    if (kind === 'position') changed.changes.position = { kind: 'first' };
    if (kind === 'type') changed.changes.type = { kind: 'decimal', precision: 13, scale: 2, unsigned: false };
    if (kind === 'comment') changed.changes.comment = '不允许混改';
    if (kind === 'mixed-targets') patches.push(patch(snapshot, 'a - b * 2.00', 'other_total'));
    if (kind === 'self-reference') patches = [patch(snapshot, 'total * 3.00')];
    if (kind === 'later-reference') patches = [patch(snapshot, 'other_total * 3.00')];
    await expect(preview(snapshot, patches)).rejects.toThrow(); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toEqual([]);
  });
  it.each(['index', 'check', 'generated-dependency'])('%s涉及目标时专用能力只读且不能预览', async kind => {
    if (kind === 'index') source = source.replace('PRIMARY KEY(a)', 'PRIMARY KEY(a),KEY total_key(total)');
    if (kind === 'check') source = source.replace('PRIMARY KEY(a)', 'PRIMARY KEY(a),CONSTRAINT positive_total CHECK(total>0)');
    if (kind === 'generated-dependency') { source = source.replace('((`a` - `b`))', '((`total` - `b`))'); columns[3].generationExpression = '`total` - `b`'; }
    const snapshot = await get(); expect(snapshot.columns[2].generation?.access.editable).toBe(false); await expect(preview(snapshot)).rejects.toThrow(); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toEqual([]);
  });
  it.each(['permission', 'unknown-extra', 'show-catalog-mismatch', 'oversized'])('%s降级只关闭新能力；普通旁列仍沿原预览流程', async kind => {
    if (kind === 'permission') permission = /^SELECT COLUMN_NAME AS name, ORDINAL_POSITION/;
    if (kind === 'unknown-extra') columns[2].extra += ' DEFAULT_GENERATED';
    if (kind === 'show-catalog-mismatch') columns[2].generationExpression = '`a` - (`b` * 2.00)';
    if (kind === 'oversized') columns[2].generationExpression = '汉'.repeat(710000);
    const snapshot = await get(); expect(snapshot.columns[2].generation).toMatchObject({ storage: 'VIRTUAL', access: { editable: false } }); expect(snapshot.generatedAccess?.editable).toBe(false); expect(snapshot.warnings.some(message => message.includes('生成列'))).toBe(false);
    snapshot.columns[2].generation!.access.editable = true; await expect(preview(snapshot)).rejects.toThrow(); await expect(preview(snapshot, [{ kind: 'alter', columnRef: snapshot.columns[1].columnRef, changes: { comment: '普通旁列' } }])).resolves.toHaveProperty('previewToken'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toEqual([]);
  });
  it.each(['physical', 'default', 'expression', 'type', 'extra'])('get后%s漂移阻止preview，不会把新目录当原授权', async kind => {
    const snapshot = await get(); if (kind === 'physical') tableId = '200'; if (kind === 'default') columns[0].defaultValue = '9'; if (kind === 'expression') { source = definition('VIRTUAL', '4.00'); columns = catalog('VIRTUAL', '4.00'); } if (kind === 'type') columns[0].dataType = 'float'; if (kind === 'extra') columns[2].extra += ' UNKNOWN';
    await expect(preview(snapshot)).rejects.toThrow(); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toEqual([]);
  });
  it.each(['physical', 'default', 'expression', 'type', 'extra'])('preview后%s漂移阻止发送，原令牌已消费不能重试', async kind => {
    const value = await preview(await get()); if (kind === 'physical') tableId = '200'; if (kind === 'default') columns[0].defaultValue = '9'; if (kind === 'expression') { source = definition('VIRTUAL', '4.00'); columns = catalog('VIRTUAL', '4.00'); } if (kind === 'type') columns[0].dataType = 'float'; if (kind === 'extra') columns[2].extra += ' UNKNOWN';
    await expect(apply(value)).rejects.toThrow(); await expect(apply(value)).rejects.toThrow('已使用'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toEqual([]);
  });
  it.each(['storage', 'type', 'nullable', 'default', 'comment', 'extra', 'ordinary-default', 'other-expression', 'order', 'missing', 'constraints', 'wrong-expression', 'decimal-scale', 'unchanged'])('OK后%s变化必须保留已完成但不能伪报定义核验', async kind => {
    const value = await preview(await get());
    if (kind === 'storage') { afterSource = definition('STORED', '3.00'); afterColumns[2].extra = 'STORED GENERATED'; }
    if (kind === 'type') { afterSource = afterSource.replace('total decimal(12,2)', 'total decimal(13,2)'); afterColumns[2].typeSql = 'decimal(13,2)'; }
    if (kind === 'nullable') afterColumns[2].nullable = 'NO';
    if (kind === 'default') afterColumns[2].defaultValue = '9';
    if (kind === 'comment') { afterSource = afterSource.replace("COMMENT '算式'", "COMMENT '被改注释'"); afterColumns[2].comment = '被改注释'; }
    if (kind === 'extra') afterColumns[2].extra += ' DEFAULT_GENERATED';
    if (kind === 'ordinary-default') afterColumns[0].defaultValue = '9';
    if (kind === 'other-expression') { afterSource = afterSource.replace('((`a` - `b`))', '((`a` + `b`))'); afterColumns[3].generationExpression = '`a` + `b`'; }
    if (kind === 'order') [afterColumns[0], afterColumns[1]] = [afterColumns[1], afterColumns[0]];
    if (kind === 'missing') afterColumns.pop();
    if (kind === 'constraints') afterSource = afterSource.replace('PRIMARY KEY(a)', 'PRIMARY KEY(a),KEY extra_key(b)');
    if (kind === 'wrong-expression') { afterSource = definition('VIRTUAL', '4.00'); afterColumns = catalog('VIRTUAL', '4.00'); }
    if (kind === 'decimal-scale') { afterSource = definition('VIRTUAL', '3.0'); afterColumns = catalog('VIRTUAL', '3.0'); }
    if (kind === 'unchanged') { afterSource = source; afterColumns = structuredClone(columns); }
    const result = await apply(value); expect(result).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: false }); await expect(apply(value)).rejects.toThrow('已使用'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toHaveLength(1); expect(events.at(-1)?.columnPatch).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });
  it('任一四项确认缺失均消费原令牌；连接修订变化亦零DDL', async () => {
    const snapshot = await get(), first = await preview(snapshot); expect(first.requiredAcknowledgements).toHaveLength(4);
    for (const acknowledgement of first.requiredAcknowledgements) { const value = await preview(snapshot); await expect(engine.handle('schema.columns.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements.filter(item => item !== acknowledgement), taskId: 'missing-' + acknowledgement, connectionRevision: 1 })).rejects.toThrow('确认'); await expect(apply(value)).rejects.toThrow('已使用'); }
    await expect(engine.handle('schema.columns.apply', { previewToken: first.previewToken, acknowledgements: first.requiredAcknowledgements, taskId: 'changed-revision', connectionRevision: 2 })).rejects.toThrow('配置已变化'); await expect(apply(first)).rejects.toThrow('已使用'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toEqual([]);
  });
  it('警告紧跟原DDL OK读取；后读目录拒绝不抹掉完成状态且不重放', async () => {
    const value = await preview(await get()); warningCount = 1; hook = sql => { if (sql.startsWith('ALTER TABLE')) permission = /^SELECT COLUMN_NAME AS name, ORDINAL_POSITION/; }; const result = await apply(value), index = sent.findIndex(value => value.sql.startsWith('ALTER'));
    expect(sent[index + 1].sql).toBe('SHOW WARNINGS LIMIT 20'); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(result.warnings.some(message => message.includes('合成表达式重算警告'))).toBe(true); expect(events.every(event => !event.message.includes('合成表达式重算警告'))).toBe(true); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('预览目录挂起取消必须等原回调及原连接关闭，不能降级发布能力', async () => {
    const snapshot = await get(), taskId = 'preview-' + nextId; hold = /^SELECT COLUMN_NAME AS name, ORDINAL_POSITION/; const pending = preview(snapshot), rejected = expect(pending).rejects.toThrow('取消'); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId }); await rejected;
    expect(held!.managed.close).toHaveBeenCalledOnce(); expect(events.at(-1)?.status).toBe('cancelled'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toEqual([]);
  });
  it('DDL挂起取消只投递一次并保留unknown，原回调结算后不能复活预览', async () => {
    const value = await preview(await get()); hold = /^ALTER TABLE/; const pending = apply(value), rejected = expect(pending).rejects.toThrow('取消'); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId: 'apply' }); await rejected;
    expect(held!.managed.close).toHaveBeenCalledOnce(); expect(events.at(-1)?.columnPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' }); await expect(apply(value)).rejects.toThrow('已使用'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('收到DDL OK后的目录取消保留已完成未核实，原回调结算后严格关闭', async () => {
    const value = await preview(await get()); hook = sql => { if (sql.startsWith('ALTER TABLE')) hold = /^SELECT COLUMN_NAME AS name, ORDINAL_POSITION/; }; const pending = apply(value); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId: 'apply' });
    expect(await pending).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: false }); expect(held!.managed.close).toHaveBeenCalledOnce(); await expect(apply(value)).rejects.toThrow('已使用'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('动作已结算但严格关闭未完成时的迟到取消只等待原关闭，不新建KILL或重放', async () => {
    const value = await preview(await get()); holdClose = true; const pending = apply(value); await vi.waitFor(() => expect(heldClose).toBeDefined()); const before = connections.length, cancelling = engine.handle('query.cancel', { taskId: 'apply' });
    expect(heldClose!.managed.close).toHaveBeenCalledWith({ strict: true }); expect(connections).toHaveLength(before); expect(driver.execute).not.toHaveBeenCalled(); expect(events.at(-1)?.status).toBe('running');
    holdClose = false; heldClose!.finish(); await cancelling; expect(await pending).toMatchObject({ ddlCompleted: true, definitionVerified: true }); expect(heldClose!.managed.close).toHaveBeenCalledOnce(); await expect(apply(value)).rejects.toThrow('已使用'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('原连接关闭未知不能发布get快照，closeAll不得把未知伪装成已释放', async () => {
    closeFailure = true; await expect(get()).rejects.toThrow(); expect(unknownClose).toBe(true); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toEqual([]);
  });
  it('DDL后严格关闭失败仍报告已完成证据与失败终态，不返回成功或再次投递', async () => {
    const value = await preview(await get()); closeFailure = true; await expect(apply(value)).rejects.toThrow('关闭失败'); expect(unknownClose).toBe(true); expect(events.at(-1)).toMatchObject({ status: 'failed', columnPatch: { ddlSubmitted: true, ddlCompleted: true, definitionVerified: true } }); await expect(apply(value)).rejects.toThrow('已使用'); expect(sent.filter(value => value.sql.startsWith('ALTER'))).toHaveLength(1);
  });
});
