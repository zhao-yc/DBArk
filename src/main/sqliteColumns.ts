import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { SqliteConnectionProfile } from '../shared/contracts';
import { SqliteDriverError, type SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteExportTextFunction, type SqliteFileIdentity, type SqliteValue } from '../engine/sqlite/protocol';
import { readSqliteTableCatalogue, type SqliteTableCatalogue, type SqliteTableBrowseControl } from './sqliteTableBrowse';
import { buildSqliteColumnsPlan, sqliteColumnsDefaultSql, sqliteColumnsInspectionSchema, sqliteColumnsLimits as limits, sqliteColumnsMessages as text, type SqliteColumnsInspectInput, type SqliteColumnsInspectOutput, type SqliteColumnsPreviewInput, type SqliteColumnsPreviewOutput, type SqliteColumnsApplyInput, type SqliteColumnsReleaseInput, type SqliteColumnsFact, type SqliteColumnsOutcome, type SqliteColumnsAction } from '../shared/sqliteColumns';

export interface SqliteColumnsInspectRequest extends SqliteColumnsInspectInput { assertCurrent(): void; }
export interface SqliteColumnsPreviewRequest extends SqliteColumnsPreviewInput { assertCurrent(): void; }
export interface SqliteColumnsApplyRequest extends SqliteColumnsApplyInput { operationId: string; recordColumnsFact(fact: SqliteColumnsFact): void; assertCurrent(): void; }
export interface SqliteColumnsControl extends SqliteTableBrowseControl { beginCommit(): void; }
type Compiled = ReturnType<typeof buildSqliteColumnsPlan>;

interface ForeignCheck { unavailable: boolean; rows: string[]; }
class ColumnForeignKeyFailure extends Error {}
type ColumnFact = SqliteColumnsInspectOutput['columns'][number];
interface ColumnFacts { schemaVersion: string; catalogue: SqliteTableCatalogue; objects: SqliteColumnsInspectOutput['relatedObjects']; columns: ColumnFact[]; strict: boolean; withoutRowid: boolean; foreignKeys: SqliteValue[][]; foreign: ForeignCheck; }
export interface SqliteColumnsSnapshot { target: { connectionId: string; database: 'main'; table: string }; profile: SqliteConnectionProfile; identity: SqliteFileIdentity; version: string; facts: ColumnFacts; }
const stale = 'SQLite字段目录、文件或预览已失效，请重新检查并明确预览';
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
function integer(value: SqliteValue | undefined): string { if (!value || typeof value !== 'object' || value.type !== 'integer') throw Error('SQLite字段整数事实无效'); return value.value; }
function exact(column: string): string { return `CASE WHEN typeof(${column})='text' THEN ${sqliteExportTextFunction}(${column},CAST(${column} AS BLOB)) ELSE ${column} END`; }
/** 能力只取原opened.version；未知或旧版不会生成新语法，也不伪造driver版本。 */
export function sqliteColumnsCapabilities(version: string): { alterNullability: boolean } {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version); return { alterNullability: !!parts && (Number(parts[1]) > 3 || Number(parts[1]) === 3 && Number(parts[2]) >= 53) };
}

