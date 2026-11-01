import { createHash, randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { SqliteConnectionProfile } from '../shared/contracts';
import { SqliteDriverError, type SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteExportTextFunction, type SqliteFileIdentity, type SqliteValue } from '../engine/sqlite/protocol';
import { readSqliteTableCatalogue, type SqliteTableCatalogue, type SqliteTableBrowseControl } from './sqliteTableBrowse';
import { buildSqliteTableRenamePlan, sqliteTableRenameInspectionSchema, sqliteTableRenameLimits as limits, sqliteTableRenameMessages as text, type SqliteTableRenameInspectInput, type SqliteTableRenameInspectOutput, type SqliteTableRenamePreviewInput, type SqliteTableRenamePreviewOutput, type SqliteTableRenameApplyInput, type SqliteTableRenameReleaseInput, type SqliteTableRenameFact, type SqliteTableRenameOutcome } from '../shared/sqliteTableRename';

export interface SqliteTableRenameInspectRequest extends SqliteTableRenameInspectInput { assertCurrent(): void; }
export interface SqliteTableRenamePreviewRequest extends SqliteTableRenamePreviewInput { assertCurrent(): void; }
export interface SqliteTableRenameApplyRequest extends SqliteTableRenameApplyInput { operationId: string; recordTableRenameFact(fact: SqliteTableRenameFact): void; assertCurrent(): void; }
export interface SqliteTableRenameControl extends SqliteTableBrowseControl { beginCommit(): void; }
type Compiled = ReturnType<typeof buildSqliteTableRenamePlan>;

interface ForeignCheck { unavailable: boolean; rows: string[]; }
class RenameForeignKeyFailure extends Error {}
type RenameColumnFact = SqliteTableRenameInspectOutput['columns'][number];
interface RenameFacts { schemaVersion: string; catalogue: SqliteTableCatalogue; objects: SqliteTableRenameInspectOutput['relatedObjects']; roots: { type: string; name: string; table: string; root: string }[]; columns: RenameColumnFact[]; strict: boolean; withoutRowid: boolean; foreignKeys: SqliteValue[][]; foreign: ForeignCheck; sequences: SqliteValue[][]; indexes: { name: string; origin: string; unique: string; partial: string; root: string; columns: SqliteValue[][] }[]; }
export interface SqliteTableRenameSnapshot { target: { connectionId: string; database: 'main'; table: string }; profile: SqliteConnectionProfile; identity: SqliteFileIdentity; version: string; facts: RenameFacts; }
const stale = 'SQLite表重命名目录、文件或预览已失效，请重新检查并明确预览';
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
function integer(value: SqliteValue | undefined): string { if (!value || typeof value !== 'object' || value.type !== 'integer') throw Error('SQLite表重命名整数事实无效'); return value.value; }
function exact(column: string): string { return `CASE WHEN typeof(${column})='text' THEN ${sqliteExportTextFunction}(${column},CAST(${column} AS BLOB)) ELSE ${column} END`; }

/** 目录不足预算必须失败；从不以截断结果宣称无冲突或外键检查完整。 */
async function read(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maximum: number, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<SqliteValue[][]> {
  control.check(); const rows: SqliteValue[][] = [];
  const result = await driver.execute(sql, { parameters, maxRows: maximum, maxBytes: 16 * 1024 * 1024, onBatch: batch => { control.check(); rows.push(...batch.rows); } });
  control.check(); if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== rows.length) throw Error('SQLite表重命名目录或外键检查超过完整读取预算'); return rows;
}
/** native路径协议与worker一致；只比较真实dev/ino，不把合法其它数据修改误判成路径替换。 */
async function assertFile(snapshot: Pick<SqliteTableRenameSnapshot, 'profile' | 'identity'>, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<void> {
  control.check(); try {
    const path = await realpath(snapshot.profile.sqlite.filePath!); control.check(); const value = await stat(snapshot.profile.sqlite.filePath!, { bigint: true }); control.check();
    if (path !== snapshot.identity.path || !value.isFile() || String(value.dev) !== snapshot.identity.device || String(value.ino) !== snapshot.identity.inode) throw Error(stale);
  } catch { control.check(); throw Error('SQLite表重命名目标实际文件身份变化或无法确认，拒绝提交'); }
}
/** 原native错误只有SQLite ERROR且driver仍在原事务中才记为不可检查；最终必须修成全valid才能提交。 */
async function foreignCheck(driver: SqliteDriverSession, control: SqliteTableBrowseControl): Promise<ForeignCheck> {
  try {
    const rows = await read(driver, 'PRAGMA main.foreign_key_check', [], 10001, control); if (rows.length > 10000) throw Error('SQLite外键违规超过10000项预算');
    if (rows.some(row => row.length !== 4)) throw Error('SQLite外键检查事实格式无效'); return { unavailable: false, rows: rows.map(row => JSON.stringify(row)).sort() };
  } catch (reason) {
    control.check(); if (reason instanceof SqliteDriverError && reason.code === 'SQLITE_NATIVE_1' && reason.completedStatements === 0 && driver.isUsable && driver.transaction === true) return { unavailable: true, rows: [] }; throw reason;
  }
}
/** 同一独立事务读取完整xinfo/原定义/全main依赖；每项目录超限明确失败。 */
async function readFacts(driver: SqliteDriverSession, table: string, control: SqliteTableBrowseControl): Promise<RenameFacts> {
  if (/^sqlite_/i.test(table)) throw Error('SQLite系统表不能管理表重命名');
  const schemaVersion = integer((await read(driver, 'PRAGMA main.schema_version', [], 1, control))[0]?.[0]), catalogue = await readSqliteTableCatalogue(driver, table, control);
  const flags = await read(driver, "SELECT type,wr,strict FROM pragma_table_list WHERE schema='main' AND name=? COLLATE BINARY LIMIT 2", [table], 2, control);
  if (catalogue.kind !== 'table' || flags.length !== 1 || flags[0][0] !== 'table') throw Error('SQLite表重命名管理仅支持main普通表，视图、虚拟表和影子表只读');
  const rows = await read(driver, 'SELECT ' + ['type', 'name', 'tbl_name', 'sql'].map(exact).join(',') + ',rootpage' + " FROM main.sqlite_schema WHERE type IN ('table','index','view','trigger') ORDER BY type,name COLLATE BINARY LIMIT " + (limits.relatedObjects + 1), [], limits.relatedObjects + 1, control);
  if (rows.length > limits.relatedObjects) throw Error('SQLite表重命名完整依赖目录超过4096项预算');
  const objects = rows.map(row => ({ type: row[0] as 'table' | 'index' | 'view' | 'trigger', name: row[1] as string, table: row[2] as string, sql: row[3] as string | null }));
  if (objects.find(row => row.type === 'table' && row.name === table)?.sql !== catalogue.schemaSql) throw Error('SQLite目标表原定义无法无损确认');
  const columns: RenameColumnFact[] = catalogue.xinfo.map(row => ({ cid: Number(integer(row[0])), name: row[1] as string, declaredType: row[2] as string, notNull: integer(row[3]) === '1', defaultSql: row[4] as string | null, primaryKey: Number(integer(row[5])), hidden: Number(integer(row[6])) }));
  const foreignKeys = await read(driver, 'SELECT m.name,f.id,f.seq,f."table",f."from",f."to",f.on_update,f.on_delete,f."match" FROM main.sqlite_schema AS m JOIN pragma_foreign_key_list(m.name,\'main\') AS f WHERE m.type=\'table\' ORDER BY m.name COLLATE BINARY,f.id,f.seq LIMIT 10001', [], 10001, control); if (foreignKeys.length > 10000) throw Error('SQLite全库外键定义超过10000项预算');
  if (integer((await read(driver, 'PRAGMA main.foreign_keys', [], 1, control))[0]?.[0]) !== '1' || integer((await read(driver, 'PRAGMA main.legacy_alter_table', [], 1, control))[0]?.[0]) !== '0') throw Error('SQLite原生ALTER保护选项不满足要求');
  const roots = rows.map(row => ({ type: row[0] as string, name: row[1] as string, table: row[2] as string, root: integer(row[4]) }));
  const sequences = objects.some(object => object.type === 'table' && object.name === 'sqlite_sequence') ? await read(driver, 'SELECT rowid,' + exact('name') + ',' + exact('seq') + ' FROM main.sqlite_sequence ORDER BY rowid LIMIT 10001', [], 10001, control) : []; if (sequences.length > 10000) throw Error('SQLite自增序列目录超过10000项预算');
  const indexRows = await read(driver, 'SELECT name,origin,"unique",partial FROM pragma_index_list(?,\'main\') ORDER BY name COLLATE BINARY LIMIT 4097', [table], 4097, control); if (indexRows.length > 4096) throw Error('SQLite表索引目录超过4096项预算');
  const indexes: RenameFacts['indexes'] = [];
  for (const row of indexRows) { if (typeof row[0] !== 'string' || typeof row[1] !== 'string') throw Error('SQLite表索引事实无效'); const root = roots.find(object => object.type === 'index' && object.name === row[0]); indexes.push({ name: row[0], origin: row[1], unique: integer(row[2]), partial: integer(row[3]), root: root?.root ?? '0', columns: await read(driver, 'SELECT seqno,cid,name,"desc",coll,"key" FROM pragma_index_xinfo(?,\'main\') ORDER BY seqno LIMIT 1025', [row[0]], 1025, control) }); if (indexes.at(-1)!.columns.length > 1024) throw Error('SQLite索引列目录超过1024项预算'); }
  const facts: RenameFacts = { schemaVersion, catalogue, objects, roots, columns, strict: integer(flags[0][2]) === '1', withoutRowid: integer(flags[0][1]) === '1', foreignKeys, foreign: await foreignCheck(driver, control), sequences, indexes };
  if (Buffer.byteLength(JSON.stringify({ columns, tableSql: catalogue.schemaSql, relatedObjects: objects, roots, sequences, indexes, foreignKeys })) > limits.ddlBytes) throw Error('SQLite完整表重命名和依赖目录超过2MiB预算'); return facts;
}
/** 只读事务始终显式ROLLBACK；准确close和exit由Runtime原资源账本统一确认。 */
async function snapshotRead<T>(driver: SqliteDriverSession, control: SqliteTableBrowseControl, action: () => Promise<T>): Promise<T> {
  let value!: T, failure: unknown, failed = false;
  try { control.check(); await driver.execute('BEGIN'); control.check(); value = await action(); } catch (reason) { failed = true; failure = reason; }
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); } catch (reason) { control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite表重命名只读检查及收尾均失败') : reason; failed = true; }
  else if (!driver.isClosed && driver.transaction !== false) { const reason = Error('SQLite表重命名原读事务状态未知'); control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason]) : reason; failed = true; }
  if (failed) throw failure; control.check(); return value;
}

