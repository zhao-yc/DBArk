import type { QueryOutcome } from '../shared/contracts';
import { parseQueryAnalyzePlan, queryAnalyzeCapability, queryAnalyzeLimits } from '../shared/queryAnalyze';
import { explainStatement, type ExplainContext } from './queryExplain';

/** 实际执行分析与估算计划分开；用户必须明确确认，且只向原会话发送一次冻结语句。 */
export async function analyzeQuery(sql: string, acknowledged: boolean, context: ExplainContext): Promise<QueryOutcome> {
  if (acknowledged !== true) throw Error('实际执行分析需要明确确认；该操作会真正执行 SQL，并可能修改数据');
  context.check();
  const capability = queryAnalyzeCapability(context.status);
  if (!capability.supported || !capability.sqlPrefix || !capability.format) throw Error(capability.reason || '当前服务器不支持实际执行分析');
  const statement = explainStatement(sql, context.mode), started = performance.now();
  // 扫描大语句之后再核取消；任何格式、权限或网络失败都原样返回，不回退或重放。
  context.check();
  const results = await context.run(capability.sqlPrefix + ' ' + statement);
  context.check();

  const first = results[0], cell = first?.rows[0]?.[first.columns[0]?.key];
  const invalidShape = results.length !== 1 || first?.columns.length !== 1 || first?.rows.length !== 1 || typeof cell !== 'string';
  const truncated = results.some(result => result.truncated);
  const overBudget = typeof cell === 'string' && Buffer.byteLength(cell) > queryAnalyzeLimits.rawBytes;
  const analysis = parseQueryAnalyzePlan(typeof cell === 'string' ? cell : '', context.status.dialect, context.status.version, capability.format, invalidShape || truncated);
  // 服务器/传输的截断事实优先于局部可解析性，不能把完整前缀误作全部执行计划。
  if (invalidShape || truncated || overBudget) {
    analysis.nodes = [];
    analysis.rawTruncated = true;
    if (invalidShape) analysis.warnings.push('实际执行分析结果不是预期的单行单列计划；请核对原始结果表格，未生成树');
    if (truncated) analysis.warnings.push('原始分析结果受到查询传输预算限制，不能作为完整计划；本次未自动重发 SQL');
    if (overBudget) analysis.warnings.push('实际执行分析计划超过原文展示预算，未从截断前缀生成树；本次未自动重发 SQL');
  }
  return { results, elapsedMs: performance.now() - started, analysis };
}