/** 目录不足预算必须失败；从不以截断结果宣称无冲突或外键检查完整。 */
async function read(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maximum: number, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<SqliteValue[][]> {
  control.check(); const rows: SqliteValue[][] = [];
  const result = await driver.execute(sql, { parameters, maxRows: maximum, maxBytes: 16 * 1024 * 1024, onBatch: batch => { control.check(); rows.push(...batch.rows); } });
  control.check(); if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== rows.length) throw Error('SQLite字段目录或外键检查超过完整读取预算'); return rows;
}
/** native路径协议与worker一致；只比较真实dev/ino，不把合法其它数据修改误判成路径替换。 */
async function assertFile(snapshot: Pick<SqliteColumnsSnapshot, 'profile' | 'identity'>, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<void> {
  control.check(); try {
    const path = await realpath(snapshot.profile.sqlite.filePath!); control.check(); const value = await stat(snapshot.profile.sqlite.filePath!, { bigint: true }); control.check();
    if (path !== snapshot.identity.path || !value.isFile() || String(value.dev) !== snapshot.identity.device || String(value.ino) !== snapshot.identity.inode) throw Error(stale);
  } catch { control.check(); throw Error('SQLite字段目标实际文件身份变化或无法确认，拒绝提交'); }
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
async function readFacts(driver: SqliteDriverSession, table: string, control: SqliteTableBrowseControl): Promise<ColumnFacts> {
  if (/^sqlite_/i.test(table)) throw Error('SQLite系统表不能管理字段');
  const schemaVersion = integer((await read(driver, 'PRAGMA main.schema_version', [], 1, control))[0]?.[0]), catalogue = await readSqliteTableCatalogue(driver, table, control);
  const flags = await read(driver, "SELECT type,wr,strict FROM pragma_table_list WHERE schema='main' AND name=? COLLATE BINARY LIMIT 2", [table], 2, control);
  if (catalogue.kind !== 'table' || flags.length !== 1 || flags[0][0] !== 'table') throw Error('SQLite字段管理仅支持main普通表，视图、虚拟表和影子表只读');
  const rows = await read(driver, 'SELECT ' + ['type', 'name', 'tbl_name', 'sql'].map(exact).join(',') + " FROM main.sqlite_schema WHERE type IN ('table','index','view','trigger') ORDER BY type,name COLLATE BINARY LIMIT " + (limits.relatedObjects + 1), [], limits.relatedObjects + 1, control);
  if (rows.length > limits.relatedObjects) throw Error('SQLite字段完整依赖目录超过4096项预算');
  const objects = rows.map(row => ({ type: row[0] as 'table' | 'index' | 'view' | 'trigger', name: row[1] as string, table: row[2] as string, sql: row[3] as string | null }));
  if (objects.find(row => row.type === 'table' && row.name === table)?.sql !== catalogue.schemaSql) throw Error('SQLite目标表原定义无法无损确认');
  const columns: ColumnFact[] = catalogue.xinfo.map(row => ({ cid: Number(integer(row[0])), name: row[1] as string, declaredType: row[2] as string, notNull: integer(row[3]) === '1', defaultSql: row[4] as string | null, primaryKey: Number(integer(row[5])), hidden: Number(integer(row[6])) }));
  const foreignKeys = await read(driver, 'SELECT m.name,f.id,f.seq,f."table",f."from",f."to",f.on_update,f.on_delete,f."match" FROM main.sqlite_schema AS m JOIN pragma_foreign_key_list(m.name,\'main\') AS f WHERE m.type=\'table\' ORDER BY m.name COLLATE BINARY,f.id,f.seq LIMIT 10001', [], 10001, control); if (foreignKeys.length > 10000) throw Error('SQLite全库外键定义超过10000项预算');
  if (integer((await read(driver, 'PRAGMA main.foreign_keys', [], 1, control))[0]?.[0]) !== '1' || integer((await read(driver, 'PRAGMA main.legacy_alter_table', [], 1, control))[0]?.[0]) !== '0') throw Error('SQLite原生ALTER保护选项不满足要求');
  const facts: ColumnFacts = { schemaVersion, catalogue, objects, columns, strict: integer(flags[0][2]) === '1', withoutRowid: integer(flags[0][1]) === '1', foreignKeys, foreign: await foreignCheck(driver, control) };
  if (Buffer.byteLength(JSON.stringify({ columns, tableSql: catalogue.schemaSql, relatedObjects: objects })) > limits.ddlBytes) throw Error('SQLite完整字段和依赖目录超过2MiB预算'); return facts;
}
/** 只读事务始终显式ROLLBACK；准确close和exit由Runtime原资源账本统一确认。 */
async function snapshotRead<T>(driver: SqliteDriverSession, control: SqliteTableBrowseControl, action: () => Promise<T>): Promise<T> {
  let value!: T, failure: unknown, failed = false;
  try { control.check(); await driver.execute('BEGIN'); control.check(); value = await action(); } catch (reason) { failed = true; failure = reason; }
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); } catch (reason) { control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite字段只读检查及收尾均失败') : reason; failed = true; }
  else if (!driver.isClosed && driver.transaction !== false) { const reason = Error('SQLite字段原读事务状态未知'); control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason]) : reason; failed = true; }
  if (failed) throw failure; control.check(); return value;
}

