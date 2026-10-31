import { randomUUID } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import type { DataRow, SqliteConnectionProfile } from '../shared/contracts';
import { inspectImportFile, readVerifiedImportRecords } from '../engine/importNewTableSource';
import { SqliteDriverError, type SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteFileIdentity, SqliteValue } from '../engine/sqlite/protocol';
import { readSqliteTableCatalogue, type SqliteTableCatalogue, type SqliteTableBrowseControl } from './sqliteTableBrowse';
import { buildSqliteTableImportPlan, SqliteTableImportMappingError, sqliteTableImportAffinity, sqliteTableImportIssue, sqliteTableImportLimits as limits, sqliteTableImportMessages as text, type SqliteTableImportColumn, type SqliteTableImportInspectInput, type SqliteTableImportInspectOutput, type SqliteTableImportPreviewInput, type SqliteTableImportPreviewOutput, type SqliteTableImportApplyInput, type SqliteTableImportReleaseInput, type SqliteTableImportReport, type SqliteTableImportIssue, type SqliteTableImportOutcome, type SqliteImportWriteFact } from '../shared/sqliteTableImport';

export interface SqliteTableImportInspectRequest extends SqliteTableImportInspectInput { filePath: string; assertCurrent(): void; }
export interface SqliteTableImportPreviewRequest extends SqliteTableImportPreviewInput { assertCurrent(): void; }
export interface SqliteTableImportApplyRequest extends SqliteTableImportApplyInput { operationId: string; assertCurrent(): void; recordWriteFact(fact: SqliteImportWriteFact): void; }
export interface SqliteTableImportControl extends SqliteTableBrowseControl { signal: AbortSignal; progress(records: number): void; }
export interface SqliteTableImportApplyControl extends SqliteTableImportControl { beginCommit(): void; }
export interface SqliteImportFileIdentity { device: string; inode: string; size: string; modified: string; changed: string; }
type SourceIdentity = SqliteImportFileIdentity;
export type SqliteImportFileInput = Pick<SqliteTableImportInspectRequest, 'fileToken' | 'taskId' | 'format' | 'encoding' | 'csvDelimiter' | 'csvHasHeader' | 'filePath'>;
export interface SqliteImportFileScan { source: SqliteTableImportInspectOutput['source']; records: number; sourceColumns: string[]; sample: DataRow[]; sampleOmitted: boolean; }
export interface SqliteImportTarget {
  target: SqliteTableImportInspectOutput['target']; profile: SqliteConnectionProfile; identity: SqliteFileIdentity;
  schemaVersion: string; catalogue: SqliteTableCatalogue; columns: SqliteTableImportColumn[]; strict: boolean;
}
export interface SqliteImportInspection extends SqliteImportTarget {
  id: string; expires: number; bytes: number; file: Omit<SqliteTableImportInspectRequest, 'assertCurrent'>;
  fileIdentity: SourceIdentity; source: SqliteTableImportInspectOutput['source']; records: number; sourceColumns: string[];
  sample: DataRow[]; sampleOmitted: boolean;
}
type ImportPlan = ReturnType<typeof buildSqliteTableImportPlan>;
export interface SqliteImportClaim { id: string; expires: number; bytes: number; inspection: SqliteImportInspection; plan: ImportPlan; confirmation: string; confirmed: boolean; }
class SourceChanged extends Error { constructor() { super('SQLite导入源文件已变化，请重新检查文件'); } }
class TargetChanged extends Error { constructor() { super('SQLite导入目标实际文件身份已变化'); } }
const integer = (value: SqliteValue | undefined) => { if (!value || typeof value !== 'object' || value.type !== 'integer') throw Error('SQLite导入目录整数无效'); return value.value; };
const fileIdentity = (value: BigIntStats): SourceIdentity => ({ device: String(value.dev), inode: String(value.ino), size: String(value.size), modified: String(value.mtimeNs), changed: String(value.ctimeNs) });
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** 原文件能力还须绑定真实对象，SHA相同的新inode不能借用旧检查。 */
async function sourceIdentity(path: string, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<SourceIdentity> {
  control.check(); try { const value = await lstat(path, { bigint: true }); control.check(); if (!value.isFile() || value.isSymbolicLink()) throw new SourceChanged(); return fileIdentity(value); } catch { control.check(); throw new SourceChanged(); }
}
/** 物理dev/ino覆盖硬链接；任何DB主库或固定日志对象都不能被当作导入源读取。 */
export async function assertSqliteImportSource(path: string, profile: SqliteConnectionProfile, control: Pick<SqliteTableBrowseControl, 'check'>, expected?: SourceIdentity): Promise<SourceIdentity> {
  const source = await sourceIdentity(path, control); if (expected && !equal(source, expected)) throw new SourceChanged();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    control.check(); let value: BigIntStats;
    try { value = await stat(profile.sqlite.filePath! + suffix, { bigint: true }); } catch (reason) { control.check(); if (suffix && (reason as NodeJS.ErrnoException).code === 'ENOENT') continue; throw Error('SQLite导入目标文件或日志身份无法确认'); }
    control.check(); if (String(value.dev) === source.device && String(value.ino) === source.inode) throw Error('SQLite数据库及其日志或硬链接不能作为导入源');
  }
  return source;
}
async function assertDatabase(snapshot: SqliteImportTarget, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<void> {
  control.check(); try { const path = await realpath(snapshot.profile.sqlite.filePath!); control.check(); const value = await stat(snapshot.profile.sqlite.filePath!, { bigint: true }); control.check(); if (path !== snapshot.identity.path || !value.isFile() || String(value.dev) !== snapshot.identity.device || String(value.ino) !== snapshot.identity.inode) throw Error(); } catch { control.check(); throw new TargetChanged(); }
}
async function read(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maximum: number, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<SqliteValue[][]> {
  control.check(); const rows: SqliteValue[][] = []; const value = await driver.execute(sql, { parameters, maxRows: maximum, maxBytes: 16 * 1024 * 1024, onBatch: batch => { control.check(); rows.push(...batch.rows); } }); control.check(); if (value.statements.length !== 1 || value.statements[0].truncated || value.statements[0].rows !== rows.length) throw Error('SQLite导入目标目录读取不完整'); return rows;
}

/** 仅普通主表可导入；真实xinfo、STRICT和隐式INTEGER rowid自动值在独立RO快照内读取。 */
export async function readSqliteImportTarget(driver: SqliteDriverSession, profile: SqliteConnectionProfile, table: string, control: SqliteTableBrowseControl): Promise<SqliteImportTarget> {
  if (!driver.readOnly || !driver.identity || /^sqlite_/i.test(table)) throw Error('SQLite导入仅支持普通表的独立只读检查');
  let value: SqliteImportTarget | undefined, failure: unknown, failed = false;
  try {
    control.check(); await driver.execute('BEGIN'); control.check(); const schemaVersion = integer((await read(driver, 'PRAGMA main.schema_version', [], 1, control))[0]?.[0]);
    const catalogue = await readSqliteTableCatalogue(driver, table, control), flags = await read(driver, "SELECT type,wr,strict FROM pragma_table_list WHERE schema='main' AND name=? COLLATE BINARY LIMIT 2", [table], 2, control);
    if (catalogue.kind !== 'table' || flags.length !== 1 || flags[0][0] !== 'table') throw Error('SQLite视图、虚拟表和影子表不能导入');
    const withoutRowid = integer(flags[0][1]) === '1', primary = catalogue.xinfo.filter(row => integer(row[5]) !== '0'), primaryIndexes = await read(driver, "SELECT origin FROM pragma_index_list(?,'main') WHERE origin='pk' LIMIT 1", [table], 1, control);
    const auto = !withoutRowid && primary.length === 1 && typeof primary[0][2] === 'string' && /^INTEGER$/i.test(primary[0][2]) && primaryIndexes.length === 0 ? primary[0][1] : undefined;
    const strict = integer(flags[0][2]) === '1', columns: SqliteTableImportColumn[] = catalogue.xinfo.filter(row => integer(row[6]) !== '1').map(row => ({ name: row[1] as string, declaredType: row[2] as string, nullable: integer(row[3]) === '0', hasDefault: row[4] !== null, generated: ['2', '3'].includes(integer(row[6])), affinity: sqliteTableImportAffinity(row[2] as string, strict), ...(row[1] === auto ? { autoGenerated: true } : {}) }));
    value = { target: { connectionId: profile.id, database: 'main', table }, profile: structuredClone(profile), identity: driver.identity, schemaVersion, catalogue, columns, strict }; await assertDatabase(value, control);
  } catch (reason) { failure = reason; failed = true; }
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); } catch (reason) { control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite导入检查及读快照收尾失败') : reason; failed = true; }
  else if (!driver.isClosed && driver.transaction !== false) { const reason = Error('SQLite导入检查读事务状态未知'); control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason]) : reason; failed = true; }
  if (failed) throw failure; control.check(); return value!;
}
/** 预检两端分别开短RO快照，不在耗时源文件扫描期间持有数据库锁。 */
export async function verifySqliteImportTarget(driver: SqliteDriverSession, inspection: SqliteImportInspection, control: SqliteTableBrowseControl): Promise<void> {
  const current = await readSqliteImportTarget(driver, inspection.profile, inspection.target.table, control);
  if (!equal(current.identity, inspection.identity) || current.schemaVersion !== inspection.schemaVersion || current.catalogue.schemaKey !== inspection.catalogue.schemaKey || !equal(current.catalogue.xinfo, inspection.catalogue.xinfo) || current.strict !== inspection.strict || !equal(current.columns, inspection.columns)) throw Error('SQLite原导入表目录已变化，请重新检查文件和表');
}
/** DB已正常关闭后才扫源文件，长文件检查不会持有数据库读锁。 */
export async function inspectSqliteImportFile(input: SqliteTableImportInspectRequest, target: SqliteImportTarget, expected: SourceIdentity, control: SqliteTableImportControl): Promise<Omit<SqliteImportInspection, 'id' | 'expires' | 'bytes'>> {
  const scanned = await inspectSqliteImportRecords(input, target.profile, expected, control);
  const { assertCurrent: _owner, ...file } = input;
  return { ...target, file: structuredClone(file), fileIdentity: expected, ...scanned };
}
/** 共享严格原字节扫描，只读来源能力和最终目标检查沿同一reader及样本预算。 */
export async function inspectSqliteImportRecords(input: SqliteImportFileInput, profile: SqliteConnectionProfile, expected: SourceIdentity, control: SqliteTableImportControl): Promise<SqliteImportFileScan> {
  await assertSqliteImportSource(input.filePath, profile, control, expected);
  const inspected = await inspectImportFile({ fileToken: input.fileToken, taskId: input.taskId, format: input.format, encoding: input.encoding, ...(input.csvDelimiter === undefined ? {} : { csvDelimiter: input.csvDelimiter }), ...(input.csvHasHeader === undefined ? {} : { csvHasHeader: input.csvHasHeader }), filePath: input.filePath, strictEncoding: true }, control.check, progress => { control.check(); if (progress.records > limits.records) throw Error('SQLite导入文件超过记录预算'); control.progress(progress.records); }, control.signal);
  control.check(); await assertSqliteImportSource(input.filePath, profile, control, expected);
  if (inspected.records > limits.records || inspected.columns.length > limits.sourceColumns) throw Error('SQLite导入文件记录或源列目录超过预算');
  const sample: DataRow[] = []; let sampleBytes = 2;
  for (const row of inspected.rows) {
    const size = Buffer.byteLength(JSON.stringify(row)); const valid = Object.values(row).every(cell => typeof cell !== 'string' || Buffer.byteLength(cell) <= limits.sourceValueBytes && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(cell)) && Object.values(row).every(cell => !cell || typeof cell !== 'object' || cell.base64.length <= 4 * Math.ceil(limits.valueBytes / 3));
    if (valid && sample.length < limits.sampleRows && sampleBytes + size + (sample.length ? 1 : 0) <= limits.sampleBytes) { sampleBytes += size + (sample.length ? 1 : 0); sample.push(structuredClone(row)); }
  }
  return { source: inspected.source, records: inspected.records, sourceColumns: inspected.columns, sample, sampleOmitted: inspected.records > sample.length };
}

