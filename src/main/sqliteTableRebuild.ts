import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { SqliteConnectionProfile } from '../shared/contracts';
import { SqliteDriverError, type SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteExportTextFunction, type SqliteFileIdentity, type SqliteValue } from '../engine/sqlite/protocol';
import { readSqliteTableCatalogue, quoteSqliteIdentifier as q, type SqliteTableCatalogue, type SqliteTableBrowseControl } from './sqliteTableBrowse';
import { sqliteTableHasAutoincrement } from './sqliteSchemaExport';
import { buildSqliteTableCreateDefault } from '../shared/sqliteTableCreate';
import { compileSqliteTableRebuildDefinition, normalizeSqliteTableRebuildDefinitionName } from '../shared/sqliteTableRebuildPlan';
import type { SqliteTablePrimaryKeyEdit } from '../shared/sqliteTablePrimaryKey';
import type { SqliteTableForeignKeyEdit } from '../shared/sqliteTableForeignKeys';
import { buildSqliteTableRebuildPlan, copySqliteTableRebuildNames, type SqliteTableRebuildNames } from '../shared/sqliteTableRebuildExecutionPlan';
import { sqliteRebuildStoredKeyEquivalent, type SqliteRebuildComparisonInput } from '../engine/sqlite/rebuildComparison';
import { sqliteTableRebuildInspectionSchema, sqliteTableRebuildEditsSchema, sqliteTableRebuildLimits as limits, sqliteTableRebuildMessages as text, type SqliteTableRebuildInspectInput, type SqliteTableRebuildInspectOutput, type SqliteTableRebuildPreviewInput, type SqliteTableRebuildPreviewOutput, type SqliteTableRebuildApplyInput, type SqliteTableRebuildReleaseInput, type SqliteTableRebuildChange, type SqliteTableRebuildFact, type SqliteTableRebuildOutcome } from '../shared/sqliteTableRebuild';

export interface SqliteTableRebuildInspectRequest extends SqliteTableRebuildInspectInput { assertCurrent(): void; }
export interface SqliteTableRebuildPreviewRequest extends SqliteTableRebuildPreviewInput { rebuildNames: SqliteTableRebuildNames; assertCurrent(): void; }
export interface SqliteTableRebuildApplyRequest extends SqliteTableRebuildApplyInput { operationId: string; recordRebuildFact(fact: SqliteTableRebuildFact): void; assertCurrent(): void; }
export interface SqliteTableRebuildControl extends SqliteTableBrowseControl { beginCommit(): void; }
type Column = SqliteTableRebuildInspectOutput['columns'][number];
interface Index { name: string; origin: string; unique: string; partial: string; columns: SqliteValue[][]; }
interface ForeignViolation { child: string; parent: string; foreignKey: string; key: { kind: 'rowid'; value: string } | { kind: 'primary-key'; columns: string[]; values: SqliteValue[] }; }
interface ForeignCheck { unavailable: boolean; rows: string[]; identities: ForeignViolation[]; }
interface RebuildFacts {
  schemaVersion: string; catalogue: SqliteTableCatalogue; columns: Column[];
  objects: SqliteTableRebuildInspectOutput['relatedObjects']; roots: { type: string; name: string; table: string; root: string }[];
  strict: boolean; withoutRowid: boolean; autoIncrement: boolean; indexes: Index[]; foreignKeys: SqliteValue[][];
  sequences: SqliteValue[][]; foreign: ForeignCheck; validViews: string[];
  rowIdentity: SqliteTableRebuildInspectOutput['rowIdentity'];
}
export interface SqliteTableRebuildSnapshot {
  target: SqliteTableRebuildInspectOutput['target']; profile: SqliteConnectionProfile; identity: SqliteFileIdentity;
  version: string; facts: RebuildFacts; rowCount: string;
}
const stale = text.stale, equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const fold = (value: string) => value.replace(/[A-Z]/g, value => value.toLowerCase());
function integer(value: SqliteValue | undefined): string { if (!value || typeof value !== 'object' || value.type !== 'integer' || !/^(?:0|[1-9][0-9]{0,18})$/.test(value.value) || BigInt(value.value) > 9223372036854775807n) throw Error('SQLite重建非负整数事实无效'); return value.value; }
/** sqlite_sequence的rowid和seq均允许真实负INTEGER，严格保原64位值而不接受REAL或Number近似。 */
function signedInteger(value: SqliteValue | undefined): string { if (!value || typeof value !== 'object' || value.type !== 'integer' || !/^(?:0|-?[1-9][0-9]{0,18})$/.test(value.value)) throw Error('SQLite重建序列有符号整数事实无效'); const parsed = BigInt(value.value); if (parsed < -9223372036854775808n || parsed > 9223372036854775807n) throw Error('SQLite重建序列超过有符号64位范围'); return value.value; }
/** schema cookie按SQLite真实signed32读回，合法负cookie仍属于准确目录签名；不能误用计数非负门。 */
function schemaCookie(value: SqliteValue | undefined): string { if (!value || typeof value !== 'object' || value.type !== 'integer' || !/^(?:0|-?[1-9][0-9]{0,9})$/.test(value.value)) throw Error('SQLite重建schema cookie整数事实无效'); const parsed = BigInt(value.value); if (parsed < -2147483648n || parsed > 2147483647n) throw Error('SQLite重建schema cookie超过有符号32位范围'); return value.value; }
function exact(column: string): string { return `CASE WHEN typeof(${column})='text' THEN ${sqliteExportTextFunction}(${column},CAST(${column} AS BLOB)) ELSE ${column} END`; }

