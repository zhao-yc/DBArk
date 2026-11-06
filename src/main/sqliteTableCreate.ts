import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { SqliteConnectionProfile } from '../shared/contracts';
import { buildSqliteTableCreate, sqliteTableCreateApplySchema, sqliteTableCreateLimits as limits, type SqliteTableCreatePreviewInput, type SqliteTableCreatePreviewOutput, type SqliteTableCreateApplyInput, type SqliteTableCreateFact, type SqliteTableCreateOutcome } from '../shared/sqliteTableCreate';
import { SqliteDriverError, type SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteExportTextFunction, type SqliteFileIdentity, type SqliteValue } from '../engine/sqlite/protocol';
import { quoteSqliteIdentifier as quote, type SqliteTableBrowseControl } from './sqliteTableBrowse';
import { prepareSqliteTableCopy, verifySqliteTableCopy, type SqliteCopyDraft } from './sqliteTableCopy';

export type SqliteTableCreatePreviewRequest = SqliteTableCreatePreviewInput & { assertCurrent(): void };
export interface SqliteTableCreateApplyRequest extends SqliteTableCreateApplyInput { operationId: string; assertCurrent(): void; recordCreateFact(fact: SqliteTableCreateFact): void; }
export interface SqliteTableCreateControl extends SqliteTableBrowseControl { beginCommit(): void; }
type Compiled = ReturnType<typeof buildSqliteTableCreate>;
export interface SqliteCreateSnapshot {
  target: SqliteTableCreatePreviewOutput['target']; profile: SqliteConnectionProfile; identity: SqliteFileIdentity;
  schemaVersion: string; version: string; compiled: Compiled;
  copy?: { draft: SqliteCopyDraft; sourceKey: string; attachment?: { profile: SqliteConnectionProfile; identity: SqliteFileIdentity } };
}
export interface SqliteCreateClaim extends SqliteCreateSnapshot { id: string; expires: number; confirmation: string; bytes: number; }
const stale = 'SQLite建表预览已失效，请重新读取并明确预览';
const integer = (value: SqliteValue | undefined): string => { if (!value || typeof value !== 'object' || value.type !== 'integer') throw Error('SQLite建表目录整数事实无效'); return value.value; };