/** 仅有界诊断穿过公共边界，不把第三方错误、文件行值或路径带入任务概要。 */
function issue(report: SqliteTableImportReport, value: SqliteTableImportIssue): void { report.issueCount++; if (report.issues.length < limits.issues) report.issues.push(value); report.truncated = report.issueCount > report.issues.length; }
const report = (): SqliteTableImportReport => ({ checkedRecords: 0, validRecords: 0, invalidRecords: 0, issueCount: 0, issues: [], truncated: false, complete: false });
export async function previewSqliteImport(inspection: SqliteImportInspection, input: SqliteTableImportPreviewRequest, control: SqliteTableImportControl): Promise<{ plan?: ImportPlan; report: SqliteTableImportReport }> {
  const checked = report(); let plan: ImportPlan | undefined;
  try {
    await assertSqliteImportSource(inspection.file.filePath, inspection.profile, control, inspection.fileIdentity); await assertDatabase(inspection, control);
    if (inspection.records) try { plan = buildSqliteTableImportPlan({ target: inspection.target, columns: inspection.columns, sourceColumns: inspection.sourceColumns, mapping: input.mapping, strict: inspection.strict }); }
    catch (reason) { if (reason instanceof SqliteTableImportMappingError) { for (const error of reason.issues) issue(checked, error); checked.issueCount += reason.issueCount - reason.issues.length; checked.truncated = checked.issueCount > checked.issues.length; } else issue(checked, sqliteTableImportIssue('invalid-mapping')); return { report: checked }; }
    for await (const row of readVerifiedImportRecords({ ...inspection.file, expectedSource: inspection.source, strictEncoding: true }, control.check, control.signal)) {
      control.check(); if (checked.checkedRecords >= limits.records) { issue(checked, sqliteTableImportIssue('record-limit')); return { report: checked }; }
      const converted = plan!.convertRow(row, checked.checkedRecords + 1); checked.checkedRecords++;
      if (converted.ok) checked.validRecords++; else { checked.invalidRecords++; for (const error of converted.issues) issue(checked, error); checked.issueCount += converted.issueCount - converted.issues.length; checked.truncated = checked.issueCount > checked.issues.length; }
      if (checked.checkedRecords % 128 === 0) control.progress(checked.checkedRecords);
    }
    await assertSqliteImportSource(inspection.file.filePath, inspection.profile, control, inspection.fileIdentity);
    checked.complete = true; if (checked.checkedRecords !== inspection.records) throw new SourceChanged();
    if (!checked.checkedRecords) issue(checked, sqliteTableImportIssue('empty-file'));
  } catch (reason) { control.check(); checked.complete = false; issue(checked, sqliteTableImportIssue(reason instanceof SourceChanged || reason instanceof Error && /变化|替换|移动/.test(reason.message) ? 'source-changed' : 'parse-error')); }
  return { ...(plan && !checked.issueCount && checked.complete ? { plan } : {}), report: checked };
}

