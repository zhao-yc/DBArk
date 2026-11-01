import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { SqliteConnectionProfile } from '../shared/contracts';
import { SqliteDriverError, type SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteExportTextFunction, type SqliteFileIdentity, type SqliteValue } from '../engine/sqlite/protocol';
import { readSqliteTableCatalogue, type SqliteTableCatalogue, type SqliteTableBrowseControl } from './sqliteTableBrowse';
import { buildSqliteIndexesPlan, sqliteIndexesLimits as limits, sqliteIndexesMessages as text, type SqliteIndexesInspectInput, type SqliteIndexesInspectOutput, type SqliteIndexesPreviewInput, type SqliteIndexesPreviewOutput, type SqliteIndexesApplyInput, type SqliteIndexesReleaseInput, type SqliteIndexesFact, type SqliteIndexesOutcome, type SqliteIndexesAction } from '../shared/sqliteIndexes';

export interface SqliteIndexesInspectRequest extends SqliteIndexesInspectInput { assertCurrent(): void; }
export interface SqliteIndexesPreviewRequest extends SqliteIndexesPreviewInput { assertCurrent(): void; }
export interface SqliteIndexesApplyRequest extends SqliteIndexesApplyInput { operationId: string; recordIndexesFact(fact: SqliteIndexesFact): void; assertCurrent(): void; }
export interface SqliteIndexesControl extends SqliteTableBrowseControl { beginCommit(): void; }
type Compiled = ReturnType<typeof buildSqliteIndexesPlan>;

interface ForeignCheck { unavailable: boolean; rows: string[]; }
class IndexForeignKeyFailure extends Error {}
interface IndexFact { name: string; unique: boolean; origin: string; partial: boolean; sql: string | null; xinfo: SqliteValue[][]; }
interface IndexFacts { schemaVersion: string; catalogue: SqliteTableCatalogue; objects: SqliteValue[][]; indexes: IndexFact[]; collations: string[]; foreignKeys: SqliteValue[][]; foreign: ForeignCheck; }
export interface SqliteIndexesSnapshot { target: { connectionId: string; database: 'main'; table: string }; profile: SqliteConnectionProfile; identity: SqliteFileIdentity; version: string; facts: IndexFacts; }
const stale = 'SQLite索引目录、文件或预览已失效，请重新检查并明确预览';
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
function integer(value: SqliteValue | undefined): string { if (!value || typeof value !== 'object' || value.type !== 'integer') throw Error('SQLite索引整数事实无效'); return value.value; }
function exact(column: string): string { return `CASE WHEN typeof(${column})='text' THEN ${sqliteExportTextFunction}(${column},CAST(${column} AS BLOB)) ELSE ${column} END`; }

