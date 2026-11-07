import { sqliteStatementRanges } from './currentStatement';
import { sqliteDriverLimits } from './protocol';
import { sqliteLeadingKeyword } from '../../shared/sqliteStatementScanner';

/** 只读取经完整SQLite词法确认的单条语句头；不prepare原SQL，不借MySQL模式或current offset猜用户意图。 */
export function sqliteExplainSource(source: string): { sql: string; sourceRange: { start: number; end: number } } {
  const ranges = sqliteStatementRanges(source);
  if (ranges.length !== 1) throw Error('SQLite执行计划只接受一条完整SELECT/VALUES/WITH或INSERT/UPDATE/DELETE/REPLACE语句');
  const selected = ranges[0];
  const keyword = sqliteLeadingKeyword(selected.sql);
  if (!keyword || !['SELECT', 'VALUES', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(keyword)) throw Error('SQLite执行计划只支持SELECT/VALUES/WITH及INSERT/UPDATE/DELETE/REPLACE，不支持PRAGMA、EXPLAIN、DDL或事务指令');
  const sql = 'EXPLAIN QUERY PLAN ' + selected.sql;
  if (Buffer.byteLength(sql) > sqliteDriverLimits.sqlBytes) throw Error('SQLite执行计划包装后的SQL超过原20MiB预算');
  return { sql, sourceRange: { start: selected.start, end: selected.end } };
}
