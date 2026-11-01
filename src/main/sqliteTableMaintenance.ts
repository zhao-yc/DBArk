import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { SqliteConnectionProfile } from '../shared/contracts';
import { SqliteDriverError, type SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteExportTextFunction, type SqliteFileIdentity, type SqliteValue } from '../engine/sqlite/protocol';
import { readSqliteTableCatalogue, quoteSqliteIdentifier, type SqliteTableCatalogue, type SqliteTableBrowseControl } from './sqliteTableBrowse';
import { sqliteTableHasAutoincrement } from './sqliteSchemaExport';
import { buildSqliteTableMaintenancePlan, sqliteTableMaintenanceInspectionSchema, sqliteTableMaintenanceLimits as limits, sqliteTableMaintenanceMessages as text, type SqliteTableMaintenanceInspectInput, type SqliteTableMaintenanceInspectOutput, type SqliteTableMaintenancePreviewInput, type SqliteTableMaintenancePreviewOutput, type SqliteTableMaintenanceApplyInput, type SqliteTableMaintenanceReleaseInput, type SqliteTableMaintenanceFact, type SqliteTableMaintenanceOutcome } from '../shared/sqliteTableMaintenance';

export interface SqliteTableMaintenanceInspectRequest extends SqliteTableMaintenanceInspectInput { assertCurrent(): void; }
export interface SqliteTableMaintenancePreviewRequest extends SqliteTableMaintenancePreviewInput { assertCurrent(): void; }
export interface SqliteTableMaintenanceApplyRequest extends SqliteTableMaintenanceApplyInput { operationId: string; recordMaintenanceFact(fact: SqliteTableMaintenanceFact): void; assertCurrent(): void; }
export interface SqliteTableMaintenanceControl extends SqliteTableBrowseControl { beginCommit(): void; }
type Compiled = ReturnType<typeof buildSqliteTableMaintenancePlan>;

interface ForeignCheck { unavailable: boolean; rows: string[]; }
class MaintenanceForeignKeyFailure extends Error {}
type MaintenanceColumnFact = SqliteTableMaintenanceInspectOutput['columns'][number];
interface GlobalFacts { schemaVersion: string; objects: SqliteTableMaintenanceInspectOutput['relatedObjects']; roots: { type: string; name: string; table: string; root: string }[]; foreignKeys: SqliteValue[][]; }
interface MaintenanceFacts extends GlobalFacts { catalogue: SqliteTableCatalogue; columns: MaintenanceColumnFact[]; strict: boolean; withoutRowid: boolean; autoIncrement: boolean; indexes: { name: string; origin: string; unique: string; partial: string; columns: SqliteValue[][] }[]; }
export interface SqliteTableMaintenanceSnapshot { target: { connectionId: string; database: 'main'; table: string }; profile: SqliteConnectionProfile; identity: SqliteFileIdentity; version: string; rowCount: string; facts: MaintenanceFacts; }
const stale = 'SQLite表维护目录、文件或预览已失效，请重新检查并明确预览';
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function integer(value: SqliteValue | undefined): string { if (!value || typeof value !== 'object' || value.type !== 'integer') throw Error('SQLite表维护整数事实无效'); return value.value; }
function exact(column: string): string { return `CASE WHEN typeof(${column})='text' THEN ${sqliteExportTextFunction}(${column},CAST(${column} AS BLOB)) ELSE ${column} END`; }

