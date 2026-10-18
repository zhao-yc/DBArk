import type { DataRow, ResultExportData } from '../shared/contracts';
import { assertResultSqlData, resultSqlLimits, type ResultSqlTarget } from '../shared/resultSql';
import { resultSqlZh as text } from '../shared/resultSql.zh-CN';
import { exportLiteral, identifier, qualified } from './sql';

/** 数据预校验后复用同一逐行生成器：预览与实际文件具有相同列序和模式无关字面量。 */
export function resultSqlRowWriter(target: ResultSqlTarget): (row: DataRow) => string {
  const prefix = `INSERT INTO ${qualified(target.database, target.table)} (${target.columns.map(column => identifier(column.name)).join(', ')}) VALUES (`;
  return row => prefix + target.columns.map(column => exportLiteral(row[column.key])).join(', ') + ');\n';
}
/** 只构造有界真实样例，不在内存拼接完整文件；单行仍受原1MiB输入预算限制。 */
export function previewResultSql(result: ResultExportData, target: ResultSqlTarget): { sql: string; shownRows: number; totalRows: number } {
  assertResultSqlData(result, target);
  const render = resultSqlRowWriter(target), parts: string[] = [text.header]; let bytes = Buffer.byteLength(text.header), shownRows = 0;
  for (const row of result.rows.slice(0, resultSqlLimits.previewRows)) {
    const sql = render(row), size = Buffer.byteLength(sql);
    if (bytes + size > resultSqlLimits.previewBytes) break;
    parts.push(sql); bytes += size; shownRows++;
  }
  if (result.rows.length && !shownRows) throw Error(text.invalid);
  return { sql: parts.join(''), shownRows, totalRows: result.rows.length };
}
