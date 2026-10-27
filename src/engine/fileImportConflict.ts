import type { ResultSetHeader } from 'mysql2';
import type { CellValue, DataRow } from '../shared/contracts';
import type { FileImportResult } from '../shared/sqlFileImport';
import { fileImportConflictMessage, fileImportConflictText as text, type FileImportConflictCounts, type FileImportConflictReport, type FileImportConflictSelection } from '../shared/fileImportConflict';
import type { FileImportTransactionMode } from '../shared/fileImportTransaction';
import type { ManagedConnection } from './connection';
import { deserializeCell, identifier, qualified, typedCellPlaceholder } from './sql';
import { validateLosslessImport } from './losslessImport';
import { readFileImportKeyCatalog, type FileImportCatalogQuery, type FileImportTarget } from './fileImportConflictCatalog';

type DriverValue = string | number | boolean | null | Buffer;
interface QueryHooks<T> { submitted?(): void; acknowledged?(rows: T): void; }
export interface FileImportConflictControl {
  managed: ManagedConnection;
  query<T>(sql: string, values?: DriverValue[], hooks?: QueryHooks<T>): Promise<T>;
  rollback(): Promise<ResultSetHeader>;
  checkCancelled(): void;
  cancelled(): boolean;
  progress(records: number): void;
}
export interface FileImportConflictEvidence { result: FileImportResult; finalCommitAcknowledged: boolean; committing: boolean; finalCommit: boolean; }
const emptyCounts = (): FileImportConflictCounts => ({ inserted: 0, matchedUpdates: 0, skippedExisting: 0, skippedMissing: 0 });

/** 不把策略或请求字段带入回执；固定任务身份与零计数，准备失败同样有结构化事实。 */
export function createFileImportConflictEvidence(taskId: string, mode: FileImportConflictSelection['mode']): FileImportConflictEvidence {
  return { finalCommitAcknowledged: false, committing: false, finalCommit: false, result: { rows: 0, errors: [], conflicts: { version: 1, taskId, mode, termination: 'failed', readRecords: 0, acknowledged: emptyCounts(), committed: emptyCounts(), currentBatch: 'none', failure: { stage: 'prepare-batch', message: '尚未开始导入；不会自动重试' } } } };
}
/** 取消/关闭晚失败保留原ACK计数；最终COMMIT已确认时不能反称数据已取消撤销。 */
export function finishFileImportConflictEvidence(evidence: FileImportConflictEvidence, cancelled: boolean, warning?: string): FileImportResult {
  const result = evidence.result, report = result.conflicts!;
  if (cancelled && !evidence.finalCommitAcknowledged) { report.termination = 'cancelled'; report.failure ??= { stage: 'cleanup', message: '导入已取消；此前提交保留，不会自动重试' }; }
  if (warning) report.cleanupWarning = fileImportConflictMessage(report.cleanupWarning ? report.cleanupWarning + '；' + warning : warning);
  result.rows = report.committed.inserted + report.committed.matchedUpdates;
  result.errors = [report.failure ? fileImportConflictMessage(`${report.failure.record ? `第${report.failure.record}条源记录` : '导入'}在${report.failure.stage}阶段停止；${report.failure.message}；此前提交及数据库副作用可能保留，失败语句也可能已生效，请核对；不会自动重试。`) : undefined, report.cleanupWarning].filter((value): value is string => value !== undefined);
  return result;
}

/** 每条内部SQL均需原连接新鲜协议证明，未知状态不能继续写入或提交。 */
function transaction(control: FileImportConflictControl, open: boolean): void {
  const managed = control.managed, status = managed.serverStatus;
  if (managed.broken || managed.transactionStateKnown !== true || !Number.isInteger(status) || status! < 0 || status! > 65535 || Boolean(status! & 1) !== open) throw Error('无法确认原连接仍在所需事务状态；未自动重试');
}
/** 固定控制语句及DML的ACK必须完整、无警告；FOUND_ROWS下UPDATE0/1只表示命令被确认。 */
function header(value: ResultSetHeader, control: FileImportConflictControl, open: boolean, affected?: number | 'update'): void {
  if (!value || Array.isArray(value) || !Number.isInteger(value.serverStatus) || value.serverStatus < 0 || value.serverStatus > 65535 || Boolean(value.serverStatus & 1) !== open || value.warningStatus !== 0 || !Number.isSafeInteger(value.affectedRows) || value.affectedRows < 0 || affected === 'update' && value.affectedRows > 1 || typeof affected === 'number' && value.affectedRows !== affected) throw Error('服务器ACK、影响计数、警告数或事务状态未通过确认；当前批拒绝提交');
  transaction(control, open);
}