/** 目录不足预算必须失败；从不以截断结果宣称无冲突或外键检查完整。 */
async function read(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maximum: number, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<SqliteValue[][]> {
  control.check(); const rows: SqliteValue[][] = [];
  const result = await driver.execute(sql, { parameters, maxRows: maximum, maxBytes: 16 * 1024 * 1024, onBatch: batch => { control.check(); rows.push(...batch.rows); } });
  control.check(); if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== rows.length) throw Error('SQLite表维护目录或外键检查超过完整读取预算'); return rows;
}
/** native路径协议与worker一致；只比较真实dev/ino，不把合法其它数据修改误判成路径替换。 */
async function assertFile(snapshot: Pick<SqliteTableMaintenanceSnapshot, 'profile' | 'identity'>, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<void> {
  control.check(); try {
    const path = await realpath(snapshot.profile.sqlite.filePath!); control.check(); const value = await stat(snapshot.profile.sqlite.filePath!, { bigint: true }); control.check();
    if (path !== snapshot.identity.path || !value.isFile() || String(value.dev) !== snapshot.identity.device || String(value.ino) !== snapshot.identity.inode) throw Error(stale);
  } catch { control.check(); throw Error('SQLite表维护目标实际文件身份变化或无法确认，拒绝提交'); }
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
/** 全main真实定义、rootpage和外键目录；DROP之后仍可读取，不尝试解析失效视图或伪称FK完整检查。 */
async function readGlobal(driver: SqliteDriverSession, control: SqliteTableBrowseControl): Promise<GlobalFacts> {
  const schemaVersion = integer((await read(driver, 'PRAGMA main.schema_version', [], 1, control))[0]?.[0]);
  const rows = await read(driver, 'SELECT ' + ['type', 'name', 'tbl_name', 'sql'].map(exact).join(',') + ',rootpage' + " FROM main.sqlite_schema WHERE type IN ('table','index','view','trigger') ORDER BY type,name COLLATE BINARY LIMIT " + (limits.relatedObjects + 1), [], limits.relatedObjects + 1, control);
  if (rows.length > limits.relatedObjects) throw Error('SQLite表维护完整依赖目录超过4096项预算');
  const objects = rows.map(row => ({ type: row[0] as 'table' | 'index' | 'view' | 'trigger', name: row[1] as string, table: row[2] as string, sql: row[3] as string | null }));
  const foreignKeys = await read(driver, 'SELECT m.name,f.id,f.seq,f."table",f."from",f."to",f.on_update,f.on_delete,f."match" FROM main.sqlite_schema AS m JOIN pragma_foreign_key_list(m.name,\'main\') AS f WHERE m.type=\'table\' ORDER BY m.name COLLATE BINARY,f.id,f.seq LIMIT 10001', [], 10001, control); if (foreignKeys.length > 10000) throw Error('SQLite全库外键定义超过10000项预算');
  if (integer((await read(driver, 'PRAGMA main.foreign_keys', [], 1, control))[0]?.[0]) !== '1') throw Error('SQLite表维护要求原生外键保护保持启用');
  const roots = rows.map(row => ({ type: row[0] as string, name: row[1] as string, table: row[2] as string, root: integer(row[4]) }));
  return { schemaVersion, objects, roots, foreignKeys };
}
/** 普通main表目录与完整xinfo/索引；AUTOINCREMENT只复用原严谨词法器，不正则猜关键字。 */
async function readFacts(driver: SqliteDriverSession, table: string, control: SqliteTableBrowseControl): Promise<MaintenanceFacts> {
  if (/^sqlite_/i.test(table)) throw Error('SQLite系统表不能清空或删除');
  const catalogue = await readSqliteTableCatalogue(driver, table, control), flags = await read(driver, "SELECT type,wr,strict FROM pragma_table_list WHERE schema='main' AND name=? COLLATE BINARY LIMIT 2", [table], 2, control);
  if (catalogue.kind !== 'table' || flags.length !== 1 || flags[0][0] !== 'table') throw Error('SQLite表维护仅支持main普通表，视图、虚拟表和影子表不允许写入');
  const global = await readGlobal(driver, control);
  if (global.objects.find(row => row.type === 'table' && row.name === table)?.sql !== catalogue.schemaSql) throw Error('SQLite目标表原定义无法无损确认');
  const columns: MaintenanceColumnFact[] = catalogue.xinfo.map(row => ({ cid: Number(integer(row[0])), name: row[1] as string, declaredType: row[2] as string, notNull: integer(row[3]) === '1', defaultSql: row[4] as string | null, primaryKey: Number(integer(row[5])), hidden: Number(integer(row[6])) }));
  const indexRows = await read(driver, 'SELECT name,origin,"unique",partial FROM pragma_index_list(?,\'main\') ORDER BY name COLLATE BINARY LIMIT 4097', [table], 4097, control); if (indexRows.length > 4096) throw Error('SQLite表索引目录超过4096项预算');
  const indexes: MaintenanceFacts['indexes'] = [];
  for (const row of indexRows) { if (typeof row[0] !== 'string' || typeof row[1] !== 'string') throw Error('SQLite表索引事实无效'); indexes.push({ name: row[0], origin: row[1], unique: integer(row[2]), partial: integer(row[3]), columns: await read(driver, 'SELECT seqno,cid,name,"desc",coll,"key" FROM pragma_index_xinfo(?,\'main\') ORDER BY seqno LIMIT 1025', [row[0]], 1025, control) }); if (indexes.at(-1)!.columns.length > 1024) throw Error('SQLite索引列目录超过1024项预算'); }
  const facts: MaintenanceFacts = { ...global, catalogue, columns, strict: integer(flags[0][2]) === '1', withoutRowid: integer(flags[0][1]) === '1', autoIncrement: sqliteTableHasAutoincrement(catalogue.schemaSql, table), indexes };
  if (Buffer.byteLength(JSON.stringify(facts)) > limits.ddlBytes) throw Error('SQLite完整表维护和依赖目录超过2MiB预算'); return facts;
}
/** COUNT仅在准确独立事务快照中返回64位整数文本，不加载任何行值。 */
async function countRows(driver: SqliteDriverSession, table: string, control: SqliteTableBrowseControl): Promise<string> {
  const rows = await read(driver, 'SELECT COUNT(*) FROM main.' + quoteSqliteIdentifier(table), [], 1, control), count = integer(rows[0]?.[0]);
  if (rows.length !== 1 || rows[0].length !== 1 || !/^(?:0|[1-9][0-9]*)$/.test(count) || BigInt(count) > 9223372036854775807n) throw Error('SQLite准确COUNT结果无效'); return count;
}
/** 只读事务始终显式ROLLBACK；准确close和exit由Runtime原资源账本统一确认。 */
async function snapshotRead<T>(driver: SqliteDriverSession, control: SqliteTableBrowseControl, action: () => Promise<T>): Promise<T> {
  let value!: T, failure: unknown, failed = false;
  try { control.check(); await driver.execute('BEGIN'); control.check(); value = await action(); } catch (reason) { failed = true; failure = reason; }
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); } catch (reason) { control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite表维护只读检查及收尾均失败') : reason; failed = true; }
  else if (!driver.isClosed && driver.transaction !== false) { const reason = Error('SQLite表维护原读事务状态未知'); control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason]) : reason; failed = true; }
  if (failed) throw failure; control.check(); return value;
}