/** 目录不足预算必须失败；从不以截断结果宣称无冲突或外键检查完整。 */
async function read(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maximum: number, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<SqliteValue[][]> {
  control.check(); const rows: SqliteValue[][] = [];
  const result = await driver.execute(sql, { parameters, maxRows: maximum, maxBytes: 16 * 1024 * 1024, onBatch: batch => { control.check(); rows.push(...batch.rows); } });
  control.check(); if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== rows.length) throw Error('SQLite索引目录或外键检查超过完整读取预算'); return rows;
}
/** native路径协议与worker一致；只比较真实dev/ino，不把合法其它数据修改误判成路径替换。 */
async function assertFile(snapshot: Pick<SqliteIndexesSnapshot, 'profile' | 'identity'>, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<void> {
  control.check(); try {
    const path = await realpath(snapshot.profile.sqlite.filePath!); control.check(); const value = await stat(snapshot.profile.sqlite.filePath!, { bigint: true }); control.check();
    if (path !== snapshot.identity.path || !value.isFile() || String(value.dev) !== snapshot.identity.device || String(value.ino) !== snapshot.identity.inode) throw Error(stale);
  } catch { control.check(); throw Error('SQLite索引目标实际文件身份变化或无法确认，拒绝提交'); }
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
/** 同一独立事务完整读取目标和全库DDL依赖；不读取用户表整行，也不执行索引表达式。 */
async function readFacts(driver: SqliteDriverSession, table: string, control: SqliteTableBrowseControl): Promise<IndexFacts> {
  if (/^sqlite_/i.test(table)) throw Error('SQLite系统表不能管理索引');
  const schemaVersion = integer((await read(driver, 'PRAGMA main.schema_version', [], 1, control))[0]?.[0]), catalogue = await readSqliteTableCatalogue(driver, table, control);
  const flags = await read(driver, "SELECT type,wr FROM pragma_table_list WHERE schema='main' AND name=? COLLATE BINARY LIMIT 2", [table], 2, control);
  if (catalogue.kind !== 'table' || flags.length !== 1 || flags[0][0] !== 'table') throw Error('SQLite索引管理仅支持main普通表，视图、虚拟表和影子表只读');
  const objects = await read(driver, 'SELECT ' + ['type', 'name', 'tbl_name', 'sql'].map(exact).join(',') + ' FROM main.sqlite_schema ORDER BY type,name COLLATE BINARY LIMIT 10001', [], 10001, control);
  if (objects.length > 10000) throw Error('SQLite索引依赖目录超过10000项预算');
  const own = objects.filter(row => row[2] === table), tableRow = own.find(row => row[0] === 'table' && row[1] === table);
  if (!tableRow || tableRow[3] !== catalogue.schemaSql) throw Error('SQLite目标表原定义无法无损确认');
  if (Buffer.byteLength(JSON.stringify(own)) > 2 * 1024 * 1024) throw Error('SQLite目标定义及索引超过2MiB预算');
  const listed = await read(driver, 'SELECT seq,name,"unique",origin,partial FROM pragma_index_list(?,\'main\') ORDER BY name COLLATE BINARY LIMIT 129', [table], 129, control);
  if (listed.length > 128) throw Error('SQLite目标索引数量超过128项预算'); const indexes: IndexFact[] = [];
  for (const entry of listed) {
    const name = entry[1]; if (typeof name !== 'string' || typeof entry[3] !== 'string' || !['c', 'pk', 'u'].includes(entry[3])) throw Error('SQLite索引目录事实无效');
    const definition = own.find(row => row[0] === 'index' && row[1] === name), implicitPrimary = entry[3] === 'pk' && integer(flags[0][1]) === '1';
    if (!definition && !implicitPrimary || definition && definition[3] !== null && typeof definition[3] !== 'string') throw Error('SQLite索引原定义无法确认');
    const xinfo = await read(driver, 'SELECT seqno,cid,' + exact('name') + ',"desc",' + exact('coll') + ',"key" FROM pragma_index_xinfo(?,\'main\') ORDER BY seqno LIMIT ' + (limits.xinfo + 1), [name], limits.xinfo + 1, control);
    if (!xinfo.length || xinfo.length > limits.xinfo || xinfo.filter(row => integer(row[5]) === '1').length > limits.keys) throw Error('SQLite索引键目录超过预算');
    indexes.push({ name, unique: integer(entry[2]) === '1', origin: entry[3], partial: integer(entry[4]) === '1', sql: definition ? definition[3] as string | null : null, xinfo });
  }
  const collationRows = await read(driver, 'SELECT ' + exact('name') + ' FROM pragma_collation_list ORDER BY name COLLATE BINARY LIMIT ' + (limits.collations + 1), [], limits.collations + 1, control);
  if (collationRows.length > limits.collations || collationRows.some(row => typeof row[0] !== 'string')) throw Error('SQLite排序规则目录超过预算或无效');
  const foreignKeys = await read(driver, 'SELECT * FROM pragma_foreign_key_list(?,\'main\') ORDER BY id,seq LIMIT 1025', [table], 1025, control); if (foreignKeys.length > 1024) throw Error('SQLite目标外键目录超过预算');
  return { schemaVersion, catalogue, objects, indexes, collations: collationRows.map(row => row[0] as string), foreignKeys, foreign: await foreignCheck(driver, control) };
}
/** 只读事务始终显式ROLLBACK；准确close和exit由Runtime原资源账本统一确认。 */
async function snapshotRead<T>(driver: SqliteDriverSession, control: SqliteTableBrowseControl, action: () => Promise<T>): Promise<T> {
  let value!: T, failure: unknown, failed = false;
  try { control.check(); await driver.execute('BEGIN'); control.check(); value = await action(); } catch (reason) { failed = true; failure = reason; }
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); } catch (reason) { control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite索引只读检查及收尾均失败') : reason; failed = true; }
  else if (!driver.isClosed && driver.transaction !== false) { const reason = Error('SQLite索引原读事务状态未知'); control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason]) : reason; failed = true; }
  if (failed) throw failure; control.check(); return value;
}

