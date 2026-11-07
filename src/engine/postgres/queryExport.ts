import { isAbsolute } from 'node:path';
import type { CellValue, QueryResult, ResultColumn } from '../../shared/contracts';
import { postgresIdentifier, splitPostgresSql } from '../../shared/postgresSql';
import { resultExportColumns } from '../../shared/resultExport';
import { EXCEL_LIMITS } from '../../shared/excelTransfer';
import { AtomicFile, nativeAtomicFileIO } from '../atomicFile';
import { startExcelExportRows } from '../excelExportRows';
import { queryStreamExportLimits } from '../../shared/queryStreamExport';
import { postgresQueryExportSchema, postgresQueryInsertColumnsForResult, type PostgresQueryExportInput, type PostgresQueryExportOutput } from '../../shared/postgresQueryExport';
import { createQueryStreamFile, type QueryStreamFile } from '../queryStreamFile';
import type { PostgresConnection } from './connection';
import { postgresParameterValues } from './parameters';
import { readPostgresSqlExportSettings, writePostgresSqlPreamble, writePostgresSqlRows } from './sqlExport';

export type PostgresQueryExportRequest = PostgresQueryExportInput & {filePath: string};

/** 空结果仍交一次列描述。等待当前批次落盘后才拉取下一批。 */
async function* queryExportBatches(connection: PostgresConnection, check: () => void) {
  const batchRows = 64;
  let columns: ResultColumn[] | undefined;
  for (;;) {
    check();
    const batch = await connection.query('FETCH FORWARD 64 FROM dbark_query_export', undefined,
      {rows: batchRows, bytes: queryStreamExportLimits.rowBytes * 4});
    if (batch.postgresCommand !== 'FETCH' || batch.truncated || batch.affectedRows !== batch.rows.length || !batch.columns.length)
      throw Error('PostgreSQL 导出批次不完整或超过大小预算');
    if (columns && (batch.columns.length !== columns.length || batch.columns.some((column, i) =>
      column.name !== columns![i].name || column.type !== columns![i].type))) throw Error('PostgreSQL 导出列描述已变化');
    columns = batch.columns;
    yield batch;
    if (batch.rows.length < batchRows) return;
  }
}

/** SQL 写入复用有界多行生成器，字段依据首个真实批次校验后才创建暂存。 */
async function* queryInsertRows(first: QueryResult,
  batches: ReturnType<typeof queryExportBatches>): AsyncGenerator<CellValue[]> {
  let batch = first;
  for (;;) {
    for (const row of batch.rows) yield batch.columns.map(column => row[column.key]);
    const next = await batches.next();
    if (next.done) return;
    batch = next.value;
  }
}