/** 目录、检查及COUNT全部完整读取，超预算绝不伪称没有依赖或违规。 */
async function read(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maximum: number, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<SqliteValue[][]> {
  control.check(); const rows: SqliteValue[][] = [];
  const result = await driver.execute(sql, { parameters, maxRows: maximum, maxBytes: 16 * 1024 * 1024, onBatch: batch => { control.check(); rows.push(...batch.rows); } });
  control.check(); if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== rows.length) throw Error('SQLite重建元数据超过完整读取预算'); return rows;
}
/** 物理文件身份独立于schemaVersion，合法数据更新不能被误当作文件替换。 */
async function assertFile(snapshot: Pick<SqliteTableRebuildSnapshot, 'profile' | 'identity'>, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<void> {
  control.check(); try {
    const path = await realpath(snapshot.profile.sqlite.filePath!); control.check(); const value = await stat(snapshot.profile.sqlite.filePath!, { bigint: true }); control.check();
    if (path !== snapshot.identity.path || !value.isFile() || String(value.dev) !== snapshot.identity.device || String(value.ino) !== snapshot.identity.inode) throw Error(stale);
  } catch { control.check(); throw Error('SQLite重建原文件身份变化或无法确认，拒绝提交'); }
}
/** 公开只读检查与私有writer的固定保护模式相反，不能继承普通ALTER的FKON假定。 */
async function assertFlags(driver: SqliteDriverSession, control: SqliteTableBrowseControl): Promise<void> {
  const rebuild = driver.isRebuildWriter;
  if (integer((await read(driver, 'PRAGMA main.foreign_keys', [], 1, control))[0]?.[0]) !== (rebuild ? '0' : '1') || integer((await read(driver, 'PRAGMA main.legacy_alter_table', [], 1, control))[0]?.[0]) !== (rebuild ? '1' : '0')) throw Error('SQLite重建连接保护模式不符合原独立连接');
}
/** 坏FK只记录为不可检查，最终不能凭PRAGMA失败冒称没有新增违规。 */
async function foreignCheck(driver: SqliteDriverSession, control: SqliteTableBrowseControl): Promise<ForeignCheck> {
  let rows: SqliteValue[][];
  try {
    rows = await read(driver, 'PRAGMA main.foreign_key_check', [], 10001, control);
  } catch (reason) {
    control.check(); if (reason instanceof SqliteDriverError && reason.code === 'SQLITE_NATIVE_1' && reason.completedStatements === 0 && driver.isUsable && driver.transaction === true) return { unavailable: true, rows: [], identities: [] }; throw reason;
  }
  if (rows.length > 10000 || rows.some(row => row.length !== 4)) throw Error('SQLite重建完整外键检查超过预算或格式无效');
  // 只有原生PRAGMA本身失败可标unavailable；后续身份解释失败必须直接拒绝，不能降级丢失实际违规。
  const identities = await foreignIdentities(driver, rows, control); return { unavailable: false, rows: rows.map(row => JSON.stringify(row)).sort(), identities };
}
/** WR子表的PRAGMA rowid为NULL；完整真实PK才是违规行身份，tuple或条数都无法防止换行。 */
async function foreignIdentities(driver: SqliteDriverSession, rows: SqliteValue[][], control: SqliteTableBrowseControl): Promise<ForeignViolation[]> {
  const identities: ForeignViolation[] = [], groups = new Map<string, { child: string; parent: string; foreignKey: string; count: number }>(); let bytes = Buffer.byteLength(JSON.stringify(rows));
  const append = (identity: ForeignViolation) => { bytes += Buffer.byteLength(JSON.stringify(identity)); if (identities.length >= 10000 || bytes > limits.ddlBytes) throw Error('SQLite完整外键违规行身份超过10000项或2MiB预算'); identities.push(identity); };
  if (bytes > limits.ddlBytes) throw Error('SQLite完整外键原生违规超过2MiB预算');
  for (const row of rows) {
    control.check(); if (typeof row[0] !== 'string' || typeof row[2] !== 'string') throw Error('SQLite外键违规对象身份无效'); const child = row[0], parent = row[2], foreignKey = integer(row[3]);
    if (row[1] !== null) append({ child, parent, foreignKey, key: { kind: 'rowid', value: signedInteger(row[1]) } });
    else { const key = JSON.stringify([child, parent, foreignKey]), group = groups.get(key); if (group) group.count++; else groups.set(key, { child, parent, foreignKey, count: 1 }); }
  }
  for (const group of groups.values()) {
    control.check(); const flags = await read(driver, "SELECT type,wr FROM pragma_table_list WHERE schema='main' AND name=? COLLATE BINARY LIMIT 2", [group.child], 2, control);
    if (flags.length !== 1 || flags[0][0] !== 'table' || integer(flags[0][1]) !== '1') throw Error('SQLite外键NULL rowid不能确认为真实WITHOUT ROWID子表');
    const childColumns = await readColumns(driver, group.child, control), primary = childColumns.filter(column => column.primaryKey > 0).sort((a, b) => a.primaryKey - b.primaryKey);
    if (!primary.length || primary.length > limits.columns || primary.some((column, index) => column.primaryKey !== index + 1 || !column.notNull)) throw Error('SQLite外键违规子表缺少准确完整主键');
    const foreign = await read(driver, 'SELECT seq,"table","from","to" FROM pragma_foreign_key_list(?,\'main\') WHERE id=? ORDER BY seq LIMIT 1025', [group.child, { type: 'integer', value: group.foreignKey }], 1025, control);
    if (!foreign.length || foreign.length > limits.columns || foreign.some((row, index) => integer(row[0]) !== String(index) || typeof row[1] !== 'string' || fold(row[1]) !== fold(group.parent) || typeof row[2] !== 'string' || row[3] !== null && typeof row[3] !== 'string')) throw Error('SQLite外键违规无法对应完整原生字段映射');
    const parentColumns = await readColumns(driver, group.parent, control), parentPrimary = parentColumns.filter(column => column.primaryKey > 0).sort((a, b) => a.primaryKey - b.primaryKey), implicit = foreign.every(row => row[3] === null);
    if (implicit && (parentPrimary.length !== foreign.length || parentPrimary.some((column, index) => column.primaryKey !== index + 1)) || !implicit && foreign.some(row => row[3] === null)) throw Error('SQLite外键隐式父主键不能准确映射');
    const childNames = foreign.map(row => childColumns.find(column => fold(column.name) === fold(row[2] as string))?.name), parentNames = foreign.map((row, index) => implicit ? parentPrimary[index].name : parentColumns.find(column => fold(column.name) === fold(row[3] as string))?.name);
    if (childNames.some(name => name === undefined) || parentNames.some(name => name === undefined)) throw Error('SQLite外键引用的准确父子列不存在');
    const child = '"__dbark_fk_child"', parent = '"__dbark_fk_parent"', childField = (name: string) => child + '.' + q(name), parentField = (name: string) => parent + '.' + q(name);
    // FK使用父列affinity/默认collation；unary +去掉子列affinity，不能按子列声明类型或显式BINARY近似。
    const predicates = childNames.map(name => childField(name!) + ' IS NOT NULL').join(' AND '), matches = parentNames.map((name, index) => parentField(name!) + ' = +' + childField(childNames[index]!)).join(' AND ');
    const query = 'SELECT ' + primary.map(column => exact(childField(column.name))).join(',') + ' FROM main.' + q(group.child) + ' AS ' + child + ' WHERE ' + predicates + ' AND NOT EXISTS(SELECT 1 FROM main.' + q(group.parent) + ' AS ' + parent + ' WHERE ' + matches + ') ORDER BY ' + primary.map(column => childField(column.name) + ' COLLATE BINARY ASC').join(',') + ' LIMIT 10001';
    const values = await read(driver, query, [], 10001, control); if (values.length !== group.count) throw Error('SQLite外键真实违规主键与原PRAGMA multiplicity不一致，无法证明行身份');
    for (const value of values) { control.check(); if (value.length !== primary.length || value.some(cell => cell === null)) throw Error('SQLite外键真实违规主键为空或不完整'); append({ child: group.child, parent: group.parent, foreignKey: group.foreignKey, key: { kind: 'primary-key', columns: primary.map(column => column.name), values: value } }); }
  }
  if (identities.length !== rows.length) throw Error('SQLite外键违规行身份未覆盖完整原生结果'); return identities;
}
/** 原有效view只能保持有效；不读取业务行，不把既有坏view误判为本次造成。 */
async function validViews(driver: SqliteDriverSession, objects: RebuildFacts['objects'], control: SqliteTableBrowseControl): Promise<string[]> {
  const valid: string[] = [];
  for (const view of objects.filter(object => object.type === 'view')) {
    try { await read(driver, 'SELECT * FROM main.' + q(view.name) + ' LIMIT 0', [], 1, control); valid.push(view.name); }
    catch (reason) { control.check(); if (!(reason instanceof SqliteDriverError && reason.code === 'SQLITE_NATIVE_1' && reason.completedStatements === 0 && driver.isUsable && driver.transaction === true)) throw reason; }
  }
  return valid;
}
/** 仅真实可访问的rowid别名或原WITHOUT ROWID完整PK能定义复制顺序。 */
function rowIdentity(columns: Column[], indexes: Index[], withoutRowid: boolean): RebuildFacts['rowIdentity'] {
  const primary = columns.filter(column => column.primaryKey > 0).sort((a, b) => a.primaryKey - b.primaryKey);
  if (withoutRowid) {
    if (!primary.length || primary.some((column, index) => column.primaryKey !== index + 1)) throw Error('SQLite重建缺少完整WITHOUT ROWID主键');
    return { kind: 'primary-key', columns: primary.map(column => column.name) };
  }
  if (primary.length === 1 && primary[0].declaredType.toUpperCase() === 'INTEGER' && !indexes.some(index => index.origin === 'pk')) return { kind: 'rowid', source: primary[0].name };
  const available = ['_rowid_', 'rowid', 'oid'].find(name => !columns.some(column => fold(column.name) === name)); if (available) return { kind: 'rowid', source: available };
  throw Error('SQLite重建无法访问真实rowid；不会用普通唯一键冒充物理行身份');
}
/** 全main定义/root/FK和目标完整索引目录均来自原生，不正则猜依赖。 */
async function readFacts(driver: SqliteDriverSession, table: string, control: SqliteTableBrowseControl): Promise<RebuildFacts> {
  if (/^sqlite_/i.test(table)) throw Error('SQLite系统表不能重建'); await assertFlags(driver, control);
  const schemaVersion = schemaCookie((await read(driver, 'PRAGMA main.schema_version', [], 1, control))[0]?.[0]), catalogue = await readSqliteTableCatalogue(driver, table, control);
  const flags = await read(driver, "SELECT type,wr,strict FROM pragma_table_list WHERE schema='main' AND name=? COLLATE BINARY LIMIT 2", [table], 2, control);
  if (catalogue.kind !== 'table' || flags.length !== 1 || flags[0][0] !== 'table') throw Error('SQLite重建只支持main普通表，系统、虚拟、影子表和view拒绝写入');
  const rows = await read(driver, 'SELECT ' + ['type', 'name', 'tbl_name', 'sql'].map(exact).join(',') + ',rootpage FROM main.sqlite_schema WHERE type IN (\'table\',\'index\',\'view\',\'trigger\') ORDER BY type,name COLLATE BINARY LIMIT ' + (limits.relatedObjects + 1), [], limits.relatedObjects + 1, control);
  if (rows.length > limits.relatedObjects) throw Error('SQLite完整重建目录超过4096项预算');
  const objects = rows.map(row => ({ type: row[0] as 'table' | 'index' | 'view' | 'trigger', name: row[1] as string, table: row[2] as string, sql: row[3] as string | null })), roots = rows.map(row => ({ type: row[0] as string, name: row[1] as string, table: row[2] as string, root: integer(row[4]) }));
  if (objects.find(object => object.type === 'table' && object.name === table)?.sql !== catalogue.schemaSql) throw Error('SQLite重建原表定义无法无损确认');
  const columns: Column[] = catalogue.xinfo.map(row => ({ cid: Number(integer(row[0])), name: row[1] as string, declaredType: row[2] as string, notNull: integer(row[3]) === '1', defaultSql: row[4] as string | null, primaryKey: Number(integer(row[5])), hidden: Number(integer(row[6])) }));
  const foreignKeys = await read(driver, 'SELECT m.name,f.id,f.seq,f."table",f."from",f."to",f.on_update,f.on_delete,f."match" FROM main.sqlite_schema AS m JOIN pragma_foreign_key_list(m.name,\'main\') AS f WHERE m.type=\'table\' ORDER BY m.name COLLATE BINARY,f.id,f.seq LIMIT 10001', [], 10001, control); if (foreignKeys.length > 10000) throw Error('SQLite完整重建外键定义超过10000项预算');
  const sequences = objects.some(object => object.type === 'table' && object.name === 'sqlite_sequence') ? await read(driver, 'SELECT rowid,' + exact('name') + ',' + exact('seq') + ' FROM main.sqlite_sequence ORDER BY rowid LIMIT 10001', [], 10001, control) : []; if (sequences.length > 10000) throw Error('SQLite重建序列目录超过10000项预算');
  const indexes = await readIndexes(driver, table, control);
  const withoutRowid = integer(flags[0][1]) === '1', facts: RebuildFacts = { schemaVersion, catalogue, columns, objects, roots, strict: integer(flags[0][2]) === '1', withoutRowid, autoIncrement: sqliteTableHasAutoincrement(catalogue.schemaSql, table), indexes, foreignKeys, sequences, foreign: await foreignCheck(driver, control), validViews: await validViews(driver, objects, control), rowIdentity: rowIdentity(columns, indexes, withoutRowid) };
  if (Buffer.byteLength(JSON.stringify(facts)) > limits.ddlBytes) throw Error('SQLite完整重建元数据超过2MiB预算'); return facts;
}
/** 候选和最终目标都核完整index_xinfo，不仅凭CREATE成功推断自动索引正确。 */
async function readIndexes(driver: SqliteDriverSession, table: string, control: SqliteTableBrowseControl): Promise<Index[]> {
  const indexRows = await read(driver, 'SELECT name,origin,"unique",partial FROM pragma_index_list(?,\'main\') ORDER BY name COLLATE BINARY LIMIT 4097', [table], 4097, control); if (indexRows.length > 4096) throw Error('SQLite重建索引目录超过4096项预算'); const indexes: Index[] = [];
  for (const row of indexRows) { if (typeof row[0] !== 'string' || typeof row[1] !== 'string') throw Error('SQLite重建索引事实无效'); const columns = await read(driver, 'SELECT seqno,cid,name,"desc",coll,"key" FROM pragma_index_xinfo(?,\'main\') ORDER BY seqno LIMIT 1026', [row[0]], 1026, control); if (columns.length > 1025) throw Error('SQLite重建索引列目录超过完整预算'); indexes.push({ name: row[0], origin: row[1], unique: integer(row[2]), partial: integer(row[3]), columns }); } return indexes;
}
/** COUNT保持原生64位文本，不把业务行读入Main内存。 */
async function countRows(driver: SqliteDriverSession, table: string, control: SqliteTableBrowseControl): Promise<string> {
  const rows = await read(driver, 'SELECT COUNT(*) FROM main.' + q(table), [], 1, control), value = integer(rows[0]?.[0]); if (rows.length !== 1 || !/^(?:0|[1-9][0-9]*)$/.test(value) || BigInt(value) > 9223372036854775807n) throw Error('SQLite重建准确COUNT事实无效'); return value;
}
/** 目录比对排除合法数据/序列水位变化，但任何外部DDL/root变化都使旧能力失效。 */
function sameFacts(left: RebuildFacts, right: RebuildFacts): boolean { const schema = ({ foreign: _foreign, sequences: _sequences, ...facts }: RebuildFacts) => facts; return equal(schema(left), schema(right)); }
/** 所有独立RO事务必须由原连接显式回滚，退出证明仍归Runtime原资源账本。 */
async function snapshotRead<T>(driver: SqliteDriverSession, control: SqliteTableBrowseControl, action: () => Promise<T>): Promise<T> {
  let value!: T, failure: unknown, failed = false;
  try { control.check(); await driver.execute('BEGIN'); control.check(); value = await action(); } catch (reason) { failure = reason; failed = true; }
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); } catch (reason) { control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite重建检查及原读事务收尾均失败') : reason; failed = true; }
  else if (!driver.isClosed && driver.transaction !== false) { const reason = Error('SQLite重建原读事务状态未知'); control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason]) : reason; failed = true; }
  if (failed) throw failure; control.check(); return value;
}
/** inspect不创建候选、不试写DDL，完整目录与行身份来自独立只读快照。 */
export async function inspectSqliteTableRebuild(driver: SqliteDriverSession, profile: SqliteConnectionProfile, table: string, control: SqliteTableBrowseControl): Promise<SqliteTableRebuildSnapshot> {
  if (!driver.readOnly || driver.isRebuildWriter || !driver.identity) throw Error('SQLite重建检查必须独立只读且持有原文件身份');
  const snapshot: SqliteTableRebuildSnapshot = { target: { connectionId: profile.id, database: 'main', table }, profile: structuredClone(profile), identity: driver.identity, version: driver.version, rowCount: '0', facts: undefined! };
  await snapshotRead(driver, control, async () => { await assertFile(snapshot, control); snapshot.facts = await readFacts(driver, table, control); snapshot.rowCount = await countRows(driver, table, control); await assertFile(snapshot, control); }); return snapshot;
}
/** preview再次独立RO复核，不能让目录ABA或连接编辑沿用旧文件能力。 */
export async function verifySqliteTableRebuild(driver: SqliteDriverSession, snapshot: SqliteTableRebuildSnapshot, control: SqliteTableBrowseControl): Promise<void> {
  if (!driver.readOnly || driver.isRebuildWriter || !equal(driver.identity, snapshot.identity) || driver.version !== snapshot.version) throw Error(stale);
  await snapshotRead(driver, control, async () => { await assertFile(snapshot, control); if (!sameFacts(snapshot.facts, await readFacts(driver, snapshot.target.table, control))) throw Error(stale); await assertFile(snapshot, control); });
}