export async function inspectSqliteTableRename(driver: SqliteDriverSession, profile: SqliteConnectionProfile, table: string, control: SqliteTableBrowseControl): Promise<SqliteTableRenameSnapshot> {
  if (!driver.readOnly || !driver.identity) throw Error('SQLite表重命名检查必须独立只读且具备原文件身份');
  const snapshot: SqliteTableRenameSnapshot = { target: { connectionId: profile.id, database: 'main', table }, profile: structuredClone(profile), identity: driver.identity, version: driver.version, facts: undefined! };
  await snapshotRead(driver, control, async () => { await assertFile(snapshot, control); snapshot.facts = await readFacts(driver, table, control); await assertFile(snapshot, control); }); return snapshot;
}

/** 原数据可在预览之后合法变化；仅目录/依赖必须与快照完全相同，FK数据以写锁内前后检查为准。 */
function sameFacts(left: RenameFacts, right: RenameFacts): boolean {
  return left.schemaVersion === right.schemaVersion && equal(left.catalogue, right.catalogue) && equal(left.objects, right.objects) && equal(left.columns, right.columns) && left.strict === right.strict && left.withoutRowid === right.withoutRowid && equal(left.foreignKeys, right.foreignKeys) && equal(left.roots, right.roots) && equal(left.indexes, right.indexes);
}
/** 名称只作为受控标识符；已有表/视图/索引同名冲突在只读预览明确拒绝。 */
function compile(snapshot: SqliteTableRenameSnapshot, newName: string): Compiled {
  const compiled = buildSqliteTableRenamePlan(snapshot.target, newName);
  if (snapshot.facts.objects.some(object => ['table', 'view', 'index'].includes(object.type) && fold(object.name) === fold(newName) && !(object.type === 'table' && object.name === snapshot.target.table))) throw Error('SQLite重命名目标名称已被表、视图或索引占用');
  return compiled;
}
/** 后验保留原rootpage、全部xinfo、索引明细及自增水位；SQL依赖正文完全交原生ALTER改写。 */
function verifyRenamed(before: RenameFacts, after: RenameFacts, oldName: string, newName: string): void {
  if (!equal(before.columns, after.columns) || before.strict !== after.strict || before.withoutRowid !== after.withoutRowid) throw Error('SQLite表重命名后原字段或表选项发生变化');
  const expectedForeign = before.foreignKeys.map(row => row.map((value, index) => (index === 0 && value === oldName || index === 3 && typeof value === 'string' && fold(value) === fold(oldName)) ? newName : value));
  const sortedRows = (rows: readonly SqliteValue[][]) => rows.map(row => JSON.stringify(row)).sort();
  if (!equal(sortedRows(expectedForeign), sortedRows(after.foreignKeys))) throw Error('SQLite表重命名后外键目标定义未按原生语义更新');
  const expectedSequences = before.sequences.map(row => row.map((value, index) => index === 1 && value === oldName ? newName : value));
  if (!equal(expectedSequences, after.sequences)) throw Error('SQLite表重命名后原自增水位变化');
  // 自动索引名由SQLite生成，按唯一rootpage和完整index_xinfo对应，不推测sqlite_autoindex文本。
  const automatic = new Set(before.indexes.filter(index => index.origin !== 'c').map(index => index.name));
  const nextAutomatic = new Set(after.indexes.filter(index => index.origin !== 'c').map(index => index.name));
  const roots = (facts: RenameFacts, prior: boolean) => facts.roots.filter(object => !(object.type === 'index' && (prior ? automatic : nextAutomatic).has(object.name))).map(object => ({ ...object, name: prior && object.type === 'table' && object.name === oldName ? newName : object.name, table: prior && object.table === oldName ? newName : object.table })).map(object => JSON.stringify(object)).sort();
  if (!equal(roots(before, true), roots(after, false))) throw Error('SQLite表重命名后出现非计划对象增删或rootpage变化');
  const indexes = (facts: RenameFacts) => facts.indexes.map(index => ({ ...index, name: index.origin === 'c' ? index.name : null })).map(index => JSON.stringify(index)).sort();
  if (!equal(indexes(before), indexes(after))) throw Error('SQLite表重命名后原索引定义或存储发生变化');
  const expectedViolations = before.foreign.rows.map(value => { const row = JSON.parse(value) as SqliteValue[]; if (row[0] === oldName) row[0] = newName; if (typeof row[2] === 'string' && fold(row[2]) === fold(oldName)) row[2] = newName; return JSON.stringify(row); }).sort();
  if (before.foreign.unavailable ? after.foreign.unavailable || after.foreign.rows.length !== 0 : after.foreign.unavailable || !equal(expectedViolations, after.foreign.rows)) throw new RenameForeignKeyFailure('SQLite表重命名后外键违规集合变化或检查未完成');
}
export interface SqliteTableRenameCatalogue extends SqliteTableRenameSnapshot { id: string; navigationIdentity: string; expires: number; bytes: number; }
export interface SqliteTableRenameClaim { id: string; catalogue: SqliteTableRenameCatalogue; compiled: Compiled; newName: string; expires: number; bytes: number; confirmed: boolean; }
const committedRenameFacts = new WeakMap<SqliteTableRenameClaim, RenameFacts>();
interface RenameLineage { connectionId: string; file: string; table: string; root: string; signature: string; navigationIdentity: string; }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** 仅会话内比较真实文件和物理连接属性，公开身份不能反推路径、rootpage或SQL。 */
function lineageFile(snapshot: SqliteTableRenameSnapshot): string { return digest([snapshot.identity, snapshot.profile.id, snapshot.profile.sqlite.filePath, snapshot.profile.sqlite.readOnly, snapshot.profile.sqlite.busyTimeoutMs, snapshot.version]); }
/** 行值和sequence增长不属于结构身份；schemaVersion及完整依赖目录变化必须切断推断。 */
function lineageSignature(facts: RenameFacts): string { return digest([facts.schemaVersion, facts.objects, facts.roots, facts.foreignKeys]); }
function lineageRoot(facts: RenameFacts, table: string): string { const value = facts.roots.find(object => object.type === 'table' && object.name === table)?.root; if (!value || !/^[1-9][0-9]*$/.test(value)) throw Error('SQLite表重命名缺少准确原表rootpage'); return value; }

