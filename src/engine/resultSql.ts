import type { DataRow, ResultExportData } from '../shared/contracts';
import { assertResultSqlData, resultSqlHeader, resultSqlLimits, type ResultSqlTarget } from '../shared/resultSql';
import { resultSqlZh as text } from '../shared/resultSql.zh-CN';
import { exportLiteral, identifier, qualified } from './sql';
import { postgresIdentifier } from '../shared/postgresSql';
import { postgresDdlLiteral } from '../shared/postgresCreateTable';
import type { SqliteResultStorage } from '../shared/sqliteResultStorage';
import { sqliteInsertRowWriter } from './sqlite/insertLiteral';

/** 返回文本保持为未知类型字面量，由明确映射的目标列解释，不猜测结果别名或来源类型。 */
function postgresResultLiteral(value: DataRow[string]): string {
  if (value === null) return 'NULL';
  if (typeof value === 'string') return postgresDdlLiteral(value);
  if (typeof value === 'object') return postgresDdlLiteral('\\x' + Buffer.from(value.base64, 'base64').toString('hex'));
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/** 数据预校验后复用同一逐行生成器：预览与实际文件具有相同列序和模式无关字面量。 */
export function resultSqlRowWriter(target: ResultSqlTarget, storage?: SqliteResultStorage): (row: DataRow, index: number) => string {
  if (target.dialect === 'sqlite') {
    const render = sqliteInsertRowWriter(target.database, target.table, target.columns.map(column => column.name));
    return (row, index) => render(target.columns.map((column, position) => {
      const cell = row[column.key], code = storage!.rows[index][position];
      // 生成器接收已逐格校验的类型标记，数字字符串不能按外观推断。
      return code === 'i' || code === 'r'
        ? {type: code === 'i' ? 'integer' : 'real', value: cell as string}
        : cell as string | null | {type: 'binary'; base64: string};
    }));
  }
  if (target.dialect === 'postgresql') {
    const prefix = 'INSERT INTO ' + postgresIdentifier(target.database) + '.' + postgresIdentifier(target.table) +
      ' (' + target.columns.map(column => postgresIdentifier(column.name)).join(', ') + ') VALUES (';
    return row => prefix + target.columns.map(column => postgresResultLiteral(row[column.key])).join(', ') + ');\n';
  }
  const prefix = `INSERT INTO ${qualified(target.database, target.table)} (${target.columns.map(column => identifier(column.name)).join(', ')}) VALUES (`;
  return row => prefix + target.columns.map(column => exportLiteral(row[column.key])).join(', ') + ');\n';
}
/** 只构造有界真实样例，不在内存拼接完整文件；单行仍受原1MiB输入预算限制。 */
export function previewResultSql(result: ResultExportData, target: ResultSqlTarget, storage?: SqliteResultStorage): { sql: string; shownRows: number; totalRows: number } {
  assertResultSqlData(result, target, storage);
  const header = resultSqlHeader(target);
  const render = resultSqlRowWriter(target, storage), parts: string[] = [header]; let bytes = Buffer.byteLength(header), shownRows = 0;
  for (const row of result.rows.slice(0, resultSqlLimits.previewRows)) {
    const sql = render(row, shownRows), size = Buffer.byteLength(sql);
    if (bytes + size > resultSqlLimits.previewBytes) break;
    parts.push(sql); bytes += size; shownRows++;
  }
  if (result.rows.length && !shownRows) throw Error(text.invalid);
  return { sql: parts.join(''), shownRows, totalRows: result.rows.length };
}