type Compiled = ReturnType<typeof buildSqliteTableRebuildPlan>;
export interface SqliteTableRebuildCatalogue extends SqliteTableRebuildSnapshot { id: string; expires: number; bytes: number; }
export interface SqliteTableRebuildClaim { id: string; catalogue: SqliteTableRebuildCatalogue; compiled: Compiled; changes: SqliteTableRebuildChange[]; columnOrder?: string[]; foreignKeyEdits?: SqliteTableForeignKeyEdit[]; primaryKeyEdit?: SqliteTablePrimaryKeyEdit; expires: number; bytes: number; confirmed: boolean; }
/** sqlite_sequence的目标存在性与原rowid/水位精确保留，不把复制后的MAX(id)冒充原序列。 */
function targetSequence(facts: RebuildFacts, table: string): SqliteValue[] | undefined {
  const values = facts.sequences.filter(row => row[1] === table); if (values.length > 1) throw Error('SQLite重建目标有重复序列，无法准确恢复');
  if (values[0]) { if (values[0].length !== 3) throw Error('SQLite重建序列事实格式无效'); signedInteger(values[0][0]); signedInteger(values[0][2]); }
  return values[0];
}
/** 公共展示仅来自原快照；不把真实文件路径/私有SQL执行参数传到Renderer。 */
function publicSource(snapshot: SqliteTableRebuildSnapshot) {
  const sequence = targetSequence(snapshot.facts, snapshot.target.table);
  return { target: { ...snapshot.target }, columns: structuredClone(snapshot.facts.columns), tableSql: snapshot.facts.catalogue.schemaSql, relatedObjects: structuredClone(snapshot.facts.objects), strict: snapshot.facts.strict, withoutRowid: snapshot.facts.withoutRowid, rowIdentity: structuredClone(snapshot.facts.rowIdentity), ...(snapshot.facts.objects.some(object => object.type === 'table' && object.name === 'sqlite_sequence') ? { sequence: { present: !!sequence, ...(sequence ? { value: signedInteger(sequence[2]) } : {}) } } : {}) };
}
/** TTL阻止新领取，不能释放仍被原任务pin占用的字节；显式release同时撤销已过期pin。 */
export class SqliteTableRebuild {
  private readonly catalogues = new Map<string, SqliteTableRebuildCatalogue>(); private readonly previews = new Map<string, SqliteTableRebuildClaim>();
  private readonly pins = new Map<SqliteTableRebuildCatalogue, number>(); private readonly revoked = new WeakSet<SqliteTableRebuildCatalogue>(); private catalogueBytes = 0; private previewBytes = 0;
  private dropPreview(id: string): void { const value = this.previews.get(id); if (value) { this.previewBytes -= value.bytes; this.previews.delete(id); } }
  private dropCatalogue(id: string, revoke: boolean): void {
    const value = this.catalogues.get(id);
    if (revoke) { if (value) this.revoked.add(value); for (const pin of this.pins.keys()) if (pin.id === id) this.revoked.add(pin); for (const preview of this.previews.values()) if (preview.catalogue.id === id) this.dropPreview(preview.id); }
    if (value) { if (!this.pins.has(value)) this.catalogueBytes -= value.bytes; this.catalogues.delete(id); }
  }
  private prune(): void { for (const value of this.previews.values()) if (value.expires <= Date.now()) this.dropPreview(value.id); for (const value of this.catalogues.values()) if (value.expires <= Date.now()) this.dropCatalogue(value.id, false); }
  private count(): number { let count = this.catalogues.size; for (const pin of this.pins.keys()) if (this.catalogues.get(pin.id) !== pin) count++; return count; }
  publish(snapshot: SqliteTableRebuildSnapshot): SqliteTableRebuildInspectOutput {
    this.prune(); const bytes = Buffer.byteLength(JSON.stringify(snapshot)); if (this.count() >= limits.catalogues || this.catalogueBytes + bytes > limits.catalogueBytes) throw Error('SQLite重建目录能力预算已满');
    const value: SqliteTableRebuildCatalogue = { ...snapshot, id: randomUUID(), expires: Date.now() + limits.catalogueLifetimeMs, bytes }, output = sqliteTableRebuildInspectionSchema.parse({ ...publicSource(value), catalogueId: value.id, readOnly: value.profile.sqlite.readOnly, expiresAt: new Date(value.expires).toISOString() });
    this.catalogues.set(value.id, value); this.catalogueBytes += bytes; return output;
  }
  catalogue(id: string): SqliteTableRebuildCatalogue { this.prune(); const value = this.catalogues.get(id); if (!value) throw Error(stale); return value; }
  pin(value: SqliteTableRebuildCatalogue): { check(): void; release(): void } {
    this.prune(); if (this.revoked.has(value)) throw Error(stale);
    // 目录TTL先到而preview仍有效时，claim已归还preview预算；首次pin必须重新预留原目录的准确预算。
    if (!this.pins.has(value) && this.catalogues.get(value.id) !== value) { if (this.count() >= limits.catalogues || this.catalogueBytes + value.bytes > limits.catalogueBytes) throw Error('SQLite重建在途目录能力预算已满'); this.catalogueBytes += value.bytes; }
    this.pins.set(value, (this.pins.get(value) ?? 0) + 1); let released = false;
    return { check: () => { if (released || this.revoked.has(value)) throw Error(stale); }, release: () => { if (released) return; released = true; const count = this.pins.get(value)!; if (count > 1) this.pins.set(value, count - 1); else { this.pins.delete(value); if (this.catalogues.get(value.id) !== value) this.catalogueBytes -= value.bytes; } } };
  }
  /** 预览仅编译固定计划，不CREATE候选或尝试用户默认值表达式。 */
  preview(catalogue: SqliteTableRebuildCatalogue, rawChanges: SqliteTableRebuildChange[], names: SqliteTableRebuildNames, columnOrder?: readonly string[], foreignKeyEdits?: readonly SqliteTableForeignKeyEdit[], primaryKeyEdit?: SqliteTablePrimaryKeyEdit): SqliteTableRebuildPreviewOutput {
    if (this.revoked.has(catalogue)) throw Error(stale); const changes = sqliteTableRebuildEditsSchema.parse(rawChanges), compiled = buildSqliteTableRebuildPlan(publicSource(catalogue), changes, names, columnOrder, foreignKeyEdits, primaryKeyEdit); this.prune(); const bytes = Buffer.byteLength(JSON.stringify({ catalogue, compiled, changes, ...(compiled.primaryKeyEdit ? { primaryKeyEdit: compiled.primaryKeyEdit } : {}), ...(compiled.foreignKeyEdits ? { foreignKeyEdits: compiled.foreignKeyEdits } : {}) }));
    if (this.previews.size >= limits.previews || this.previewBytes + bytes > limits.previewBytes) throw Error('SQLite重建预览能力预算已满');
    const value: SqliteTableRebuildClaim = { id: randomUUID(), catalogue, compiled, changes: structuredClone(changes), ...(compiled.primaryKeyEdit ? { primaryKeyEdit: structuredClone(compiled.primaryKeyEdit) } : {}), ...(compiled.columnOrder ? { columnOrder: [...compiled.columnOrder] } : {}), ...(compiled.foreignKeyEdits ? { foreignKeyEdits: structuredClone(compiled.foreignKeyEdits) } : {}), expires: Date.now() + limits.previewLifetimeMs, bytes, confirmed: false }; this.previews.set(value.id, value); this.previewBytes += bytes;
    return { previewId: value.id, catalogueId: catalogue.id, target: { ...catalogue.target }, sql: [...compiled.sql], confirmation: 'main.' + catalogue.target.table, changedTypes: compiled.changedTypes, changedDefaults: compiled.changedDefaults, ...(compiled.changedPrimaryKey ? { changedPrimaryKey: true as const } : {}), ...(compiled.changedOrder ? { changedOrder: true as const } : {}), ...(compiled.changedForeignKeys ? { changedForeignKeys: compiled.changedForeignKeys } : {}), warnings: [...compiled.warnings], expiresAt: new Date(value.expires).toISOString() };
  }
  /** 确认失败也消费准确preview，不能把同一次确认自动重放。 */
  claim(input: SqliteTableRebuildApplyInput): SqliteTableRebuildClaim { this.prune(); const value = this.previews.get(input.previewId); if (!value) throw Error(stale); this.dropPreview(value.id); return { ...value, confirmed: input.confirmation === 'main.' + value.catalogue.target.table }; }
  release(input: SqliteTableRebuildReleaseInput): void { if (input.previewId) this.dropPreview(input.previewId); if (input.catalogueId) this.dropCatalogue(input.catalogueId, true); }
  releaseConnection(id: string): void { for (const value of new Set([...this.catalogues.values(), ...this.pins.keys()])) if (value.target.connectionId === id) this.dropCatalogue(value.id, true); for (const value of this.previews.values()) if (value.catalogue.target.connectionId === id) this.dropPreview(value.id); }
  settle(claim: SqliteTableRebuildClaim, outcome: SqliteTableRebuildOutcome['outcome']): void { if (outcome === 'committed' || outcome === 'unknown') this.dropCatalogue(claim.catalogue.id, true); }
}