/** TTL仅阻新领取；在途RO pin继续计预算，显式release能命中已从领取Map过期的准确对象。 */
export class SqliteTableRenames {
  private readonly catalogues = new Map<string, SqliteTableRenameCatalogue>(); private readonly previews = new Map<string, SqliteTableRenameClaim>();
  private readonly lineages = new Map<string, RenameLineage>();
  private readonly pins = new Map<SqliteTableRenameCatalogue, number>(); private readonly revoked = new WeakSet<SqliteTableRenameCatalogue>(); private catalogueBytes = 0; private previewBytes = 0;
  private dropPreview(id: string): void { const value = this.previews.get(id); if (value) { this.previewBytes -= value.bytes; this.previews.delete(id); } }
  private dropCatalogue(id: string, revoke: boolean): void {
    const value = this.catalogues.get(id);
    if (revoke) { if (value) this.revoked.add(value); for (const pin of this.pins.keys()) if (pin.id === id) this.revoked.add(pin); for (const preview of this.previews.values()) if (preview.catalogue.id === id) this.dropPreview(preview.id); }
    if (value) { if (!this.pins.has(value)) this.catalogueBytes -= value.bytes; this.catalogues.delete(id); }
  }
  private prune(): void { for (const value of this.previews.values()) if (value.expires <= Date.now()) this.dropPreview(value.id); for (const value of this.catalogues.values()) if (value.expires <= Date.now()) this.dropCatalogue(value.id, false); }
  private count(): number { let count = this.catalogues.size; for (const pin of this.pins.keys()) if (this.catalogues.get(pin.id) !== pin) count++; return count; }
  /** 只承认上次已确认提交的完整后目录；rootpage复用或外部DDL绝不沿用旧导航身份。 */
  private navigationIdentity(snapshot: SqliteTableRenameSnapshot): string {
    const file = lineageFile(snapshot), root = lineageRoot(snapshot.facts, snapshot.target.table), key = file + ':' + root, signature = lineageSignature(snapshot.facts);
    for (const [entry, value] of this.lineages) if (value.file === file && value.signature !== signature) this.lineages.delete(entry);
    const known = this.lineages.get(key);
    if (known && known.table === snapshot.target.table) return known.navigationIdentity;
    if (known) this.lineages.delete(key);
    return digest(randomUUID());
  }
  /** ACK且完整后验才保留链；固定上限满时淘汰最旧证据，绝不因内存整理改写已提交事实。 */
  private remember(claim: SqliteTableRenameClaim): void {
    const facts = committedRenameFacts.get(claim); if (!facts) return; this.prune();
    const file = lineageFile(claim.catalogue), root = lineageRoot(facts, claim.newName), key = file + ':' + root, before = lineageSignature(claim.catalogue.facts), after = lineageSignature(facts);
    // 同一已知事务推进所有准确匹配before的证据，交错改两张表不会互相抹掉身份；未知结构分支绝不继承。
    for (const [entry, value] of this.lineages) if (value.file === file) {
      if (value.signature !== before) this.lineages.delete(entry);
      else this.lineages.set(entry, { ...value, signature: after, ...(value.root === root ? { table: claim.newName } : {}) });
    }
    this.lineages.delete(key);
    while (this.lineages.size >= limits.lineages) this.lineages.delete(this.lineages.keys().next().value!);
    this.lineages.set(key, { connectionId: claim.catalogue.target.connectionId, file, table: claim.newName, root, signature: after, navigationIdentity: claim.catalogue.navigationIdentity });
  }
  /** 公共目录只复制真实展示字段，私有依赖及文件身份不传到Renderer。 */
  publish(snapshot: SqliteTableRenameSnapshot): SqliteTableRenameInspectOutput {
    this.prune(); const bytes = Buffer.byteLength(JSON.stringify(snapshot)); if (this.count() >= limits.catalogues || this.catalogueBytes + bytes > limits.catalogueBytes) throw Error('SQLite表重命名目录能力预算已满');
    const value: SqliteTableRenameCatalogue = { ...snapshot, id: randomUUID(), navigationIdentity: this.navigationIdentity(snapshot), expires: Date.now() + limits.catalogueLifetimeMs, bytes };
    const output = sqliteTableRenameInspectionSchema.parse({ catalogueId: value.id, navigationIdentity: value.navigationIdentity, target: { ...value.target }, columns: structuredClone(value.facts.columns), tableSql: value.facts.catalogue.schemaSql, relatedObjects: structuredClone(value.facts.objects), strict: value.facts.strict, withoutRowid: value.facts.withoutRowid, readOnly: value.profile.sqlite.readOnly, expiresAt: new Date(value.expires).toISOString() });
    this.catalogues.set(value.id, value); this.catalogueBytes += bytes; return output;
  }
  /** TTL仅控制新领取；不把过期自动当作对原任务的取消授权。 */
  catalogue(id: string): SqliteTableRenameCatalogue { this.prune(); const value = this.catalogues.get(id); if (!value) throw Error(stale); return value; }
  /** 在途只读对象继续占用原数量/字节预算，最后一个原任务settle才归还。 */
  pin(value: SqliteTableRenameCatalogue): { check(): void; release(): void } {
    if (this.revoked.has(value)) throw Error(stale); this.pins.set(value, (this.pins.get(value) ?? 0) + 1); let released = false;
    return { check: () => { if (released || this.revoked.has(value)) throw Error(stale); }, release: () => { if (released) return; released = true; const count = this.pins.get(value)!; if (count > 1) this.pins.set(value, count - 1); else { this.pins.delete(value); if (this.catalogues.get(value.id) !== value) this.catalogueBytes -= value.bytes; } } };
  }
  /** 编译计划不执行用户表达式；预览与父目录各有独立期限。 */
  preview(catalogue: SqliteTableRenameCatalogue, newName: string): SqliteTableRenamePreviewOutput {
    if (this.revoked.has(catalogue)) throw Error(stale); const compiled = compile(catalogue, newName); this.prune(); const bytes = Buffer.byteLength(JSON.stringify({ catalogue, compiled, newName })); if (this.previews.size >= limits.previews || this.previewBytes + bytes > limits.previewBytes) throw Error('SQLite表重命名预览能力预算已满');
    const value: SqliteTableRenameClaim = { id: randomUUID(), catalogue, compiled, newName, expires: Date.now() + limits.previewLifetimeMs, bytes, confirmed: false }; this.previews.set(value.id, value); this.previewBytes += bytes;
    return { previewId: value.id, catalogueId: catalogue.id, navigationIdentity: catalogue.navigationIdentity, target: { ...catalogue.target }, sql: [...compiled.sql], confirmation: 'main.' + catalogue.target.table, newName, expiresAt: new Date(value.expires).toISOString() };
  }
  /** 确认错误也消费准确编号，防止同一次明确操作被自动重放。 */
  claim(input: SqliteTableRenameApplyInput): SqliteTableRenameClaim { this.prune(); const value = this.previews.get(input.previewId); if (!value) throw Error(stale); this.dropPreview(value.id); return { ...value, confirmed: input.confirmation === 'main.' + value.catalogue.target.table }; }
  release(input: SqliteTableRenameReleaseInput): void { if (input.previewId) this.dropPreview(input.previewId); if (input.catalogueId) this.dropCatalogue(input.catalogueId, true); }
  releaseConnection(id: string): void { for (const value of new Set([...this.catalogues.values(), ...this.pins.keys()])) if (value.target.connectionId === id) this.dropCatalogue(value.id, true); for (const value of this.previews.values()) if (value.catalogue.target.connectionId === id) this.dropPreview(value.id); for (const [key, value] of this.lineages) if (value.connectionId === id) this.lineages.delete(key); }
  settle(claim: SqliteTableRenameClaim, outcome: SqliteTableRenameOutcome['outcome']): void {
    if (outcome === 'committed') this.remember(claim);
    else if (outcome === 'unknown') { const file = lineageFile(claim.catalogue); for (const [key, value] of this.lineages) if (value.file === file) this.lineages.delete(key); }
    committedRenameFacts.delete(claim);
    if (outcome === 'committed' || outcome === 'unknown') this.dropCatalogue(claim.catalogue.id, true);
  }
}