export async function inspectSqliteIndexes(driver: SqliteDriverSession, profile: SqliteConnectionProfile, table: string, control: SqliteTableBrowseControl): Promise<SqliteIndexesSnapshot> {
  if (!driver.readOnly || !driver.identity) throw Error('SQLite索引检查必须独立只读且具备原文件身份');
  const snapshot: SqliteIndexesSnapshot = { target: { connectionId: profile.id, database: 'main', table }, profile: structuredClone(profile), identity: driver.identity, version: driver.version, facts: undefined! };
  await snapshotRead(driver, control, async () => { await assertFile(snapshot, control); snapshot.facts = await readFacts(driver, table, control); await assertFile(snapshot, control); }); return snapshot;
}

/** 原数据可在预览之后合法变化；仅目录/依赖必须与快照完全相同，FK数据以写锁内前后检查为准。 */
function sameFacts(left: IndexFacts, right: IndexFacts): boolean {
  return left.schemaVersion === right.schemaVersion && equal(left.catalogue, right.catalogue) && equal(left.objects, right.objects) && equal(left.indexes, right.indexes) && equal(left.collations, right.collations) && equal(left.foreignKeys, right.foreignKeys);
}
/** 名称与列必须来自真实白名单；表达式仅由shared词法隔离，原生语义失败留到apply整批回滚。 */
function compile(snapshot: SqliteIndexesSnapshot, actions: readonly SqliteIndexesAction[]): Compiled {
  const names = new Map(snapshot.facts.objects.filter(row => ['table', 'view', 'index'].includes(String(row[0]))).map(row => [fold(String(row[1])), row]));
  const indexes = new Map(snapshot.facts.indexes.map(index => [fold(index.name), index])), columns = new Set(snapshot.facts.catalogue.columns.map(column => fold(column.name))), collations = new Set(snapshot.facts.collations.map(fold));
  let count = snapshot.facts.indexes.length;
  for (const action of actions) {
    if (action.kind === 'drop') {
      const index = indexes.get(fold(action.name)); if (!index || index.origin !== 'c' || /^sqlite_/i.test(index.name) || index.sql === null) throw Error('SQLite索引不存在或属于PRIMARY KEY/UNIQUE约束，不能删除');
      names.delete(fold(action.name)); indexes.delete(fold(action.name)); count--;
    } else {
      if (names.has(fold(action.design.name))) throw Error('SQLite索引名称已被main表、视图或索引占用');
      for (const key of action.design.keys) if (key.kind === 'column' && !columns.has(fold(key.name)) || key.collation !== undefined && !collations.has(fold(key.collation))) throw Error('SQLite索引字段或排序规则已不存在');
      names.set(fold(action.design.name), ['index', action.design.name, snapshot.target.table, null]); count++;
    }
  }
  if (count > limits.indexes) throw Error('SQLite索引修改后的完整目录将超过128项预算');
  return buildSqliteIndexesPlan(snapshot.target, actions);
}
export interface SqliteIndexesCatalogue extends SqliteIndexesSnapshot { id: string; expires: number; bytes: number; }
export interface SqliteIndexesClaim { id: string; catalogue: SqliteIndexesCatalogue; compiled: Compiled; actions: SqliteIndexesAction[]; expires: number; bytes: number; confirmed: boolean; }

