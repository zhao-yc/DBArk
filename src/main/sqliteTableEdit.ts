import { randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { SqliteConnectionProfile } from '../shared/contracts';
import { sqliteTableEditApplySchema, sqliteTableEditPreviewSchema, sqliteTableEditReleaseSchema, sqliteTableEditLimits as limits, sqliteTableEditMessages as text, type SqliteEditColumn, type SqliteEditTarget, type SqliteEditValue, type SqliteOriginalValue, type SqliteTableChange, type SqliteTableEditApplyInput, type SqliteTableEditCounts, type SqliteTableEditOutcome, type SqliteTableEditPage, type SqliteTableEditPreview, type SqliteTableEditPreviewInput, type SqliteTableEditReleaseInput, type SqliteWriteFact } from '../shared/sqliteTableEdit';
import type { SqliteTablePageInput } from '../shared/sqliteTableBrowse';
import { sqliteExportTextFunction, type SqliteFileIdentity, type SqliteValue } from '../engine/sqlite/protocol';
import { SqliteDriverError, type SqliteDriverSession } from '../engine/sqlite/session';
import { quoteSqliteIdentifier as quote, readSqliteTableCatalogue, type SqliteEditReadPlan, type SqliteTableBrowseControl, type SqliteTableCatalogue } from './sqliteTableBrowse';
import { sqliteInsertLiteral } from './sqliteTableExport';

interface Locator { kind: 'rowid' | 'primary-key' | 'unique-key'; columns: string[]; collations: string[]; rowid?: string; }
interface Snapshot {
  id: string; target: SqliteEditTarget; profile: SqliteConnectionProfile; identity: SqliteFileIdentity;
  catalogue: SqliteTableCatalogue; columns: SqliteEditColumn[]; schemaVersion: string; locator: Locator;
  rows: SqliteValue[][]; locators: SqliteValue[][]; expires: number; bytes: number; active: number; revoked: boolean;
}
interface Statement { sql: string; parameters: SqliteValue[]; row?: number; kind: SqliteTableChange['kind']; }
export interface SqliteEditClaim { snapshot: Snapshot; statements: Statement[]; counts: SqliteTableEditCounts; confirmation: string; }
interface Preview extends SqliteEditClaim { id: string; expires: number; bytes: number; }
export interface SqliteEditApplyRequest extends SqliteTableEditApplyInput {
  operationId: string; assertCurrent(): void; recordWriteFact(fact: SqliteWriteFact): void;
}
export interface SqliteEditApplyControl extends SqliteTableBrowseControl { beginCommit(): void; }
const emptyCounts = (): SqliteTableEditCounts => ({ insert: 0, update: 0, delete: 0 });
/** 类型、负零和64位原文不经Number；二进制只比较规范字节包装。 */
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const integer = (value: SqliteValue | undefined): string => { if (!value || typeof value !== 'object' || value.type !== 'integer') throw Error('SQLite目录整数事实无效'); return value.value; };
/** 私有原TEXT校验同时适用于只读页和独立读写校验，不改变源列collation。 */
const projection = (column: string) => 'CASE WHEN typeof(' + column + ")='text' THEN " + sqliteExportTextFunction + '(' + column + ',CAST(' + column + ' AS BLOB)) ELSE ' + column + ' END';

/** driver保留的是打开时身份；事务边界还须重新核原配置路径，不能向已被替换/重定向的来源提交。 */
async function assertSnapshotFile(snapshot: Snapshot, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<void> {
  control.check();
  const unavailable = () => Error('SQLite数据库路径的真实文件身份已变化或无法确认，本次修改拒绝提交');
  let canonical: string;
  try { canonical = await realpath(snapshot.profile.sqlite.filePath!); } catch { control.check(); throw unavailable(); }
  control.check(); if (canonical !== snapshot.identity.path) throw unavailable();
  // stat仍跟随原配置路径，以便发现realpath返回后该路径被再次重定向；mtime/ctime不属于文件身份。
  let current: BigIntStats;
  try { current = await stat(snapshot.profile.sqlite.filePath!, { bigint: true }); } catch { control.check(); throw unavailable(); }
  control.check();
  if (!current.isFile() || current.dev.toString() !== snapshot.identity.device || current.ino.toString() !== snapshot.identity.inode) throw unavailable();
}

/** 每次只接完整有界单语句，取消检查不能影响随后必需的rollback。 */
async function read(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], control: Pick<SqliteTableBrowseControl, 'check'>, maximum = 1025): Promise<SqliteValue[][]> {
  control.check(); const rows: SqliteValue[][] = [];
  const result = await driver.execute(sql, { parameters, maxRows: maximum, maxBytes: 16 * 1024 * 1024, onBatch: batch => { control.check(); rows.push(...batch.rows); } });
  control.check(); if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== rows.length) throw Error('SQLite编辑目录或原行超过预算，未签发修改能力'); return rows;
}
/** 公共typed页值仅供显示，apply完全使用Main私有原行，绝不信任客户端旧值。 */
function original(value: SqliteValue): SqliteOriginalValue {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'string') return { kind: 'text', value };
  return value.type === 'binary' ? { kind: 'blob', value: Buffer.from(value.base64, 'base64').toString('hex') } : { kind: value.type, value: value.value };
}
/** 新输入严格沿共享typed合同，整数不丢精度，REAL负零不抹除。 */
function parameter(value: SqliteEditValue): SqliteValue {
  if (value.kind === 'null') return null;
  if (value.kind === 'text') return value.value;
  if (value.kind === 'blob') return { type: 'binary', base64: Buffer.from(value.value, 'hex').toString('base64') };
  if (value.kind === 'integer') return { type: 'integer', value: BigInt(value.value).toString() };
  const number = Number(value.value); return { type: 'real', value: Object.is(number, -0) ? '-0' : String(number) };
}
/** 精确locator使用原存储类型和可靠键的实际collation，不被列默认collation扩大匹配范围。 */
function locate(snapshot: Snapshot, row: number): { sql: string; parameters: SqliteValue[] } {
  const values = snapshot.locators[row]; if (!values) throw Error(text.stale);
  const names = snapshot.locator.rowid ? [snapshot.locator.rowid] : snapshot.locator.columns;
  const parameters: SqliteValue[] = [], sql = names.map((name, index) => {
    const value = values[index], type = value === null ? 'null' : typeof value === 'string' ? 'text' : value.type === 'binary' ? 'blob' : value.type;
    parameters.push(type, value); return '(typeof(' + quote(name) + ')=? AND ' + quote(name) + (snapshot.locator.collations[index] ? ' COLLATE ' + quote(snapshot.locator.collations[index]) : '') + ' IS ?)';
  }).join(' AND ');
  return { sql, parameters };
}
/** 显示SQL只由已验证计划和SQLite字面量组成，不作为apply执行输入。 */
function display(statement: Statement): string {
  let index = 0, result = '', quoted = '';
  for (let offset = 0; offset < statement.sql.length; offset++) {
    const character = statement.sql[offset];
    if (quoted) { result += character; if (character === quoted) { if (statement.sql[offset + 1] === quoted) result += statement.sql[++offset]; else quoted = ''; } }
    else if (character === '"' || character === "'") { quoted = character; result += character; }
    else result += character === '?' ? sqliteInsertLiteral(statement.parameters[index++]) : character;
  }
  if (index !== statement.parameters.length) throw Error('SQLite预览参数与语句不一致'); return result;
}

