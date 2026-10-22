import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import { tableCreateRequiredAcknowledgements, type TableCreateApplyOutput, type TableCreateDraft, type TableCreateGetOutput, type TableCreatePreviewOutput } from '../../src/shared/tableCreate';
import { buildDesign, buildGeneratedTableDesign, buildPrefixTableDesign } from '../../src/engine/sql';
const driver = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
// 仅替换原连接边界，真实Engine、事实读取、计划、后核、取消和严格关闭全部保留。
vi.mock('../../src/engine/connection', async () => ({ ...await vi.importActual('../../src/engine/connection'), connect: driver.connect, execute: driver.execute }));
import { closeMysqlConnection } from '../../src/engine/connection';
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'generated-create', name: '新表生成列RAM', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 3306, user: '合成用户' };
/** 草稿、SHOW及目录均独立手写，不用产品生成器/解析器反推对照。 */
function design(): TableCreateDraft { return { database: 'db', name: 'subject', engine: 'InnoDB', charset: 'utf8mb4', comment: '本例表', columns: [
  { name: 'id', type: 'bigint unsigned', nullable: false, autoIncrement: true, comment: '' },
  { name: 'qty', type: 'int', nullable: true, autoIncrement: false, comment: '' },
  { name: 'price', type: 'decimal(20,6)', nullable: true, autoIncrement: false, comment: '' },
  { name: 'note', type: 'varchar(64)', nullable: true, autoIncrement: false, comment: '' },
  { name: 'virtual_total', type: 'decimal(30,6)', nullable: true, autoIncrement: false, comment: '虚拟', generated: { storage: 'VIRTUAL', expression: '+(qty * price)' } },
  { name: 'stored_total', type: 'decimal(30,6)', nullable: true, autoIncrement: false, comment: '存储', generated: { storage: 'STORED', expression: 'qty * price + 1.00' } },
], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }, { name: 'ix_qty', unique: false, columns: ['qty'] }], foreignKeys: [] }; }
const show = "CREATE TABLE `subject` (`id` bigint unsigned NOT NULL AUTO_INCREMENT,`qty` int DEFAULT NULL,`price` decimal(20,6) DEFAULT NULL,`note` varchar(64) DEFAULT NULL,`virtual_total` decimal(30,6) GENERATED ALWAYS AS ((`qty` * `price`)) VIRTUAL COMMENT '虚拟',`stored_total` decimal(30,6) GENERATED ALWAYS AS (((`qty` * `price`) + 1.00)) STORED COMMENT '存储',PRIMARY KEY (`id`),KEY `ix_qty` (`qty`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='本例表'";
/** 首轮5.7原SHOW原件，仅将随机所有者注释换成本例固定注释；不由产品renderer/解析器构造期望。 */
const mysql57ObservedShow = "CREATE TABLE `subject` (\n  `id` bigint(20) unsigned NOT NULL,\n  `qty` int(11) DEFAULT NULL,\n  `price` decimal(20,6) DEFAULT NULL,\n  `note` varchar(100) COLLATE utf8mb4_bin DEFAULT NULL,\n  `virtual_total` decimal(30,6) GENERATED ALWAYS AS ((`qty` * `price`)) VIRTUAL COMMENT '虚拟结果',\n  `stored_total` decimal(30,6) GENERATED ALWAYS AS (((`qty` * `price`) + 1.000000)) STORED COMMENT '存储结果',\n  PRIMARY KEY (`id`),\n  KEY `ix_qty` (`qty`),\n  CONSTRAINT `fk_qty` FOREIGN KEY (`qty`) REFERENCES `parent` (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='本例表'";
interface Column { name: string; ordinal: number | string; typeSql: string; dataType: string; nullable: string; defaultValue: string | null; extra: string; generationExpression: string; charset: string | null; collation: string | null; comment: string; }
function catalog(): Column[] { return [
  { name: 'id', ordinal: 1, typeSql: 'bigint unsigned', dataType: 'bigint', nullable: 'NO', defaultValue: null, extra: 'auto_increment', generationExpression: '', charset: null, collation: null, comment: '' },
  { name: 'qty', ordinal: 2, typeSql: 'int', dataType: 'int', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' },
  { name: 'price', ordinal: 3, typeSql: 'decimal(20,6)', dataType: 'decimal', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' },
  { name: 'note', ordinal: 4, typeSql: 'varchar(64)', dataType: 'varchar', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '' },
  { name: 'virtual_total', ordinal: 5, typeSql: 'decimal(30,6)', dataType: 'decimal', nullable: 'YES', defaultValue: null, extra: 'VIRTUAL GENERATED', generationExpression: '`qty` * `price`', charset: null, collation: null, comment: '虚拟' },
  { name: 'stored_total', ordinal: 6, typeSql: 'decimal(30,6)', dataType: 'decimal', nullable: 'YES', defaultValue: null, extra: 'STORED GENERATED', generationExpression: '(`qty` * `price`) + 1.00', charset: null, collation: null, comment: '存储' },
]; }
let engine: Engine, events: TaskEvent[], commands: string[], connections: ManagedConnection[], rows: Column[], source: string, sequence: number, showReads: number, laterShowAt: number;
let version: string, dialect: 'mysql' | 'mariadb', support: string, os: string, pageSize: number, maxBytes: number, mode: string, uuid: string, occupied: boolean, created: boolean, foreign: boolean, prefix: boolean, laterShow: string | undefined;
let permission: RegExp | undefined, fail: RegExp | undefined, hold: RegExp | undefined, closeFails: boolean, unknownClose: boolean;
let held: { managed: ManagedConnection; complete(error?: Error): void } | undefined;
const statistics = () => [{ name: 'PRIMARY', nonUnique: 0, column: 'id', sequence: 1, subPart: null, method: 'BTREE', direction: 'A', comment: '' }, { name: 'ix_qty', nonUnique: 1, column: 'qty', sequence: 1, subPart: null, method: 'BTREE', direction: 'A', comment: '' }, ...(prefix ? [{ name: 'ix_note', nonUnique: 1, column: 'note', sequence: 1, subPart: 10, method: 'BTREE', direction: 'A', comment: '' }] : [])];

/** 原回调含未知语句也必须结算；严格close沿正式原流实现，不用Promise end冒充释放。 */
function connect(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++sequence, stream = Object.assign(new EventEmitter(), { closed: false, end(callback: () => void) { queueMicrotask(() => { callback(); stream.closed = true; stream.emit('close'); }); } });
  const managed: ManagedConnection = { connection, signal, profile, status: { version, dialect, connectionId: threadId }, broken: false, close: vi.fn(async () => { if (closeFails) { unknownClose = true; throw Error('合成原流关闭未知'); } await closeMysqlConnection(connection as any, true, false, 500); }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, stream, end: (callback: () => void) => queueMicrotask(callback), destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, result?: unknown) => void) {
    commands.push(sql);
    const complete = (error?: Error) => queueMicrotask(() => {
      if (error || fail?.test(sql)) { callback(error ?? Error('合成结果未知')); return; }
      if (permission?.test(sql)) { callback(Object.assign(Error('合成目录拒读'), { errno: 1142, code: 'ER_TABLEACCESS_DENIED_ERROR' })); return; }
      let result: unknown;
      if (sql.startsWith('SELECT @@hostname')) result = [{ hostname: 'ram', port: 3306, serverId: 7, currentUser: 'ram@host', sqlMode: mode, lowerNames: 0, charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT VERSION() AS version,')) result = [{ version, os, lowerNames: 0, sqlMode: mode, quoteShowCreate: 1, hostname: 'ram', port: 3306, serverId: 7, currentUser: 'ram@host', charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT @@server_uuid')) result = [{ uuid }];
      else if (sql.startsWith('SELECT @@version AS version,@@explicit_defaults_for_timestamp')) result = [{ version, explicitTimestamp: 1, innodbStrict: 1 }];
      else if (sql.startsWith('SELECT ENGINE AS engine')) result = [{ engine: 'InnoDB', support }];
      else if (sql.startsWith('SELECT CHARACTER_SET_NAME AS charset')) result = [{ charset: 'utf8mb4' }];
      else if (sql.startsWith('SELECT SCHEMA_NAME')) result = [{ name: 'db', charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT TABLE_NAME FROM')) result = occupied || created ? [{ TABLE_NAME: 'subject' }] : [];
      else if (sql.startsWith('SELECT @@innodb_page_size')) result = [{ pageSize, defaultRowFormat: 'dynamic' }];
      else if (sql.startsWith('SELECT CHARACTER_SET_NAME AS name,MAXLEN')) result = [{ name: 'utf8mb4', maxBytes }];
      else if (sql.startsWith('CREATE TABLE')) { created = true; result = { affectedRows: 0, warningStatus: 0 }; }
      else if (sql.startsWith('SHOW CREATE TABLE')) result = [{ 'Create Table': ++showReads >= laterShowAt ? laterShow ?? source : source }];
      else if (sql.startsWith('SELECT t.TABLE_SCHEMA AS databaseName')) result = [{ databaseName: 'db', tableName: 'subject', kind: 'BASE TABLE', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT PARTITION_NAME AS name')) result = [{ name: null }];
      else if (sql.startsWith('SELECT t.TABLE_NAME')) result = [{ name: 'subject', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '本例表' }];
      else if (sql.startsWith('SELECT TABLE_NAME AS name,ENGINE')) result = [{ name: 'subject', engine: 'InnoDB', rowFormat: 'Dynamic', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name,ORDINAL_POSITION')) result = structuredClone(rows);
      else if (sql.startsWith('SELECT COLUMN_NAME AS name,COLUMN_TYPE')) result = rows.map(row => ({ name: row.name, type: row.typeSql, nullable: row.nullable, defaultValue: row.defaultValue, extra: row.extra, comment: row.comment }));
      else if (sql.startsWith('SELECT COLUMN_NAME,DATA_TYPE')) result = rows.map(row => ({ COLUMN_NAME: row.name, DATA_TYPE: row.dataType, COLUMN_TYPE: row.typeSql, IS_NULLABLE: row.nullable, CHARACTER_SET_NAME: row.charset, COLLATION_NAME: row.collation, CHARACTER_MAXIMUM_LENGTH: row.name === 'note' ? 64 : null, CHARACTER_OCTET_LENGTH: row.name === 'note' ? 256 : null, EXTRA: row.extra }));
      else if (sql.startsWith('SELECT INDEX_NAME AS name')) result = statistics();
      else if (sql.startsWith('SELECT INDEX_NAME,NON_UNIQUE')) result = statistics().map(row => ({ INDEX_NAME: row.name, NON_UNIQUE: row.nonUnique, COLUMN_NAME: row.column, SEQ_IN_INDEX: row.sequence, SUB_PART: row.subPart, INDEX_TYPE: row.method, COLLATION: row.direction, INDEX_COMMENT: row.comment, EXPRESSION: null, IS_VISIBLE: 'YES' }));
      else if (sql.includes('FROM information_schema.REFERENTIAL_CONSTRAINTS')) result = foreign ? [{ CONSTRAINT_SCHEMA: 'db', CONSTRAINT_NAME: 'fk_qty', TABLE_NAME: 'subject', UNIQUE_CONSTRAINT_SCHEMA: 'db', REFERENCED_TABLE_NAME: 'parent', UNIQUE_CONSTRAINT_NAME: 'PRIMARY', MATCH_OPTION: 'NONE', UPDATE_RULE: 'RESTRICT', DELETE_RULE: 'RESTRICT' }] : [];
      else if (sql.includes('FROM information_schema.KEY_COLUMN_USAGE')) result = foreign ? [{ CONSTRAINT_SCHEMA: 'db', CONSTRAINT_NAME: 'fk_qty', TABLE_SCHEMA: 'db', TABLE_NAME: 'subject', COLUMN_NAME: 'qty', ORDINAL_POSITION: 1, POSITION_IN_UNIQUE_CONSTRAINT: 1, REFERENCED_TABLE_SCHEMA: 'db', REFERENCED_TABLE_NAME: 'parent', REFERENCED_COLUMN_NAME: 'id' }] : [];
      else { callback(Error('新表生成RAM未登记SQL')); return; }
      callback(null, result);
    });
    if (hold?.test(sql)) held = { managed, complete }; else complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(managed); return managed;
}

/** 只通过真实Engine入口，修订模拟Main私有注入；apply不携带SQL。 */
const get = (generated = true, withPrefix = false): Promise<TableCreateGetOutput> => engine.handle('schema.tableCreate.get', { connectionId: profile.id, database: 'db', taskId: 'get-' + sequence, connectionRevision: 1, ...(generated ? { includeGeneratedFacts: true } : {}), ...(withPrefix ? { includePrefixFacts: true } : {}) });
const preview = (snapshot: TableCreateGetOutput, input = design()): Promise<TableCreatePreviewOutput> => engine.handle('schema.tableCreate.preview', { snapshotId: snapshot.snapshotId, design: input, taskId: 'preview-' + sequence, connectionRevision: 1 });
const apply = (value: TableCreatePreviewOutput, options: { taskId?: string; acknowledgements?: string[]; revision?: number; confirmation?: string } = {}): Promise<TableCreateApplyOutput> => engine.handle('schema.tableCreate.apply', { previewToken: value.previewToken, confirmation: options.confirmation ?? 'db.subject', acknowledgements: options.acknowledgements ?? value.requiredAcknowledgements, taskId: options.taskId ?? 'apply', connectionRevision: options.revision ?? 1 });
beforeEach(async () => {
  events = []; commands = []; connections = []; rows = catalog(); source = show; sequence = showReads = 0; laterShowAt = 2; version = '8.4.11'; dialect = 'mysql'; support = 'DEFAULT'; os = 'Linux'; pageSize = 16384; maxBytes = 4; mode = ''; uuid = '11111111-2222-3333-4444-555555555555'; occupied = created = foreign = prefix = closeFails = unknownClose = false; laterShow = permission = fail = hold = held = undefined;
  driver.connect.mockReset().mockImplementation(async (_profile, _database, signal) => connect(signal)); driver.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Error('合成原命令已取消')); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => { hold = undefined; closeFails = false; held?.complete(Error('合成收尾')); if (unknownClose) await expect(engine.closeAll()).rejects.toThrow('资源未确认释放'); else await engine.closeAll(); });

/** 原5.7观测的类型、NULL、EXTRA、编码及表达式逐项固定，未从SHOW反解或补造。 */
function mysql57ObservedFixture(): TableCreateDraft {
  version = '5.7.44'; source = mysql57ObservedShow; foreign = true;
  rows = [
    { name: 'id', ordinal: '1', typeSql: 'bigint(20) unsigned', dataType: 'bigint', nullable: 'NO', defaultValue: null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' },
    { name: 'qty', ordinal: '2', typeSql: 'int(11)', dataType: 'int', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' },
    { name: 'price', ordinal: '3', typeSql: 'decimal(20,6)', dataType: 'decimal', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' },
    { name: 'note', ordinal: '4', typeSql: 'varchar(100)', dataType: 'varchar', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '' },
    { name: 'virtual_total', ordinal: '5', typeSql: 'decimal(30,6)', dataType: 'decimal', nullable: 'YES', defaultValue: null, extra: 'VIRTUAL GENERATED', generationExpression: '(`qty` * `price`)', charset: null, collation: null, comment: '虚拟结果' },
    { name: 'stored_total', ordinal: '6', typeSql: 'decimal(30,6)', dataType: 'decimal', nullable: 'YES', defaultValue: null, extra: 'STORED GENERATED', generationExpression: '((`qty` * `price`) + 1.000000)', charset: null, collation: null, comment: '存储结果' },
  ];
  const input = design(); input.columns[0].autoIncrement = false; input.columns[3].type = 'varchar(100)'; input.columns[4].comment = '虚拟结果'; input.columns[5].comment = '存储结果'; input.columns[5].generated!.expression = 'qty * price + 1.000000';
  input.foreignKeys = [{ name: 'fk_qty', columns: ['qty'], referencedDatabase: 'db', referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }]; return input;
}

describe('新表多生成列真实Engine及独立目录RAM', () => {
  it('5.7原SHOW显式普通列COLLATE在实际表/列编码完整交叉后通过，外键及生成精度保留', async () => {
    const input = mysql57ObservedFixture(), value = await preview(await get(), input);
    expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: true }); expect(commands.filter(sql => sql.startsWith('CREATE TABLE'))).toEqual([value.sql]); await expect(apply(value)).rejects.toThrow('失效'); expect(commands.some(sql => /^DROP|^ALTER/.test(sql))).toBe(false);
  });
  it.each(['show-collation', 'catalog-collation', 'catalog-charset', 'unknown-attribute'])('5.7显式编码%s不一致仍只保留ACK完成，不放宽后核', async kind => {
    const input = mysql57ObservedFixture(), value = await preview(await get(), input);
    if (kind === 'show-collation') source = source.replace('varchar(100) COLLATE utf8mb4_bin', 'varchar(100) COLLATE utf8mb4_general_ci');
    if (kind === 'catalog-collation') rows[3].collation = 'utf8mb4_general_ci'; if (kind === 'catalog-charset') rows[3].charset = 'latin1'; if (kind === 'unknown-attribute') source = source.replace('varchar(100) COLLATE utf8mb4_bin', 'varchar(100) COLLATE utf8mb4_bin STORAGE DISK');
    expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(commands.filter(sql => sql.startsWith('CREATE TABLE'))).toEqual([value.sql]); await expect(apply(value)).rejects.toThrow('失效'); expect(commands.some(sql => /^DROP|^ALTER/.test(sql))).toBe(false);
  });
  it.each([['mysql', '5.7.44'], ['mysql', '8.0.46'], ['mysql', '8.4.11'], ['mariadb', '10.11.19-MariaDB'], ['mariadb', '11.4.13-MariaDB']] as const)('%s %s同时创建VIRTUAL/STORED并保持普通主键和索引，单次DDL不重放', async (family, release) => {
    dialect = family; version = release; if (family === 'mysql' && release === '5.7.44') { source = source.replace('bigint unsigned', 'bigint(20) unsigned').replace('`qty` int DEFAULT', '`qty` int(11) DEFAULT'); rows[0].typeSql = 'bigint(20) unsigned'; rows[1].typeSql = 'int(11)'; }
    if (family === 'mariadb') { source = source.replace(' STORED ', ' PERSISTENT '); rows[4].defaultValue = rows[5].defaultValue = 'NULL'; rows[5].extra = 'PERSISTENT GENERATED'; }
    const snapshot = await get(); expect(snapshot.generatedAccess).toEqual({ editable: true }); const value = await preview(snapshot); expect(value.sql).toContain('GENERATED ALWAYS AS'); expect(value.sql).toContain('PRIMARY KEY (`id`)'); expect(value.sql).toContain('KEY `ix_qty` (`qty`)'); expect(value.requiredAcknowledgements).toEqual(tableCreateRequiredAcknowledgements(design())); expect(value.requiredAcknowledgements).toHaveLength(3); expect(created).toBe(false);
    expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: true }); await expect(apply(value)).rejects.toThrow('失效'); expect(commands.filter(sql => sql.startsWith('CREATE TABLE'))).toEqual([value.sql]); expect(commands.some(sql => /^DROP|^ALTER/.test(sql))).toBe(false); expect(events.at(-1)?.tableCreate).toMatchObject({ ddlCompleted: true, definitionVerified: true });
  });
  it('普通外键与显式普通子键完整后核，旁边生成列不导致整表拒绝', async () => {
    const input = design(); foreign = true; input.foreignKeys = [{ name: 'fk_qty', columns: ['qty'], referencedDatabase: 'db', referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }]; source = source.replace(') ENGINE=', ',CONSTRAINT `fk_qty` FOREIGN KEY (`qty`) REFERENCES `db`.`parent` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT) ENGINE=');
    const value = await preview(await get(), input); expect(value.sql).toContain('FOREIGN KEY (`qty`)'); expect(await apply(value)).toMatchObject({ definitionVerified: true }); expect(commands.filter(sql => /REFERENTIAL_CONSTRAINTS|KEY_COLUMN_USAGE/.test(sql))).toHaveLength(2);
  });
  it('准确8.4前缀索引与非键生成列并存，完整目录和索引集合均核验', async () => {
    const input = design(); prefix = true; input.indexes.push({ name: 'ix_note', unique: false, keyParts: [{ columnName: 'note', prefixLength: 10 }] }); source = source.replace(') ENGINE=', ',KEY `ix_note` (`note`(10))) ENGINE=').replace(" COMMENT='本例表'", " ROW_FORMAT=DYNAMIC COMMENT='本例表'");
    const value = await preview(await get(true, true), input); expect(value.sql).toContain('KEY `ix_note` (`note`(10))'); expect(value.sql).toContain('ROW_FORMAT=DYNAMIC'); expect(await apply(value)).toMatchObject({ definitionVerified: true }); expect(commands.some(sql => sql.startsWith('SELECT INDEX_NAME,NON_UNIQUE'))).toBe(true);
  });
  it('前缀加外键继续原首片拒绝，生成列不能偷偷扩展已定边界', async () => {
    const input = design(); input.indexes.push({ name: 'ix_note', unique: false, keyParts: [{ columnName: 'note', prefixLength: 10 }] }); input.foreignKeys = [{ name: 'fk_qty', columns: ['qty'], referencedDatabase: 'db', referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }]; await expect(preview(await get(true, true), input)).rejects.toThrow('不含外键'); expect(created).toBe(false);
  });
  it('旧普通设计不新增生成能力查询，也不引入第三项确认', async () => {
    const input = design(); input.columns = input.columns.slice(0, 4); const value = await preview(await get(false), input); expect(value.requiredAcknowledgements).toHaveLength(2); expect(value.sql).not.toContain('GENERATED ALWAYS'); expect(commands.some(sql => sql.startsWith('SELECT VERSION() AS version,'))).toBe(false); expect(created).toBe(false);
  });
  it('旧普通无生成用途不会借本次编码补证放宽COLLATE属性门', async () => {
    const input = design(); input.columns = input.columns.slice(0, 4); rows = rows.slice(0, 4);
    source = "CREATE TABLE `subject` (`id` bigint unsigned NOT NULL AUTO_INCREMENT,`qty` int DEFAULT NULL,`price` decimal(20,6) DEFAULT NULL,`note` varchar(64) COLLATE utf8mb4_bin DEFAULT NULL,PRIMARY KEY (`id`),KEY `ix_qty` (`qty`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='本例表'";
    const value = await preview(await get(false), input); expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(commands.some(sql => sql.startsWith('SELECT VERSION() AS version,'))).toBe(false); expect(commands.filter(sql => sql.startsWith('CREATE TABLE'))).toEqual([value.sql]);
  });
  it.each(['permission', 'unknown-version', 'unknown-os'])('%s只关闭生成能力，不能伪造可编辑且普通预览可继续', async kind => {
    if (kind === 'permission') permission = /^SELECT VERSION\(\)/; if (kind === 'unknown-version') version = '8.4.12'; if (kind === 'unknown-os') os = 'Win64'; const snapshot = await get(); expect(snapshot.generatedAccess?.editable).toBe(false); snapshot.generatedAccess = { editable: true }; await expect(preview(snapshot)).rejects.toThrow('真实能力'); const input = design(); input.columns = input.columns.slice(0, 4); await expect(preview(snapshot, input)).resolves.toHaveProperty('previewToken'); expect(created).toBe(false);
  });
  it.each(['get-preview', 'preview-apply'])('%s之间真实引擎能力摘要漂移时零CREATE，apply拒绝后令牌消费', async phase => {
    const snapshot = await get(); if (phase === 'get-preview') { support = 'YES'; await expect(preview(snapshot)).rejects.toThrow('已变化'); } else { const value = await preview(snapshot); support = 'YES'; await expect(apply(value)).rejects.toThrow('已变化'); await expect(apply(value)).rejects.toThrow('失效'); } expect(created).toBe(false);
  });
  it.each(['expression', 'storage', 'null', 'default', 'order', 'type', 'comment', 'extra', 'show-extra', 'ordinary-default', 'ordinary-invisible', 'ordinary-unknown', 'late-show', 'permission'])('收到OK后%s差异只保留完成事实，不DROP或重放', async kind => {
    const value = await preview(await get());
    if (kind === 'expression') rows[4].generationExpression = '`qty` + `price`'; if (kind === 'storage') rows[4].extra = 'STORED GENERATED'; if (kind === 'null') rows[4].nullable = 'NO'; if (kind === 'default') rows[4].defaultValue = '7'; if (kind === 'order') [rows[4], rows[5]] = [rows[5], rows[4]]; if (kind === 'type') { source = source.replace('`virtual_total` decimal(30,6)', '`virtual_total` decimal(31,6)'); rows[4].typeSql = 'decimal(31,6)'; } if (kind === 'comment') { source = source.replace("COMMENT '虚拟'", "COMMENT '未请求'"); rows[4].comment = '未请求'; } if (kind === 'extra') rows[4].extra += ' DEFAULT_GENERATED'; if (kind === 'show-extra') source = source.replace("COMMENT '虚拟'", "COMMENT '虚拟' STORAGE DISK"); if (kind === 'ordinary-default') rows[2].defaultValue = '9';
    // 同一手写目录分别供应新完整COLUMNS和旧COLUMNS；普通来源的未知EXTRA不能被生成计划遮蔽。
    if (kind === 'ordinary-invisible') rows[2].extra = 'INVISIBLE'; if (kind === 'ordinary-unknown') rows[2].extra = 'future_marker';
    if (kind === 'late-show') laterShow = source + " COMMENT='外部变化'"; if (kind === 'permission') permission = /^SELECT COLUMN_NAME AS name,ORDINAL_POSITION/;
    expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: false }); await expect(apply(value)).rejects.toThrow('失效'); expect(commands.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1); expect(commands.some(sql => /^DROP|^ALTER/.test(sql))).toBe(false);
  });
  it('缺第三项或额外未知确认均消费原令牌，准确目标确认仍逐字核对', async () => {
    const snapshot = await get(); for (const acknowledgements of [['ddl-implicit-commit', 'create-only-no-replay'], [...tableCreateRequiredAcknowledgements(design()), 'unknown']]) { const value = await preview(snapshot); await expect(apply(value, { acknowledgements })).rejects.toThrow('确认'); await expect(apply(value)).rejects.toThrow('失效'); } const value = await preview(snapshot); await expect(apply(value, { confirmation: 'db.subject ' })).rejects.toThrow('确认'); expect(created).toBe(false);
  });
  it('完整普通STATISTICS之后才发生的生成表达式漂移也不能核验成功', async () => {
    const value = await preview(await get()); laterShowAt = 3; laterShow = source.replace('((`qty` * `price`)) VIRTUAL', '((`qty` + `price`)) VIRTUAL'); expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(showReads).toBe(3); expect(commands.map(sql => sql.startsWith('SHOW CREATE TABLE')).lastIndexOf(true)).toBeGreaterThan(commands.findIndex(sql => sql.startsWith('SELECT INDEX_NAME AS name'))); expect(commands.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1);
  });
  it('get能力读取取消按原回调失败并严格释放，不降级成成功只读', async () => {
    hold = /^SELECT VERSION\(\)/; const taskId = 'get-' + sequence, pending = get(), rejected = expect(pending).rejects.toThrow('取消'); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId }); await rejected; expect(held!.managed.close).toHaveBeenCalledOnce(); expect(created).toBe(false);
  });
  it('迟到预览等待时快照释放不得登记新令牌', async () => {
    const snapshot = await get(); hold = /^SELECT VERSION\(\)/; const pending = preview(snapshot), rejected = expect(pending).rejects.toThrow('失效'); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('schema.tableCreate.release', { snapshotId: snapshot.snapshotId }); hold = undefined; held!.complete(); await rejected; expect(created).toBe(false);
  });
  it('CREATE挂起取消仍保留unknown及目标锁，原预览不能再次发送', async () => {
    const snapshot = await get(), value = await preview(snapshot); hold = /^CREATE TABLE/; const pending = apply(value), rejected = expect(pending).rejects.toThrow('取消'); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId: 'apply' }); await rejected; expect(events.at(-1)?.tableCreate).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' }); await expect(apply(value)).rejects.toThrow('失效'); hold = undefined; await expect(apply(await preview(snapshot), { taskId: 'second' })).rejects.toThrow('上次收尾'); expect(commands.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1);
  });
  it('成功ACK后严格关闭未知保留完成事实和资源警告，不允许同目标重放', async () => {
    const snapshot = await get(), value = await preview(snapshot); closeFails = true; const result = await apply(value); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: false }); expect(unknownClose).toBe(true); expect(result.warnings.length).toBeGreaterThan(0); await expect(apply(value)).rejects.toThrow('失效'); expect(commands.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1);
  });
  it('旧SQL入口明确拒绝生成字段，不能静默创建成普通列', () => {
    expect(() => buildDesign(design() as any)).toThrow('生成列'); expect(() => buildPrefixTableDesign(design(), {} as any)).toThrow(); expect(typeof buildGeneratedTableDesign).toBe('function');
  });
});