export async function inspectSqliteTableMaintenance(driver: SqliteDriverSession, profile: SqliteConnectionProfile, table: string, control: SqliteTableBrowseControl): Promise<SqliteTableMaintenanceSnapshot> {
  if (!driver.readOnly || !driver.identity) throw Error('SQLite表维护检查必须独立只读且具备原文件身份');
  const snapshot: SqliteTableMaintenanceSnapshot = { target: { connectionId: profile.id, database: 'main', table }, profile: structuredClone(profile), identity: driver.identity, version: driver.version, rowCount: '', facts: undefined! };
  await snapshotRead(driver, control, async () => { await assertFile(snapshot, control); snapshot.facts = await readFacts(driver, table, control); snapshot.rowCount = await countRows(driver, table, control); await assertFile(snapshot, control); }); return snapshot;
}

/** 原数据可在预览之后合法变化；仅目录/依赖必须与快照完全相同，FK数据以写锁内前后检查为准。 */
function sameFacts(left: MaintenanceFacts, right: MaintenanceFacts): boolean { return equal(left, right); }
/** 两种原生操作均只有受控语句；重置仅允许真实AUTOINCREMENT准确表。 */
function compile(snapshot: SqliteTableMaintenanceSnapshot, action: 'clear' | 'drop', resetSequence: boolean): Compiled {
  if (resetSequence && (!snapshot.facts.autoIncrement || !snapshot.facts.objects.some(object => object.type === 'table' && object.name === 'sqlite_sequence'))) throw Error('当前准确表不是可重置序列的AUTOINCREMENT普通表');
  return buildSqliteTableMaintenancePlan(snapshot.target, action, resetSequence);
}
/** 允许清空减少原既有违规；重复的WITHOUT ROWID违规也按多重集合核对，不能吞新增违规。 */
function noNewForeignViolations(before: ForeignCheck, after: ForeignCheck): boolean {
  if (after.unavailable) return false; if (before.unavailable) return after.rows.length === 0;
  const counts = new Map<string, number>(); for (const row of before.rows) counts.set(row, (counts.get(row) ?? 0) + 1);
  for (const row of after.rows) { const count = counts.get(row) ?? 0; if (count === 0) return false; counts.set(row, count - 1); } return true;
}
/** DROP只删除准确表及其原附属索引/触发器；其它定义必须原样保留，不代替用户级联删视图或FK定义。 */
function verifyDropped(before: MaintenanceFacts, after: GlobalFacts, table: string): void {
  const retained = before.objects.filter(object => !(object.name === table && object.type === 'table') && !(['index', 'trigger'].includes(object.type) && object.table === table));
  if (!equal(retained, after.objects) || !equal(before.foreignKeys.filter(row => row[0] !== table), after.foreignKeys)) throw Error('SQLite删除表后目录增删或非目标定义发生非计划变化');
  // AUTO_VACUUM可合法移动其它表rootpage；只在发送DROP前严格核原root，不能把原生页移动误判为额外删表。
}
export interface SqliteTableMaintenanceCatalogue extends SqliteTableMaintenanceSnapshot { id: string; expires: number; bytes: number; }
export interface SqliteTableMaintenanceClaim { id: string; catalogue: SqliteTableMaintenanceCatalogue; compiled: Compiled; action: 'clear' | 'drop'; resetSequence: boolean; rowCount: string; expires: number; bytes: number; confirmed: boolean; }