/** 来源和预检能力独立TTL，已claim任务只持准确强引用，不再因TTL中断其原事务。 */
export class SqliteTableImports {
  private readonly inspections = new Map<string, SqliteImportInspection>(); private readonly previews = new Map<string, SqliteImportClaim>(); private bytes = 0;
  private readonly pendingInspections = new Map<SqliteImportInspection, number>();
  private readonly revokedInspections = new WeakSet<SqliteImportInspection>();
  private dropPreview(id: string): void { const value = this.previews.get(id); if (value) { this.bytes -= value.bytes; this.previews.delete(id); } }
  /** 自然TTL仅移除新领取资格；显式撤销必须同时命中仍在扫描、已不在领取Map里的准确对象。 */
  private dropInspection(id: string, children: boolean): void {
    const value = this.inspections.get(id);
    if (children) {
      if (value) this.revokedInspections.add(value);
      for (const pending of this.pendingInspections.keys()) if (pending.id === id) this.revokedInspections.add(pending);
      for (const preview of this.previews.values()) if (preview.inspection.id === id) this.dropPreview(preview.id);
    }
    if (value) { if (!this.pendingInspections.has(value)) this.bytes -= value.bytes; this.inspections.delete(id); }
  }
  /** 过期但仍在途的快照继续占原64个/64MiB预算，不能以TTL删除Map来隐去强引用的成本。 */
  private inspectionCount(): number { let count = this.inspections.size; for (const value of this.pendingInspections.keys()) if (this.inspections.get(value.id) !== value) count++; return count; }
  private prune(): void { for (const value of this.previews.values()) if (value.expires <= Date.now()) this.dropPreview(value.id); for (const value of this.inspections.values()) if (value.expires <= Date.now()) this.dropInspection(value.id, false); }
  publish(value: Omit<SqliteImportInspection, 'id' | 'expires' | 'bytes'>): SqliteTableImportInspectOutput {
    this.prune(); const bytes = Buffer.byteLength(JSON.stringify(value)); if (this.inspectionCount() >= limits.inspections || this.bytes + bytes > limits.previewBytes) throw Error('SQLite导入来源预算已满，请释放旧来源');
    const inspection = { ...value, id: randomUUID(), expires: Date.now() + limits.previewLifetimeMs, bytes }; this.inspections.set(inspection.id, inspection); this.bytes += bytes;
    return { inspectionId: inspection.id, target: { ...inspection.target }, source: { ...inspection.source }, sourceColumns: [...inspection.sourceColumns], sample: structuredClone(inspection.sample), sampleOmitted: inspection.sampleOmitted, records: inspection.records, columns: structuredClone(inspection.columns), strict: inspection.strict, readOnly: inspection.profile.sqlite.readOnly, expiresAt: new Date(inspection.expires).toISOString() };
  }
  inspection(id: string): SqliteImportInspection { this.prune(); const value = this.inspections.get(id); if (!value) throw Error(text.stale); return value; }
  /** 只读预检保留到原Promise终态；已claim writer不登记于此，不把metadata释放当成事务取消。 */
  retainInspection(inspection: SqliteImportInspection): { check(): void; release(): void } {
    if (this.revokedInspections.has(inspection)) throw Error(text.stale);
    this.pendingInspections.set(inspection, (this.pendingInspections.get(inspection) ?? 0) + 1); let released = false;
    return {
      check: () => { if (released || this.revokedInspections.has(inspection)) throw Error(text.stale); },
      release: () => {
        if (released) return; released = true; const count = this.pendingInspections.get(inspection)!;
        if (count > 1) this.pendingInspections.set(inspection, count - 1);
        else { this.pendingInspections.delete(inspection); if (this.inspections.get(inspection.id) !== inspection) this.bytes -= inspection.bytes; }
      },
    };
  }
  publishPreview(inspection: SqliteImportInspection, checked: Awaited<ReturnType<typeof previewSqliteImport>>): SqliteTableImportPreviewOutput {
    if (this.revokedInspections.has(inspection)) throw Error(text.stale);
    const common = { inspectionId: inspection.id, target: { ...inspection.target }, source: { ...inspection.source }, records: inspection.records, report: checked.report, warnings: [text.source, text.triggers] };
    if (!checked.plan) return { ok: false, ...common };
    this.prune(); const bytes = Buffer.byteLength(JSON.stringify({ inspection, sql: checked.plan.sql, mapping: checked.plan.mapping })); if (this.previews.size >= limits.previews || this.bytes + bytes > limits.previewBytes) throw Error('SQLite导入预检预算已满，请释放旧来源');
    const value: SqliteImportClaim = { id: randomUUID(), expires: Date.now() + limits.previewLifetimeMs, bytes, inspection, plan: checked.plan, confirmation: 'main.' + inspection.target.table, confirmed: false }; this.previews.set(value.id, value); this.bytes += bytes;
    return { ok: true, ...common, warnings: [...new Set([...common.warnings, ...checked.plan.warnings])], previewId: value.id, sql: value.plan.sql, confirmation: value.confirmation, expiresAt: new Date(value.expires).toISOString() };
  }
  claim(input: SqliteTableImportApplyInput): SqliteImportClaim { this.prune(); const value = this.previews.get(input.previewId); if (!value) throw Error(text.stale); this.dropPreview(value.id); return { ...value, confirmed: value.confirmation === input.confirmation }; }
  release(input: SqliteTableImportReleaseInput): void { if (input.previewId) this.dropPreview(input.previewId); if (input.inspectionId) this.dropInspection(input.inspectionId, true); }
  /** 来源显式释放或写批终态级联未领取能力；已claim writer仍持原快照，不冒充事务取消。 */
  releaseSource(id: string): void { for (const value of new Set([...this.inspections.values(), ...this.pendingInspections.keys()])) if (value.file.sourceId === id) this.dropInspection(value.id, true); for (const value of this.previews.values()) if (value.inspection.file.sourceId === id) this.dropPreview(value.id); }
  releaseConnection(id: string): void { for (const value of new Set([...this.inspections.values(), ...this.pendingInspections.keys()])) if (value.target.connectionId === id) this.dropInspection(value.id, true); for (const value of this.previews.values()) if (value.inspection.target.connectionId === id) this.dropPreview(value.id); }
  settle(value: SqliteImportClaim, outcome: SqliteTableImportOutcome['outcome']): void { if (outcome === 'committed' || outcome === 'unknown') this.dropInspection(value.inspection.id, true); }
}

