import { sqliteDriverLimits } from './protocol';
import type { SqlStatementRange } from '../../shared/sqlScriptScanner';
import { locateSqliteStatement, scanSqliteStatementPositions, type SqliteAcceptRange } from '../../shared/sqliteStatementScanner';

/** 执行入口仍用原Buffer字节预算，不为浏览器复用额外分配20MiB编码副本。 */
function scanSqliteStatements(source: string, accept: SqliteAcceptRange): void {
  if (typeof source !== 'string' || Buffer.byteLength(source) > sqliteDriverLimits.sqlBytes) throw Error('SQLite SQL全文不能超过20MiB');
  scanSqliteStatementPositions(source, accept);
}

/** 显式目录入口最多保留原driver的1000份范围，避免20MiB短语句分配百万长期对象。 */
export function sqliteStatementRanges(source: string): SqlStatementRange[] {
  const result: SqlStatementRange[] = [];
  scanSqliteStatements(source, (start, end, delimiterStart, delimiterEnd, delimiter) => {
    if (result.length >= sqliteDriverLimits.statements) throw Error('SQLite语句范围目录超过1000项预算，请使用当前语句定位入口');
    result.push({ sql: source.slice(start, end), start, end, delimiterStart, delimiterEnd, delimiter });
  });
  return result;
}

/** Main 对原文先核对字节预算，再按与编辑器相同的 UTF-16 规则定位。 */
export function currentSqliteStatement(source: string, offset: number): SqlStatementRange | undefined {
  if (typeof source !== 'string' || Buffer.byteLength(source) > sqliteDriverLimits.sqlBytes) throw Error('SQLite SQL全文不能超过20MiB');
  return locateSqliteStatement(source, offset);
}