/** Main专有快照与一次性预览账本；释放不取消已经claim的写事务。 */
export class SqliteTableEdits {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly previews = new Map<string, Preview>();
  private bytes = 0;
  /** 只删除到期且未使用的能力，活动apply仍持有并计入原快照预算。 */
  private prune(): void {
    for (const preview of this.previews.values()) if (preview.expires <= Date.now()) this.dropPreview(preview.id);
    for (const snapshot of this.snapshots.values()) if (snapshot.expires <= Date.now()) this.invalidate(snapshot);
  }
  private dropPreview(id: string): void { const value = this.previews.get(id); if (value) { this.bytes -= value.bytes; this.previews.delete(id); } }
  /** 提交或未知时撤销所有兄弟预览；活动写持有原记录直到执行终态，不提前归还内存预算。 */
  private invalidate(snapshot: Snapshot): void {
    snapshot.revoked = true; for (const preview of this.previews.values()) if (preview.snapshot === snapshot) this.dropPreview(preview.id);
    if (!snapshot.active && this.snapshots.delete(snapshot.id)) { this.bytes -= snapshot.bytes; snapshot.rows = []; snapshot.locators = []; }
  }
  /** 连接显式关闭/配置切换撤销旧页，但不干预已经发送的SQL。 */
  releaseConnection(connectionId: string): void { for (const snapshot of this.snapshots.values()) if (snapshot.target.connectionId === connectionId) this.invalidate(snapshot); }
  release(input: SqliteTableEditReleaseInput): void { const value = sqliteTableEditReleaseSchema.parse(input); if (value.previewId) this.dropPreview(value.previewId); if (value.snapshotId) { const snapshot = this.snapshots.get(value.snapshotId); if (snapshot) this.invalidate(snapshot); } }
  /** 只读判断也沿真实目录；virtual/shadow/系统表不靠名称猜测成普通可写表。 */
  async preparePage(driver: SqliteDriverSession, input: SqliteTablePageInput, profile: SqliteConnectionProfile, catalogue: SqliteTableCatalogue, control: SqliteTableBrowseControl): Promise<SqliteEditReadPlan> {
    const readonly = (reason = text.readonly): SqliteEditReadPlan => ({ capture: () => ({ kind: 'readonly', reason }) });
    if (profile.sqlite.readOnly || catalogue.kind !== 'table' || /^sqlite_/i.test(input.table) || !driver.identity) return readonly();
    const facts = await read(driver, "SELECT type,wr FROM pragma_table_list WHERE schema='main' AND name=? COLLATE BINARY", [input.table], control, 2);
    if (facts.length !== 1 || facts[0][0] !== 'table') return readonly();
    const withoutRowid = integer(facts[0][1]) === '1';
    const columns: SqliteEditColumn[] = catalogue.xinfo.filter(row => integer(row[6]) !== '1').map(row => ({ name: row[1] as string, declaredType: row[2] as string, generated: ['2', '3'].includes(integer(row[6])), nullable: integer(row[3]) === '0', hasDefault: row[4] !== null }));
    let locator: Locator | undefined;
    const fieldNames = new Set(columns.map(column => column.name.toLowerCase())), rowid = ['rowid', '_rowid_', 'oid'].find(name => !fieldNames.has(name));
    if (!withoutRowid && rowid && columns.length < 1024) locator = { kind: 'rowid', columns: [], rowid, collations: ['BINARY'] };
    if (!locator) {
      const indexes = await read(driver, 'SELECT name,origin FROM pragma_index_list(?,\'main\') WHERE "unique"=1 AND partial=0 ORDER BY seq', [input.table], control);
      for (const item of indexes) {
        if (typeof item[0] !== 'string' || withoutRowid && item[1] !== 'pk') continue;
        const parts = await read(driver, 'SELECT cid,name,coll FROM pragma_index_xinfo(?,\'main\') WHERE key=1 ORDER BY seqno', [item[0]], control);
        if (!parts.length || parts.some(part => BigInt(integer(part[0])) < 0n || typeof part[1] !== 'string' || !['BINARY', 'NOCASE', 'RTRIM'].includes(String(part[2])) || !columns.some(column => column.name === part[1] && (!column.nullable || withoutRowid)))) continue;
        locator = { kind: item[1] === 'pk' ? 'primary-key' : 'unique-key', columns: parts.map(part => part[1] as string), collations: parts.map(part => part[2] as string) }; break;
      }
    }
    if (!locator) return readonly();
    const schema = await read(driver, 'PRAGMA main.schema_version', [], control, 1), schemaVersion = integer(schema[0]?.[0]);
    const identity = driver.identity!, chosen = locator;
    return {
      project: projection, ...(chosen.rowid ? { extraColumn: '"__dbark_source".' + quote(chosen.rowid) } : {}),
      capture: values => {
        this.prune();
        const rows = values.map(row => structuredClone(chosen.rowid ? row.slice(1) : row));
        const locators = values.map((row, index) => chosen.rowid ? [structuredClone(row[0])] : chosen.columns.map(name => structuredClone(rows[index][columns.findIndex(column => column.name === name)])));
        if (rows.some(row => row.length !== columns.length) || locators.some(row => row.some(value => value === null)) || chosen.rowid && locators.some(row => !row[0] || typeof row[0] !== 'object' || row[0].type !== 'integer')) return { kind: 'readonly', reason: text.readonly };
        const data = { target: { connectionId: profile.id, database: 'main' as const, table: input.table }, profile: structuredClone(profile), identity, catalogue: structuredClone(catalogue), columns, schemaVersion, locator: chosen, rows, locators };
        const size = Buffer.byteLength(JSON.stringify(data));
        if (this.snapshots.size >= limits.snapshots || this.bytes + size > limits.snapshotBytes) return { kind: 'readonly', reason: 'SQLite编辑快照预算已满，请关闭旧编辑来源后重新读取' };
        const snapshot: Snapshot = { ...data, id: randomUUID(), expires: Date.now() + limits.snapshotLifetimeMs, bytes: size, active: 0, revoked: false };
        this.snapshots.set(snapshot.id, snapshot); this.bytes += size;
        return { kind: 'editable', snapshotId: snapshot.id, expiresAt: new Date(snapshot.expires).toISOString(), columns: structuredClone(columns), rows: rows.map(row => row.map(original)), locator: { kind: chosen.kind, columns: [...chosen.columns] } };
      },
    };
  }
  /** 预览只编译参数化DML，没有driver或SQL投递能力。 */
  preview(source: SqliteTableEditPreviewInput): SqliteTableEditPreview {
    const input = sqliteTableEditPreviewSchema.parse(source); this.prune(); const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.revoked || snapshot.active) throw Error(text.stale);
    const table = '"main".' + quote(snapshot.target.table), counts = emptyCounts();
    const statements = input.changes.map(change => {
      counts[change.kind]++;
      if (change.kind !== 'insert' && !snapshot.rows[change.row]) throw Error(text.stale);
      const values = change.kind === 'delete' ? [] : change.values.map(value => { const column = snapshot.columns.find(column => column.name === value.column); if (!column || column.generated) throw Error('SQLite未知列或生成列不能写入'); return { column: column.name, value: parameter(value.value) }; });
      const where = change.kind === 'insert' ? undefined : locate(snapshot, change.row);
      if (change.kind === 'delete') return { kind: change.kind, row: change.row, sql: 'DELETE FROM ' + table + ' WHERE ' + where!.sql, parameters: where!.parameters };
      if (change.kind === 'insert') return { kind: change.kind, sql: values.length ? 'INSERT INTO ' + table + ' (' + values.map(value => quote(value.column)).join(',') + ') VALUES (' + values.map(() => '?').join(',') + ')' : 'INSERT INTO ' + table + ' DEFAULT VALUES', parameters: values.map(value => value.value) };
      return { kind: change.kind, row: change.row, sql: 'UPDATE ' + table + ' SET ' + values.map(value => quote(value.column) + '=?').join(',') + ' WHERE ' + where!.sql, parameters: [...values.map(value => value.value), ...where!.parameters] };
    });
    const size = Buffer.byteLength(JSON.stringify(statements)); if (this.previews.size >= 64 || this.bytes + size > limits.snapshotBytes) throw Error('SQLite编辑预览超过内存预算，请释放旧预览');
    const preview: Preview = { id: randomUUID(), snapshot, statements, counts, confirmation: snapshot.target.database + '.' + snapshot.target.table, expires: Math.min(snapshot.expires, Date.now() + limits.previewLifetimeMs), bytes: size };
    this.previews.set(preview.id, preview); this.bytes += size;
    return { previewId: preview.id, snapshotId: snapshot.id, target: { ...snapshot.target }, schemaKey: snapshot.catalogue.schemaKey, expiresAt: new Date(preview.expires).toISOString(), confirmation: preview.confirmation, sql: statements.map(display), counts: { ...counts } };
  }
  /** 一次领取后立即撤预览，客户端重复apply不能重放；快照原行仍由本次claim强引用。 */
  claim(source: SqliteTableEditApplyInput): SqliteEditClaim {
    const input = sqliteTableEditApplySchema.parse(source); this.prune(); const preview = this.previews.get(input.previewId);
    if (!preview) throw Error(text.stale); this.dropPreview(preview.id);
    if (preview.confirmation !== input.confirmation || preview.snapshot.revoked || preview.snapshot.active) throw Error(text.stale);
    preview.snapshot.active++; return preview;
  }
  /** 只有确认回滚保留快照；提交/未知永久撤原页和兄弟预览，释放不影响已执行事务。 */
  settle(claim: SqliteEditClaim, outcome: SqliteTableEditOutcome['outcome']): void { claim.snapshot.active--; if (outcome === 'committed' || outcome === 'unknown' || claim.snapshot.revoked) this.invalidate(claim.snapshot); }
}

