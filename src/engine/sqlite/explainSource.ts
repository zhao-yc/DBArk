import { sqliteStatementRanges } from './currentStatement';
import { sqliteDriverLimits } from './protocol';

/** 只读取经完整SQLite词法确认的单条语句头；不prepare原SQL，不借MySQL模式或current offset猜用户意图。 */
export function sqliteExplainSource(source: string): { sql: string; sourceRange: { start: number; end: number } } {
  const ranges = sqliteStatementRanges(source);
  if (ranges.length !== 1) throw Error('SQLite执行计划只接受一条完整SELECT/VALUES/WITH或INSERT/UPDATE/DELETE/REPLACE语句');
  const selected = ranges[0]; let offset = 0;
  // 与SQLite原词法一致：仅ASCII空白及token边界BOM；NBSP/VT等不能被静默删除成合法语句头。
  while (offset < selected.sql.length) {
    if (/[ \t\n\f\r]/.test(selected.sql[offset]) || selected.sql[offset] === '\uFEFF') { offset++; continue; }
    if (selected.sql.startsWith('--', offset)) { const end = selected.sql.indexOf('\n', offset + 2); offset = end < 0 ? selected.sql.length : end + 1; continue; }
    if (selected.sql.startsWith('/*', offset)) { const end = selected.sql.indexOf('*/', offset + 2); if (end < 0) throw Error('SQLite执行计划SQL注释未闭合'); offset = end + 2; continue; }
    break;
  }
  const keyword = /^[A-Za-z_][A-Za-z0-9_$\u0080-\uFFFF]*/.exec(selected.sql.slice(offset))?.[0].toUpperCase();
  if (!keyword || !['SELECT', 'VALUES', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(keyword)) throw Error('SQLite执行计划只支持SELECT/VALUES/WITH及INSERT/UPDATE/DELETE/REPLACE，不支持PRAGMA、EXPLAIN、DDL或事务指令');
  const sql = 'EXPLAIN QUERY PLAN ' + selected.sql;
  if (Buffer.byteLength(sql) > sqliteDriverLimits.sqlBytes) throw Error('SQLite执行计划包装后的SQL超过原20MiB预算');
  return { sql, sourceRange: { start: selected.start, end: selected.end } };
}