export async function inspectSqliteColumns(driver: SqliteDriverSession, profile: SqliteConnectionProfile, table: string, control: SqliteTableBrowseControl): Promise<SqliteColumnsSnapshot> {
  if (!driver.readOnly || !driver.identity) throw Error('SQLite字段检查必须独立只读且具备原文件身份');
  const snapshot: SqliteColumnsSnapshot = { target: { connectionId: profile.id, database: 'main', table }, profile: structuredClone(profile), identity: driver.identity, version: driver.version, facts: undefined! };
  await snapshotRead(driver, control, async () => { await assertFile(snapshot, control); snapshot.facts = await readFacts(driver, table, control); await assertFile(snapshot, control); }); return snapshot;
}

/** 原数据可在预览之后合法变化；仅目录/依赖必须与快照完全相同，FK数据以写锁内前后检查为准。 */
function sameFacts(left: ColumnFacts, right: ColumnFacts): boolean {
  return left.schemaVersion === right.schemaVersion && equal(left.catalogue, right.catalogue) && equal(left.objects, right.objects) && equal(left.columns, right.columns) && left.strict === right.strict && left.withoutRowid === right.withoutRowid && equal(left.foreignKeys, right.foreignKeys);
}
/** 按动作顺序推导完整xinfo与全库FK改名，依赖能否DROP交原生执行，不靠正则修改定义。 */
function expectedFacts(snapshot: SqliteColumnsSnapshot, actions: readonly SqliteColumnsAction[]): { columns: ColumnFact[]; foreignKeys: SqliteValue[][] } {
  let columns = structuredClone(snapshot.facts.columns); const foreignKeys = structuredClone(snapshot.facts.foreignKeys);
  for (const action of actions) {
    if (action.kind === 'add') {
      if (columns.some(column => fold(column.name) === fold(action.column.name))) throw Error('SQLite新增字段名称已被占用');
      if (snapshot.facts.strict && !['INT', 'INTEGER', 'REAL', 'TEXT', 'BLOB', 'ANY'].includes(action.column.declaredType.toUpperCase())) throw Error('SQLite STRICT表不支持所选声明类型');
      columns.push({ cid: columns.length, name: action.column.name, declaredType: action.column.declaredType, notNull: !action.column.nullable, defaultSql: sqliteColumnsDefaultSql(action.column.default) ?? null, primaryKey: 0, hidden: 0 });
    } else {
      const column = columns.find(value => fold(value.name) === fold(action.name)); if (!column) throw Error('SQLite原字段不存在，请重新检查');
      if (action.kind === 'rename') {
        if (columns.some(value => value !== column && fold(value.name) === fold(action.newName))) throw Error('SQLite重命名目标字段已被占用');
        for (const row of foreignKeys) { if (row[0] === snapshot.target.table && typeof row[4] === 'string' && fold(row[4]) === fold(column.name)) row[4] = action.newName; if (typeof row[3] === 'string' && fold(row[3]) === fold(snapshot.target.table) && typeof row[5] === 'string' && fold(row[5]) === fold(column.name)) row[5] = action.newName; }
        column.name = action.newName;
      } else if (action.kind === 'drop') columns = columns.filter(value => value !== column);
      else { if (!sqliteColumnsCapabilities(snapshot.version).alterNullability) throw Error('当前实际SQLite版本不支持原生ALTER COLUMN修改空值约束'); column.notNull = !action.nullable; }
    }
    if (!columns.length || columns.length > limits.columns) throw Error('SQLite修改后的字段目录为空或超过1024项预算'); columns.forEach((column, cid) => { column.cid = cid; });
  }
  return { columns, foreignKeys };
}
/** 每个动作恰好一条受控ALTER，不能借类型/默认值/名称拼入另一语句。 */
function compile(snapshot: SqliteColumnsSnapshot, actions: readonly SqliteColumnsAction[]): Compiled {
  expectedFacts(snapshot, actions); return buildSqliteColumnsPlan(snapshot.target, actions);
}
export interface SqliteColumnsCatalogue extends SqliteColumnsSnapshot { id: string; expires: number; bytes: number; }
export interface SqliteColumnsClaim { id: string; catalogue: SqliteColumnsCatalogue; compiled: Compiled; actions: SqliteColumnsAction[]; expires: number; bytes: number; confirmed: boolean; }

