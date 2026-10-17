import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import { tableCreateAcknowledgements, type TableCreateDesign, type TableCreateGetOutput, type TableCreatePreviewOutput } from '../../src/shared/tableCreate';
import { validateCommand } from '../../src/shared/validation';
const driver = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', async () => ({ ...await vi.importActual('../../src/engine/connection'), connect: driver.connect, execute: driver.execute }));
import { closeMysqlConnection } from '../../src/engine/connection';
import { Engine } from '../../src/engine';
const profile: ConnectionProfile = { id: 'c', name: '离线新建表', group: '', color: '', dialect: 'mysql', host: 'invalid', port: 3306, user: 'unit' };
const design = (): TableCreateDesign => ({ database: 'db', name: 'new`table', engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: [{ name: 'id', type: 'bigint unsigned', nullable: false, autoIncrement: true, comment: '' }, { name: 'amount', type: 'decimal(30,12)', nullable: false, autoIncrement: false, defaultValue: '123456789012345678.123456789012', comment: '' }], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }, { name: 'uq_amount', unique: true, columns: ['amount'] }], foreignKeys: [] });
const definition = "CREATE TABLE `new``table` (`id` bigint unsigned NOT NULL AUTO_INCREMENT,`amount` decimal(30,12) NOT NULL DEFAULT '123456789012345678.123456789012',PRIMARY KEY (`id`),UNIQUE KEY `uq_amount` (`amount`)) ENGINE=InnoDB";
let showDefinition: string | undefined;
let catalogType: string | undefined, catalogDefault: string | null | undefined;
let indexChanges: Record<string, unknown>;
let foreignRules: unknown, foreignParts: unknown, foreignIndex: boolean, deniedForeign: 'rc' | 'kcu' | undefined;
let laterDefinition: string | undefined, showReads: number, laterShowFails: boolean;
let engine: Engine, events: TaskEvent[], sent: string[], connections: ManagedConnection[], sequence: number, uuid: string, mode: string, occupied: boolean, created: boolean, closeFails: boolean, badVerify: boolean, dialect: 'mysql' | 'mariadb', version: string;
let hold: RegExp | undefined, held: { complete(error?: Error): void } | undefined, fail: RegExp | undefined, holdClose: boolean, releaseClose: (() => void) | undefined;
/** 仅替换驱动，真实Engine、任务锁、缓存、SQL与取消/关闭代码均执行产品实现。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), id = ++sequence;
  const stream = Object.assign(new EventEmitter(), { closed: false, end(callback: () => void) { queueMicrotask(() => { callback(); stream.closed = true; stream.emit('close'); }); } });
  Object.assign(connection, { stream, end(callback: () => void) { queueMicrotask(callback); } });
  const value = { connection, signal, profile, status: { version, dialect, connectionId: id }, broken: false, close: vi.fn(async () => { if (holdClose && created) await new Promise<void>(resolve => { releaseClose = resolve; }); if (closeFails) throw Error('合成连接关闭未知'); await closeMysqlConnection(connection as any, true, false, 500); }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId: id, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push(sql);
    const complete = (error?: Error) => queueMicrotask(() => {
      if (error || fail?.test(sql)) { callback(error ?? Error('合成请求结果未知')); return; }
      let rows: unknown;
      if (sql.startsWith('SELECT @@hostname')) rows = [{ hostname: 'unit', port: 3306, serverId: 7, currentUser: 'unit@host', sqlMode: mode, lowerNames: 0, charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid }];
      else if (sql.startsWith('SELECT SCHEMA_NAME')) rows = [{ name: 'db', charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT TABLE_NAME')) rows = occupied || created ? [{ TABLE_NAME: 'new`table' }] : [];
      else if (sql.startsWith('CREATE TABLE')) { created = true; rows = { affectedRows: 0, warningStatus: 0 }; }
      else if (sql.startsWith('SHOW CREATE TABLE')) {
        if (showReads++ > 0 && laterShowFails) { callback(Error('合成后读SHOW未知')); return; }
        rows = [{ 'Create Table': showReads > 1 ? laterDefinition ?? showDefinition ?? definition : showDefinition ?? definition }];
      }
      else if (sql.startsWith('SELECT t.TABLE_NAME')) rows = [{ name: 'new`table', engine: 'InnoDB', charset: 'utf8mb4', comment: '' }];
      else if (sql.startsWith('SELECT COLUMN_NAME')) rows = [{ name: 'id', type: 'bigint unsigned', nullable: 'NO', defaultValue: null, extra: 'auto_increment', comment: '' }, { name: 'amount', type: catalogType ?? (badVerify ? 'decimal(20,2)' : 'decimal(30,12)'), nullable: 'NO', defaultValue: catalogDefault !== undefined ? catalogDefault : dialect === 'mariadb' ? "'123456789012345678.123456789012'" : '123456789012345678.123456789012', extra: '', comment: '' }];
      else if (sql.startsWith('SELECT INDEX_NAME')) rows = [{ name: 'PRIMARY', nonUnique: 0, column: 'id', sequence: 1, subPart: null, method: 'BTREE', direction: 'A', comment: '' }, { name: 'uq_amount', nonUnique: 0, column: 'amount', sequence: 1, subPart: null, method: 'BTREE', direction: 'A', comment: '', ...indexChanges }, ...(foreignIndex ? [{ name: 'ix_child', nonUnique: 1, column: 'id', sequence: 1, subPart: null, method: 'BTREE', direction: 'A', comment: '' }, { name: 'ix_child', nonUnique: 1, column: 'amount', sequence: 2, subPart: null, method: 'BTREE', direction: 'A', comment: '' }] : [])];
      else if (sql.includes('FROM information_schema.REFERENTIAL_CONSTRAINTS')) { if (deniedForeign === 'rc') { callback(Object.assign(Error('合成规则目录拒读'), { errno: 1142, code: 'ER_TABLEACCESS_DENIED_ERROR' })); return; } rows = foreignRules; }
      else if (sql.includes('FROM information_schema.KEY_COLUMN_USAGE')) { if (deniedForeign === 'kcu') { callback(Object.assign(Error('合成列目录拒读'), { errno: 1143, code: 'ER_COLUMNACCESS_DENIED_ERROR' })); return; } rows = foreignParts; }
      else { callback(Error('纯测试未声明SQL')); return; }
      callback(null, rows, []);
    });
    if (hold?.test(sql)) held = { complete }; else complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(value); return value;
}
async function get(revision = 1): Promise<TableCreateGetOutput> { return engine.handle('schema.tableCreate.get', { connectionId: 'c', database: 'db', taskId: 'get-' + sequence, connectionRevision: revision }); }
async function preview(snapshot: TableCreateGetOutput, draft = design()): Promise<TableCreatePreviewOutput> { return engine.handle('schema.tableCreate.preview', { snapshotId: snapshot.snapshotId, design: draft, taskId: 'preview-' + sequence, connectionRevision: 1 }); }
async function apply(value: TableCreatePreviewOutput, taskId = 'apply', revision = 1, confirmation = 'db.new`table') { return engine.handle('schema.tableCreate.apply', { previewToken: value.previewToken, confirmation, acknowledgements: [...tableCreateAcknowledgements], taskId, connectionRevision: revision }); }
/** 独立固定设计、SHOW和两套目录：不调用生产解析器或比较器生成测试期望。 */
function compositeForeignKey(): TableCreateDesign {
  const draft = design();
  draft.indexes.push({ name: 'ix_child', unique: false, columns: ['id', 'amount'] });
  draft.foreignKeys.push({ name: 'fk_mix', columns: ['id', 'amount'], referencedDatabase: 'parent_db', referencedTable: 'parent', referencedColumns: ['parent_id', 'parent_amount'], onUpdate: 'CASCADE', onDelete: 'CASCADE' });
  showDefinition = definition.replace(') ENGINE=InnoDB', ',KEY `ix_child` (`id`,`amount`),CONSTRAINT `fk_mix` FOREIGN KEY (`id`,`amount`) REFERENCES `parent_db`.`parent` (`parent_id`,`parent_amount`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB');
  foreignIndex = true;
  foreignRules = [{ CONSTRAINT_SCHEMA: 'db', CONSTRAINT_NAME: 'fk_mix', TABLE_NAME: 'new`table', UNIQUE_CONSTRAINT_SCHEMA: 'parent_db', REFERENCED_TABLE_NAME: 'parent', UNIQUE_CONSTRAINT_NAME: 'PRIMARY', MATCH_OPTION: 'NONE', UPDATE_RULE: 'CASCADE', DELETE_RULE: 'CASCADE' }];
  foreignParts = [
    { CONSTRAINT_SCHEMA: 'db', CONSTRAINT_NAME: 'fk_mix', TABLE_SCHEMA: 'db', TABLE_NAME: 'new`table', COLUMN_NAME: 'id', ORDINAL_POSITION: 1, POSITION_IN_UNIQUE_CONSTRAINT: 1, REFERENCED_TABLE_SCHEMA: 'parent_db', REFERENCED_TABLE_NAME: 'parent', REFERENCED_COLUMN_NAME: 'parent_id' },
    { CONSTRAINT_SCHEMA: 'db', CONSTRAINT_NAME: 'fk_mix', TABLE_SCHEMA: 'db', TABLE_NAME: 'new`table', COLUMN_NAME: 'amount', ORDINAL_POSITION: '2', POSITION_IN_UNIQUE_CONSTRAINT: '2', REFERENCED_TABLE_SCHEMA: 'parent_db', REFERENCED_TABLE_NAME: 'parent', REFERENCED_COLUMN_NAME: 'parent_amount' },
  ];
  return draft;
}
beforeEach(async () => {
  events = []; sent = []; connections = []; sequence = 0; uuid = 'server-1'; mode = ''; occupied = created = closeFails = badVerify = holdClose = false; hold = held = fail = releaseClose = undefined; showDefinition = catalogType = catalogDefault = laterDefinition = deniedForeign = undefined; indexChanges = {}; foreignRules = []; foreignParts = []; foreignIndex = laterShowFails = false; showReads = 0; dialect = 'mysql'; version = '8.4.11';
  driver.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal)); driver.execute.mockReset().mockImplementation(async () => { held?.complete(Error('合成取消终态')); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: 'c', profile });
});