/** TTL仅阻新领取；在途RO pin继续计预算，显式release能命中已从领取Map过期的准确对象。 */
export class SqliteTableMaintenance {
  private readonly catalogues = new Map<string, SqliteTableMaintenanceCatalogue>(); private readonly previews = new Map<string, SqliteTableMaintenanceClaim>();
  private readonly pins = new Map<SqliteTableMaintenanceCatalogue, number>(); private readonly revoked = new WeakSet<SqliteTableMaintenanceCatalogue>(); private catalogueBytes = 0; private previewBytes = 0;
  private dropPreview(id: string): void { const value = this.previews.get(id); if (value) { this.previewBytes -= value.bytes; this.previews.delete(id); } }
  private dropCatalogue(id: string, revoke: boolean): void {
    const value = this.catalogues.get(id);
    if (revoke) { if (value) this.revoked.add(value); for (const pin of this.pins.keys()) if (pin.id === id) this.revoked.add(pin); for (const preview of this.previews.values()) if (preview.catalogue.id === id) this.dropPreview(preview.id); }
    if (value) { if (!this.pins.has(value)) this.catalogueBytes -= value.bytes; this.catalogues.delete(id); }
  }
  private prune(): void { for (const value of this.previews.values()) if (value.expires <= Date.now()) this.dropPreview(value.id); for (const value of this.catalogues.values()) if (value.expires <= Date.now()) this.dropCatalogue(value.id, false); }
  private count(): number { let count = this.catalogues.size; for (const pin of this.pins.keys()) if (this.catalogues.get(pin.id) !== pin) count++; return count; }
  /** 公共目录只复制真实展示字段，原文件身份及内部索引指纹不传到Renderer。 */
  publish(snapshot: SqliteTableMaintenanceSnapshot): SqliteTableMaintenanceInspectOutput {
    this.prune(); const bytes = Buffer.byteLength(JSON.stringify(snapshot)); if (this.count() >= limits.catalogues || this.catalogueBytes + bytes > limits.catalogueBytes) throw Error('SQLite表维护目录能力预算已满');
    const value: SqliteTableMaintenanceCatalogue = { ...snapshot, id: randomUUID(), expires: Date.now() + limits.catalogueLifetimeMs, bytes };
    const output = sqliteTableMaintenanceInspectionSchema.parse({ catalogueId: value.id, target: { ...value.target }, columns: structuredClone(value.facts.columns), rowCount: value.rowCount, autoIncrement: value.facts.autoIncrement, foreignKeys: value.facts.foreignKeys.map(row => ({ table: row[0], id: Number(integer(row[1])), sequence: Number(integer(row[2])), parent: row[3], from: row[4], to: row[5], onUpdate: row[6], onDelete: row[7], match: row[8] })), tableSql: value.facts.catalogue.schemaSql, relatedObjects: structuredClone(value.facts.objects), strict: value.facts.strict, withoutRowid: value.facts.withoutRowid, readOnly: value.profile.sqlite.readOnly, expiresAt: new Date(value.expires).toISOString() });
    this.catalogues.set(value.id, value); this.catalogueBytes += bytes; return output;
  }
  /** TTL仅控制新领取；不把过期自动当作对原任务的取消授权。 */
  catalogue(id: string): SqliteTableMaintenanceCatalogue { this.prune(); const value = this.catalogues.get(id); if (!value) throw Error(stale); return value; }
  /** 在途只读对象继续占用原数量/字节预算，最后一个原任务settle才归还。 */
  pin(value: SqliteTableMaintenanceCatalogue): { check(): void; release(): void } {
    if (this.revoked.has(value)) throw Error(stale); this.pins.set(value, (this.pins.get(value) ?? 0) + 1); let released = false;
    return { check: () => { if (released || this.revoked.has(value)) throw Error(stale); }, release: () => { if (released) return; released = true; const count = this.pins.get(value)!; if (count > 1) this.pins.set(value, count - 1); else { this.pins.delete(value); if (this.catalogues.get(value.id) !== value) this.catalogueBytes -= value.bytes; } } };
  }
  /** 编译计划不执行用户表达式；预览与父目录各有独立期限。 */
  preview(catalogue: SqliteTableMaintenanceCatalogue, action: 'clear' | 'drop', resetSequence: boolean, rowCount: string): SqliteTableMaintenancePreviewOutput {
    if (this.revoked.has(catalogue)) throw Error(stale); const compiled = compile(catalogue, action, resetSequence); this.prune(); const bytes = Buffer.byteLength(JSON.stringify({ catalogue, compiled, action, resetSequence, rowCount })); if (this.previews.size >= limits.previews || this.previewBytes + bytes > limits.previewBytes) throw Error('SQLite表维护预览能力预算已满');
    const value: SqliteTableMaintenanceClaim = { id: randomUUID(), catalogue, compiled, action, resetSequence, rowCount, expires: Date.now() + limits.previewLifetimeMs, bytes, confirmed: false }; this.previews.set(value.id, value); this.previewBytes += bytes;
    return { previewId: value.id, catalogueId: catalogue.id, target: { ...catalogue.target }, sql: [...compiled.sql], confirmation: 'main.' + catalogue.target.table, action, resetSequence, rowCount, requiredAcknowledgements: [...compiled.requiredAcknowledgements], expiresAt: new Date(value.expires).toISOString() };
  }
  /** 确认错误也消费准确编号，防止同一次明确操作被自动重放。 */
  claim(input: SqliteTableMaintenanceApplyInput): SqliteTableMaintenanceClaim { this.prune(); const value = this.previews.get(input.previewId); if (!value) throw Error(stale); this.dropPreview(value.id); return { ...value, confirmed: input.confirmation === 'main.' + value.catalogue.target.table && input.acknowledgements.length === value.compiled.requiredAcknowledgements.length && value.compiled.requiredAcknowledgements.every(item => input.acknowledgements.includes(item)) }; }
  release(input: SqliteTableMaintenanceReleaseInput): void { if (input.previewId) this.dropPreview(input.previewId); if (input.catalogueId) this.dropCatalogue(input.catalogueId, true); }
  releaseConnection(id: string): void { for (const value of new Set([...this.catalogues.values(), ...this.pins.keys()])) if (value.target.connectionId === id) this.dropCatalogue(value.id, true); for (const value of this.previews.values()) if (value.catalogue.target.connectionId === id) this.dropPreview(value.id); }
  settle(claim: SqliteTableMaintenanceClaim, outcome: SqliteTableMaintenanceOutcome['outcome']): void { if (outcome === 'committed' || outcome === 'unknown') this.dropCatalogue(claim.catalogue.id, true); }
}