/** 5.7的LONGLONG常量按精度配置返回文本；仅接纳规范1标记，不隐式转换其它值或执行访问器。 */
function validMatchRow(row: unknown): boolean {
  if (!row || typeof row !== 'object' || Array.isArray(row) || Reflect.ownKeys(row).length !== 1) return false;
  const marker = Object.getOwnPropertyDescriptor(row, 'present');
  return !!marker && marker.enumerable === true && 'value' in marker && (marker.value === 1 || marker.value === '1');
}

/** 只消费自有数据映射，拒绝重复目标、缺失键或无可更新列，不执行调用方访问器。 */
function mappingOf(input: object, info: Awaited<ReturnType<typeof readFileImportKeyCatalog>>['info'], selection: FileImportConflictSelection): [string, string][] {
  if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw Error('导入映射无效');
  const mapping: [string, string][] = [];
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== 'string' || !descriptor || !descriptor.enumerable || !('value' in descriptor) || typeof descriptor.value !== 'string') throw Error('导入映射必须为自有文字字段');
    mapping.push([key, descriptor.value]);
  }
  if (!mapping.length || new Set(mapping.map(([, target]) => target)).size !== mapping.length || mapping.some(([, target]) => !info.columns.some(column => column.name === target && !column.generated))) throw Error('导入映射为空、重复或包含不存在/生成列');
  if (selection.key.columns.some(key => !mapping.some(([, target]) => target === key))) throw Error(text.nullable);
  if (selection.mode !== 'skip-existing' && !mapping.some(([, target]) => !selection.key.columns.includes(target))) throw Error(text.noUpdate);
  return mapping;
}

