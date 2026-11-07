import { isAbsolute } from 'node:path';
import type { ResultColumn } from '../../shared/contracts';
import { splitPostgresSql } from '../../shared/postgresSql';
import { resultExportColumns } from '../../shared/resultExport';
import { queryStreamExportLimits } from '../../shared/queryStreamExport';
import { postgresQueryExportSchema, type PostgresQueryExportInput, type PostgresQueryExportOutput } from '../../shared/postgresQueryExport';
import { createQueryStreamFile, type QueryStreamFile } from '../queryStreamFile';
import type { PostgresConnection } from './connection';
import { postgresParameterValues } from './parameters';

export type PostgresQueryExportRequest = PostgresQueryExportInput & {filePath: string};

/** 只消费独占只读连接的单个游标。文件在游标和会话收尾之后发布。 */
export async function exportPostgresQuery(input: PostgresQueryExportRequest,
  connect: (action: (connection: PostgresConnection) => Promise<void>) => Promise<void>,
  check: () => void, publish: () => void, progress: (rows: number) => void): Promise<PostgresQueryExportOutput> {
  const { filePath, sql, format, encoding, csvDelimiter, parameters } = input;
  postgresQueryExportSchema.parse({connectionId: input.connectionId, database: input.database, taskId: input.taskId,
    fileToken: input.fileToken, sql, format, encoding, csvDelimiter, parameters});
  if (!isAbsolute(filePath) || filePath.includes('\0')) throw Error('主进程未提供授权的导出路径');
  let file: QueryStreamFile | undefined;
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
      // 扩展协议拒绝多命令，服务端同时约束游标查询及只读事务内的写入。
      const declared = await connection.query('DECLARE dbark_query_export NO SCROLL CURSOR FOR\n' + part.sql,
        values, small, undefined, 'extended');
      if (declared.postgresCommand !== 'DECLARE') throw Error('PostgreSQL 未确认导出游标');
      const output = file = await createQueryStreamFile({filePath, format, encoding, csvDelimiter,
        resultSelection: format === 'csv' ? {kind: 'row-result', ordinal: 1} : {kind: 'all'},
        checkCancelled: check, onCommitStart: publish});
      const batchRows = 64;
      let columns: ResultColumn[] | undefined;
      for (;;) {
        check();
        const batch = await connection.query('FETCH FORWARD 64 FROM dbark_query_export', undefined,
          {rows: batchRows, bytes: queryStreamExportLimits.rowBytes * 4});
        if (batch.postgresCommand !== 'FETCH' || batch.truncated || batch.affectedRows !== batch.rows.length || !batch.columns.length)
          throw Error('PostgreSQL 导出批次不完整或超过大小预算');
        if (!columns) {
          columns = batch.columns;
          await output.write({kind: 'rows-start', resultOrdinal: 1, statementOrdinal: 1, rowResultOrdinal: 1,
            columns: resultExportColumns(columns).map((column, i) => ({...column, position: i + 1, type: columns![i].type}))});
        } else if (batch.columns.length !== columns.length || batch.columns.some((column, i) =>
          column.name !== columns![i].name || column.type !== columns![i].type)) throw Error('PostgreSQL 导出列描述已变化');
        for (const row of batch.rows) {
          await output.write({kind: 'row', resultOrdinal: 1, values: batch.columns.map(column => row[column.key])});
        }
        if (batch.rows.length < batchRows) break;
        if (output.rowsWritten % 256 === 0) progress(output.rowsWritten);
      }
      await output.write({kind: 'rows-end', resultOrdinal: 1});
      check();
      const closed = await connection.query('CLOSE dbark_query_export', undefined, small);
      if (closed.postgresCommand !== 'CLOSE') throw Error('PostgreSQL 未确认游标关闭');
      const ended = await connection.query('COMMIT', undefined, small);
      const state = connection.state();
      if (ended.postgresCommand !== 'COMMIT' || !state.transactionKnown || state.transactionOpen)
        throw Error('PostgreSQL 未确认完整读取结束');
    });
    check();
    if (!file) throw Error('PostgreSQL 导出未生成文件');
    await file.complete();
    return {rows: file.rowsWritten, fileCommitted: true};
  } finally { await file?.abort(); }
}