/** TTL仅阻新领取；在途RO pin继续计预算，显式release能命中已从领取Map过期的准确对象。 */
export class SqliteIndexes {
  private readonly catalogues = new Map<string, SqliteIndexesCatalogue>(); private readonly previews = new Map<string, SqliteIndexesClaim>();
  private readonly pins = new Map<SqliteIndexesCatalogue, number>(); private readonly revoked = new WeakSet<SqliteIndexesCatalogue>(); private catalogueBytes = 0; private previewBytes = 0;
  private dropPreview(id: string): void { const value = this.previews.get(id); if (value) { this.previewBytes -= value.bytes; this.previews.delete(id); } }
  private dropCatalogue(id: string, revoke: boolean): void {
    const value = this.catalogues.get(id);
    if (revoke) { if (value) this.revoked.add(value); for (const pin of this.pins.keys()) if (pin.id === id) this.revoked.add(pin); for (const preview of this.previews.values()) if (preview.catalogue.id === id) this.dropPreview(preview.id); }
    if (value) { if (!this.pins.has(value)) this.catalogueBytes -= value.bytes; this.catalogues.delete(id); }
  }
  private prune(): void { for (const value of this.previews.values()) if (value.expires <= Date.now()) this.dropPreview(value.id); for (const value of this.catalogues.values()) if (value.expires <= Date.now()) this.dropCatalogue(value.id, false); }
  private count(): number { let count = this.catalogues.size; for (const pin of this.pins.keys()) if (this.catalogues.get(pin.id) !== pin) count++; return count; }
  /** 公共目录只复制真实展示字段，私有依赖及文件身份不传到Renderer。 */
  publish(snapshot: SqliteIndexesSnapshot): SqliteIndexesInspectOutput {
    this.prune(); const bytes = Buffer.byteLength(JSON.stringify(snapshot)); if (this.count() >= limits.catalogues || this.catalogueBytes + bytes > limits.catalogueBytes) throw Error('SQLite索引目录能力预算已满');
    const value: SqliteIndexesCatalogue = { ...snapshot, id: randomUUID(), expires: Date.now() + limits.catalogueLifetimeMs, bytes }; this.catalogues.set(value.id, value); this.catalogueBytes += bytes;
    return { catalogueId: value.id, target: { ...value.target }, columns: value.facts.catalogue.columns.map(column => ({ name: column.name, declaredType: column.declaredType })), indexes: value.facts.indexes.map(index => ({ name: index.name, unique: index.unique, origin: index.origin as 'c' | 'u' | 'pk', partial: index.partial, sql: index.sql, keys: index.xinfo.map(row => ({ seqno: Number(integer(row[0])), cid: Number(integer(row[1])), name: row[2] as string | null, desc: integer(row[3]) === '1', collation: row[4] as string | null, key: integer(row[5]) === '1' })) })), collations: [...value.facts.collations], readOnly: value.profile.sqlite.readOnly, expiresAt: new Date(value.expires).toISOString() };
  }
  /** TTL仅控制新领取；不把过期自动当作对原任务的取消授权。 */
  catalogue(id: string): SqliteIndexesCatalogue { this.prune(); const value = this.catalogues.get(id); if (!value) throw Error(stale); return value; }
  /** 在途只读对象继续占用原数量/字节预算，最后一个原任务settle才归还。 */
  pin(value: SqliteIndexesCatalogue): { check(): void; release(): void } {
    if (this.revoked.has(value)) throw Error(stale); this.pins.set(value, (this.pins.get(value) ?? 0) + 1); let released = false;
    return { check: () => { if (released || this.revoked.has(value)) throw Error(stale); }, release: () => { if (released) return; released = true; const count = this.pins.get(value)!; if (count > 1) this.pins.set(value, count - 1); else { this.pins.delete(value); if (this.catalogues.get(value.id) !== value) this.catalogueBytes -= value.bytes; } } };
  }
  /** 编译计划不执行用户表达式；预览与父目录各有独立期限。 */
  preview(catalogue: SqliteIndexesCatalogue, actions: SqliteIndexesAction[]): SqliteIndexesPreviewOutput {
    if (this.revoked.has(catalogue)) throw Error(stale); const compiled = compile(catalogue, actions); this.prune(); const bytes = Buffer.byteLength(JSON.stringify({ catalogue, compiled, actions })); if (this.previews.size >= limits.previews || this.previewBytes + bytes > limits.previewBytes) throw Error('SQLite索引预览能力预算已满');
    const value: SqliteIndexesClaim = { id: randomUUID(), catalogue, compiled, actions: structuredClone(actions), expires: Date.now() + limits.previewLifetimeMs, bytes, confirmed: false }; this.previews.set(value.id, value); this.previewBytes += bytes;
    return { previewId: value.id, catalogueId: catalogue.id, target: { ...catalogue.target }, sql: [...compiled.sql], confirmation: 'main.' + catalogue.target.table, added: compiled.storedSql.length, removed: compiled.removed.length, expiresAt: new Date(value.expires).toISOString() };
  }
  /** 确认错误也消费准确编号，防止同一次明确操作被自动重放。 */
  claim(input: SqliteIndexesApplyInput): SqliteIndexesClaim { this.prune(); const value = this.previews.get(input.previewId); if (!value) throw Error(stale); this.dropPreview(value.id); return { ...value, confirmed: input.confirmation === 'main.' + value.catalogue.target.table }; }
  release(input: SqliteIndexesReleaseInput): void { if (input.previewId) this.dropPreview(input.previewId); if (input.catalogueId) this.dropCatalogue(input.catalogueId, true); }
  releaseConnection(id: string): void { for (const value of new Set([...this.catalogues.values(), ...this.pins.keys()])) if (value.target.connectionId === id) this.dropCatalogue(value.id, true); for (const value of this.previews.values()) if (value.catalogue.target.connectionId === id) this.dropPreview(value.id); }
  settle(claim: SqliteIndexesClaim, outcome: SqliteIndexesOutcome['outcome']): void { if (outcome === 'committed' || outcome === 'unknown') this.dropCatalogue(claim.catalogue.id, true); }
}