/** 只消费独占只读连接的单个游标。文件在游标和会话收尾之后发布。 */
export async function exportPostgresQuery(input: PostgresQueryExportRequest,
  connect: (action: (connection: PostgresConnection) => Promise<void>) => Promise<void>,
  check: () => void, publish: () => void, progress: (rows: number) => void): Promise<PostgresQueryExportOutput> {
  const { filePath, sql, format, encoding, csvDelimiter, parameters, insertTarget } = input;
  postgresQueryExportSchema.parse({connectionId: input.connectionId, database: input.database, taskId: input.taskId,
    fileToken: input.fileToken, sql, format, encoding, csvDelimiter, parameters, insertTarget});
  if (!isAbsolute(filePath) || filePath.includes('\0')) throw Error('主进程未提供授权的导出路径');
  let file: QueryStreamFile | undefined, atomic: AtomicFile | undefined;
  let excel: ReturnType<typeof startExcelExportRows> | undefined;
  let rows = 0;
  try {
    await connect(async connection => {
      check();
      const parts = splitPostgresSql(sql, connection.standardStrings);
      const part = parts[0];
      if (parts.length !== 1 || !['SELECT', 'WITH'].includes(part.keyword))
        throw Error('完整导出需要一条 SELECT 或 WITH 查询');
      const values = postgresParameterValues(part.parameters, parameters);
      const small = {rows: 0, bytes: 1024};
      const begun = await connection.query('BEGIN READ ONLY', undefined, small);
      if (begun.postgresCommand !== 'BEGIN' || !connection.state().transactionOpen) throw Error('PostgreSQL 未确认只读事务');
      check();
      const insertSettings = format === 'sql' ? await readPostgresSqlExportSettings(connection) : undefined;
      check();
      // 扩展协议拒绝多命令，服务端同时约束游标查询及只读事务内的写入。
      const declared = await connection.query('DECLARE dbark_query_export NO SCROLL CURSOR FOR\n' + part.sql,
        values, small, undefined, 'extended');
      if (declared.postgresCommand !== 'DECLARE') throw Error('PostgreSQL 未确认导出游标');
      const batches = queryExportBatches(connection, check);
      if (format === 'sql') {
        const first = await batches.next();
        if (first.done || !insertTarget || !insertSettings) throw Error('PostgreSQL INSERT 导出缺少列描述或目标');
        const target = postgresIdentifier(insertTarget.schema) + '.' + postgresIdentifier(insertTarget.table);
        const names = postgresQueryInsertColumnsForResult(insertTarget, first.value.columns.map(column => column.name));
        const columns = names.map(name => ({name, identityAlways: false}));
        const destination = atomic = await AtomicFile.create(filePath, 'utf8', check, publish, nativeAtomicFileIO, queryStreamExportLimits.fileBytes);
        const write = (chunk: string) => destination.write(chunk);
        await writePostgresSqlPreamble(insertSettings, write, '完整查询 INSERT 导出');
        rows = await writePostgresSqlRows(target, columns, queryInsertRows(first.value, batches), write, progress);
        await write('COMMIT;\n');
      } else {
        const output = file = format === 'xlsx' ? undefined : await createQueryStreamFile({filePath, format, encoding, csvDelimiter,
          resultSelection: format === 'csv' ? {kind: 'row-result', ordinal: 1} : {kind: 'all'},
          checkCancelled: check, onCommitStart: publish});
        let started = false;
        for await (const batch of batches) {
          if (!started) {
            started = true;
            const headers = resultExportColumns(batch.columns).map((column, index) => ({
              ...column, position: index + 1, type: batch.columns[index].type,
            }));
            if (output) await output.write({kind: 'rows-start', resultOrdinal: 1, statementOrdinal: 1, rowResultOrdinal: 1, columns: headers});
            else {
              atomic = await AtomicFile.create(filePath, 'utf8', check, publish, nativeAtomicFileIO, EXCEL_LIMITS.maxCompressedBytes, undefined, true);
              excel = startExcelExportRows({filePath, columns: headers.map(({exportName, type}) => ({name: exportName, type})),
                deferredAtomicFile: atomic, checkCancelled: check, onCommitStart: publish});
            }
          }
          for (const row of batch.rows) {
            const values = batch.columns.map(column => row[column.key]);
            if (output) await output.write({kind: 'row', resultOrdinal: 1, values});
            else await excel!.write(values);
            rows++;
          }
          if (batch.rows.length && rows % 256 === 0) progress(rows);
        }
        if (output) await output.write({kind: 'rows-end', resultOrdinal: 1});
        else if ((await excel!.complete()).rows !== rows) throw Error('PostgreSQL Excel 导出行数与原结果不一致');
      }
      check();
      const closed = await connection.query('CLOSE dbark_query_export', undefined, small);
      if (closed.postgresCommand !== 'CLOSE') throw Error('PostgreSQL 未确认游标关闭');
      const ended = await connection.query('COMMIT', undefined, small);
      const state = connection.state();
      if (ended.postgresCommand !== 'COMMIT' || !state.transactionKnown || state.transactionOpen)
        throw Error('PostgreSQL 未确认完整读取结束');
    });
    check();
    if (atomic) await atomic.commit();
    else if (file) await file.complete();
    else throw Error('PostgreSQL 导出未生成文件');
    return {rows, fileCommitted: true};
  } catch (reason) {
    await excel?.abort(reason);
    throw reason;
  } finally {
    await atomic?.dispose();
    await file?.abort();
  }
}