/** 候选可含唯一内部ordinal；移除后cid重新按用户列从0核对。 */
async function readColumns(driver: SqliteDriverSession, table: string, control: SqliteTableBrowseControl): Promise<Column[]> {
  const rows = await read(driver, 'SELECT cid,name,type,"notnull",dflt_value,pk,hidden FROM pragma_table_xinfo(?,\'main\') ORDER BY cid LIMIT 1026', [table], 1026, control); if (!rows.length || rows.length > 1025) throw Error('SQLite重建候选字段目录不完整');
  return rows.map(row => ({ cid: Number(integer(row[0])), name: row[1] as string, declaredType: row[2] as string, notNull: integer(row[3]) === '1', defaultSql: row[4] as string | null, primaryKey: Number(integer(row[5])), hidden: Number(integer(row[6])) }));
}
/** 仅明确PK计划可更新主键和隐含可空性；名称、生成标记及未计划列属性必须保持。 */
function expectedColumns(snapshot: SqliteTableRebuildSnapshot, changes: SqliteTableRebuildChange[], columnOrder?: string[], keyLayout?: Compiled['keyLayout']): Column[] {
  const columns = columnOrder ? columnOrder.map(name => snapshot.facts.columns.find(column => column.name === name)!) : snapshot.facts.columns;
  return columns.map((column, cid) => { const change = changes.find(change => fold(change.column) === fold(column.name)); return { ...column, cid, ...(keyLayout?.columns.find(value => value.name === column.name) ?? {}), ...(change?.declaredType !== undefined ? { declaredType: change.declaredType } : {}), ...(change?.default !== undefined ? { defaultSql: buildSqliteTableCreateDefault(change.default) ?? null } : {}) }; });
}
function userColumns(columns: Column[], ordinal?: string): Column[] { return columns.filter(column => column.name !== ordinal).map((column, cid) => ({ ...column, cid })); }
/** 精确原生对象列表只允许计划目标及其附属索引/触发器发生重建。 */
async function verifyRetained(before: RebuildFacts, after: RebuildFacts, table: string, losslessColumns: string[], control: SqliteTableBrowseControl, changedOrder = false, expectedForeignKeys?: SqliteValue[][], primaryPlan?: Compiled): Promise<void> {
  const owned = (object: { type: string; name: string; table: string }) => object.type === 'table' && object.name === table || ['index', 'trigger'].includes(object.type) && fold(object.table) === fold(table);
  const newSequence = !!primaryPlan?.keyLayout?.autoIncrement && !before.objects.some(object => object.type === 'table' && object.name === 'sqlite_sequence');
  const original = before.objects.filter(object => !owned(object)), current = after.objects.filter(object => !owned(object) && !(newSequence && object.type === 'table' && object.name === 'sqlite_sequence' && object.sql === 'CREATE TABLE sqlite_sequence(name,seq)')); if (!equal(original, current)) throw Error('SQLite重建使非目标schema对象定义发生变化');
  for (const root of before.roots.filter(root => !owned(root))) if (!equal(root, after.roots.find(value => value.type === root.type && value.name === root.name))) throw Error('SQLite重建使非目标对象rootpage发生变化');
  for (const object of before.objects.filter(object => ['index', 'trigger'].includes(object.type) && fold(object.table) === fold(table) && object.sql !== null)) if (!equal(object, after.objects.find(value => value.type === object.type && value.name === object.name))) throw Error('SQLite原附属索引或触发器未按准确原SQL恢复');
  const explicit = (facts: RebuildFacts) => facts.objects.filter(object => ['index', 'trigger'].includes(object.type) && fold(object.table) === fold(table) && object.sql !== null); if (!equal(explicit(before), explicit(after))) throw Error('SQLite重建出现非计划附属索引或触发器');
  // 只有完整计划和native候选都核过的新目标外键可变；其他表的外键仍来自准确原目录。
  const normalizeForeign = changedOrder || expectedForeignKeys !== undefined;
  const expected = expectedForeignKeys === undefined ? before.foreignKeys : [...before.foreignKeys.filter(row => typeof row[0] !== 'string' || fold(row[0]) !== fold(table)), ...expectedForeignKeys];
  const foreign = (rows: SqliteValue[][]) => normalizeForeign ? normalizedForeignDefinitions(rows, table) : rows;
  if (!equal(foreign(expected), foreign(after.foreignKeys))) throw new ForeignKeyVerificationError(text.foreignDefinition);
  const sequences = (rows: SqliteValue[][]) => primaryPlan?.sequenceChanged ? rows.filter(row => row[1] !== table) : rows;
  if (!equal(sequences(before.sequences), sequences(after.sequences))) throw Error('SQLite重建非计划序列存在性/水位/rowid变化');
  if (primaryPlan && (after.foreign.unavailable || after.foreign.rows.length)) throw new ForeignKeyVerificationError(text.foreignUnavailable);
  if (after.foreign.unavailable || before.foreign.unavailable && after.foreign.rows.length !== 0) throw new ForeignKeyVerificationError(text.foreignUnavailable);
  const violations = (facts: RebuildFacts) => facts.foreign.identities.map(value => normalizeForeign && fold(value.child) === fold(table) ? { ...value, foreignKey: foreignConstraintIdentity(facts.foreignKeys, table, value.foreignKey) } : value);
  if (!primaryPlan && !before.foreign.unavailable) await assertForeignSubset(violations(before), violations(after), table, losslessColumns, control);
  if (before.validViews.some(name => !after.validViews.includes(name))) throw Error('SQLite重建使原有效视图失效');
}
/** 重排列跨度可能重编inline FK的native编号；只将目标表完整约束语义归一，重复约束仍保留多重性。 */
function foreignConstraintIdentity(rows: SqliteValue[][], table: string, id: string): string {
  const group = rows.filter(row => typeof row[0] === 'string' && fold(row[0]) === fold(table) && integer(row[1]) === id);
  if (!group.length) throw Error('SQLite重排外键编号缺少完整原生定义');
  return JSON.stringify(group.map(row => [row[0], ...row.slice(2)]));
}
function normalizedForeignDefinitions(rows: SqliteValue[][], table: string): string[] {
  const target = rows.filter(row => typeof row[0] === 'string' && fold(row[0]) === fold(table));
  return [...rows.filter(row => !target.includes(row)).map(row => JSON.stringify(row)), ...[...new Set(target.map(row => integer(row[1])))].map(id => foreignConstraintIdentity(rows, table, id))].sort();
}
/** index_xinfo中的真实列号随重排变化，表达式/rowid负号及其余原生事实必须原样保持。 */
function reorderedIndexes(indexes: Index[], before: Column[], after: Column[]): Index[] {
  return indexes.map(index => ({ ...index, columns: index.columns.map(row => { const cid = signedInteger(row[1]); if (BigInt(cid) < 0n) return row; const column = before.find(column => column.cid === Number(cid)), mapped = column && after.find(value => value.name === column.name); if (!mapped) throw Error('SQLite重排索引列号无法按准确名称映射'); return row.map((value, position) => position === 1 ? { type: 'integer' as const, value: String(mapped.cid) } : value); }) }));
}
/** 原具体违规行可减少；新违规身份不能借重复NULL-rowid tuple或同数换行隐藏。 */
async function assertForeignSubset(before: ForeignViolation[], after: ForeignViolation[], table: string, losslessColumns: string[], control: SqliteTableBrowseControl): Promise<void> {
  const grouped = new Map<string, ForeignViolation[]>(), key = (value: ForeignViolation) => JSON.stringify([value.child, value.parent, value.foreignKey, value.key.kind]); let compared = 0;
  for (const value of before) { const groupKey = key(value), values = grouped.get(groupKey); if (values) values.push(value); else grouped.set(groupKey, [value]); }
  for (const value of after) {
    control.check(); const candidates = grouped.get(key(value)); if (!candidates?.length) throw new ForeignKeyVerificationError(text.foreignRows); let matched = -1;
    for (let index = 0; index < candidates.length; index++) {
      const current = value.key, original = candidates[index].key;
      const same = current.kind === 'rowid' && original.kind === 'rowid' ? current.value === original.value : current.kind === 'primary-key' && original.kind === 'primary-key' && equal(current.columns, original.columns) && current.values.every((cell, ordinal) => sqliteRebuildStoredKeyEquivalent(original.values[ordinal], cell, fold(value.child) === fold(table) && losslessColumns.includes(current.columns[ordinal])));
      // 最坏有界匹配也定期交还Main事件循环，撤销/关闭不必等待整个违规目录比完。
      if (++compared % 256 === 0) { await new Promise<void>(resolve => setImmediate(resolve)); control.check(); }
      if (same) { matched = index; break; }
    }
    if (matched < 0) throw new ForeignKeyVerificationError(text.foreignRows); candidates.splice(matched, 1);
  }
}
/** native更名仅允许CREATE头对象名变化；用同一跨度编译器归一到另一准确名称再比完整正文。 */
function sameDefinition(candidateSql: string, finalSql: string, claim: SqliteTableRebuildClaim): boolean {
  const columns = expectedColumns(claim.catalogue, claim.changes, claim.columnOrder, claim.compiled.keyLayout).map(column => ({ name: column.name, hidden: column.hidden }));
  return normalizeSqliteTableRebuildDefinitionName({ table: claim.compiled.names.candidate, tableSql: candidateSql, columns }, claim.compiled.names.verificationCandidate) === normalizeSqliteTableRebuildDefinitionName({ table: claim.catalogue.target.table, tableSql: finalSql, columns }, claim.compiled.names.verificationCandidate);
}
/** 比较只返回计数；不把SQL、默认值、字段或业务行写入任务事实。 */
function comparison(source: string, candidate: string, ordinal: string, columns: string[], identity: RebuildFacts['rowIdentity'], candidateIdentity: RebuildFacts['rowIdentity'], losslessColumns: string[] = [], sourceOrdinal?: string, candidateOrder?: string[]): SqliteRebuildComparisonInput {
  return { source, candidate, candidateOrdinal: ordinal, columns, sourceOrder: identity.kind === 'rowid' ? [identity.source] : [...identity.columns], ...(identity.kind === 'rowid' && candidateIdentity.kind === 'rowid' ? { rowid: { source: identity.source, candidate: candidateIdentity.source } } : {}), losslessColumns, ...(sourceOrdinal ? { sourceOrdinal } : {}), ...(candidateOrder ? { candidateOrder } : {}) };
}
/** 写入未发送也返回准确原操作和固定计划数量。 */
export function sqliteTableRebuildNotSent(claim: SqliteTableRebuildClaim, input: SqliteTableRebuildApplyRequest): SqliteTableRebuildOutcome {
  const fact: SqliteTableRebuildFact = { operationId: input.operationId, target: { ...claim.catalogue.target }, phase: 'not-sent', requestedStatements: claim.compiled.sql.length, completedStatements: 0, sourceRows: '0', copiedRows: '0', verifiedRows: '0', commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false }; let warning = false;
  try { const value: unknown = input.recordRebuildFact(fact); if (value && typeof (value as { then?: unknown }).then === 'function') throw Error('SQLite重建事实必须同步持久化'); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...fact.target }, outcome: 'not-sent', fact, definitionVerified: false, message: text.notSent, ...(warning ? { cleanupWarning: true } : {}) };
}