export function sqliteImportNotSent(claim: SqliteImportClaim, input: SqliteTableImportApplyRequest): SqliteTableImportOutcome {
  const fact: SqliteImportWriteFact = { operationId: input.operationId, target: { ...claim.inspection.target }, phase: 'not-sent', requestedRows: claim.inspection.records, appliedRows: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false }; let warning = false;
  try { const value: unknown = input.recordWriteFact(fact); if (value && typeof (value as { then?: unknown }).then === 'function') throw Error('导入事实必须同步持久'); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...fact.target }, outcome: 'not-sent', counts: { insert: fact.requestedRows, update: 0, delete: 0 }, fact, message: text.notSent, ...(warning ? { cleanupWarning: true } : {}) };
}

/** 全文件只用固定INSERT OR ABORT和typed绑定，所有行及最后SHA/身份确认后才唯一COMMIT。 */
export async function applySqliteImport(driver: SqliteDriverSession, claim: SqliteImportClaim, input: SqliteTableImportApplyRequest, control: SqliteTableImportApplyControl): Promise<SqliteTableImportOutcome> {
  const inspection = claim.inspection; let begun = false, sent = false, committed = false, rollback = false, appliedRows = 0, warning = false, currentRecord = 0, stage: 'source' | 'schema' | 'row' | 'transaction' = 'source', failure: SqliteTableImportIssue | undefined;
  const fact = (phase: SqliteImportWriteFact['phase']): SqliteImportWriteFact => ({ operationId: input.operationId, target: { ...inspection.target }, phase, requestedRows: inspection.records, appliedRows, commitMayHaveBeenSent: sent || phase === 'commit-pending', commitAcknowledged: committed, rollbackAcknowledged: rollback });
  const record = (phase: SqliteImportWriteFact['phase']) => { const value: unknown = input.recordWriteFact(fact(phase)); if (value && typeof (value as { then?: unknown }).then === 'function') throw Error('SQLite导入事实必须同步持久化'); };
  try {
    control.check(); if (!claim.confirmed || driver.readOnly || !equal(driver.identity, inspection.identity)) throw Error(text.stale);
    await assertDatabase(inspection, control); await assertSqliteImportSource(inspection.file.filePath, inspection.profile, control, inspection.fileIdentity); stage = 'transaction'; record('not-sent');
    try { await driver.execute('BEGIN IMMEDIATE'); begun = true; } catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults[0]?.transaction === true) begun = true; throw reason; }
    control.check(); stage = 'schema'; await assertDatabase(inspection, control);
    if (integer((await read(driver, 'PRAGMA main.schema_version', [], 1, control))[0]?.[0]) !== inspection.schemaVersion) throw Error(text.stale);
    const catalogue = await readSqliteTableCatalogue(driver, inspection.target.table, control); if (catalogue.schemaKey !== inspection.catalogue.schemaKey || !equal(catalogue.xinfo, inspection.catalogue.xinfo)) throw Error(text.stale);
    stage = 'source'; await assertSqliteImportSource(inspection.file.filePath, inspection.profile, control, inspection.fileIdentity); stage = 'transaction'; record('writing'); stage = 'source';
    for await (const row of readVerifiedImportRecords({ ...inspection.file, expectedSource: inspection.source, strictEncoding: true }, control.check, control.signal)) {
      control.check(); if (appliedRows >= inspection.records) throw new SourceChanged(); currentRecord = appliedRows + 1; stage = 'row'; const converted = claim.plan.convertRow(row, currentRecord); if (!converted.ok) { failure = converted.issues[0]; throw Error('SQLite导入原行未通过预检规则'); }
      const value = await driver.execute(claim.plan.sql, { parameters: converted.parameters }); if (value.statements.length !== 1 || value.statements[0].truncated) throw Error('SQLite导入缺少原INSERT完整事实');
      const changed = await read(driver, 'SELECT changes()', [], 1, control); if (integer(changed[0]?.[0]) !== '1') throw Error('SQLite导入顶层INSERT不是准确1行，原批必须回滚'); appliedRows++;
      if (appliedRows % 128 === 0) { stage = 'transaction'; record('writing'); control.progress(appliedRows); } stage = 'source';
    }
    if (appliedRows !== inspection.records) throw new SourceChanged(); await assertSqliteImportSource(inspection.file.filePath, inspection.profile, control, inspection.fileIdentity); stage = 'schema'; await assertDatabase(inspection, control); stage = 'transaction'; record('writing'); record('commit-pending'); control.check(); control.beginCommit(); sent = true;
    await driver.execute('COMMIT'); committed = true; try { record('committed'); } catch { warning = true; }
  } catch (reason) {
    if (sent && reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated && reason.completedResults[0].transaction === false) { committed = true; warning = true; try { record('committed'); } catch { /* 保留真实ACK。 */ } }
    else if (!control.signal.aborted) failure ??= sqliteTableImportIssue(reason instanceof TargetChanged ? 'schema-changed' : reason instanceof SourceChanged || reason instanceof Error && /文件.*变化/.test(reason.message) ? 'source-changed' : stage === 'row' ? 'native-rejected' : stage === 'schema' ? 'schema-changed' : stage === 'source' ? 'read-error' : 'transaction-error', stage === 'row' && currentRecord ? { record: currentRecord } : {});
  }
  if (!committed) { control.beginCleanup(); if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); rollback = true; } catch (reason) { control.cleanupFailed(reason); } else if (begun) control.cleanupFailed(Error('SQLite导入原事务回滚未知')); }
  const outcome: SqliteTableImportOutcome['outcome'] = committed ? 'committed' : rollback ? 'rolled-back' : begun || sent ? 'unknown' : 'not-sent'; if (!committed) try { record(outcome); } catch { warning = true; }
  if (outcome === 'unknown') failure ??= sqliteTableImportIssue('transaction-error');
  return { operationId: input.operationId, target: { ...inspection.target }, outcome, counts: { insert: inspection.records, update: 0, delete: 0 }, fact: fact(outcome), message: committed ? text.committed : outcome === 'rolled-back' ? text.rolledBack : outcome === 'unknown' ? text.unknown : text.notSent, ...(!committed && failure ? { failure } : {}), ...(warning ? { cleanupWarning: true } : {}) };
}
