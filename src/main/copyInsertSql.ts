import { exportLiteral, identifier, qualified } from '../engine/sql';
import { assertCopyInsertSqlInput, copyInsertNumericLiteral, copyInsertSqlLimits } from '../shared/copyInsertSql';
import { copyInsertSqlZh as text } from '../shared/copyInsertSql.zh-CN';

/** 复用 SQL 导出字面量：字符串使用 UTF-8 十六进制，二进制使用 X，独立于 SQL mode。 */
export function buildCopyInsertSql(input: unknown): string {
  assertCopyInsertSqlInput(input);
  const prefix = `INSERT INTO ${qualified(input.database, input.table)} (${input.columns.map(column => identifier(column.name)).join(', ')}) VALUES (`;
  let bytes = 0; const statements: string[] = [];
  for (const row of input.rows) {
    const statement = prefix + input.columns.map(column => copyInsertNumericLiteral(column, row[column.name]) ?? exportLiteral(row[column.name])).join(', ') + ');';
    bytes += Buffer.byteLength(statement, 'utf8') + (statements.length ? 1 : 0);
    if (bytes > copyInsertSqlLimits.sqlBytes) throw new Error(text.limit);
    statements.push(statement);
  }
  return statements.join('\n');
}
/** 同步构建全部内容后只发起一次写入并返回原生完成结果；不读剪贴板、不访问连接或执行 SQL。 */
export function copyInsertSql(input: unknown, writeText: (sql: string) => void | Promise<void>): void | Promise<void> {
  const sql = buildCopyInsertSql(input);
  // Electron 的原生写入可能异步失败；返回同一个 Promise，由 IPC 如实报告，不提前宣告成功。
  return writeText(sql);
}