/** 私有设计及编译计划不和公共输出共享引用，预览后不能改写DDL或默认值。 */
function immutable<T>(value: T): T { if (value && typeof value === 'object') { for (const field of Object.values(value)) immutable(field); Object.freeze(value); } return value; }
/** 不比较mtime/ctime；合法其它行写入不会被误认成路径替换。 */
async function assertFile(snapshot: Pick<SqliteCreateSnapshot, 'profile' | 'identity'>, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<void> {
  control.check();
  try {
    const canonical = await realpath(snapshot.profile.sqlite.filePath!); control.check();
    if (canonical !== snapshot.identity.path) throw Error('SQLite建表源路径身份已变化');
    const current = await stat(snapshot.profile.sqlite.filePath!, { bigint: true }); control.check();
    if (!current.isFile() || current.dev.toString() !== snapshot.identity.device || current.ino.toString() !== snapshot.identity.inode) throw Error('SQLite建表源文件身份已变化');
  } catch { control.check(); throw Error('SQLite建表源文件身份已变化或无法确认，本次拒绝提交'); }
}
/** 每次元数据只接完整单语句，预算不足不能冒充名称可用或定义已核验。 */
async function read(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maximum: number, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<SqliteValue[][]> {
  control.check(); const values: SqliteValue[][] = [];
  const result = await driver.execute(sql, { parameters, maxRows: maximum, maxBytes: 4 * 1024 * 1024, onBatch: batch => { control.check(); values.push(...batch.rows); } });
  control.check(); if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== values.length) throw Error('SQLite建表元数据未完整返回'); return values;
}
/** table/view/index共用SQLite ASCII NOCASE命名空间，trigger名称不占该空间。 */
async function assertNamesAvailable(driver: SqliteDriverSession, compiled: Compiled, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<void> {
  const names = compiled.storedSql.map(value => value.name);
  const occupied = await read(driver, "SELECT name,type FROM main.sqlite_schema WHERE type IN ('table','view','index') AND (" + names.map(() => 'name=? COLLATE NOCASE').join(' OR ') + ') LIMIT ?', [...names, { type: 'integer', value: String(names.length + 1) }], names.length + 1, control);
  if (occupied.length) throw Error('SQLite计划的表或索引名称已被占用，请修改设计并重新预览');
}

/** 原只读连接BEGIN取目录快照；不执行任何CREATE，也不借用用户标签事务。 */
export async function prepareSqliteCreateSnapshot(driver: SqliteDriverSession, input: SqliteTableCreatePreviewInput, profile: SqliteConnectionProfile, control: SqliteTableBrowseControl, sourceProfile?: SqliteConnectionProfile): Promise<SqliteCreateSnapshot> {
  if (!driver.readOnly || !driver.identity) throw Error('SQLite建表预览必须使用有真实文件身份的独立只读连接');
  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(driver.version), versionNumber = version ? Number(version[1]) * 1000000 + Number(version[2]) * 1000 + Number(version[3]) : 0;
  if ('design' in input && (input.design.strict && versionNumber < 3037000 || input.design.withoutRowid && versionNumber < 3008002)) throw Error('当前SQLite版本不支持设计使用的表选项');
  const context = { profile: structuredClone(profile), identity: driver.identity };
  const sourceId = 'copy' in input ? input.copy.sourceConnectionId : undefined, sourceIdentity = driver.copySourceIdentity;
  if (sourceId ? sourceProfile?.id !== sourceId || !sourceIdentity : !!sourceProfile || !!sourceIdentity) throw Error('SQLite 复制源连接与实际文件不一致');
  const attachment = sourceProfile && sourceIdentity ? { profile: structuredClone(sourceProfile), identity: sourceIdentity } : undefined;
  let snapshot: SqliteCreateSnapshot | undefined;
  let failure: unknown, failed = false;
  try {
    await assertFile(context, control); if (attachment) await assertFile(attachment, control);
    await driver.execute('BEGIN'); control.check();
    const schemaVersion = integer((await read(driver, 'PRAGMA main.schema_version', [], 1, control))[0]?.[0]);
    const table = 'design' in input ? input.design.name : input.copy.name;
    const { compiled, copy } = 'design' in input ? { compiled: buildSqliteTableCreate(input.design), copy: undefined } :
      await prepareSqliteTableCopy(driver, input.copy, control).then(({ sourceKey, ...compiled }) => ({ compiled, copy: { draft: { ...input.copy }, sourceKey, attachment } }));
    snapshot = { ...context, target: { connectionId: profile.id, database: 'main', table }, schemaVersion, version: driver.version, compiled: immutable(compiled), copy: immutable(copy) };
    await assertNamesAvailable(driver, snapshot.compiled, control); await assertFile(snapshot, control);
    if (attachment) await assertFile(attachment, control);
  } catch (reason) { failed = true; failure = reason; }
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); } catch (reason) { control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite建表预览失败且读事务回滚未确认') : reason; failed = true; }
  else if (!driver.isClosed && driver.transaction !== false) { const reason = Error('SQLite建表预览读事务状态未知'); control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite建表预览收尾未确认') : reason; failed = true; }
  if (failed) throw failure; control.check(); return snapshot!;
}

/** 一次性能力只存小型设计/DDL与真实来源事实，终态不会永久引用utility或用户session。 */
export class SqliteTableCreates {
  private readonly previews = new Map<string, SqliteCreateClaim>();
  private bytes = 0;
  private drop(id: string): void { const value = this.previews.get(id); if (value) { this.bytes -= value.bytes; this.previews.delete(id); } }
  private prune(): void { for (const value of this.previews.values()) if (value.expires <= Date.now()) this.drop(value.id); }
  /** 只在原只读driver正常关闭且实际exit之后由Runtime发布。 */
  publish(snapshot: SqliteCreateSnapshot): SqliteTableCreatePreviewOutput {
    this.prune(); const bytes = Buffer.byteLength(JSON.stringify(snapshot)); if (this.previews.size >= limits.previews || this.bytes + bytes > limits.previewBytes) throw Error('SQLite建表预览预算已满，请释放旧预览');
    const value = { ...snapshot, id: randomUUID(), confirmation: 'main.' + snapshot.target.table, expires: Date.now() + limits.previewLifetimeMs, bytes }; this.previews.set(value.id, value); this.bytes += bytes;
    const warnings = value.copy ? [value.copy.attachment ? '来源文件只读打开。自引用改为副本，显式索引生成新名称，触发器需单独配置。' : '外键保留原引用，自引用改为副本。显式索引生成新名称，触发器需单独配置。'] : [];
    if (value.copy?.draft.mode === 'data') warnings.push('确认时读取完整来源。生成列重新计算，AUTOINCREMENT 按副本现有行重新建立高水位。');
    if (value.profile.sqlite.readOnly) warnings.push('当前SQLite连接为只读，仅可预览，不能创建表');
    return { previewId: value.id, target: { ...value.target }, expiresAt: new Date(value.expires).toISOString(), confirmation: value.confirmation, sql: [...value.compiled.sql], warnings };
  }
  release(id: string): void { this.drop(id); }
  releaseConnection(id: string): void { for (const value of this.previews.values()) if (value.target.connectionId === id || value.copy?.draft.sourceConnectionId === id) this.drop(value.id); }
  /** 确认文字错误同样立即消费原ID；重复apply不能重放。 */
  claim(input: SqliteTableCreateApplyInput): SqliteCreateClaim {
    const parsed = sqliteTableCreateApplySchema.parse(input); this.prune(); const value = this.previews.get(parsed.previewId); if (!value) throw Error(stale); this.drop(value.id); if (parsed.confirmation !== value.confirmation) throw Error(stale); return value;
  }
}

/** 原BEGIN之前拒绝也给明确事实；同步持久回调失败只添warning，不擅自补发任何SQL。 */
export function sqliteCreateNotSent(claim: SqliteCreateClaim, input: SqliteTableCreateApplyRequest): SqliteTableCreateOutcome {
  const fact: SqliteTableCreateFact = { operationId: input.operationId, target: { ...claim.target }, phase: 'not-sent', requestedStatements: claim.compiled.sql.length, completedStatements: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false };
  let warning = false; try { const result: unknown = input.recordCreateFact(fact); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite建表事实必须同步持久化'); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...claim.target }, outcome: 'not-sent', definitionVerified: false, fact, message: 'SQLite新建表未发送，连接或预览事实已变化，请重新明确预览', ...(warning ? { cleanupWarning: true } : {}) };
}

/** 独立写事务锁内重核全部来源，CREATE/index全批与FK编译检查成功后才唯一COMMIT。 */
export async function applySqliteTableCreate(driver: SqliteDriverSession, claim: SqliteCreateClaim, input: SqliteTableCreateApplyRequest, control: SqliteTableCreateControl): Promise<SqliteTableCreateOutcome> {
  let begun = false, commitSent = false, committed = false, rollback = false, verified = false, completedStatements = 0, warning = false;
  let copiedRows: string | undefined;
  const fact = (phase: SqliteTableCreateFact['phase']): SqliteTableCreateFact => ({ operationId: input.operationId, target: { ...claim.target }, phase, requestedStatements: claim.compiled.sql.length, completedStatements, commitMayHaveBeenSent: commitSent || phase === 'commit-pending', commitAcknowledged: committed, rollbackAcknowledged: rollback });
  const record = (phase: SqliteTableCreateFact['phase']) => { const value: unknown = input.recordCreateFact(fact(phase)); if (value && typeof (value as { then?: unknown }).then === 'function') throw Error('SQLite建表事实必须同步持久化'); };
  try {
    control.check(); if (driver.readOnly || JSON.stringify(driver.identity) !== JSON.stringify(claim.identity) || driver.version !== claim.version) throw Error('SQLite建表实际连接或版本已变化');
    const attachment = claim.copy?.attachment;
    if (JSON.stringify(attachment?.identity) !== JSON.stringify(driver.copySourceIdentity)) throw Error('SQLite 复制源文件已变化');
    await assertFile(claim, control); if (attachment) await assertFile(attachment, control);
    record('not-sent');
    try { await driver.execute('BEGIN IMMEDIATE'); begun = true; }
    catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults[0]?.transaction === true) begun = true; throw reason; }
    control.check(); await assertFile(claim, control); if (attachment) await assertFile(attachment, control);
    if (integer((await read(driver, 'PRAGMA main.schema_version', [], 1, control))[0]?.[0]) !== claim.schemaVersion) throw Error('SQLite目录版本已变化，请重新预览');
    if (claim.copy && (await prepareSqliteTableCopy(driver, claim.copy.draft, control)).sourceKey !== claim.copy.sourceKey) throw Error('SQLite复制来源定义已变化');
    await assertNamesAvailable(driver, claim.compiled, control); record('writing');
    for (const sql of claim.compiled.sql) {
      control.check();
      try {
        const result = await driver.execute(sql, { parameters: [] });
        if (result.statements.length !== 1 || result.statements[0].truncated) throw Error('SQLite建表缺少完整原生事实');
        completedStatements++;
        if (claim.copy?.draft.mode === 'data' && completedStatements === claim.compiled.sql.length) copiedRows = result.statements[0].changes;
      }
      catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated) completedStatements++; throw reason; }
      record('writing'); control.check();
    }
    // 只编译被解释的INSERT检查FK；EXPLAIN输出可截断为一行，但绝不执行原INSERT/默认值。
    const foreignKeys = await driver.execute('EXPLAIN INSERT INTO "main".' + quote(claim.target.table) + ' DEFAULT VALUES', { parameters: [], maxRows: 1 }); control.check();
    if (foreignKeys.statements.length !== 1 || !foreignKeys.transaction) throw Error('SQLite外键编译检查未确认');
    for (const expected of claim.compiled.storedSql) {
      const value = 'CASE WHEN typeof(sql)=\'text\' THEN ' + sqliteExportTextFunction + '(sql,CAST(sql AS BLOB)) ELSE sql END';
      const rows = await read(driver, 'SELECT type,name,tbl_name,' + value + ' FROM main.sqlite_schema WHERE name=? COLLATE BINARY AND type=? LIMIT 2', [expected.name, expected.type], 2, control);
      if (rows.length !== 1 || rows[0][0] !== expected.type || rows[0][1] !== expected.name || rows[0][2] !== claim.target.table || rows[0][3] !== expected.sql) throw Error('SQLite真实storedSql与原预览定义不一致');
    }
    if (claim.copy) await verifySqliteTableCopy(driver, claim.copy.draft, copiedRows, control);
    verified = true; await assertFile(claim, control); if (attachment) await assertFile(attachment, control);
    record('commit-pending'); control.check(); control.beginCommit(); commitSent = true;
    await driver.execute('COMMIT'); committed = true; try { record('committed'); } catch { warning = true; }
  } catch (reason) {
    // 单条COMMIT的statementEnd是真实ACK；不能因最终completed/进程随后丢失而冒充unknown。
    if (commitSent && reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated && reason.completedResults[0].transaction === false) { committed = true; warning = true; try { record('committed'); } catch { /* 只报告warning，不抹已确认COMMIT。 */ } }
  }
  if (!committed) {
    control.beginCleanup();
    if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); rollback = true; } catch (reason) { control.cleanupFailed(reason); }
    else if (begun) control.cleanupFailed(Error('SQLite建表原事务回滚事实未知'));
  }
  const outcome: SqliteTableCreateOutcome['outcome'] = committed ? 'committed' : rollback ? 'rolled-back' : begun || commitSent ? 'unknown' : 'not-sent';
  if (!committed) try { record(outcome); } catch { warning = true; }
  const success = claim.copy ? 'SQLite表副本已确认创建' + (copiedRows === undefined ? '' : `，已复制 ${copiedRows} 行`) : 'SQLite表和索引已确认创建';
  return { operationId: input.operationId, target: { ...claim.target }, outcome, definitionVerified: committed && verified, fact: fact(outcome), message: committed ? success : outcome === 'unknown' ? 'SQLite建表结果未知，禁止重放，请独立核对原数据库' : outcome === 'rolled-back' ? 'SQLite建表未提交，原整批事务已确认回滚，请重新明确预览' : 'SQLite建表未发送，请重新明确预览', ...(warning ? { cleanupWarning: true } : {}) };
}
