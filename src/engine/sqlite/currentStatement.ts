import { sqliteDriverLimits } from './protocol';
import type { SqlStatementRange } from '../../shared/sqlScriptScanner';
import { scanSqliteStatementPositions, type SqliteAcceptRange } from '../../shared/sqliteStatementScanner';

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

/** 当前入口仍支持20MiB完整原文及任意语句数量，只保留命中与必要边界候选，并扫完全文核未闭合。
 * Monaco光标沿UTF16半开区间；空白/空语句绝不回退全文或跨空白寻找相邻SQL。
 */
export function currentSqliteStatement(source: string, offset: number): SqlStatementRange | undefined {
  if (typeof source !== 'string' || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length) throw Error('SQLite当前语句光标位置无效，请重新选择');
  if (source[offset - 1] === '\r' && source[offset] === '\n') throw Error('SQLite当前语句光标不能位于CRLF换行内部');
  if (offset > 0 && offset < source.length && /[\uD800-\uDBFF]/.test(source[offset - 1]) && /[\uDC00-\uDFFF]/.test(source[offset])) throw Error('SQLite当前语句光标不能位于Unicode代理对内部');
  let containing: SqlStatementRange | undefined, boundary: SqlStatementRange | undefined;
  scanSqliteStatements(source, (start, end, delimiterStart, delimiterEnd, delimiter) => {
    if (offset >= start && offset < delimiterEnd) containing = { sql: source.slice(start, end), start, end, delimiterStart, delimiterEnd, delimiter };
    else if (offset >= start && offset === delimiterEnd && (offset === source.length || source[offset] === '\r' || source[offset] === '\n')) boundary = { sql: source.slice(start, end), start, end, delimiterStart, delimiterEnd, delimiter };
  });
  return containing ?? boundary;
}
