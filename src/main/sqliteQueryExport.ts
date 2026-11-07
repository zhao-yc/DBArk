import { sqliteQueryInsertColumnsForResult, type SqliteQueryExportInput } from '../shared/sqliteQueryExport';
import { validateSqliteQueryParameters } from '../shared/sqliteQueryParameters';
import { resultExportColumns } from '../shared/resultExport';
import { startExcelExportRows } from '../engine/excelExportRows';
import { csvExportDelimiter } from '../shared/csvExport';
import { csvCell, csvHeader } from '../engine/files';
import { sqliteQueryExportParameterNames } from '../engine/sqlite/parameters';
import { sqliteInsertRowWriter } from '../engine/sqlite/insertLiteral';
import type { SqliteValue } from '../engine/sqlite/protocol';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteExportDestination, SqliteTableExportFile } from './sqliteTableExport';
import { sqliteWorkspaceValue } from './sqliteQuerySession';
import { dataMarkupWriter } from '../engine/dataMarkupExport';

export type SqliteQueryExportRequest = SqliteQueryExportInput & SqliteExportDestination;

/** 在打开源库及分配文件前验证全部值；用户 SQL 始终原样交给只读驱动。 */
export function sqliteQueryExportBindings(input: SqliteQueryExportInput): Record<string, SqliteValue> {
  const {names} = sqliteQueryExportParameterNames(input.sql);
  const values = validateSqliteQueryParameters(input.parameters ?? []);
  if (values.size !== names.length || names.some(name => !values.has(name))) throw Error('SQLite 导出参数必须完整匹配模板中的 :name');
  return Object.fromEntries(names.map(name => [':' + name, values.get(name)!]));
}

/** 只在收到原生列定义后打开暂存，按批次落盘。真正发布由任务在确认只读进程退出后处理。 */
export async function prepareSqliteQueryExport(driver: SqliteDriverSession, input: SqliteQueryExportRequest,
  namedParameters: Record<string, SqliteValue>, file: SqliteTableExportFile, check: () => void, progress: (rows: number) => void): Promise<number> {
  const markup = dataMarkupWriter(input.format);
  const delimiter = csvExportDelimiter(input.format, input.csvDelimiter);
  let columns: string[] | undefined;
  let excel: ReturnType<typeof startExcelExportRows> | undefined;
  let insertRow: ReturnType<typeof sqliteInsertRowWriter> | undefined;
  let count = 0;
  try {
    check();
    const result = await driver.streamQuery(input.sql, {
      namedParameters, batchRows: 100,
      onStatement: async statement => {
        check();
        if (statement.index !== 0 || columns || !statement.columns.length) throw Error('SQLite 查询导出必须恰好产生一组查询结果');
        columns = statement.columns.map(column => column.name);
        if (input.format === 'json' && new Set(columns).size !== columns.length) throw Error('JSON 导出需要不同的列名，请为重名列设置别名或选择 CSV／Excel／HTML');
        if (input.format === 'sql') {
          const target = input.insertTarget!;
          insertRow = sqliteInsertRowWriter(target.database, target.table, sqliteQueryInsertColumnsForResult(target, columns));
        }
        await file.open();
        if (input.format === 'xlsx') {
          const headers = resultExportColumns(columns.map((name, index) => ({key: String(index), name})));
          excel = startExcelExportRows({filePath: input.filePath, columns: headers.map(({exportName}) => ({name: exportName, type: 'SQLITE'})),
            deferredAtomicFile: file.excelFile(), checkCancelled: check, onCommitStart: () => { throw Error('SQLite Excel 不能自行发布文件'); }});
        } else if (insertRow) await file.write('-- SQLite 完整查询结果\n');
        else if (markup) {
          const headers = input.format === 'xml' ? columns : resultExportColumns(columns.map((name, index) => ({key: String(index), name}))).map(column => column.exportName);
          await file.write(markup.documentStart() + markup.tableStart(headers));
        }
        else {
          if (input.encoding === 'utf16le') await file.write('\uFEFF');
          await file.write(input.format === 'csv' ? columns.map(name => csvHeader(name, delimiter)).join(delimiter) + '\r\n' : '[');
        }
      },
      onBatch: async batch => {
        check();
        if (batch.index !== 0 || !columns) throw Error('SQLite 查询导出结果与原生列定义不一致');
        for (const row of batch.rows) {
          check();
          if (row.length !== columns.length || !Number.isSafeInteger(count + 1)) throw Error('SQLite 查询导出行或计数无效');
          if (insertRow) await file.write(insertRow(row));
          else {
            const values = row.map(sqliteWorkspaceValue);
            if (excel) await excel.write(values);
            else if (markup) await file.write(markup.row(values));
            else await file.write(input.format === 'csv' ? values.map(value => csvCell(value, delimiter)).join(delimiter) + '\r\n'
              : (count ? ',\n' : '') + '{' + columns.map((name, index) => JSON.stringify(name) + ':' + JSON.stringify(values[index])).join(',') + '}');
          }
          count++;
        }
        progress(count);
      },
    });
    check();
    if (!columns || result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== count) {
      throw Error('SQLite 查询导出未取得完整原生结果，文件未发布');
    }
    if (excel && (await excel.complete()).rows !== count) throw Error('SQLite Excel 导出行数与原结果不一致');
    if (input.format === 'json') await file.write('\n]\n');
    if (markup) await file.write(markup.tableEnd(count) + markup.documentEnd);
    return count;
  } catch (reason) {
    await excel?.abort(reason);
    throw reason;
  }
}