/** TTL仅阻新领取；在途RO pin继续计预算，显式release能命中已从领取Map过期的准确对象。 */
export class SqliteColumns {
  private readonly catalogues = new Map<string, SqliteColumnsCatalogue>(); private readonly previews = new Map<string, SqliteColumnsClaim>();
  private readonly pins = new Map<SqliteColumnsCatalogue, number>(); private readonly revoked = new WeakSet<SqliteColumnsCatalogue>(); private catalogueBytes = 0; private previewBytes = 0;
  private dropPreview(id: string): void { const value = this.previews.get(id); if (value) { this.previewBytes -= value.bytes; this.previews.delete(id); } }
  private dropCatalogue(id: string, revoke: boolean): void {
    const value = this.catalogues.get(id);
    if (revoke) { if (value) this.revoked.add(value); for (const pin of this.pins.keys()) if (pin.id === id) this.revoked.add(pin); for (const preview of this.previews.values()) if (preview.catalogue.id === id) this.dropPreview(preview.id); }
    if (value) { if (!this.pins.has(value)) this.catalogueBytes -= value.bytes; this.catalogues.delete(id); }
  }
  private prune(): void { for (const value of this.previews.values()) if (value.expires <= Date.now()) this.dropPreview(value.id); for (const value of this.catalogues.values()) if (value.expires <= Date.now()) this.dropCatalogue(value.id, false); }
  private count(): number { let count = this.catalogues.size; for (const pin of this.pins.keys()) if (this.catalogues.get(pin.id) !== pin) count++; return count; }
  /** 公共目录只复制真实展示字段，私有依赖及文件身份不传到Renderer。 */
  publish(snapshot: SqliteColumnsSnapshot): SqliteColumnsInspectOutput {
    this.prune(); const bytes = Buffer.byteLength(JSON.stringify(snapshot)); if (this.count() >= limits.catalogues || this.catalogueBytes + bytes > limits.catalogueBytes) throw Error('SQLite字段目录能力预算已满');
    const value: SqliteColumnsCatalogue = { ...snapshot, id: randomUUID(), expires: Date.now() + limits.catalogueLifetimeMs, bytes };
    const output = sqliteColumnsInspectionSchema.parse({ catalogueId: value.id, target: { ...value.target }, columns: structuredClone(value.facts.columns), tableSql: value.facts.catalogue.schemaSql, relatedObjects: structuredClone(value.facts.objects), strict: value.facts.strict, withoutRowid: value.facts.withoutRowid, capabilities: sqliteColumnsCapabilities(value.version), readOnly: value.profile.sqlite.readOnly, expiresAt: new Date(value.expires).toISOString() });
    this.catalogues.set(value.id, value); this.catalogueBytes += bytes; return output;
  }
  /** TTL仅控制新领取；不把过期自动当作对原任务的取消授权。 */
  catalogue(id: string): SqliteColumnsCatalogue { this.prune(); const value = this.catalogues.get(id); if (!value) throw Error(stale); return value; }
  /** 在途只读对象继续占用原数量/字节预算，最后一个原任务settle才归还。 */
  pin(value: SqliteColumnsCatalogue): { check(): void; release(): void } {
    if (this.revoked.has(value)) throw Error(stale); this.pins.set(value, (this.pins.get(value) ?? 0) + 1); let released = false;
    return { check: () => { if (released || this.revoked.has(value)) throw Error(stale); }, release: () => { if (released) return; released = true; const count = this.pins.get(value)!; if (count > 1) this.pins.set(value, count - 1); else { this.pins.delete(value); if (this.catalogues.get(value.id) !== value) this.catalogueBytes -= value.bytes; } } };
  }
  /** 编译计划不执行用户表达式；预览与父目录各有独立期限。 */
  preview(catalogue: SqliteColumnsCatalogue, actions: SqliteColumnsAction[]): SqliteColumnsPreviewOutput {
    if (this.revoked.has(catalogue)) throw Error(stale); const compiled = compile(catalogue, actions); this.prune(); const bytes = Buffer.byteLength(JSON.stringify({ catalogue, compiled, actions })); if (this.previews.size >= limits.previews || this.previewBytes + bytes > limits.previewBytes) throw Error('SQLite字段预览能力预算已满');
    const value: SqliteColumnsClaim = { id: randomUUID(), catalogue, compiled, actions: structuredClone(actions), expires: Date.now() + limits.previewLifetimeMs, bytes, confirmed: false }; this.previews.set(value.id, value); this.previewBytes += bytes;
    return { previewId: value.id, catalogueId: catalogue.id, target: { ...catalogue.target }, sql: [...compiled.sql], confirmation: 'main.' + catalogue.target.table, added: actions.filter(action => action.kind === 'add').length, renamed: actions.filter(action => action.kind === 'rename').length, removed: actions.filter(action => action.kind === 'drop').length, nullabilityChanged: actions.filter(action => action.kind === 'nullable').length, expiresAt: new Date(value.expires).toISOString() };
  }
  /** 确认错误也消费准确编号，防止同一次明确操作被自动重放。 */
  claim(input: SqliteColumnsApplyInput): SqliteColumnsClaim { this.prune(); const value = this.previews.get(input.previewId); if (!value) throw Error(stale); this.dropPreview(value.id); return { ...value, confirmed: input.confirmation === 'main.' + value.catalogue.target.table }; }
  release(input: SqliteColumnsReleaseInput): void { if (input.previewId) this.dropPreview(input.previewId); if (input.catalogueId) this.dropCatalogue(input.catalogueId, true); }
  releaseConnection(id: string): void { for (const value of new Set([...this.catalogues.values(), ...this.pins.keys()])) if (value.target.connectionId === id) this.dropCatalogue(value.id, true); for (const value of this.previews.values()) if (value.catalogue.target.connectionId === id) this.dropPreview(value.id); }
  settle(claim: SqliteColumnsClaim, outcome: SqliteColumnsOutcome['outcome']): void { if (outcome === 'committed' || outcome === 'unknown') this.dropCatalogue(claim.catalogue.id, true); }
}