/** 非默认导入独占原连接；每500条已处理源记录提交，跳过也计批边界，所有错误均停止而不重放。 */
export async function importFileWithConflict(target: FileImportTarget, format: 'csv' | 'json', mapping: object, selection: FileImportConflictSelection, mode: FileImportTransactionMode, records: AsyncIterable<DataRow>, evidence: FileImportConflictEvidence, control: FileImportConflictControl): Promise<FileImportResult> {
  const report = evidence.result.conflicts!;
  let stage: NonNullable<FileImportConflictReport['failure']>['stage'] = 'prepare-batch', currentRecord: number | undefined;
  let started = false, committing = false, prepared: Awaited<ReturnType<typeof readFileImportKeyCatalog>> | undefined, mapped: [string, string][] | undefined, processed = 0;
  const readStage = (): NonNullable<FileImportConflictReport['failure']>['stage'] => stage;
  /** 目录查询也保持取消代次与事务状态证明，不允许诊断失败后借旧状态继续。 */
  const catalogQuery: FileImportCatalogQuery = async <T>(sql: string, values: DriverValue[] = []) => { const rows = await control.query<T>(sql, values); transaction(control, true); return rows; };
  const prepare = async () => {
    stage = 'prepare-batch'; currentRecord = undefined; control.checkCancelled();
    await control.query<ResultSetHeader>('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', [], { acknowledged: rows => header(rows, control, false, 0) });
    await control.query<ResultSetHeader>('START TRANSACTION', [], { submitted: () => { started = true; report.currentBatch = 'pending'; }, acknowledged: rows => header(rows, control, true, 0) });
    await catalogQuery<unknown[]>(`SELECT 1 FROM ${qualified(target.database, target.table)} LIMIT 0`);
    prepared = await readFileImportKeyCatalog(control.managed, target, catalogQuery);
    if (prepared.catalog.schemaHash !== selection.schemaHash) throw Error(text.stale);
    const key = prepared.catalog.keys.find(key => key.name === selection.key.name);
    if (!key?.reliable || JSON.stringify(key.columns) !== JSON.stringify(selection.key.columns)) throw Error(text.noKey);
    mapped = mappingOf(mapping, prepared.info, selection); processed = 0;
  };
  /** COMMIT发送与完整ACK分别入账；结果未知时不补发ROLLBACK冒充撤销。 */
  const commit = async (final: boolean) => {
    stage = 'commit'; currentRecord = undefined; control.checkCancelled(); transaction(control, true);
    await control.query<ResultSetHeader>('COMMIT', [], { submitted: () => { committing = true; evidence.committing = true; evidence.finalCommit = final; report.currentBatch = 'commit-unknown'; }, acknowledged: rows => {
      header(rows, control, false, 0); report.committed = { ...report.acknowledged }; report.currentBatch = 'none'; started = false; committing = false;
      evidence.committing = false;
      if (final) { evidence.finalCommitAcknowledged = true; report.termination = 'completed'; delete report.failure; }
    } });
  };
  try {
    await prepare(); stage = 'read';
    for await (const row of records) {
      const record = ++report.readRecords;
      if (!started) await prepare();
      stage = 'record'; currentRecord = record; control.checkCancelled(); transaction(control, true);
      const columns = new Map(prepared!.info.columns.map(column => [column.name, column]));
      /** 先仅校验匹配键；真正跳过的记录不读取无用payload，写入时仍逐列保留原无损门。 */
      const checked = new Map<string, CellValue>();
      const valueOf = (target: string): CellValue => {
        if (checked.has(target)) return checked.get(target)!;
        const [source] = mapped!.find(([, column]) => column === target)!;
        if (!Object.hasOwn(row, source)) throw Error(`源记录缺少字段：${source}`);
        let value = row[source];
        if (format === 'csv' && typeof value === 'string' && value.startsWith('base64:') && /^(?:tinyblob|blob|mediumblob|longblob|binary|varbinary|bit)/i.test(columns.get(target)!.type)) value = { type: 'binary', base64: value.slice(7) };
        validateLosslessImport(columns.get(target)!, value, control.managed.status.dialect); checked.set(target, value); return value;
      };
      const keyValues = selection.key.columns.map(valueOf);
      if (keyValues.some(value => value === null || value === undefined)) throw Error(text.nullable);
      const where = selection.key.columns.map((key, index) => `${identifier(key)} = ${typedCellPlaceholder(columns.get(key)!, keyValues[index])}`).join(' AND ');
      const params = keyValues.map(deserializeCell);
      stage = 'match';
      const found = await control.query<unknown[]>(`SELECT 1 AS present FROM ${qualified(target.database, target.table)} FORCE INDEX (${identifier(selection.key.name)}) WHERE ${where} LIMIT 2 FOR UPDATE`, params);
      transaction(control, true); control.checkCancelled();
      if (!Array.isArray(found) || found.length > 1 || found.some(row => !validMatchRow(row))) throw Error('匹配回包无效或匹配不唯一，当前批拒绝提交');
      if (found.length && selection.mode === 'skip-existing') report.acknowledged.skippedExisting++;
      else if (!found.length && selection.mode === 'update-existing') report.acknowledged.skippedMissing++;
      else if (!found.length) {
        stage = 'record'; const values = mapped!.map(([, target]) => valueOf(target));
        stage = 'insert';
        const sql = `INSERT INTO ${qualified(target.database, target.table)} (${mapped!.map(([, target]) => identifier(target)).join(', ')}) VALUES (${mapped!.map(([, target], index) => typedCellPlaceholder(columns.get(target)!, values[index])).join(', ')})`;
        await control.query<ResultSetHeader>(sql, values.map(deserializeCell), { acknowledged: rows => { header(rows, control, true, 1); report.acknowledged.inserted++; } });
      } else {
        stage = 'record';
        const changed = mapped!.filter(([, target]) => !selection.key.columns.includes(target)).map(([, target]) => ({ target, value: valueOf(target) }));
        stage = 'update';
        const sql = `UPDATE ${qualified(target.database, target.table)} SET ${changed.map(item => `${identifier(item.target)} = ${typedCellPlaceholder(columns.get(item.target)!, item.value)}`).join(', ')} WHERE ${where}`;
        await control.query<ResultSetHeader>(sql, [...changed.map(item => deserializeCell(item.value)), ...params], { acknowledged: rows => { header(rows, control, true, 'update'); report.acknowledged.matchedUpdates++; } });
      }
      processed++; control.checkCancelled();
      if (mode === 'batch' && processed === 500) { await commit(false); control.progress(report.readRecords); }
      stage = 'read'; currentRecord = undefined;
    }
    control.checkCancelled();
    if (started) await commit(true);
    else { evidence.finalCommitAcknowledged = true; report.termination = 'completed'; delete report.failure; }
  } catch (error) {
    if (!evidence.finalCommitAcknowledged) {
      report.termination = control.cancelled() ? 'cancelled' : 'failed';
      report.failure = { stage: readStage(), message: fileImportConflictMessage(stage === 'read' ? '读取源文件失败；请核对文件内容、编码及读取权限' : error instanceof Error ? error.message : '导入处理失败'), ...(currentRecord ? { record: currentRecord } : {}) };
      if (!committing && started) {
        report.currentBatch = 'rollback-unconfirmed';
        try { const rows = await control.rollback(); header(rows, control, false, 0); report.currentBatch = 'rolled-back'; }
        catch { /* 保留原失败阶段；回滚未确认不能冒称本批已撤销。 */ }
      }
    }
  }
  return finishFileImportConflictEvidence(evidence, control.cancelled());
}