describe('新建表外键实际定义后核（真实Engine，仅RAM驱动）', () => {
  it.each(['mysql', 'mariadb'] as const)('%s正常跨库复合FK与SHOW/两套目录/复读定义一致才完整核验', async value => {
    dialect = value; version = value === 'mysql' ? '8.4.11' : '10.11.19'; const draft = compositeForeignKey();
    const p = await preview(await get(), draft), result = await apply(p);
    expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: true });
    expect(events.at(-1)?.tableCreate).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    const rcIndex = sent.findIndex(sql => sql.includes('FROM information_schema.REFERENTIAL_CONSTRAINTS'));
    expect(rcIndex).toBeGreaterThan(sent.findIndex(sql => sql.startsWith('CREATE TABLE'))); expect(sent.at(-1)).toMatch(/^SHOW CREATE TABLE/); expect(showReads).toBe(2);
    expect(sent[rcIndex]).toContain('LIMIT 257'); expect(sent.find(sql => sql.includes('FROM information_schema.KEY_COLUMN_USAGE'))).toContain('LIMIT 8193');
    expect(sent.filter(sql => /^(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)/.test(sql))).toHaveLength(1);
    await expect(apply(p, 'fk-replay')).rejects.toThrow('失效');
  });
  it.each(['名称', '子列顺序', '父库', '父表', '父列顺序', '删除动作', '更新动作', '未知MATCH'])('SHOW的%s与设计矛盾不能由目录补证', async kind => {
    const draft = compositeForeignKey();
    const replacements: Record<string, [string, string]> = { 名称: ['CONSTRAINT `fk_mix`', 'CONSTRAINT `other`'], 子列顺序: ['FOREIGN KEY (`id`,`amount`)', 'FOREIGN KEY (`amount`,`id`)'], 父库: ['`parent_db`.`parent`', '`other_db`.`parent`'], 父表: ['`parent_db`.`parent`', '`parent_db`.`other`'], 父列顺序: ['(`parent_id`,`parent_amount`)', '(`parent_amount`,`parent_id`)'], 删除动作: ['ON DELETE CASCADE', 'ON DELETE RESTRICT'], 更新动作: ['ON UPDATE CASCADE', 'ON UPDATE NO ACTION'], 未知MATCH: ['ON DELETE CASCADE', 'MATCH SIMPLE ON DELETE CASCADE'] };
    showDefinition = showDefinition!.replace(...replacements[kind]);
    expect(await apply(await preview(await get(), draft))).toMatchObject({ ddlCompleted: true, definitionVerified: false, resourcesReleased: true });
    expect(sent.some(sql => sql.includes('FROM information_schema.REFERENTIAL_CONSTRAINTS'))).toBe(false);
  });
  it.each(['规则空集', '字段空集', '父库矛盾', '父表矛盾', '规则动作', '子列顺序', '父列顺序', '缺项', '序号重复', '重复规则', '多出约束', '未知父键位置'])('目录%s时CREATE ACK保持但完整核验为false', async kind => {
    const draft = compositeForeignKey(), rules = foreignRules as Record<string, unknown>[], parts = foreignParts as Record<string, unknown>[];
    if (kind === '规则空集') foreignRules = [];
    if (kind === '字段空集') foreignParts = [];
    if (kind === '父库矛盾') rules[0].UNIQUE_CONSTRAINT_SCHEMA = 'other_db';
    if (kind === '父表矛盾') parts[0].REFERENCED_TABLE_NAME = 'other';
    if (kind === '规则动作') rules[0].UPDATE_RULE = 'RESTRICT';
    if (kind === '子列顺序') [parts[0].COLUMN_NAME, parts[1].COLUMN_NAME] = [parts[1].COLUMN_NAME, parts[0].COLUMN_NAME];
    if (kind === '父列顺序') [parts[0].REFERENCED_COLUMN_NAME, parts[1].REFERENCED_COLUMN_NAME] = [parts[1].REFERENCED_COLUMN_NAME, parts[0].REFERENCED_COLUMN_NAME];
    if (kind === '缺项') parts.pop();
    if (kind === '序号重复') parts[1].ORDINAL_POSITION = 1;
    if (kind === '重复规则') rules.push({ ...rules[0] });
    if (kind === '多出约束') rules.push({ ...rules[0], CONSTRAINT_NAME: 'other' });
    if (kind === '未知父键位置') parts[0].POSITION_IN_UNIQUE_CONSTRAINT = null;
    const result = await apply(await preview(await get(), draft));
    expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: false, resourcesReleased: true }); expect(result.warnings.join('')).toContain('未核验');
    expect(sent.filter(sql => /^(CREATE|ALTER|DROP)/.test(sql))).toHaveLength(1);
  });
  it.each(['rc', 'kcu'] as const)('%s权限拒读不扩大权限、不重试、不擦ACK', async kind => {
    const draft = compositeForeignKey(); deniedForeign = kind;
    const result = await apply(await preview(await get(), draft)); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: false, resourcesReleased: true });
    expect(sent.filter(sql => sql.includes(kind === 'rc' ? 'FROM information_schema.REFERENTIAL_CONSTRAINTS' : 'FROM information_schema.KEY_COLUMN_USAGE'))).toHaveLength(1);
    expect(sent.some(sql => /^(GRANT|ALTER|DROP)/.test(sql))).toBe(false);
  });
  it('目录后复读SHOW变化，不能把两次定义拼为完整核验', async () => {
    const draft = compositeForeignKey(); laterDefinition = showDefinition!.replace('ON DELETE CASCADE', 'ON DELETE RESTRICT');
    expect(await apply(await preview(await get(), draft))).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(showReads).toBe(2);
  });
  it('目录后复读SHOW未知保留ACK，不发送补救DDL', async () => {
    const draft = compositeForeignKey(); laterShowFails = true;
    expect(await apply(await preview(await get(), draft))).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(showReads).toBe(2);
    expect(sent.filter(sql => /^(CREATE|ALTER|DROP)/.test(sql))).toHaveLength(1);
  });
  it('模式省略不借目录补齐FK定义', async () => {
    mode = 'NO_KEY_OPTIONS'; const draft = compositeForeignKey();
    expect(await apply(await preview(await get(), draft))).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    expect(sent.some(sql => sql.includes('FROM information_schema.REFERENTIAL_CONSTRAINTS'))).toBe(false);
  });
  it('未建模的隐式支持索引仍保守不完整，但原生成器和创建ACK保留', async () => {
    const draft = compositeForeignKey(); draft.indexes.pop();
    expect(await apply(await preview(await get(), draft))).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    expect(sent.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1);
  });
  it('完整FK核验成功与严格关闭未知是两项独立事实', async () => {
    const draft = compositeForeignKey(), p = await preview(await get(), draft); closeFails = true;
    expect(await apply(p)).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: false });
  });
  it.each(['规则上限', '字段上限', '字节上限'])('目录%s超过有界预算只保留ACK', async kind => {
    const draft = compositeForeignKey();
    if (kind === '规则上限') foreignRules = Array.from({ length: 257 }, () => (foreignRules as unknown[])[0]);
    if (kind === '字段上限') foreignParts = Array.from({ length: 8193 }, () => (foreignParts as unknown[])[0]);
    if (kind === '字节上限') (foreignRules as Record<string, unknown>[])[0].unexpected = 'x'.repeat(4 * 1024 * 1024);
    expect(await apply(await preview(await get(), draft))).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });
});
afterEach(async () => { closeFails = holdClose = false; releaseClose?.(); hold = undefined; held?.complete(Error('纯测试收尾')); await engine.closeAll(); vi.useRealTimers(); });
describe('新建表真实Engine仅RAM驱动', () => {
  it.each(['前缀', '方法', '方向', '不可见', '注释'])('SHOW索引%s不同，即使目录投影同名同列也不报完整核验', async kind => {
    const draft = design(); draft.columns[1].type = 'varchar(80)'; catalogType = 'varchar(80)';
    const changed = kind === '前缀' ? '(`amount`(5))' : kind === '方法' ? '(`amount`) USING HASH' : kind === '方向' ? '(`amount` DESC)' : kind === '不可见' ? '(`amount`) INVISIBLE' : "(`amount`) COMMENT '不同'";
    showDefinition = definition.replace('decimal(30,12)', 'varchar(80)').replace('UNIQUE KEY `uq_amount` (`amount`)', 'UNIQUE KEY `uq_amount` ' + changed);
    expect(await apply(await preview(await get(), draft))).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    expect(sent.filter(sql => /^(CREATE|ALTER|DROP)/.test(sql))).toHaveLength(1);
  });
  it.each([{ subPart: 5 }, { subPart: undefined }, { method: 'HASH' }, { direction: 'D' }, { direction: null }, { comment: '不同' }])('目录索引属性%s与设计/SHOW矛盾或未知时不报完整核验', async changes => {
    indexChanges = changes;
    expect(await apply(await preview(await get()))).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });
  it.each(['mysql', 'mariadb'] as const)('%s普通完整列BTREE及显式ASC仍可共同核验', async value => {
    dialect = value; version = value === 'mysql' ? '5.7.44' : '10.11.19';
    showDefinition = definition.replace('UNIQUE KEY `uq_amount` (`amount`)', 'UNIQUE KEY `uq_amount` (`amount` ASC) USING BTREE');
    expect(await apply(await preview(await get()))).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    expect(sent.find(sql => sql.startsWith('SELECT INDEX_NAME'))).toContain('SUB_PART AS subPart,INDEX_TYPE AS method,COLLATION AS direction');
  });
  it.each(['enum', 'set'])('%s文字量大小写及内部空白不能被规范化抹平', async kind => {
    const draft = design(); draft.columns[1].type = `${kind}('A B','x')`; delete draft.columns[1].defaultValue;
    catalogType = `${kind}('ab','x')`; catalogDefault = null;
    showDefinition = definition.replace("decimal(30,12) NOT NULL DEFAULT '123456789012345678.123456789012'", `${catalogType} NOT NULL`);
    expect(await apply(await preview(await get(), draft))).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });
  it.each(['mysql', 'mariadb'] as const)('%s的ENUM文字量保真，关键字/引号外空白可等价', async value => {
    dialect = value; version = value === 'mysql' ? '8.4.11' : '10.11.19';
    const draft = design(); draft.columns[1].type = "enum('A B','x''Y')"; delete draft.columns[1].defaultValue;
    catalogType = "ENUM( 'A B', 'x''Y' )"; catalogDefault = null;
    showDefinition = definition.replace("decimal(30,12) NOT NULL DEFAULT '123456789012345678.123456789012'", `${catalogType} NOT NULL`);
    expect(await apply(await preview(await get(), draft))).toMatchObject({ ddlCompleted: true, definitionVerified: true });
  });
  it('SHOW保真而后读目录ENUM文字量不同也不合成核验成功', async () => {
    const draft = design(); draft.columns[1].type = "enum('A B','x')"; delete draft.columns[1].defaultValue;
    catalogType = "enum('ab','x')"; catalogDefault = null;
    showDefinition = definition.replace("decimal(30,12) NOT NULL DEFAULT '123456789012345678.123456789012'", `${draft.columns[1].type} NOT NULL`);
    expect(await apply(await preview(await get(), draft))).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });
  it.each(['类型', '自增缺失', '自增多出'])('SHOW CREATE的%s已与设计及目录矛盾时只保留ACK', async kind => {
    showDefinition = kind === '类型' ? definition.replace('bigint unsigned', 'int unsigned') : kind === '自增缺失' ? definition.replace(' AUTO_INCREMENT', '') : definition.replace('decimal(30,12) NOT NULL', 'decimal(30,12) NOT NULL AUTO_INCREMENT');
    expect(await apply(await preview(await get()))).toMatchObject({ ddlCompleted: true, definitionVerified: false, resourcesReleased: true });
    expect(sent.filter(sql => /^(CREATE|ALTER|DROP)/.test(sql))).toHaveLength(1);
  });
  it('SHOW CREATE仅整数显示宽度不同仍可与设计和目录共同核验', async () => {
    showDefinition = definition.replace('bigint unsigned', 'BIGINT(20) UNSIGNED');
    expect(await apply(await preview(await get()))).toMatchObject({ ddlCompleted: true, definitionVerified: true });
  });
  it('发送前取消经产品严格关闭后可新预览同目标，旧令牌仍不可重放', async () => {
    const first = await preview(await get()); hold = /^SELECT @@hostname/;
    const pending = apply(first, 'cancel-before-create').catch(reason => reason);
    await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId: 'cancel-before-create' });
    expect(await pending).toBeInstanceOf(Error); expect(events.filter(event => event.taskId === 'cancel-before-create').at(-1)?.tableCreate).toMatchObject({ ddlSubmitted: false, outcome: 'not-sent' });
    expect(sent.some(sql => sql.startsWith('CREATE TABLE'))).toBe(false);
    expect(connections.every(value => vi.mocked(value.close).mock.calls.length === 1 && (value.connection as any).stream.closed)).toBe(true);
    hold = undefined; await expect(apply(first, 'old-after-cancel')).rejects.toThrow('失效');
    expect(await apply(await preview(await get()), 'new-after-cancel')).toMatchObject({ ddlCompleted: true, resourcesReleased: true });
  });
  it('发送前关闭未知仍保留目标锁，不能借新预览恢复投递', async () => {
    const first = await preview(await get()); fail = /^SELECT @@hostname/; closeFails = true;
    await expect(apply(first)).rejects.toThrow(); fail = undefined; closeFails = false;
    await expect(apply(await preview(await get()), 'after-close-unknown')).rejects.toThrow('同一目标');
    expect(sent.some(sql => sql.startsWith('CREATE TABLE'))).toBe(false);
  });
  it('DDL未知即使严格关闭已成功仍保留目标锁', async () => {
    const first = await preview(await get()); fail = /^CREATE TABLE/; await expect(apply(first)).rejects.toThrow(); fail = undefined;
    expect(connections.every(value => (value.connection as any).stream.closed)).toBe(true);
    await expect(apply(await preview(await get()), 'after-ddl-unknown')).rejects.toThrow('同一目标');
    expect(sent.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1);
  });
  it('取消控制连接关闭未知不发布资源释放事实，同目标仍锁定', async () => {
    const first = await preview(await get()); hold = /^SELECT @@hostname/;
    const pending = apply(first, 'cancel-control-unknown').catch(reason => reason);
    await vi.waitFor(() => expect(held).toBeDefined()); closeFails = true;
    await expect(engine.handle('query.cancel', { taskId: 'cancel-control-unknown' })).rejects.toThrow('清理失败');
    expect(await pending).toBeInstanceOf(Error); closeFails = false; hold = undefined;
    await expect(apply(await preview(await get()), 'after-control-unknown')).rejects.toThrow('同一目标');
    expect(sent.some(sql => sql.startsWith('CREATE TABLE'))).toBe(false);
  });
  it('只读准备绑定设计，一条准确CREATE，保留精度/主键/unique并完整后核', async () => {
    const p = await preview(await get()); expect(p.sql).toContain('CREATE TABLE `db`.`new``table`'); expect(p.sql).toContain("DEFAULT '123456789012345678.123456789012'"); expect(sent.some(sql => /^(CREATE|DROP|ALTER|USE)/.test(sql))).toBe(false);
    expect(await apply(p)).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: true }); expect(sent.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1); expect(sent.some(sql => /IF NOT EXISTS|^(DROP|ALTER)/.test(sql))).toBe(false);
    await expect(apply(p, 'replay')).rejects.toThrow('失效'); expect(events.at(-1)?.tableCreate).toMatchObject({ ddlCompleted: true, definitionVerified: true }); expect(connections.every(c => vi.mocked(c.close).mock.calls.length === 1)).toBe(true);
    expect(showReads).toBe(1); expect(sent.some(sql => /REFERENTIAL_CONSTRAINTS|KEY_COLUMN_USAGE/.test(sql))).toBe(false);
  });
  it.each(['5.7.44', '8.0.46', '8.4.11', '10.11.19', '11.4.13'])('普通版本%s仍使用原生成器，不随意缩为8.4.11', async value => { version = value; dialect = value.startsWith('1') ? 'mariadb' : 'mysql'; const p = await preview(await get()); expect((await apply(p)).ddlCompleted).toBe(true); });
  it.each(['身份', '模式', '修订', '同名'])('%s变化拒绝旧预览且不覆盖', async kind => {
    const p = await preview(await get()); if (kind === '身份') uuid = 'other'; if (kind === '模式') mode = 'NO_BACKSLASH_ESCAPES'; if (kind === '同名') occupied = true;
    await expect(apply(p, 'changed', kind === '修订' ? 2 : 1)).rejects.toThrow(); await expect(apply(p, 'again')).rejects.toThrow('失效'); expect(sent.some(sql => /^(CREATE|DROP|ALTER)/.test(sql))).toBe(false);
  });
  it('错误准确确认先消费，不能trim后重用', async () => { const p = await preview(await get()); await expect(apply(p, 'bad', 1, 'db.new`table ')).rejects.toThrow('确认'); await expect(apply(p, 'again')).rejects.toThrow('失效'); expect(created).toBe(false); });
  it('同步消费拒绝双发，目标锁覆盖实际连接关闭等待', async () => {
    const s = await get(), p = await preview(s), q = await preview(s); hold = /^CREATE TABLE/; const pending = apply(p); await vi.waitFor(() => expect(held).toBeDefined()); await expect(apply(p, 'duplicate')).rejects.toThrow('失效'); await expect(apply(q, 'other')).rejects.toThrow(); held!.complete(); await pending; expect(sent.filter(sql => sql.startsWith('CREATE'))).toHaveLength(1);
  });
  it('已发后未知没有DDL重放或自动DROP补救', async () => { const p = await preview(await get()); fail = /^CREATE TABLE/; await expect(apply(p)).rejects.toThrow(); expect(events.at(-1)?.tableCreate).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' }); await expect(apply(p, 'retry')).rejects.toThrow('失效'); expect(sent.filter(sql => /^(CREATE|DROP|ALTER)/.test(sql))).toHaveLength(1); });
  it('ACK后核不符与连接关闭失败分别保留完成事实', async () => {
    const p = await preview(await get()); badVerify = true; expect(await apply(p)).toMatchObject({ ddlCompleted: true, definitionVerified: false, resourcesReleased: true });
    created = false; badVerify = false; const q = await preview(await get()); closeFails = true; const result = await apply(q, 'close-fail'); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: false }); expect(result.warnings.length).toBeGreaterThan(0); await expect(apply(q, 'retry')).rejects.toThrow('失效');
  });
  it('预览释放期间或过期不能发DDL，跨用途不能消费', async () => {
    const s = await get(), p = await preview(s); engine.handle('schema.tableCreate.release', { snapshotId: s.snapshotId }); await expect(apply(p)).rejects.toThrow('失效');
    const q = await preview(await get()); await expect(engine.handle('schema.databaseCreate.apply', { previewToken: q.previewToken, confirmation: 'db', acknowledgements: [], taskId: 'wrong', connectionRevision: 1 })).rejects.toThrow(); expect(created).toBe(false);
  });
  it('严格协议拒绝SQL/profile/修订/originalName及可替换目标', () => {
    for (const extra of [{ sql: 'DROP TABLE x' }, { connectionRevision: 7 }, { profile }]) expect(() => validateCommand('schema.tableCreate.get', { connectionId: 'c', database: 'db', taskId: 't', ...extra })).toThrow();
    expect(() => validateCommand('schema.tableCreate.preview', { snapshotId: 's', taskId: 't', design: { ...design(), originalName: 'old' } })).toThrow(); expect(() => validateCommand('schema.tableCreate.apply', { previewToken: 'p', taskId: 't', confirmation: 'db.t', acknowledgements: [...tableCreateAcknowledgements], sql: 'CREATE TABLE other' })).toThrow();
  });
  it('目标锁覆盖真实close Promise，不把DDL回包当资源释放', async () => {
    const s = await get(), p = await preview(s), q = await preview(s); holdClose = true; const pending = apply(p); await vi.waitFor(() => expect(releaseClose).toBeDefined());
    await expect(apply(q, 'during-close')).rejects.toThrow(); expect(sent.filter(sql => sql.startsWith('CREATE'))).toHaveLength(1); holdClose = false; releaseClose!(); expect((await pending).resourcesReleased).toBe(true);
  });
  it('预览TTL和重核等待中释放来源均在发送前拒绝', async () => {
    const s = await get(), p = await preview(s); hold = /^SELECT @@hostname/; const pending = apply(p); await vi.waitFor(() => expect(held).toBeDefined()); engine.handle('schema.tableCreate.release', { snapshotId: s.snapshotId }); held!.complete(); await expect(pending).rejects.toThrow('失效'); expect(created).toBe(false);
    hold = undefined; const q = await preview(await get()); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 120001); await expect(apply(q, 'expired')).rejects.toThrow('失效'); expect(created).toBe(false);
  });
  it('预览前后renderer修改设计对象不能替换引擎持有的设计', async () => {
    const draft = design(), s = await get(), p = await preview(s, draft); draft.name = 'other'; draft.columns[1].defaultValue = '0';
    expect(p.sql).toContain('`new``table`'); expect(p.sql).toContain('123456789012345678.123456789012'); expect((await apply(p)).definitionVerified).toBe(true); expect(sent.filter(sql => sql.startsWith('CREATE'))[0]).not.toContain('`other`');
  });
  it('外键仍可生成与投递，未逐项核验时明确保留ACK而不伪报完整定义', async () => {
    const draft = design(); draft.foreignKeys.push({ name: 'fk_id', columns: ['id'], referencedDatabase: 'db', referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' });
    const p = await preview(await get(), draft); expect(p.sql).toContain('FOREIGN KEY'); expect(p.warnings.join('')).toContain('外键'); expect(await apply(p)).toMatchObject({ ddlCompleted: true, definitionVerified: false, resourcesReleased: true });
  });
  it('公开返回目标修改不改变服务端预览和准确CREATE', async () => {
    const p = await preview(await get()); p.target.table = 'forged'; const result = await apply(p); expect(result.target.table).toBe('new`table'); expect(sent.filter(sql => sql.startsWith('CREATE'))[0]).toContain('`new``table`');
  });
});