/** 官方12步在固定私有writer事务内完成；双验证表补足移除ordinal后的真实逐值证明。 */
/** 只传递固定的检查类别；不将驱动错误中的业务值、SQL或路径带到结果和任务。 */
class ForeignKeyVerificationError extends Error {}

export async function applySqliteTableRebuild(driver: SqliteDriverSession, claim: SqliteTableRebuildClaim, input: SqliteTableRebuildApplyRequest, control: SqliteTableRebuildControl): Promise<SqliteTableRebuildOutcome> {
  const snapshot = claim.catalogue; let begun = false, sent = false, committed = false, rollback = false, verified = false, completedStatements = 0, warning = false;
  let sourceRows = '0', copiedRows = '0', verifiedRows = '0', before!: RebuildFacts, candidateSql = '', candidateIndexes: Index[] = [], candidateForeignKeys: SqliteValue[][] | undefined, foreignDiagnostic = '';
  const fact = (phase: SqliteTableRebuildFact['phase']): SqliteTableRebuildFact => ({ operationId: input.operationId, target: { ...snapshot.target }, phase, requestedStatements: claim.compiled.sql.length, completedStatements, sourceRows, copiedRows, verifiedRows, commitMayHaveBeenSent: sent || phase === 'commit-pending', commitAcknowledged: committed, rollbackAcknowledged: rollback });
  const record = (phase: SqliteTableRebuildFact['phase']) => { const value: unknown = input.recordRebuildFact(fact(phase)); if (value && typeof (value as { then?: unknown }).then === 'function') throw Error('SQLite重建事实必须同步持久化'); };
  const check = () => { input.assertCurrent(); control.check(); };
  const compare = async (request: SqliteRebuildComparisonInput) => { check(); const result = await driver.rebuildCompare(request, { onProgress: () => { check(); } }); check(); if (result.sourceRows !== sourceRows || result.candidateRows !== sourceRows || result.verifiedRows !== sourceRows) throw Error('SQLite重建全量比较数量与写锁内COUNT不一致'); };
  try {
    check(); if (!claim.confirmed || snapshot.profile.sqlite.readOnly || driver.readOnly || !driver.isRebuildWriter || driver.transaction !== false || !equal(driver.identity, snapshot.identity) || driver.version !== snapshot.version) throw Error(stale);
    copySqliteTableRebuildNames(claim.compiled.names); if (!equal(buildSqliteTableRebuildPlan(publicSource(snapshot), claim.changes, claim.compiled.names, claim.columnOrder, claim.foreignKeyEdits, claim.primaryKeyEdit), claim.compiled)) throw Error(stale); await assertFile(snapshot, control); record('not-sent');
    try { await driver.execute('BEGIN IMMEDIATE'); begun = true; } catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults[0]?.transaction === true) begun = true; throw reason; }
    check(); await assertFile(snapshot, control); before = await readFacts(driver, snapshot.target.table, control); if (!sameFacts(snapshot.facts, before)) throw Error(stale); sourceRows = await countRows(driver, snapshot.target.table, control); record('writing');
    const names = claim.compiled.names, sourceFields = before.columns.map(column => column.name), identity = claim.compiled.candidateRowIdentity, expected = expectedColumns(snapshot, claim.changes, claim.columnOrder, claim.compiled.keyLayout), fields = expected.map(column => column.name);
    for (const step of claim.compiled.steps) {
      check();
      if (step.role === 'verification-create') {
        const first = comparison(snapshot.target.table, names.candidate, names.ordinal, sourceFields, before.rowIdentity, identity, claim.compiled.losslessColumns, undefined, claim.columnOrder);
        if (claim.compiled.rowidChanged) { first.rowidTransition = first.rowid; delete first.rowid; }
        await compare(first); verifiedRows = sourceRows; record('writing');
      }
      if (step.role === 'ordinal-index-drop') await compare(comparison(names.candidate, names.verificationCandidate, names.verificationOrdinal, fields, identity, identity, [], names.ordinal));
      if (step.role === 'original-drop') {
        if (!equal(await readColumns(driver, names.candidate, control), expected)) throw Error('SQLite移除内部序号后完整用户字段定义不一致');
        await compare(comparison(names.candidate, names.verificationCandidate, names.verificationOrdinal, fields, identity, identity));
        const rows = await read(driver, 'SELECT ' + exact('sql') + ' FROM main.sqlite_schema WHERE type=\'table\' AND name=? COLLATE BINARY', [names.candidate], 1, control); if (rows.length !== 1 || typeof rows[0][0] !== 'string') throw Error('SQLite候选最终定义无法确认'); candidateSql = rows[0][0] as string;
        if (claim.foreignKeyEdits || claim.primaryKeyEdit) {
          const planned = compileSqliteTableRebuildDefinition({ table: snapshot.target.table, tableSql: before.catalogue.schemaSql, columns: before.columns.map(column => ({ name: column.name, hidden: column.hidden })), candidateName: names.candidate, changes: claim.changes, columnOrder: claim.columnOrder, foreignKeyEdits: claim.foreignKeyEdits, primaryKeyEdit: claim.primaryKeyEdit });
          const normalized = (tableSql: string) => normalizeSqliteTableRebuildDefinitionName({ table: names.candidate, tableSql, columns: expected.map(column => ({ name: column.name, hidden: column.hidden })) }, names.verificationCandidate);
          if (normalized(candidateSql) !== normalized(planned.candidateSql)) throw new ForeignKeyVerificationError(text.foreignDefinition);
          candidateForeignKeys = (await read(driver, 'SELECT ?,f.id,f.seq,f."table",f."from",f."to",f.on_update,f.on_delete,f."match" FROM pragma_foreign_key_list(?,\'main\') AS f ORDER BY f.id,f.seq LIMIT 10001', [snapshot.target.table, names.candidate], 10001, control));
          if (candidateForeignKeys.length > 10000) throw Error('SQLite目标外键完整目录超过预算');
        }
        candidateIndexes = await readIndexes(driver, names.candidate, control);
      }
      if (step.role === 'verification-drop') {
        await compare(comparison(snapshot.target.table, names.verificationCandidate, names.verificationOrdinal, fields, identity, identity));
        if (!equal(await readColumns(driver, snapshot.target.table, control), expected)) throw Error('SQLite最终目标完整用户字段定义不一致');
      }
      const sequence = targetSequence(before, snapshot.target.table), parameters: SqliteValue[] = step.role === 'sequence-delete' ? [snapshot.target.table] : step.role === 'sequence-insert' ? [sequence?.[0] ?? { type: 'integer', value: '0' }, snapshot.target.table, sequence?.[2] ?? { type: 'integer', value: '0' }, { type: 'integer', value: sequence ? '1' : '0' }] : [];
      const trigger = step.role === 'restore-trigger' ? before.objects.find(object => object.type === 'trigger' && object.sql === step.sql && fold(object.table) === fold(snapshot.target.table)) : undefined;
      try { const result = await driver.execute(step.sql, { parameters, ...(trigger ? { createGuard: { kind: 'trigger' as const, name: trigger.name, allowedRelations: [snapshot.target.table] } } : {}) }); if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== 0) throw Error('SQLite重建固定语句缺少真实完整回执'); completedStatements++; }
      catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated) completedStatements++; throw reason; }
      if (step.role === 'original-copy') { copiedRows = await countRows(driver, names.candidate, control); if (copiedRows !== sourceRows) throw Error('SQLite复制候选行数与原COUNT不一致'); }
      if (step.role === 'candidate-create' || step.role === 'verification-create') { const ordinal = step.role === 'candidate-create' ? names.ordinal : names.verificationOrdinal, table = step.role === 'candidate-create' ? names.candidate : names.verificationCandidate; if (!equal(userColumns(await readColumns(driver, table, control), ordinal), expected)) throw Error('SQLite候选原生字段定义与准确类型/default补丁不一致'); }
      record('writing'); check();
    }
    const after = await readFacts(driver, snapshot.target.table, control); if (!equal(after.columns, expected) || before.strict !== after.strict || before.withoutRowid !== after.withoutRowid || (claim.primaryKeyEdit ? claim.compiled.keyLayout!.autoIncrement : before.autoIncrement) !== after.autoIncrement || !equal(after.rowIdentity, identity) || !sameDefinition(candidateSql, after.catalogue.schemaSql, claim)) throw Error('SQLite最终表定义、字段或表选项与已验证候选不一致');
    const originalIndexes = claim.compiled.changedOrder ? reorderedIndexes(before.indexes, before.columns, expected) : before.indexes;
    const automatic = (indexes: Index[]) => indexes.filter(index => index.origin !== 'c').map(({ name: _name, ...index }) => JSON.stringify(index)).sort();
    const explicit = (indexes: Index[]) => indexes.filter(index => index.origin === 'c').map(index => claim.primaryKeyEdit ? { ...index, columns: index.columns.filter(row => integer(row[5]) === '1') } : index);
    if (!equal(automatic(candidateIndexes), automatic(after.indexes)) || !equal(explicit(originalIndexes), explicit(after.indexes))) throw Error('SQLite原生自动索引或原explicit索引后验不一致');
    if (claim.compiled.sequenceChanged) {
      const sequence = targetSequence(after, snapshot.target.table);
      if (claim.compiled.keyLayout!.autoIncrement) {
        if (identity.kind !== 'rowid' || !sequence) throw Error('SQLite新自增主键缺少真实序列');
        const expectedSequence = await read(driver, 'SELECT MAX(0,COALESCE(MAX(' + q(identity.source) + '),0)) FROM main.' + q(snapshot.target.table), [], 1, control);
        if (expectedSequence.length !== 1 || !equal(sequence[2], expectedSequence[0][0])) throw Error('SQLite新自增主键水位与当前完整原生值不一致');
      } else if (sequence) throw Error('SQLite停用自增后目标序列未移除');
    }
    await verifyRetained(before, after, snapshot.target.table, claim.compiled.losslessColumns, { ...control, check }, claim.compiled.changedOrder, candidateForeignKeys, claim.primaryKeyEdit ? claim.compiled : undefined); if (await countRows(driver, snapshot.target.table, control) !== sourceRows) throw Error('SQLite最终准确行数发生变化');
    verified = true; await assertFile(snapshot, control); record('commit-pending'); check(); control.beginCommit(); sent = true; await driver.execute('COMMIT'); committed = true; try { record('committed'); } catch { warning = true; }
  } catch (reason) {
    if ((claim.foreignKeyEdits || claim.primaryKeyEdit) && reason instanceof ForeignKeyVerificationError) foreignDiagnostic = reason.message;
    if (sent && reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated && reason.completedResults[0].transaction === false) { committed = true; warning = true; try { record('committed'); } catch { /* 真实COMMIT statementEnd不能因末回包丢失被抹去。 */ } }
  }
  if (!committed) {
    // BEGIN之后任何控制回调异常都不能逃到外层被当作not-sent；真实ROLLBACK仍独立尝试并只凭ACK标记。
    try { control.beginCleanup(); } catch { warning = true; }
    const cleanupFailed = (reason: unknown) => { try { control.cleanupFailed(reason); } catch { warning = true; } };
    if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); rollback = true; } catch (reason) { cleanupFailed(reason); } else if (begun) cleanupFailed(Error('SQLite重建原写事务回滚未确认'));
  }
  const outcome: SqliteTableRebuildOutcome['outcome'] = committed ? 'committed' : rollback ? 'rolled-back' : begun || sent ? 'unknown' : 'not-sent'; if (!committed) try { record(outcome); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...snapshot.target }, outcome, fact: fact(outcome), definitionVerified: committed && verified, message: committed ? text.committed : outcome === 'unknown' ? text.unknown : outcome === 'rolled-back' ? text.rolledBack + (foreignDiagnostic ? ' ' + foreignDiagnostic : '') : text.notSent, ...(warning ? { cleanupWarning: true } : {}) };
}
