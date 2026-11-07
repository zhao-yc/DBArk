import { sqlSyntaxCheckLimits as limits, type SqlSyntaxCheckResult, type SqlSyntaxIssue } from '../../shared/sqlSyntaxCheck';
import { scanSqliteStatementPositions } from '../../shared/sqliteStatementScanner';
import type { SqliteRawStatement } from './rawStatement';

function skipTrivia(sql: string, offset = 0): number {
  while (offset < sql.length) {
    if (/[ \t\n\r\f;\uFEFF]/.test(sql[offset])) { offset++; continue; }
    if (sql.startsWith('--', offset)) { const end = sql.indexOf('\n', offset + 2); offset = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', offset)) { const end = sql.indexOf('*/', offset + 2); if (end < 0) break; offset = end + 2; continue; }
    break;
  }
  return offset;
}

/** 某些 PRAGMA 在 prepare 阶段生效，包括带 EXPLAIN 包装的语句。 */
function skipPreparation(sql: string): boolean {
  let offset = 0;
  const keyword = () => {
    offset = skipTrivia(sql, offset);
    const token = /^[A-Za-z_][A-Za-z0-9_$\u0080-\uFFFF]*/.exec(sql.slice(offset))?.[0] ?? '';
    offset += token.length;
    return token.toUpperCase();
  };
  let command = keyword();
  if (command === 'EXPLAIN') {
    command = keyword();
    if (command === 'QUERY' && keyword() === 'PLAN') command = keyword();
  }
  return ['PRAGMA', 'ATTACH', 'DETACH'].includes(command);
}

/** 只编译并释放当前语句，不绑定或步进用户 SQL，也不执行前句来补后句的目录。 */
export async function checkSqliteSyntax(sql: string, prepare: (source: string) => SqliteRawStatement, next: () => Promise<void>): Promise<SqlSyntaxCheckResult> {
  if (typeof sql !== 'string' || sql.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(sql))
    return {status: 'blocked', reason: 'input'};
  if (sql.length > limits.sourceUnits) return {status: 'blocked', reason: 'budget'};
  const ranges: {start: number; end: number}[] = [];
  const budget = new Error();
  let incomplete: SqlSyntaxIssue | undefined;
  try {
    scanSqliteStatementPositions(sql, (start, _end, _delimiterStart, end) => {
      if (ranges.length >= limits.statements) throw budget;
      ranges.push({start, end});
    });
  } catch (reason) {
    if (reason === budget || ranges.length >= limits.statements) return {status: 'blocked', reason: 'budget'};
    if (!(reason instanceof Error) || !/未闭合|括号未配对|括号内出现非法|触发器END后/.test(reason.message))
      return {status: 'blocked', reason: 'unsupported'};
    incomplete = {start: skipTrivia(sql, ranges.at(-1)?.end ?? 0), end: sql.length, code: 'sqlite-incomplete'};
  }
  const issues: SqlSyntaxIssue[] = [];
  for (const range of ranges) {
    const source = sql.slice(range.start, range.end);
    if (skipPreparation(source)) issues.push({...range, code: 'sqlite-unchecked'});
    else {
      let statement: SqliteRawStatement | undefined;
      try {
        statement = prepare(source);
        if (!statement.hasStatement || skipTrivia(source, statement.sourceSQL.length) !== source.length)
          return {status: 'blocked', reason: 'position'};
      } catch (reason) {
        const code = reason && typeof reason === 'object' && 'errcode' in reason ? reason.errcode : undefined;
        const native = typeof code === 'number' && Number.isSafeInteger(code) && code > 0 ? code & 255 : undefined;
        if (native === 1 || native === 20) issues.push({...range, code: 'sqlite-prepare'});
        else if (native === 23 || native === 8) issues.push({...range, code: 'sqlite-unchecked'});
        else return {status: 'blocked', reason: 'context'};
      } finally { statement?.finish(); }
    }
    if (issues.length > limits.issues) return {status: 'blocked', reason: 'budget'};
    await next();
  }
  if (incomplete) issues.push(incomplete);
  return issues.length <= limits.issues ? {status: 'ready', issues, statementCount: ranges.length + (incomplete ? 1 : 0)}
    : {status: 'blocked', reason: 'budget'};
}