/** 每次预览重新取独立RO快照，原目录变化不能仍签发旧计划。 */
export async function verifySqliteIndexes(driver: SqliteDriverSession, snapshot: SqliteIndexesSnapshot, control: SqliteTableBrowseControl): Promise<void> {
  if (!driver.readOnly || !equal(driver.identity, snapshot.identity) || driver.version !== snapshot.version) throw Error(stale);
  await snapshotRead(driver, control, async () => { await assertFile(snapshot, control); if (!sameFacts(snapshot.facts, await readFacts(driver, snapshot.target.table, control))) throw Error(stale); await assertFile(snapshot, control); });
}
/** 写操作尚未发送时也给准确结构化事实，不借错误回包猜测已执行DDL。 */
export function sqliteIndexesNotSent(claim: SqliteIndexesClaim, input: SqliteIndexesApplyRequest): SqliteIndexesOutcome {
  const fact: SqliteIndexesFact = { operationId: input.operationId, target: { ...claim.catalogue.target }, phase: 'not-sent', requestedStatements: claim.compiled.sql.length, completedStatements: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false }; let warning = false;
  try { const result: unknown = input.recordIndexesFact(fact); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite索引事实必须同步持久化'); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...fact.target }, outcome: 'not-sent', fact, definitionVerified: false, message: text.notSent, ...(warning ? { cleanupWarning: true } : {}) };
}

/** 全部原DDL在一个独立写事务内，FK前后及完整目录后验成功才发送唯一COMMIT。 */
export async function applySqliteIndexes(driver: SqliteDriverSession, claim: SqliteIndexesClaim, input: SqliteIndexesApplyRequest, control: SqliteIndexesControl): Promise<SqliteIndexesOutcome> {
  const snapshot = claim.catalogue; let begun = false, sent = false, committed = false, rollback = false, verified = false, completedStatements = 0, warning = false, rollbackMessage: string = text.rolledBack;
  const fact = (phase: SqliteIndexesFact['phase']): SqliteIndexesFact => ({ operationId: input.operationId, target: { ...snapshot.target }, phase, requestedStatements: claim.compiled.sql.length, completedStatements, commitMayHaveBeenSent: sent || phase === 'commit-pending', commitAcknowledged: committed, rollbackAcknowledged: rollback });
  const record = (phase: SqliteIndexesFact['phase']) => { const result: unknown = input.recordIndexesFact(fact(phase)); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite索引事实必须同步持久化'); };
  try {
    control.check(); if (!claim.confirmed || driver.readOnly || !equal(driver.identity, snapshot.identity) || driver.version !== snapshot.version) throw Error(stale); await assertFile(snapshot, control); record('not-sent');
    try { await driver.execute('BEGIN IMMEDIATE'); begun = true; } catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults[0]?.transaction === true) begun = true; throw reason; }
    control.check(); await assertFile(snapshot, control); const before = await readFacts(driver, snapshot.target.table, control); if (!sameFacts(snapshot.facts, before) || !equal(compile(snapshot, claim.actions), claim.compiled)) throw Error(stale); record('writing');
    for (const sql of claim.compiled.sql) {
      control.check();
      try { const result = await driver.execute(sql, { parameters: [] }); if (result.statements.length !== 1 || result.statements[0].truncated) throw Error('SQLite原索引DDL缺少完整回执'); completedStatements++; }
      catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated) completedStatements++; throw reason; }
      record('writing'); control.check();
    }
    const after = await readFacts(driver, snapshot.target.table, control), removed = new Set(claim.compiled.removed.map(fold));
    const expected = before.objects.filter(row => !(row[0] === 'index' && removed.has(fold(String(row[1]))))); for (const index of claim.compiled.storedSql) expected.push(['index', index.name, snapshot.target.table, index.sql]);
    const normalize = (rows: SqliteValue[][]) => rows.map(row => JSON.stringify(row)).sort();
    if (!equal(normalize(expected), normalize(after.objects)) || !equal(before.catalogue, after.catalogue) || !equal(before.foreignKeys, after.foreignKeys) || !equal(before.collations, after.collations)) throw Error('SQLite索引批次后验定义或原表/依赖结构不一致');
    for (const index of before.indexes) if (!removed.has(fold(index.name)) && !equal(index, after.indexes.find(value => value.name === index.name))) throw Error('SQLite未修改索引的原键目录已变化');
    const invalidForeignKeys = before.foreign.unavailable ? after.foreign.unavailable || after.foreign.rows.length !== 0 : after.foreign.unavailable || !equal(before.foreign.rows, after.foreign.rows);
    if (invalidForeignKeys) throw new IndexForeignKeyFailure('SQLite索引修改使外键失效、出现新增违规或原mismatch未修复');
    verified = true; await assertFile(snapshot, control); record('commit-pending'); control.check(); control.beginCommit(); sent = true; await driver.execute('COMMIT'); committed = true; try { record('committed'); } catch { warning = true; }
  } catch (reason) {
    if (sent && reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated && reason.completedResults[0].transaction === false) { committed = true; warning = true; try { record('committed'); } catch { /* 原COMMIT ACK不能被末回包/通知失败抹去。 */ } }
    else if (reason instanceof IndexForeignKeyFailure) rollbackMessage = 'SQLite索引修改未通过外键保护，原整批事务已确认回滚。';
    else if (reason instanceof SqliteDriverError && /^SQLITE_NATIVE_\d+$/.test(reason.code) && Number(reason.code.slice('SQLITE_NATIVE_'.length)) % 256 === 19) rollbackMessage = 'SQLite原生索引约束拒绝本批修改，原整批事务已确认回滚。';
  }
  if (!committed) { control.beginCleanup(); if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); rollback = true; } catch (reason) { control.cleanupFailed(reason); } else if (begun) control.cleanupFailed(Error('SQLite索引原写事务回滚未确认')); }
  const outcome: SqliteIndexesOutcome['outcome'] = committed ? 'committed' : rollback ? 'rolled-back' : begun || sent ? 'unknown' : 'not-sent'; if (!committed) try { record(outcome); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...snapshot.target }, outcome, fact: fact(outcome), definitionVerified: committed && verified, message: committed ? text.committed : outcome === 'unknown' ? text.unknown : outcome === 'rolled-back' ? rollbackMessage : text.notSent, ...(warning ? { cleanupWarning: true } : {}) };
}