/** 每次预览重新取独立RO快照，原目录变化不能仍签发旧计划。 */
export async function verifySqliteColumns(driver: SqliteDriverSession, snapshot: SqliteColumnsSnapshot, control: SqliteTableBrowseControl): Promise<void> {
  if (!driver.readOnly || !equal(driver.identity, snapshot.identity) || driver.version !== snapshot.version) throw Error(stale);
  await snapshotRead(driver, control, async () => { await assertFile(snapshot, control); if (!sameFacts(snapshot.facts, await readFacts(driver, snapshot.target.table, control))) throw Error(stale); await assertFile(snapshot, control); });
}
/** 写操作尚未发送时也给准确结构化事实，不借错误回包猜测已执行DDL。 */
export function sqliteColumnsNotSent(claim: SqliteColumnsClaim, input: SqliteColumnsApplyRequest): SqliteColumnsOutcome {
  const fact: SqliteColumnsFact = { operationId: input.operationId, target: { ...claim.catalogue.target }, phase: 'not-sent', requestedStatements: claim.compiled.sql.length, completedStatements: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false }; let warning = false;
  try { const result: unknown = input.recordColumnsFact(fact); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite字段事实必须同步持久化'); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...fact.target }, outcome: 'not-sent', fact, definitionVerified: false, message: text.notSent, ...(warning ? { cleanupWarning: true } : {}) };
}

/** 全部原DDL在一个独立写事务内，FK前后及完整目录后验成功才发送唯一COMMIT。 */
export async function applySqliteColumns(driver: SqliteDriverSession, claim: SqliteColumnsClaim, input: SqliteColumnsApplyRequest, control: SqliteColumnsControl): Promise<SqliteColumnsOutcome> {
  const snapshot = claim.catalogue; let begun = false, sent = false, committed = false, rollback = false, verified = false, completedStatements = 0, warning = false, rollbackMessage: string = text.rolledBack;
  const fact = (phase: SqliteColumnsFact['phase']): SqliteColumnsFact => ({ operationId: input.operationId, target: { ...snapshot.target }, phase, requestedStatements: claim.compiled.sql.length, completedStatements, commitMayHaveBeenSent: sent || phase === 'commit-pending', commitAcknowledged: committed, rollbackAcknowledged: rollback });
  const record = (phase: SqliteColumnsFact['phase']) => { const result: unknown = input.recordColumnsFact(fact(phase)); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite字段事实必须同步持久化'); };
  try {
    control.check(); if (!claim.confirmed || driver.readOnly || !equal(driver.identity, snapshot.identity) || driver.version !== snapshot.version) throw Error(stale); await assertFile(snapshot, control); record('not-sent');
    try { await driver.execute('BEGIN IMMEDIATE'); begun = true; } catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults[0]?.transaction === true) begun = true; throw reason; }
    control.check(); await assertFile(snapshot, control); const before = await readFacts(driver, snapshot.target.table, control); if (!sameFacts(snapshot.facts, before) || !equal(compile(snapshot, claim.actions), claim.compiled)) throw Error(stale); record('writing');
    for (const sql of claim.compiled.sql) {
      control.check();
      try { const result = await driver.execute(sql, { parameters: [] }); if (result.statements.length !== 1 || result.statements[0].truncated) throw Error('SQLite原字段DDL缺少完整回执'); completedStatements++; }
      catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated) completedStatements++; throw reason; }
      record('writing'); control.check();
    }
    const after = await readFacts(driver, snapshot.target.table, control), expected = expectedFacts(snapshot, claim.actions);
    if (!equal(expected.columns, after.columns) || !equal(expected.foreignKeys, after.foreignKeys) || before.strict !== after.strict || before.withoutRowid !== after.withoutRowid) throw Error('SQLite字段批次后验xinfo、外键定义或原表选项不一致');
    const identities = (objects: ColumnFacts['objects']) => objects.map(({ type, name, table }) => JSON.stringify({ type, name, table })).sort();
    if (!equal(identities(before.objects), identities(after.objects))) throw Error('SQLite字段ALTER后出现非计划目录对象增删或改名');
    // Rename依赖正文交SQLite原生重写，不正则猜SQL；其它动作只能改变准确目标表原定义。
    if (!claim.actions.some(action => action.kind === 'rename')) for (const object of before.objects) if (!(object.type === 'table' && object.name === snapshot.target.table) && !equal(object, after.objects.find(value => value.type === object.type && value.name === object.name))) throw Error('SQLite非目标目录定义发生非计划变化');
    const invalidForeignKeys = before.foreign.unavailable ? after.foreign.unavailable || after.foreign.rows.length !== 0 : after.foreign.unavailable || !equal(before.foreign.rows, after.foreign.rows);
    if (invalidForeignKeys) throw new ColumnForeignKeyFailure('SQLite字段修改使外键失效、出现新增违规或原mismatch未修复');
    verified = true; await assertFile(snapshot, control); record('commit-pending'); control.check(); control.beginCommit(); sent = true; await driver.execute('COMMIT'); committed = true; try { record('committed'); } catch { warning = true; }
  } catch (reason) {
    if (sent && reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated && reason.completedResults[0].transaction === false) { committed = true; warning = true; try { record('committed'); } catch { /* 原COMMIT ACK不能被末回包/通知失败抹去。 */ } }
    else if (reason instanceof ColumnForeignKeyFailure) rollbackMessage = 'SQLite字段修改未通过外键保护，原整批事务已确认回滚。';
    else if (reason instanceof SqliteDriverError && /^SQLITE_NATIVE_\d+$/.test(reason.code) && Number(reason.code.slice('SQLITE_NATIVE_'.length)) % 256 === 19) rollbackMessage = 'SQLite原生字段约束拒绝本批修改，原整批事务已确认回滚。';
  }
  if (!committed) { control.beginCleanup(); if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); rollback = true; } catch (reason) { control.cleanupFailed(reason); } else if (begun) control.cleanupFailed(Error('SQLite字段原写事务回滚未确认')); }
  const outcome: SqliteColumnsOutcome['outcome'] = committed ? 'committed' : rollback ? 'rolled-back' : begun || sent ? 'unknown' : 'not-sent'; if (!committed) try { record(outcome); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...snapshot.target }, outcome, fact: fact(outcome), definitionVerified: committed && verified, message: committed ? text.committed : outcome === 'unknown' ? text.unknown : outcome === 'rolled-back' ? rollbackMessage : text.notSent, ...(warning ? { cleanupWarning: true } : {}) };
}
