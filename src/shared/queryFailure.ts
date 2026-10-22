export interface QueryFailureSourceRange { start: number; end: number; }
export interface QueryFailure { statementOrdinal: number; statementsCompleted: number; message: string; sourceRange?: QueryFailureSourceRange; }
export const queryFailureMessageLimit = 32 * 1024;

/** 先固定执行事实，再有界保留错误详情；截断不能拆开UTF16代理对或抹去首错停止事实。 */
export function queryFailureMessage(statementsCompleted: number, detail: string): string {
  const prefix = `第 ${statementsCompleted + 1} 条 SQL 未完成；已完成 ${statementsCompleted} 条，此前已提交语句保留，未自动回滚或重放。`;
  const source = prefix + detail;
  if (source.length <= queryFailureMessageLimit) return source;
  const suffix = '\n[错误详情已截断]', limit = queryFailureMessageLimit - suffix.length;
  const end = /[\ud800-\udbff]/.test(source[limit - 1]) && /[\udc00-\udfff]/.test(source[limit]) ? limit - 1 : limit;
  return source.slice(0, end) + suffix;
}
