import type { CellValue, ColumnInfo, TableInfo } from '../shared/contracts';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import { tableFilteredExportLimits, tableFilteredExportText as text, type TableFilteredExportInput, type TableFilteredExportOutput } from '../shared/tableFilteredExport';
import { queryStreamExportLimits as limits, type QueryExportFrame } from '../shared/queryStreamExport';
import { EXCEL_LIMITS } from '../shared/excelTransfer';
import { csvExportDelimiter, type CsvExportDelimiter } from '../shared/csvExport';
import { AtomicFile, AtomicFileTargetReservation, type AtomicFileIO } from './atomicFile';
import { exportExcelFile } from './excelFiles';
import { csvCell, csvHeader } from './files';
import { readIncomingReferenceTable } from './incomingReferences';
import { consumeQueryFrames } from './queryStreamProtocol';
import { QueryInsertFile } from './queryInsertFile';
import { buildTableFilterSql, identifier, inlineParameters, qualified } from './sql';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { tableStatisticsSourceIdentity } from './tableStatistics';

export interface TableFilteredExportPlan { sql: string; columns: ColumnInfo[]; }
export interface PreparedTableFilteredExport {
  readonly rows: number; readonly fileCommitted: boolean;
  commit(): Promise<TableFilteredExportOutput>; dispose(): Promise<void>;
}
export interface TableFilteredExportControl { stop(): Promise<void>; onCommitStart(): void; onProgress?(rows: number): void; io?: AtomicFileIO; }
const exportTypes = new Set(['TINY', 'SHORT', 'LONG', 'INT24', 'YEAR', 'DECIMAL', 'NEWDECIMAL', 'LONGLONG', 'FLOAT', 'DOUBLE', 'NULL', 'DATE', 'NEWDATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'DATETIME2', 'TIMESTAMP2', 'TIME2', 'VARCHAR', 'VAR_STRING', 'STRING', 'ENUM', 'SET', 'JSON', 'TINY_BLOB', 'MEDIUM_BLOB', 'LONG_BLOB', 'BLOB', 'BIT']);

/** 条件复用表页原构建器和排序白名单，补完整可靠键；只生成一次无LIMIT的明确列SELECT。 */
export function planTableFilteredExport(source: TableInfo, input: TableFilteredExportInput): TableFilteredExportPlan {
  if (typeof input.metadataKey !== 'string' || Buffer.byteLength(input.metadataKey) > tableFilteredExportLimits.metadataBytes || tableCopyMetadataKey(source) !== input.metadataKey) throw Error(text.stale);
  if (!['csv', 'json', 'sql', 'xlsx'].includes(input.format) || !['utf8', 'utf16le', 'gb18030'].includes(input.encoding) || input.format === 'xlsx' && input.encoding !== 'utf8') throw Error(text.invalid);
  csvExportDelimiter(input.format, input.csvDelimiter);
  // 视图目录不能证明投影及生成表达式可写；不把只读结果伪装成可向原视图复放的INSERT。
  if (input.format === 'sql' && source.objectKind !== 'table') throw Error('无法确认视图INSERT可写性；视图请用CSV/JSON/XLSX导出。');
  const columns = input.format === 'sql' ? source.columns.filter(column => !column.generated) : source.columns;
  if (!columns.length || columns.length > limits.columns || new Set(source.columns.map(column => column.name)).size !== source.columns.length) throw Error(text.metadata);
  if (!Array.isArray(input.sort) || input.sort.length > tableFilteredExportLimits.sorts || new Set(input.sort.map(rule => rule?.column)).size !== input.sort.length || input.sort.some(rule => !rule || !source.columns.some(column => column.name === rule.column) || !['ASC', 'DESC'].includes(rule.direction))) throw Error(text.invalid);
  const sort = input.sort.map(rule => ({ column: rule.column, direction: rule.direction }));
  const order = [...sort, ...source.editableKey.filter(column => !sort.some(rule => rule.column === column)).map(column => ({ column, direction: 'ASC' as const }))];
  if (order.some(rule => !source.columns.some(column => column.name === rule.column))) throw Error(text.metadata);
  const filter = buildTableFilterSql(source, input.filters, input.filterMode, input.filterGroup);
  const sql = inlineParameters(`SELECT ${columns.map(column => identifier(column.name)).join(', ')} FROM ${qualified(source.database, source.name)}${filter.where ? ' WHERE ' + filter.where : ''}${order.length ? ' ORDER BY ' + order.map(rule => `${identifier(rule.column)} ${rule.direction}`).join(', ') : ''}`, filter.params);
  if (Buffer.byteLength(sql) > limits.sqlBytes) throw Error(text.invalid);
  return { sql, columns };
}

/** XLSX生产者与行编码器只交接一行；下一次next才确认上一行已编码并通过真实背压。 */
class ExportRowChannel implements AsyncIterableIterator<CellValue[]> {
  private pending?: { row: CellValue[]; resolve(): void; reject(error: unknown): void };
  private taken?: { resolve(): void; reject(error: unknown): void };
  private wake?: () => void;
  private failure?: { error: unknown };
  private ended = false;
  [Symbol.asyncIterator](): AsyncIterableIterator<CellValue[]> { return this; }
  async write(row: CellValue[]): Promise<void> {
    if (this.failure) throw this.failure.error;
    if (this.ended || this.pending || this.taken) throw Error('Excel原行背压协议无效');
    return new Promise<void>((resolve, reject) => { this.pending = { row, resolve, reject }; this.wake?.(); this.wake = undefined; });
  }
  async next(): Promise<IteratorResult<CellValue[]>> {
    this.taken?.resolve(); this.taken = undefined;
    for (;;) {
      if (this.failure) throw this.failure.error;
      if (this.pending) { const item = this.pending; this.pending = undefined; this.taken = item; return { done: false, value: item.row }; }
      if (this.ended) return { done: true, value: undefined };
      await new Promise<void>(resolve => { this.wake = resolve; });
    }
  }
  end(): void { this.ended = true; this.wake?.(); this.wake = undefined; }
  fail(error: unknown): void { this.failure ??= { error }; this.pending?.reject(error); this.pending = undefined; this.taken?.reject(error); this.taken = undefined; this.wake?.(); this.wake = undefined; }
  async return(): Promise<IteratorResult<CellValue[]>> { this.fail(Error('Excel行消费者已停止')); return { done: true, value: undefined }; }
}

/** 单行字段由原binary协议带入；保留负零、字符串精度及原二进制包装，不改写为空值。 */
function encodedCell(value: CellValue, format: 'csv' | 'json', delimiter: CsvExportDelimiter): string {
  if (value === undefined || typeof value === 'number' && !Number.isFinite(value)) throw Error('服务器导出字段不是完整有限值');
  const encoded = typeof value === 'number' && Object.is(value, -0) ? '-0' : format === 'csv' ? csvCell(value, delimiter) : JSON.stringify(value);
  if (encoded === undefined || Buffer.byteLength(encoded) > limits.fieldBytes) throw Error('完整导出单个序列化字段超过8MiB');
  return encoded;
}

/** 独立只读事务固定MDL后核来源；返回的只是完整暂存，数据库严格关闭前没有文件替换能力调用。 */
export async function prepareTableFilteredExport(context: StructureTaskContext, input: TableFilteredExportInput & { filePath: string }, control: TableFilteredExportControl): Promise<PreparedTableFilteredExport> {
  const check = context.checkCancelled;
  await structureTaskQuery(context, 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await structureTaskQuery(context, 'START TRANSACTION READ ONLY');
  // 获取真实目标MDL，随后目录、全量数据与后核全部属于同一独立连接/事务。
  await structureTaskQuery(context, `SELECT 1 FROM ${qualified(input.database, input.table)} LIMIT 0`);
  const source = await readIncomingReferenceTable(context, input, true), identity = tableStatisticsSourceIdentity(source, context), plan = planTableFilteredExport(source, input);
  const reservation = await AtomicFileTargetReservation.reserve(input.filePath);
  let file: AtomicFile;
  try { file = await AtomicFile.create(input.filePath, input.format === 'xlsx' ? 'utf8' : input.encoding, check, control.onCommitStart, control.io, input.format === 'xlsx' ? EXCEL_LIMITS.maxCompressedBytes : limits.fileBytes, reservation, true); }
  catch (error) { if (!(error instanceof AggregateError)) reservation.release(); throw error; }
  let rows = 0, starts = 0, ends = 0, warningCount: number | undefined, columnsStarted = false;
  const channel = input.format === 'xlsx' ? new ExportRowChannel() : undefined;
  let excel: Promise<{ rows: number; bytes: number }> | undefined;
  let insert: QueryInsertFile | undefined;
  const delimiter = csvExportDelimiter(input.format, input.csvDelimiter);
  try {
    if (input.format === 'sql') insert = new QueryInsertFile({ database: source.database, table: source.name, columns: plan.columns.map(column => column.name) }, sql => file.write(sql));
    if (input.format !== 'xlsx' && input.encoding === 'utf16le') await file.write('\uFEFF');
    if (input.format === 'csv') await file.write(plan.columns.map(column => csvHeader(column.name, delimiter)).join(delimiter) + '\r\n');
    if (input.format === 'json') await file.write('[\n');
    if (input.format === 'sql') await file.write('-- DBArk：当前服务器筛选全部匹配行，仅数据INSERT，不含表结构。\n-- 执行前请核对会话设置：若包含自增列零值，sql_mode必须包含NO_AUTO_VALUE_ON_ZERO，避免零值被重新分配。\n-- TIMESTAMP再次执行时，目标会话时区必须与源导出会话一致；请先核对源、目标@@SESSION.time_zone及实际时区规则。\n-- 本文件不自动切换或恢复sql_mode、时区等会话设置；未承诺通用恢复或跨时区无损恢复。\n');
    if (channel) {
      excel = exportExcelFile({ filePath: input.filePath, columns: plan.columns.map(column => ({ name: column.name, type: column.type })), rows: channel, deferredAtomicFile: file, checkCancelled: check, onCommitStart: control.onCommitStart });
      // 文件/ZIP错误立即拒绝正在等待的原行生产者，consumeQueryFrames负责原命令停止及真实终态。
      void excel.catch(error => { channel.fail(error); });
    }
    await consumeQueryFrames(context.managed, plan.sql, 'binary', {
      statementOrdinal: 1, ordinals: { results: 0, rows: 0 }, checkCancelled: check, commandStarted: context.commandStarted, stop: control.stop,
      async consume(frame: QueryExportFrame) {
        check();
        if (frame.kind === 'rows-start') {
          if (++starts !== 1 || frame.resultOrdinal !== 1 || frame.rowResultOrdinal !== 1 || frame.columns.length !== plan.columns.length || frame.columns.some((column, index) => column.name !== plan.columns[index].name || column.position !== index + 1 || !exportTypes.has(column.type))) throw Error(text.metadata);
          columnsStarted = true;
        } else if (frame.kind === 'row') {
          if (!columnsStarted || ends || frame.resultOrdinal !== 1 || frame.values.length !== plan.columns.length || !Number.isSafeInteger(rows + 1)) throw Error(text.invalid);
          if (channel) await channel.write(frame.values);
          else if (!insert) {
            const cells = frame.values.map(value => encodedCell(value, input.format as 'csv' | 'json', delimiter));
            const line = input.format === 'json' ? (rows ? ',\n' : '') + '{' + plan.columns.map((column, index) => JSON.stringify(column.name) + ':' + cells[index]).join(',') + '}' : cells.join(delimiter) + '\r\n';
            if (Buffer.byteLength(line) > limits.rowBytes) throw Error('完整导出序列化单行超过16MiB');
            await file.write(line);
          }
          rows++; if (rows % 100 === 0) control.onProgress?.(rows);
        } else if (frame.kind === 'rows-end') { if (++ends !== 1 || starts !== 1 || frame.resultOrdinal !== 1) throw Error(text.invalid); warningCount = frame.warningCount; }
        else throw Error(text.invalid);
        if (insert) await insert.consume(frame);
      },
    });
    const warnings = (await structureTaskQuery<unknown>(context, 'SHOW WARNINGS LIMIT 21')).rows;
    if (!Array.isArray(warnings) || warnings.length || warningCount !== 0 || starts !== 1 || ends !== 1) throw Error('服务器完整导出存在警告或无法确认原终包，原文件保持');
    channel?.end(); if (excel) { const complete = await excel; if (complete.rows !== rows) throw Error(text.invalid); }
    if (input.format === 'json') await file.write('\n]\n');
    if (insert && insert.rowsWritten !== rows) throw Error(text.invalid);
    const after = await readIncomingReferenceTable(context, input, true), afterIdentity = tableStatisticsSourceIdentity(after, context);
    if (tableCopyMetadataKey(after) !== input.metadataKey || identity.digest !== afterIdentity.digest || identity.conservative !== afterIdentity.conservative) throw Error(text.stale);
    await structureTaskQuery(context, 'ROLLBACK AND NO CHAIN NO RELEASE'); check();
    if (!channel) await file.prepare(true);
    check();
    return { rows, get fileCommitted() { return file.fileCommitted; }, async commit() { check(); await file.commit(); return { rows, fileCommitted: true }; }, async dispose() { await file.dispose(); reservation.release(); } };
  } catch (error) {
    channel?.fail(error); if (excel) await excel.catch(() => undefined);
    try { await file.dispose(); reservation.release(); } catch (cleanup) { throw new AggregateError([error, cleanup], '导出失败且原暂存资源未确认清理', { cause: error }); }
    throw error;
  }
}