/** 每次预览重新取独立RO快照，原目录变化不能仍签发旧计划。 */
export async function verifySqliteTableRename(driver: SqliteDriverSession, snapshot: SqliteTableRenameSnapshot, control: SqliteTableBrowseControl): Promise<void> {
  if (!driver.readOnly || !equal(driver.identity, snapshot.identity) || driver.version !== snapshot.version) throw Error(stale);
  await snapshotRead(driver, control, async () => { await assertFile(snapshot, control); if (!sameFacts(snapshot.facts, await readFacts(driver, snapshot.target.table, control))) throw Error(stale); await assertFile(snapshot, control); });
}
/** 写操作尚未发送时也给准确结构化事实，不借错误回包猜测已执行DDL。 */
export function sqliteTableRenameNotSent(claim: SqliteTableRenameClaim, input: SqliteTableRenameApplyRequest): SqliteTableRenameOutcome {
  const fact: SqliteTableRenameFact = { operationId: input.operationId, target: { ...claim.catalogue.target }, phase: 'not-sent', requestedStatements: 1, completedStatements: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false }; let warning = false;
  try { const result: unknown = input.recordTableRenameFact(fact); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite表重命名事实必须同步持久化'); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...fact.target }, navigationIdentity: claim.catalogue.navigationIdentity, newName: claim.newName, outcome: 'not-sent', fact, definitionVerified: false, message: text.notSent, ...(warning ? { cleanupWarning: true } : {}) };
}

/** 全部原DDL在一个独立写事务内，FK前后及完整目录后验成功才发送唯一COMMIT。 */
export async function applySqliteTableRename(driver: SqliteDriverSession, claim: SqliteTableRenameClaim, input: SqliteTableRenameApplyRequest, control: SqliteTableRenameControl): Promise<SqliteTableRenameOutcome> {
  const snapshot = claim.catalogue; let begun = false, sent = false, committed = false, rollback = false, verified = false, verifiedAfter: RenameFacts | undefined, completedStatements = 0, warning = false, rollbackMessage: string = text.rolledBack;
  const fact = (phase: SqliteTableRenameFact['phase']): SqliteTableRenameFact => ({ operationId: input.operationId, target: { ...snapshot.target }, phase, requestedStatements: 1, completedStatements: completedStatements as 0 | 1, commitMayHaveBeenSent: sent || phase === 'commit-pending', commitAcknowledged: committed, rollbackAcknowledged: rollback });
  const record = (phase: SqliteTableRenameFact['phase']) => { const result: unknown = input.recordTableRenameFact(fact(phase)); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite表重命名事实必须同步持久化'); };
  try {
    control.check(); if (!claim.confirmed || driver.readOnly || !equal(driver.identity, snapshot.identity) || driver.version !== snapshot.version) throw Error(stale); await assertFile(snapshot, control); record('not-sent');
    try { await driver.execute('BEGIN IMMEDIATE'); begun = true; } catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults[0]?.transaction === true) begun = true; throw reason; }
    control.check(); await assertFile(snapshot, control); const before = await readFacts(driver, snapshot.target.table, control); if (!sameFacts(snapshot.facts, before) || !equal(compile(snapshot, claim.newName), claim.compiled)) throw Error(stale); record('writing');
    for (const sql of claim.compiled.sql) {
      control.check();
      try { const result = await driver.execute(sql, { parameters: [] }); if (result.statements.length !== 1 || result.statements[0].truncated) throw Error('SQLite原表重命名DDL缺少完整回执'); completedStatements++; }
      catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated) completedStatements++; throw reason; }
      record('writing'); control.check();
    }
    const after = await readFacts(driver, claim.newName, control); verifyRenamed(before, after, snapshot.target.table, claim.newName); verifiedAfter = after;
    verified = true; await assertFile(snapshot, control); record('commit-pending'); control.check(); control.beginCommit(); sent = true; await driver.execute('COMMIT'); committed = true; try { record('committed'); } catch { warning = true; }
  } catch (reason) {
    if (sent && reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated && reason.completedResults[0].transaction === false) { committed = true; warning = true; try { record('committed'); } catch { /* 原COMMIT ACK不能被末回包/通知失败抹去。 */ } }
    else if (reason instanceof RenameForeignKeyFailure) rollbackMessage = 'SQLite表重命名修改未通过外键保护，原整批事务已确认回滚。';
    else if (reason instanceof SqliteDriverError && /^SQLITE_NATIVE_\d+$/.test(reason.code) && Number(reason.code.slice('SQLITE_NATIVE_'.length)) % 256 === 19) rollbackMessage = 'SQLite原生表重命名约束拒绝本批修改，原整批事务已确认回滚。';
  }
  if (!committed) { control.beginCleanup(); if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); rollback = true; } catch (reason) { control.cleanupFailed(reason); } else if (begun) control.cleanupFailed(Error('SQLite表重命名原写事务回滚未确认')); }
  const outcome: SqliteTableRenameOutcome['outcome'] = committed ? 'committed' : rollback ? 'rolled-back' : begun || sent ? 'unknown' : 'not-sent'; if (!committed) try { record(outcome); } catch { warning = true; }
  if (committed && verified && verifiedAfter) committedRenameFacts.set(claim, verifiedAfter);
  return { operationId: input.operationId, target: { ...snapshot.target }, navigationIdentity: snapshot.navigationIdentity, newName: claim.newName, outcome, fact: fact(outcome), definitionVerified: committed && verified, message: committed ? text.committed : outcome === 'unknown' ? text.unknown : outcome === 'rolled-back' ? rollbackMessage : text.notSent, ...(warning ? { cleanupWarning: true } : {}) };
}