/** 每次预览重新取独立RO快照，原目录变化不能仍签发旧计划。 */
export async function verifySqliteTableMaintenance(driver: SqliteDriverSession, snapshot: SqliteTableMaintenanceSnapshot, control: SqliteTableBrowseControl): Promise<string> {
  if (!driver.readOnly || !equal(driver.identity, snapshot.identity) || driver.version !== snapshot.version) throw Error(stale);
  return snapshotRead(driver, control, async () => { await assertFile(snapshot, control); if (!sameFacts(snapshot.facts, await readFacts(driver, snapshot.target.table, control))) throw Error(stale); const count = await countRows(driver, snapshot.target.table, control); await assertFile(snapshot, control); return count; });
}
/** 写操作尚未发送时也给准确结构化事实，不借错误回包猜测已执行DDL。 */
export function sqliteTableMaintenanceNotSent(claim: SqliteTableMaintenanceClaim, input: SqliteTableMaintenanceApplyRequest): SqliteTableMaintenanceOutcome {
  const fact: SqliteTableMaintenanceFact = { operationId: input.operationId, target: { ...claim.catalogue.target }, action: claim.action, phase: 'not-sent', requestedStatements: claim.compiled.sql.length, completedStatements: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false }; let warning = false;
  try { const result: unknown = input.recordMaintenanceFact(fact); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite表维护事实必须同步持久化'); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...fact.target }, action: claim.action, resetSequence: claim.resetSequence, outcome: 'not-sent', fact, definitionVerified: false, message: text.notSent, ...(warning ? { cleanupWarning: true } : {}) };
}

/** 独立写事务确认全部当前行；clear保护结果为空，drop只核准确目录，不冒称遗留引用仍有效。 */
export async function applySqliteTableMaintenance(driver: SqliteDriverSession, claim: SqliteTableMaintenanceClaim, input: SqliteTableMaintenanceApplyRequest, control: SqliteTableMaintenanceControl): Promise<SqliteTableMaintenanceOutcome> {
  const snapshot = claim.catalogue; let begun = false, sent = false, committed = false, rollback = false, verified = false, completedStatements = 0, actualBeforeRows: string | undefined, warning = false, rollbackMessage: string = text.rolledBack;
  const fact = (phase: SqliteTableMaintenanceFact['phase']): SqliteTableMaintenanceFact => ({ operationId: input.operationId, target: { ...snapshot.target }, action: claim.action, phase, ...(actualBeforeRows !== undefined ? { actualBeforeRows } : {}), requestedStatements: claim.compiled.sql.length, completedStatements, commitMayHaveBeenSent: sent || phase === 'commit-pending', commitAcknowledged: committed, rollbackAcknowledged: rollback });
  const record = (phase: SqliteTableMaintenanceFact['phase']) => { const result: unknown = input.recordMaintenanceFact(fact(phase)); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite表维护事实必须同步持久化'); };
  try {
    control.check(); if (!claim.confirmed || driver.readOnly || !equal(driver.identity, snapshot.identity) || driver.version !== snapshot.version) throw Error(stale); await assertFile(snapshot, control); record('not-sent');
    try { await driver.execute('BEGIN IMMEDIATE'); begun = true; } catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults[0]?.transaction === true) begun = true; throw reason; }
    control.check(); await assertFile(snapshot, control); const before = await readFacts(driver, snapshot.target.table, control); if (!sameFacts(snapshot.facts, before) || !equal(compile(snapshot, claim.action, claim.resetSequence), claim.compiled)) throw Error(stale); actualBeforeRows = await countRows(driver, snapshot.target.table, control); const beforeForeign = claim.action === 'clear' ? await foreignCheck(driver, control) : undefined; record('writing');
    for (const [index, sql] of claim.compiled.sql.entries()) {
      control.check();
      try { const result = await driver.execute(sql, { parameters: claim.action === 'clear' && claim.resetSequence && index === 1 ? [snapshot.target.table] : [] }); if (result.statements.length !== 1 || result.statements[0].truncated) throw Error('SQLite原表维护DDL缺少完整回执'); completedStatements++; }
      catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated) completedStatements++; throw reason; }
      record('writing'); control.check();
    }
    if (claim.action === 'clear') {
      const after = await readFacts(driver, snapshot.target.table, control); if (!sameFacts(before, after) || await countRows(driver, snapshot.target.table, control) !== '0') throw Error('SQLite清空后目标仍有记录或目录改变，原批次必须回滚');
      if (claim.resetSequence) {
        const sequence = await read(driver, 'SELECT COUNT(*) FROM main.sqlite_sequence WHERE name=?', [snapshot.target.table], 1, control);
        if (sequence.length !== 1 || sequence[0].length !== 1 || integer(sequence[0][0]) !== '0') throw Error('SQLite清空后准确自增序列仍存在');
      }
      if (!noNewForeignViolations(beforeForeign!, await foreignCheck(driver, control))) throw new MaintenanceForeignKeyFailure('SQLite清空后出现新增外键违规或完整检查不可确认');
    } else verifyDropped(before, await readGlobal(driver, control), snapshot.target.table);
    verified = true; await assertFile(snapshot, control); record('commit-pending'); control.check(); control.beginCommit(); sent = true; await driver.execute('COMMIT'); committed = true; try { record('committed'); } catch { warning = true; }
  } catch (reason) {
    if (sent && reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated && reason.completedResults[0].transaction === false) { committed = true; warning = true; try { record('committed'); } catch { /* 原COMMIT ACK不能被末回包/通知失败抹去。 */ } }
    else if (reason instanceof MaintenanceForeignKeyFailure) rollbackMessage = 'SQLite表维护修改未通过外键保护，原整批事务已确认回滚。';
    else if (reason instanceof SqliteDriverError && /^SQLITE_NATIVE_\d+$/.test(reason.code) && Number(reason.code.slice('SQLITE_NATIVE_'.length)) % 256 === 19) rollbackMessage = 'SQLite原生表维护约束拒绝本批修改，原整批事务已确认回滚。';
  }
  if (!committed) { control.beginCleanup(); if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); rollback = true; } catch (reason) { control.cleanupFailed(reason); } else if (begun) control.cleanupFailed(Error('SQLite表维护原写事务回滚未确认')); }
  const outcome: SqliteTableMaintenanceOutcome['outcome'] = committed ? 'committed' : rollback ? 'rolled-back' : begun || sent ? 'unknown' : 'not-sent'; if (!committed) try { record(outcome); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...snapshot.target }, action: claim.action, resetSequence: claim.resetSequence, outcome, fact: fact(outcome), definitionVerified: committed && verified, message: committed ? text.committed : outcome === 'unknown' ? text.unknown : outcome === 'rolled-back' ? rollbackMessage : text.notSent, ...(warning ? { cleanupWarning: true } : {}) };
}