/** 领取后但尚未取得driver的失败也返回明确not-sent，不把参数错误冒充未知写入。 */
export function sqliteEditNotSent(claim: SqliteEditClaim, input: SqliteEditApplyRequest, message: string): SqliteTableEditOutcome {
  const fact: SqliteWriteFact = { operationId: input.operationId, target: { ...claim.snapshot.target }, phase: 'not-sent', requestedRows: claim.statements.length, appliedRows: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false };
  let warning = false; try { input.recordWriteFact(fact); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...claim.snapshot.target }, outcome: 'not-sent', counts: { ...claim.counts }, fact, message, ...(warning ? { cleanupWarning: true } : {}) };
}

/** 独立rw BEGIN IMMEDIATE包住全批；每条DML前核完整旧行，trigger改动后继行也会整批回滚。 */
export async function applySqliteTableEdit(driver: SqliteDriverSession, claim: SqliteEditClaim, input: SqliteEditApplyRequest, control: SqliteEditApplyControl): Promise<SqliteTableEditOutcome> {
  const snapshot = claim.snapshot, requestedRows = claim.statements.length; let appliedRows = 0, begun = false, commitSent = false, committed = false, rollback = false, warning = false, failure: unknown;
  const fact = (phase: SqliteWriteFact['phase']): SqliteWriteFact => ({ operationId: input.operationId, target: { ...snapshot.target }, phase, requestedRows, appliedRows, commitMayHaveBeenSent: commitSent || phase === 'commit-pending', commitAcknowledged: committed, rollbackAcknowledged: rollback });
  const record = (phase: SqliteWriteFact['phase']) => { const value: unknown = input.recordWriteFact(fact(phase)); if (value && typeof (value as { then?: unknown }).then === 'function') throw Error('SQLite写入事实必须同步持久化，不能使用异步替身'); };
  try {
    control.check(); if (driver.readOnly || !equal(driver.identity, snapshot.identity)) throw Error('SQLite实际数据库文件身份已变化，原修改未发送');
    await assertSnapshotFile(snapshot, control); record('not-sent'); await driver.execute('BEGIN IMMEDIATE'); begun = true; control.check();
    await assertSnapshotFile(snapshot, control);
    const schema = await read(driver, 'PRAGMA main.schema_version', [], control, 1);
    const catalogue = await readSqliteTableCatalogue(driver, snapshot.target.table, control);
    if (integer(schema[0]?.[0]) !== snapshot.schemaVersion || catalogue.schemaKey !== snapshot.catalogue.schemaKey || !equal(catalogue.xinfo, snapshot.catalogue.xinfo)) throw Error('SQLite表结构已变化，请重新读取原页');
    record('writing');
    for (const statement of claim.statements) {
      control.check();
      if (statement.row !== undefined) {
        const where = locate(snapshot, statement.row), fields = snapshot.columns.map(column => projection('"__dbark_source".' + quote(column.name)) + ' AS ' + quote(column.name)).join(',');
        const current = await read(driver, 'SELECT ' + fields + ' FROM "main".' + quote(snapshot.target.table) + ' AS "__dbark_source" WHERE ' + where.sql + ' LIMIT 2', where.parameters, control, 2);
        if (current.length !== 1 || !equal(current[0], snapshot.rows[statement.row])) throw Error('SQLite原记录已被其他操作修改、删除或trigger改变，整批未继续');
      }
      control.check(); await driver.execute(statement.sql, { parameters: statement.parameters });
      const changed = await read(driver, 'SELECT changes()', [], control, 1); if (integer(changed[0]?.[0]) !== '1') throw Error('SQLite顶层修改行数不是1，整批必须回滚');
      appliedRows++; record('writing');
    }
    await assertSnapshotFile(snapshot, control); control.check(); record('commit-pending'); control.check(); control.beginCommit(); commitSent = true;
    await driver.execute('COMMIT'); committed = true;
    try { record('committed'); } catch { warning = true; }
  } catch (reason) {
    failure = reason;
    // 单条COMMIT的statementEnd已由原driver按operation顺序确认；随后completed丢失/进程退出不能抹掉提交ACK。
    const acknowledged = commitSent && reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1
      && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated && reason.completedResults[0].transaction === false;
    if (acknowledged) { committed = true; warning = true; try { record('committed'); } catch { /* 原提交事实优先，回调失败另记warning。 */ } }
  }
  if (!committed) {
    control.beginCleanup();
    if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); rollback = true; } catch (reason) { control.cleanupFailed(reason); failure = new AggregateError([failure, reason], 'SQLite原修改失败且整批回滚未确认', { cause: failure }); }
    else if (begun && !rollback) { const reason = Error('SQLite写事务原回滚事实未知'); control.cleanupFailed(reason); failure ??= reason; }
  }
  const outcome: SqliteTableEditOutcome['outcome'] = committed ? 'committed' : rollback ? 'rolled-back' : begun || commitSent ? 'unknown' : 'not-sent';
  if (!committed) try { record(outcome); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...snapshot.target }, outcome, counts: { ...claim.counts }, fact: fact(outcome), message: committed ? text.committed : outcome === 'unknown' ? text.unknown : outcome === 'rolled-back' ? text.rolledBack + (failure instanceof Error ? ' ' + failure.message : '') : failure instanceof Error ? failure.message : text.stale, ...(warning ? { cleanupWarning: true } : {}) };
}
