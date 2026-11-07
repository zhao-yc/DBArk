import type { SqliteDriverSession, SqliteExecuteOptions } from '../engine/sqlite/session';
import { SqliteDriverError } from '../engine/sqlite/session';
import type { SqliteStatementResult, SqliteValue } from '../engine/sqlite/protocol';
import { sqliteNamedParameterNames } from '../engine/sqlite/parameters';
import type { QueryScriptReport } from '../shared/queryContinueOnError';
import { queryContinueOnErrorLimits } from '../shared/queryContinueOnError';
import type { SqlStatementRange } from '../shared/sqlScriptScanner';

type Statement = Parameters<NonNullable<SqliteExecuteOptions['onStatement']>>[0];
type Batch = Parameters<NonNullable<SqliteExecuteOptions['onBatch']>>[0];
interface ScriptControl {
  cancelled(): boolean;
  budget(): {rows: number; bytes: number};
  statement(header: Statement): void;
  batch(batch: Batch): void;
  discard(): void;
}

/** 普通 SQL、约束和类型错误可续执行。锁、I/O、权限及未知错误保守停止。 */
function sqliteCanContinue(code: number): boolean {
  return code === 1 || code === 20 || (code & 255) === 19;
}

/** 始终在原物理连接上逐条执行，上一条的原生终态确认后才发送下一条。 */
export async function continueSqliteScript(driver: SqliteDriverSession, source: string, ranges: SqlStatementRange[],
  namedParameters: Record<string, SqliteValue> | undefined, resultLimit: number, control: ScriptControl) {
  const facts: SqliteStatementResult[] = [], ordinals: number[] = [];
  const report: QueryScriptReport = {mode: 'continue-on-error', statementsAttempted: 0, statementsCompleted: 0, reachedEnd: false, errors: []};
  let cancelled = false;
  const stop = (message: string, range: SqlStatementRange, ordinal: number) => {
    report.stopReason = message;
    if (report.errors.length < queryContinueOnErrorLimits.errors) report.errors.push({
      kind: 'stopped', statementOrdinal: ordinal, statementsCompleted: facts.length, message,
      sourceRange: {start: range.start, end: range.delimiterEnd},
    });
  };
  for (const [index, range] of ranges.entries()) {
    const ordinal = index + 1;
    if (control.cancelled()) { cancelled = true; stop('SQLite 脚本已取消', range, ordinal); break; }
    if (report.errors.length === queryContinueOnErrorLimits.errors) { stop('SQLite 脚本已记录 100 项错误', range, ordinal); break; }
    if (facts.length === resultLimit) { stop('SQLite 完整结果已达 200 项上限', range, ordinal); break; }
    const sql = source.slice(range.start, range.delimiterEnd);
    const budget = control.budget();
    report.statementsAttempted++;
    try {
      const bindings = namedParameters && Object.fromEntries(sqliteNamedParameterNames(sql).map(name => [':' + name, namedParameters[':' + name]]));
      const result = await driver.execute(sql, {
        singleStatement: true, captureQueryReceipt: true, ...(bindings ? {namedParameters: bindings} : {}),
        maxRows: Math.max(1, budget.rows), maxBytes: Math.max(1, budget.bytes), batchRows: 200,
        onStatement: header => control.statement({...header, index: facts.length}),
        onBatch: batch => control.batch({...batch, index: facts.length}),
      });
      const [fact] = result.statements;
      const receipt = fact?.queryReceipt;
      if (result.statements.length !== 1 || !receipt || fact.index !== 0) throw Error('SQLite 单条执行缺少完整原生回执');
      const {start, end} = receipt.sourceRange;
      facts.push({...fact, index: facts.length, queryReceipt: {...receipt, sourceRange: {start: range.start + start, end: range.start + end}}});
      ordinals.push(ordinal);
      report.statementsCompleted = facts.length;
    } catch (reason) {
      control.discard();
      const code = reason instanceof SqliteDriverError ? reason.code : '';
      const native = /^SQLITE_NATIVE_(\d+)$/.exec(code);
      cancelled = control.cancelled() || code === 'SQLITE_CANCELLED' || code === 'SQLITE_CANCELLED_SESSION_CLOSED';
      if (!cancelled && native && reason instanceof SqliteDriverError && driver.isUsable && reason.transaction !== null && sqliteCanContinue(Number(native[1]))) {
        report.errors.push({kind: 'server', statementOrdinal: ordinal, statementsCompleted: facts.length,
          message: 'SQLite 语句失败（' + code + '）', sourceRange: {start: range.start, end: range.delimiterEnd}});
      } else {
        const message = cancelled ? 'SQLite 脚本已取消' : native ? 'SQLite 原生错误要求停止（' + code + '）'
          : 'SQLite 未确认语句或连接的执行终态，已停止脚本';
        stop(message, range, ordinal);
        break;
      }
    }
  }
  report.reachedEnd = report.stopReason === undefined;
  return {facts, ordinals, report, cancelled, transaction: driver.isUsable ? driver.transaction ?? undefined : undefined};
}
