import type { ConnectionStatus, QueryOutcome, QueryResult } from '../shared/contracts';
import type { SqlLexicalMode } from '../shared/queryParameters';
import { explainLimits, parseExplainPlan, type ExplainPlan } from '../shared/explain';
import { splitSql } from './sql';

export interface ExplainContext {
  status: ConnectionStatus; mode: SqlLexicalMode;
  run(sql: string): Promise<QueryResult[]>;
  check(): void; reusable(): boolean;
}
/** 版本来自真实连接握手；未知版本采取文本模式，绝不暗建连接探测。 */
export function explainCapability(status: ConnectionStatus): boolean {
  const version = /^(\d+)\.(\d+)/.exec(status.version.replace(/^5\.5\.5-/, ''));
  if (!version) return false;
  const major = Number(version[1]), minor = Number(version[2]);
  return status.dialect === 'mysql' ? major > 5 || major === 5 && minor >= 6 : major > 10 || major === 10 && minor >= 2;
}
/** 扫描器沿用原会话模式及 DELIMITER；所有用户语句只允许被 EXPLAIN 包裹。 */
export function explainStatement(sql: string, mode: SqlLexicalMode): string {
  if (typeof sql !== 'string' || Buffer.byteLength(sql) > 20 * 1024 * 1024) throw Error('执行计划 SQL 不能超过 20 MiB');
  const statements = splitSql(sql, mode.noBackslashEscapes, mode.ansiQuotes, mode.ansiQuotesKnown !== false, mode.noBackslashEscapesKnown !== false);
  if (statements.length !== 1) throw Error('执行计划一次只接受一条 SQL，请选中需要分析的语句');
  const statement = statements[0];
  if (/\/\*(?:!|M!)/i.test(statement)) throw Error('执行计划不接受可执行版本注释，请先展开注释为明确的 SQL');
  const start = statement.replace(/^(?:\s+|\/\*[\s\S]*?\*\/|--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$))*/, '');
  if (/^(?:EXPLAIN|ANALYZE)\b/i.test(start)) throw Error('执行计划不接受 EXPLAIN 或 ANALYZE 输入，ANALYZE 会实际执行 SQL');
  if (!/^(?:SELECT|WITH|INSERT|UPDATE|DELETE|REPLACE)\b/i.test(start)) throw Error('请选择 SELECT、WITH 或数据修改语句查看执行计划');
  return statement;
}
/** 仅格式能力错误回退；取消、权限、断线和普通 SQL 错误不会重发。 */
function formatUnsupported(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === 'ER_UNKNOWN_EXPLAIN_FORMAT' || code === 'ER_NOT_SUPPORTED_YET' || code === 'ER_PARSE_ERROR';
}
/** JSON 与文本都在调用方持有的同一会话任务内执行；禁止使用任何 ANALYZE 变体。 */
export async function explainQuery(sql: string, format: 'auto' | 'text', context: ExplainContext): Promise<QueryOutcome> {
  const statement = explainStatement(sql, context.mode), started = performance.now();
  const capable = explainCapability(context.status), warnings: string[] = [];
  let results: QueryResult[];
  if (format === 'auto' && capable) {
    try {
      context.check(); results = await context.run('EXPLAIN FORMAT=JSON ' + statement); context.check();
      const first = results[0], cell = first?.rows[0]?.[first.columns[0]?.key];
      let plan: ExplainPlan;
      if (typeof cell === 'string' && Buffer.byteLength(cell) <= explainLimits.jsonBytes) plan = parseExplainPlan(cell, context.status.dialect, context.status.version);
      else plan = { ...context.status, format: 'json', nodes: [], raw: '', rawTruncated: true, warnings: ['计划结果为空、格式未知或超过 192 KiB 上限，未生成树；可手动查看文本计划'] };
      if (first?.truncated) { plan.rawTruncated = true; plan.warnings.push('原始结果受到查询字节预算限制，不能作为完整计划'); }
      return { results, elapsedMs: performance.now() - started, explain: plan };
    } catch (error) {
      context.check();
      if (!context.reusable() || !formatUnsupported(error)) throw error;
      warnings.push('服务器拒绝 JSON 计划格式，已在原会话回退文本计划');
    }
  } else if (format === 'auto') warnings.push('无法确认当前服务器支持 JSON 计划，已使用文本计划');
  context.check();
  // MySQL 的 explain_format 可能被设为 TREE/JSON，显式指定 TRADITIONAL 保留原有表格。
  results = await context.run((capable && context.status.dialect === 'mysql' ? 'EXPLAIN FORMAT=TRADITIONAL ' : 'EXPLAIN ') + statement);
  context.check();
  return { results, elapsedMs: performance.now() - started, explain: { ...context.status, format: 'text', nodes: [], raw: '', rawTruncated: results.some(result => result.truncated), warnings } };
}
