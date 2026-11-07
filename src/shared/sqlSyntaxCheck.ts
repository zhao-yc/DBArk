/** 本地解析器只报告自身语法提示，不证明服务器版本、权限或对象有效。 */
export const sqlSyntaxCheckLimits = { sourceUnits: 262144, tokens: 16384, depth: 64, issues: 100, statements: 256 } as const;
export const sqlSyntaxIssueCodes = ['syntax', 'incomplete', 'unclosed-string', 'unclosed-identifier', 'unclosed-comment', 'sqlite-prepare', 'sqlite-unchecked', 'sqlite-incomplete'] as const;
export const sqlSyntaxBlockedReasons = ['input', 'budget', 'mode', 'dynamic-mode', 'executable-comment', 'client-command', 'delimiter', 'unsupported', 'parser', 'position', 'stale', 'context', 'cancelled', 'worker', 'startup-timeout', 'timeout', 'disposed', 'replaced'] as const;
export type SqlSyntaxIssueCode = typeof sqlSyntaxIssueCodes[number];
export type SqlSyntaxBlockedReason = typeof sqlSyntaxBlockedReasons[number];
export interface SqlSyntaxIssue { start: number; end: number; code: SqlSyntaxIssueCode; }
export type SqlSyntaxCheckResult = { status: 'ready'; issues: SqlSyntaxIssue[]; statementCount: number } | { status: 'blocked'; reason: SqlSyntaxBlockedReason };

/** 只读自身可枚举数据字段，拒绝原型实例、访问器、Symbol及额外隐藏内容。 */
function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) return false;
  const names = Reflect.ownKeys(value);
  return names.length === keys.length && names.every(key => typeof key === 'string' && keys.includes(key) && (() => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return !!descriptor?.enumerable && 'value' in descriptor; })());
}

/** 定位不能切开代理对或CRLF；EOF保留为合法零宽位置，由界面按原模型展示。 */
export function sqlSyntaxBoundary(source: string, offset: number): boolean {
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= source.length && !(offset > 0 && offset < source.length && (/[\uD800-\uDBFF]/.test(source[offset - 1]) && /[\uDC00-\uDFFF]/.test(source[offset]) || source[offset - 1] === '\r' && source[offset] === '\n'));
}

/** 线程结果绑定原文范围和固定代码，不能夹带SQL、服务器错误、路径或任意操作。 */
export function validSqlSyntaxCheckResult(value: unknown, source: string): value is SqlSyntaxCheckResult {
  if (typeof source !== 'string') return false;
  if (record(value, ['status', 'reason']) && value.status === 'blocked') return typeof value.reason === 'string' && sqlSyntaxBlockedReasons.includes(value.reason as SqlSyntaxBlockedReason);
  if (!record(value, ['status', 'issues', 'statementCount']) || value.status !== 'ready' || source.length > sqlSyntaxCheckLimits.sourceUnits || source.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source) || !Number.isSafeInteger(value.statementCount) || Number(value.statementCount) < 0 || Number(value.statementCount) > sqlSyntaxCheckLimits.statements) return false;
  const issues = value.issues;
  if (!Array.isArray(issues) || Object.getPrototypeOf(issues) !== Array.prototype || issues.length > sqlSyntaxCheckLimits.issues || Reflect.ownKeys(issues).length !== issues.length + 1) return false;
  let previous: SqlSyntaxIssue | undefined;
  for (let index = 0; index < issues.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(issues, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) return false;
    const issue = descriptor.value;
    if (!record(issue, ['start', 'end', 'code']) || typeof issue.start !== 'number' || typeof issue.end !== 'number' || !sqlSyntaxBoundary(source, issue.start) || !sqlSyntaxBoundary(source, issue.end) || issue.end < issue.start || typeof issue.code !== 'string' || !sqlSyntaxIssueCodes.includes(issue.code as SqlSyntaxIssueCode)) return false;
    if (previous && (issue.start < previous.start || issue.start === previous.start && (issue.end < previous.end || issue.end === previous.end && issue.code <= previous.code))) return false;
    previous = issue as unknown as SqlSyntaxIssue;
  }
  return true;
}
