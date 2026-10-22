import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TableCreateApplyOutput, TableCreateDraft, TableCreateGetOutput, TableCreatePreviewOutput } from '../../src/shared/tableCreate';

const driver = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
/** 只替换传输边界；实际Engine、缓存、目录摘要、SQL及完整后核均使用正式实现。 */
vi.mock('../../src/engine/connection', async () => ({ ...await vi.importActual('../../src/engine/connection'), connect: driver.connect, execute: driver.execute }));
import { closeMysqlConnection } from '../../src/engine/connection';
import { Engine } from '../../src/engine/index';

const profile: ConnectionProfile = { id: 'column-encoding', name: '列级编码RAM', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 3306, user: '合成用户' };
/** 独立待建请求；期望SHOW/COLUMNS另手写，不用产品renderer制造观测。 */
function design(): TableCreateDraft { return { database: 'db', name: 'subject', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_general_ci', comment: '列级编码表', columns: [
  { name: 'id', type: 'bigint unsigned', nullable: false, autoIncrement: false, comment: '' }, { name: 'qty', type: 'int', nullable: true, autoIncrement: false, comment: '' },
  { name: 'label', type: 'varchar(100)', nullable: true, autoIncrement: false, comment: '西文', collation: { charset: 'latin1', collation: 'latin1_bin' } },
  { name: 'body', type: 'text', nullable: true, autoIncrement: false, comment: '中文', collation: { charset: 'utf8mb4', collation: 'utf8mb4_bin' } },
], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }, { name: 'ix_qty', unique: false, columns: ['qty'] }], foreignKeys: [] }; }
const originalShow = "CREATE TABLE `subject` (`id` bigint unsigned NOT NULL,`qty` int DEFAULT NULL,`label` varchar(100) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL COMMENT '西文',`body` text COLLATE utf8mb4_bin COMMENT '中文',PRIMARY KEY (`id`),KEY `ix_qty` (`qty`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='列级编码表'";
interface Column { name: string; ordinal: number | string; typeSql: string; dataType: string; nullable: string; defaultValue: string | null; extra: string; generationExpression: string; charset: string | null; collation: string | null; comment: string; }
function columns(): Column[] { return [
  { name: 'id', ordinal: '1', typeSql: 'bigint unsigned', dataType: 'bigint', nullable: 'NO', defaultValue: null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' },
  { name: 'qty', ordinal: '2', typeSql: 'int', dataType: 'int', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' },
  { name: 'label', ordinal: '3', typeSql: 'varchar(100)', dataType: 'varchar', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: 'latin1', collation: 'latin1_bin', comment: '西文' },
  { name: 'body', ordinal: '4', typeSql: 'text', dataType: 'text', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '中文' },
]; }
let engine: Engine, events: TaskEvent[], sent: string[], rows: Column[], source: string, version: string, dialect: 'mysql' | 'mariadb', sequence: number, showReads: number;
let catalog: { charset: string; collation: string; compiled: string }[], created: boolean, prefix: boolean, foreign: boolean, labelLength: number, latinMax: number;
let held: { complete(error?: Error): void; managed: ManagedConnection } | undefined, hold: RegExp | undefined, denied: RegExp | undefined, lateShow: string | undefined, lateAt: number, closeFails: boolean, unknownClose: boolean;
let fullPatch: Record<string, unknown>, tablesPatch: Record<string, unknown>;
const statistics = () => [{ name: 'PRIMARY', nonUnique: 0, column: 'id', sequence: 1, subPart: null, method: 'BTREE', direction: 'A', comment: '' }, { name: 'ix_qty', nonUnique: 1, column: 'qty', sequence: 1, subPart: null, method: 'BTREE', direction: 'A', comment: '' }, ...(prefix ? [{ name: 'ix_label', nonUnique: 1, column: 'label', sequence: 1, subPart: 3072, method: 'BTREE', direction: 'A', comment: '' }] : [])];
/** 每条原查询均以真实callback结算，未登记也回错误，避免悬空超时掩盖fixture缺漏。 */
function connect(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++sequence, stream = Object.assign(new EventEmitter(), { closed: false, end(callback: () => void) { queueMicrotask(() => { callback(); stream.closed = true; stream.emit('close'); }); } });
  const managed = { connection, signal, profile, status: { version, dialect, connectionId: threadId }, broken: false, close: vi.fn(async () => { if (closeFails) { unknownClose = true; throw Error('合成原流关闭未知'); } await closeMysqlConnection(connection as any, true, false, 500); }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, stream, end: (callback: () => void) => queueMicrotask(callback), destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown) => void) {
    sent.push(sql);
    const complete = (error?: Error) => queueMicrotask(() => {
      if (error) { callback(error); return; } if (denied?.test(sql)) { callback(Object.assign(Error('合成目录权限拒绝'), { errno: 1142, code: 'ER_TABLEACCESS_DENIED_ERROR' })); return; }
      let result: unknown;
      if (sql.startsWith('SELECT @@hostname')) result = [{ hostname: 'ram', port: 3306, serverId: 7, currentUser: 'ram@host', sqlMode: '', lowerNames: 0, charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }];
      else if (sql.startsWith('SELECT @@server_uuid')) result = [{ uuid: '11111111-2222-3333-4444-555555555555' }];
      else if (sql.startsWith('SELECT @@version AS version,@@explicit_defaults_for_timestamp')) result = [{ version, explicitTimestamp: 1, innodbStrict: 1 }];
      else if (sql.startsWith('SELECT VERSION() AS version,')) result = [{ version, os: 'Linux', lowerNames: 0, sqlMode: '', quoteShowCreate: 1, hostname: 'ram', port: 3306, serverId: 7, currentUser: 'ram@host', charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }];
      else if (sql.startsWith('SELECT ENGINE AS engine')) result = [{ engine: 'InnoDB', support: 'DEFAULT' }];
      else if (sql.startsWith('SELECT CHARACTER_SET_NAME AS charset')) result = [{ charset: 'latin1' }, { charset: 'utf8mb4' }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset')) result = structuredClone(catalog);
      else if (sql.startsWith('SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS')) result = [];
      else if (sql.startsWith('SELECT SCHEMA_NAME')) result = [{ name: 'db', charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }];
      else if (sql.startsWith('SELECT @@innodb_page_size')) result = [{ pageSize: 16384, defaultRowFormat: 'dynamic' }];
      else if (sql.startsWith('SELECT CHARACTER_SET_NAME AS name,MAXLEN')) result = [{ name: 'latin1', maxBytes: latinMax }, { name: 'utf8mb4', maxBytes: 4 }];
      else if (sql.startsWith('SELECT TABLE_NAME FROM')) result = created ? [{ TABLE_NAME: 'subject' }] : [];
      else if (sql.startsWith('CREATE TABLE')) { created = true; result = { affectedRows: 0, warningStatus: 0 }; }
      else if (sql.startsWith('SHOW CREATE TABLE')) result = [{ 'Create Table': ++showReads >= lateAt ? lateShow ?? source : source }];
      else if (sql.startsWith('SELECT t.TABLE_SCHEMA AS databaseName')) result = [{ databaseName: 'db', tableName: 'subject', kind: 'BASE TABLE', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_general_ci', ...tablesPatch }];
      else if (sql.startsWith('SELECT PARTITION_NAME AS name')) result = [{ name: null }];
      else if (sql.startsWith('SELECT t.TABLE_NAME')) result = [{ name: 'subject', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_general_ci', comment: '列级编码表' }];
      else if (sql.startsWith('SELECT TABLE_NAME AS name,ENGINE')) result = [{ name: 'subject', engine: 'InnoDB', rowFormat: 'Dynamic', collation: 'utf8mb4_general_ci' }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name,ORDINAL_POSITION')) result = rows.map(row => ({ ...row, ...(row.name === 'label' ? fullPatch : {}) }));
      else if (sql.startsWith('SELECT COLUMN_NAME AS name,COLUMN_TYPE')) result = rows.map(row => ({ name: row.name, type: row.typeSql, nullable: row.nullable, defaultValue: row.defaultValue, extra: row.extra, comment: row.comment, ...(sql.includes('CHARACTER_SET_NAME AS charset') ? { charset: row.charset, collation: row.collation } : {}) }));
      else if (sql.startsWith('SELECT COLUMN_NAME,DATA_TYPE')) result = rows.map(row => ({ COLUMN_NAME: row.name, DATA_TYPE: row.dataType, COLUMN_TYPE: row.typeSql, IS_NULLABLE: row.nullable, CHARACTER_SET_NAME: row.charset, COLLATION_NAME: row.collation, CHARACTER_MAXIMUM_LENGTH: row.name === 'label' ? labelLength : row.name === 'body' ? 65535 : null, CHARACTER_OCTET_LENGTH: row.name === 'label' ? labelLength : row.name === 'body' ? 65535 : null, EXTRA: row.extra }));
      else if (sql.startsWith('SELECT INDEX_NAME AS name')) result = statistics();
      else if (sql.startsWith('SELECT INDEX_NAME,NON_UNIQUE')) result = statistics().map(row => ({ INDEX_NAME: row.name, NON_UNIQUE: row.nonUnique, COLUMN_NAME: row.column, SEQ_IN_INDEX: row.sequence, SUB_PART: row.subPart, INDEX_TYPE: row.method, COLLATION: row.direction, INDEX_COMMENT: row.comment, EXPRESSION: null, IS_VISIBLE: 'YES' }));
      else if (sql.includes('FROM information_schema.REFERENTIAL_CONSTRAINTS')) result = foreign ? [{ CONSTRAINT_SCHEMA: 'db', CONSTRAINT_NAME: 'fk_qty', TABLE_NAME: 'subject', UNIQUE_CONSTRAINT_SCHEMA: 'db', REFERENCED_TABLE_NAME: 'parent', UNIQUE_CONSTRAINT_NAME: 'PRIMARY', MATCH_OPTION: 'NONE', UPDATE_RULE: 'RESTRICT', DELETE_RULE: 'RESTRICT' }] : [];
      else if (sql.includes('FROM information_schema.KEY_COLUMN_USAGE')) result = foreign ? [{ CONSTRAINT_SCHEMA: 'db', CONSTRAINT_NAME: 'fk_qty', TABLE_SCHEMA: 'db', TABLE_NAME: 'subject', COLUMN_NAME: 'qty', ORDINAL_POSITION: 1, POSITION_IN_UNIQUE_CONSTRAINT: 1, REFERENCED_TABLE_SCHEMA: 'db', REFERENCED_TABLE_NAME: 'parent', REFERENCED_COLUMN_NAME: 'id' }] : [];
      else { callback(Error('列级编码RAM未登记SQL')); return; }
      callback(null, result);
    });
    if (hold?.test(sql)) held = { complete, managed }; else complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); return managed;
}
/** 测试修订只模拟真实Main私有注入，执行输入从不包含SQL。 */
const get = (encodings = true, facts = false, prefixed = false): Promise<TableCreateGetOutput> => engine.handle('schema.tableCreate.get', { connectionId: profile.id, database: 'db', connectionRevision: 1, taskId: 'get-' + sequence, ...(encodings ? { includeEncodings: true } : {}), ...(facts ? { includeGeneratedFacts: true } : {}), ...(prefixed ? { includePrefixFacts: true } : {}) });
const preview = (snapshot: TableCreateGetOutput, input = design()): Promise<TableCreatePreviewOutput> => engine.handle('schema.tableCreate.preview', { snapshotId: snapshot.snapshotId, design: input, connectionRevision: 1, taskId: 'preview-' + sequence });
const apply = (value: TableCreatePreviewOutput, confirmation = 'db.subject'): Promise<TableCreateApplyOutput> => engine.handle('schema.tableCreate.apply', { previewToken: value.previewToken, confirmation, acknowledgements: value.requiredAcknowledgements, connectionRevision: 1, taskId: 'apply-' + sequence });
beforeEach(async () => {
  rows = columns(); source = originalShow; version = '8.4.11'; dialect = 'mysql'; sequence = showReads = 0; events = []; sent = []; created = prefix = foreign = closeFails = unknownClose = false; labelLength = 100; latinMax = 1; lateAt = Infinity; lateShow = held = hold = denied = undefined;
  // 两次目录的反例控制必须独立，不能让完整COLUMNS补丁意外污染更早的TABLES证据。
  fullPatch = {}; tablesPatch = {};
  catalog = [{ charset: 'latin1', collation: 'latin1_bin', compiled: 'YES' }, { charset: 'latin1', collation: 'latin1_swedish_ci', compiled: 'YES' }, { charset: 'utf8mb4', collation: 'utf8mb4_bin', compiled: 'YES' }, { charset: 'utf8mb4', collation: 'utf8mb4_general_ci', compiled: 'YES' }];
  driver.connect.mockReset().mockImplementation(async (_profile, _database, signal) => connect(signal)); driver.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Error('合成原命令已取消')); return { rows: [] }; }); engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => { hold = undefined; closeFails = false; held?.complete(Error('合成收尾')); if (unknownClose) await expect(engine.closeAll()).rejects.toThrow('资源未确认释放'); else await engine.closeAll(); });

/** 与字符配对并列的普通数值生成列；原SHOW和真实目录独立固定。 */
function withGenerated(input = design()): TableCreateDraft {
  input.columns.push({ name: 'computed', type: 'decimal(20,2)', nullable: true, autoIncrement: false, comment: '计算', generated: { storage: 'STORED', expression: 'qty * 1.00' } });
  source = source.replace(',PRIMARY KEY', ",`computed` decimal(20,2) GENERATED ALWAYS AS ((`qty` * 1.00)) STORED COMMENT '计算',PRIMARY KEY"); rows.push({ name: 'computed', ordinal: '5', typeSql: 'decimal(20,2)', dataType: 'decimal', nullable: 'YES', defaultValue: null, extra: 'STORED GENERATED', generationExpression: '(`qty` * 1.00)', charset: null, collation: null, comment: '计算' }); return input;
}
/** 表默认utf8mb4但键列latin1：3072个字符恰3072字节，不能误用表级MAXLEN=4。 */
function withPrefix(): TableCreateDraft { const input = design(); prefix = true; labelLength = 4000; input.columns[2].type = 'varchar(4000)'; input.indexes.push({ name: 'ix_label', unique: false, keyParts: [{ columnName: 'label', prefixLength: 3072 }] }); rows[2].typeSql = 'varchar(4000)'; source = source.replace('varchar(100)', 'varchar(4000)').replace(') ENGINE=', ',KEY `ix_label` (`label`(3072))) ENGINE=').replace(" COMMENT='列级编码表'", " ROW_FORMAT=DYNAMIC COMMENT='列级编码表'"); return input; }

describe('列级编码真实Engine与独立目录（只RAM，不作实库结论）', () => {
  it.each([['mysql', '5.7.44'], ['mysql', '8.0.46'], ['mysql', '8.4.11'], ['mariadb', '10.11.19-MariaDB'], ['mariadb', '11.4.13-MariaDB']] as const)('%s %s普通TEXT/VARCHAR使用准确列配对并完整核验，单CREATE且不可重放', async (family, release) => {
    dialect = family; version = release;
    if (release === '5.7.44') { source = source.replace('bigint unsigned', 'bigint(20) unsigned').replace('`qty` int DEFAULT', '`qty` int(11) DEFAULT'); rows[0].typeSql = 'bigint(20) unsigned'; rows[1].typeSql = 'int(11)'; }
    if (family === 'mariadb') rows.slice(1).forEach(row => { row.defaultValue = 'NULL'; });
    const snapshot = await get(), value = await preview(snapshot); expect(value.columnEncodings).toEqual({ catalogDigest: snapshot.encodings!.digest, selections: [{ ordinal: 2, name: 'label', charset: 'latin1', collation: 'latin1_bin' }, { ordinal: 3, name: 'body', charset: 'utf8mb4', collation: 'utf8mb4_bin' }] }); expect(created).toBe(false); expect(value.sql).toContain('CHARACTER SET latin1 COLLATE latin1_bin'); expect(value.requiredAcknowledgements).toHaveLength(2); expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: true }); await expect(apply(value)).rejects.toThrow('失效'); expect(sent.filter(sql => sql.startsWith('CREATE TABLE'))).toEqual([value.sql]); expect(sent.some(sql => /^DROP|^ALTER/.test(sql))).toBe(false);
  });
  it('生成列与普通FK不丢失列级pair，三确认及两套外键目录完整保持', async () => {
    const input = withGenerated(); foreign = true; input.foreignKeys = [{ name: 'fk_qty', columns: ['qty'], referencedDatabase: 'db', referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }]; source = source.replace(') ENGINE=', ',CONSTRAINT `fk_qty` FOREIGN KEY (`qty`) REFERENCES `db`.`parent` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT) ENGINE='); const value = await preview(await get(true, true), input); expect(value.requiredAcknowledgements).toHaveLength(3); expect(await apply(value)).toMatchObject({ definitionVerified: true }); expect(sent.filter(sql => /REFERENTIAL_CONSTRAINTS|KEY_COLUMN_USAGE/.test(sql))).toHaveLength(2);
  });
  it('仅列级pair而不指定表collation仍绑定真实目录并完整后核', async () => { const input = design(); delete input.collation; const snapshot = await get(), value = await preview(snapshot, input); expect(value.encoding).toBeUndefined(); expect(value.columnEncodings?.catalogDigest).toBe(snapshot.encodings!.digest); expect(await apply(value)).toMatchObject({ definitionVerified: true }); expect(sent.filter(sql => sql.startsWith('CREATE TABLE'))).toEqual([value.sql]); });
  it.each(['char(100)', "enum('a','é')", "set('a','é')"])('普通%s显式latin1配对保持受控类型及独立目录', async type => {
    const input = design(); input.columns[2].type = type; rows[2].typeSql = type; rows[2].dataType = type.split('(')[0]; source = source.replace('varchar(100)', type); expect(await apply(await preview(await get(), input))).toMatchObject({ definitionVerified: true });
  });
  it('8.4用列latin1真实MAXLEN而非表utf8mb4规划3072字符前缀，所有非键列也后核', async () => {
    const input = withGenerated(withPrefix()), value = await preview(await get(true, true, true), input); expect(value.sql).toContain('`label`(3072)'); expect(await apply(value)).toMatchObject({ definitionVerified: true }); expect(sent.some(sql => sql.startsWith('SELECT COLUMN_NAME,DATA_TYPE'))).toBe(true);
  });
  it('列latin1前缀3073字节拒绝且零DDL，不能自动缩短', async () => { const input = withPrefix(); input.indexes[2] = { name: 'ix_label', unique: false, keyParts: [{ columnName: 'label', prefixLength: 3073 }] }; await expect(preview(await get(true, false, true), input)).rejects.toThrow('3072'); expect(created).toBe(false); });
  it.each(['no-catalog', 'missing-pair', 'mismatched-pair', 'denied'])('%s不能凭renderer回执补造列配对，普通无pair预览仍可继续', async kind => {
    if (kind === 'denied') denied = /^SELECT c.CHARACTER_SET_NAME AS charset/; if (kind === 'missing-pair') catalog = catalog.filter(pair => pair.collation !== 'latin1_bin'); const snapshot = await get(kind !== 'no-catalog'), input = design(); delete input.collation; if (kind === 'mismatched-pair') input.columns[2].collation = { charset: 'utf8mb4', collation: 'latin1_bin' };
    // 改写公开回执不能改写Engine私有快照，伪造目录摘要和候选也不得获得写能力。
    snapshot.encodings = { digest: 'a'.repeat(64), warnings: [], reasons: [], candidates: [{ charset: 'latin1', collation: 'latin1_bin' }, { charset: 'utf8mb4', collation: 'latin1_bin' }, { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }] };
    await expect(preview(snapshot, input)).rejects.toThrow(); const ordinary = design(); delete ordinary.collation; ordinary.columns.forEach(column => { delete column.collation; }); await expect(preview(snapshot, ordinary)).resolves.toHaveProperty('previewToken'); expect(created).toBe(false);
  });
  it.each(['get-preview', 'preview-apply'])('完整目录%s变化时拒绝，即使选中配对原文未变', async phase => {
    const input = design(); delete input.collation; const snapshot = await get(); if (phase === 'get-preview') { catalog[1].compiled = 'NO'; await expect(preview(snapshot, input)).rejects.toThrow(); } else { const value = await preview(snapshot, input); catalog[1].compiled = 'NO'; await expect(apply(value)).rejects.toThrow(); await expect(apply(value)).rejects.toThrow('失效'); } expect(created).toBe(false);
  });
  it.each(['ordinary', 'generated', 'prefix', 'generated-prefix'])('%s完整COLUMNS单次默认值矛盾不能借后续简目录NULL补成核验成功', async kind => {
    const hasGenerated = kind.includes('generated'), hasPrefix = kind.includes('prefix'); let input = hasPrefix ? withPrefix() : design(); if (hasGenerated) input = withGenerated(input); delete input.collation;
    const value = await preview(await get(true, hasGenerated, hasPrefix), input), originalSource = source;
    // 只污染第一次完整11字段COLUMNS；原SHOW及后续简版目录都严格保持原NULL。
    fullPatch.defaultValue = '9'; expect(tablesPatch).toEqual({}); expect(rows[2].defaultValue).toBeNull(); expect(source).toContain("DEFAULT NULL COMMENT '西文'");
    expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: false, resourcesReleased: true });
    expect(source).toBe(originalSource); expect(rows[2].defaultValue).toBeNull(); expect(sent.some(sql => sql.startsWith('SELECT COLUMN_NAME AS name,ORDINAL_POSITION'))).toBe(true);
    await expect(apply(value)).rejects.toThrow('失效'); expect(sent.filter(sql => sql.startsWith('CREATE TABLE'))).toEqual([value.sql]); expect(sent.some(sql => /^DROP|^ALTER/.test(sql))).toBe(false);
  });
  it.each(['catalog-charset', 'catalog-collation', 'show-charset', 'show-collation', 'ordinary-unknown', 'unknown-field', 'table-pair', 'default', 'null', 'type', 'ordinal', 'permission', 'late-show'])('CREATE收到OK后%s不能伪报完整后核，也不DROP/重放', async kind => {
    const value = await preview(await get()); if (kind === 'catalog-charset') rows[2].charset = 'utf8mb4'; if (kind === 'catalog-collation') rows[2].collation = 'latin1_swedish_ci'; if (kind === 'show-charset') source = source.replace('CHARACTER SET latin1', 'CHARACTER SET utf8mb4'); if (kind === 'show-collation') source = source.replace('COLLATE latin1_bin', 'COLLATE latin1_swedish_ci'); if (kind === 'ordinary-unknown') rows[2].extra = 'INVISIBLE'; if (kind === 'table-pair') tablesPatch.collation = 'utf8mb4_bin'; if (kind === 'default') rows[2].defaultValue = '9'; if (kind === 'null') rows[2].nullable = 'NO'; if (kind === 'type') rows[2].typeSql = 'varchar(101)'; if (kind === 'ordinal') rows[2].ordinal = '4'; if (kind === 'permission') denied = /^SELECT COLUMN_NAME AS name,ORDINAL_POSITION/; if (kind === 'late-show') { lateAt = 2; lateShow = source.replace('latin1_bin', 'latin1_swedish_ci'); }
    if (kind === 'unknown-field') fullPatch.future = '未证明的额外字段';
    expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: false }); await expect(apply(value)).rejects.toThrow('失效'); expect(sent.filter(sql => sql.startsWith('CREATE TABLE'))).toEqual([value.sql]); expect(sent.some(sql => /^DROP|^ALTER/.test(sql))).toBe(false);
  });
  it('错误准确目标确认消费原令牌且零DDL', async () => { const value = await preview(await get()); await expect(apply(value, 'db.subject ')).rejects.toThrow('确认'); await expect(apply(value)).rejects.toThrow('失效'); expect(created).toBe(false); });
  it('预览目录等待时释放快照，迟到响应不得签发新预览', async () => { const snapshot = await get(); hold = /^SELECT c.CHARACTER_SET_NAME AS charset/; const pending = preview(snapshot), rejected = expect(pending).rejects.toThrow('失效'); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('schema.tableCreate.release', { snapshotId: snapshot.snapshotId }); hold = undefined; held!.complete(); await rejected; expect(created).toBe(false); });
  it('目录查询取消沿原任务拒绝和严格原流关闭，不伪装目录空候选', async () => { hold = /^SELECT c.CHARACTER_SET_NAME AS charset/; const taskId = 'get-' + sequence, pending = get(), rejected = expect(pending).rejects.toThrow('取消'); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId }); await rejected; expect(held!.managed.close).toHaveBeenCalledOnce(); expect(created).toBe(false); });
  it('OK后关闭未知只保留DDL/定义事实，不能以完成Promise冒充资源释放', async () => { const value = await preview(await get()); closeFails = true; expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: false }); await expect(apply(value)).rejects.toThrow('失效'); expect(sent.filter(sql => sql.startsWith('CREATE TABLE'))).toEqual([value.sql]); });
  it('原无列pair旧输入执行后也不读取新完整COLUMNS或新增目录', async () => {
    const input = design(); delete input.collation; input.columns.forEach(column => { delete column.collation; }); rows[2].charset = 'utf8mb4'; rows[2].collation = rows[3].collation = 'utf8mb4_general_ci';
    source = "CREATE TABLE `subject` (`id` bigint unsigned NOT NULL,`qty` int DEFAULT NULL,`label` varchar(100) DEFAULT NULL COMMENT '西文',`body` text COMMENT '中文',PRIMARY KEY (`id`),KEY `ix_qty` (`qty`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='列级编码表'";
    const value = await preview(await get(false), input); expect(value.columnEncodings).toBeUndefined(); expect(value.requiredAcknowledgements).toHaveLength(2); expect(created).toBe(false); expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: true }); expect(sent.some(sql => sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset') || sql.startsWith('SELECT COLUMN_NAME AS name,ORDINAL_POSITION'))).toBe(false); expect(sent.filter(sql => sql.startsWith('CREATE TABLE'))).toEqual([value.sql]);
  });
});
