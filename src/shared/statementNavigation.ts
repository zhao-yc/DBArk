import { SqlScriptScanner } from './sqlScriptScanner';
import { scanSqliteStatementPositions } from './sqliteStatementScanner';
import type { CompletionLexicalMode } from './completionLexical';

export const statementNavigationLimits = { sourceUnits: 262144, statements: 1000, previewPoints: 160 } as const;
export interface NavigableStatement { start: number; end: number; delimiterStart: number; delimiterEnd: number; }
export type StatementNavigationResult = { status: 'ready'; statements: NavigableStatement[] } | { status: 'blocked'; reason: string };
const reasons = ['input', 'budget', 'mode', 'script', 'context', 'stale', 'worker', 'cancelled', 'disposed', 'replaced', 'timeout', 'startup-timeout'];

/** 只读取固定、自有数据属性；线程不能夹带SQL、路径、命令或访问器。 */
function record(raw: unknown, keys: readonly string[]): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) return false;
  const names = Reflect.ownKeys(raw);
  return names.length === keys.length && names.every(name => typeof name === 'string' && keys.includes(name) && (() => { const field = Object.getOwnPropertyDescriptor(raw, name); return !!field?.enumerable && 'value' in field; })());
}
/** 不把NUL或坏代理项转换成另一个脚本，也不切开原UTF16／CRLF边界。 */
function sourceValid(source: unknown): source is string { return typeof source === 'string' && source.length <= statementNavigationLimits.sourceUnits && !source.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source); }
function boundary(source: string, offset: unknown): offset is number { return Number.isSafeInteger(offset) && Number(offset) >= 0 && Number(offset) <= source.length && !(Number(offset) > 0 && Number(offset) < source.length && (/[\uD800-\uDBFF]/.test(source[Number(offset) - 1]) && /[\uDC00-\uDFFF]/.test(source[Number(offset)]) || source[Number(offset) - 1] === '\r' && source[Number(offset)] === '\n')); }

/** 所有范围绑定同一原文，顺序完整、不重叠且含准确原分隔符边界；不传原SQL副本。 */
export function validStatementNavigationResult(raw: unknown, source: string): raw is StatementNavigationResult {
  if (record(raw, ['status', 'reason']) && raw.status === 'blocked') return typeof raw.reason === 'string' && reasons.includes(raw.reason);
  if (!sourceValid(source) || !record(raw, ['status', 'statements']) || raw.status !== 'ready') return false;
  const ranges = raw.statements;
  if (!Array.isArray(ranges) || Object.getPrototypeOf(ranges) !== Array.prototype || ranges.length > statementNavigationLimits.statements || Reflect.ownKeys(ranges).length !== ranges.length + 1) return false;
  let previous = 0;
  for (let index = 0; index < ranges.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(ranges, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) return false;
    const range = descriptor.value;
    if (!record(range, ['start', 'end', 'delimiterStart', 'delimiterEnd']) || !boundary(source, range.start) || !boundary(source, range.end) || !boundary(source, range.delimiterStart) || !boundary(source, range.delimiterEnd) || range.start < previous || range.end <= range.start || range.end > range.delimiterStart || range.delimiterStart > range.delimiterEnd) return false;
    if (range.delimiterStart === range.delimiterEnd && range.delimiterEnd !== source.length || range.delimiterEnd - range.delimiterStart > 16) return false;
    previous = range.delimiterEnd;
  }
  return true;
}

/** 使用真正执行路径的原扫描器；导航不会prepare、执行或预测前面SET/CALL的效果。 */
export function analyzeStatementNavigation(source: string, dialect: 'mysql' | 'mariadb' | 'sqlite', mode: CompletionLexicalMode = {}): StatementNavigationResult {
  if (typeof source === 'string' && source.length > statementNavigationLimits.sourceUnits) return { status: 'blocked', reason: 'budget' };
  if (!sourceValid(source) || !['mysql', 'mariadb', 'sqlite'].includes(dialect)) return { status: 'blocked', reason: 'input' };
  const modeKeys = mode && typeof mode === 'object' && !Array.isArray(mode) ? Reflect.ownKeys(mode).filter((key): key is string => typeof key === 'string') : [];
  if (!record(mode, modeKeys) || Object.keys(mode).some(key => !['ansiQuotes', 'noBackslashEscapes'].includes(key)) || [mode.ansiQuotes, mode.noBackslashEscapes].some(value => value !== undefined && typeof value !== 'boolean')) return { status: 'blocked', reason: 'mode' };
  const statements: NavigableStatement[] = [];
  const accept = (start: number, end: number, delimiterStart: number, delimiterEnd: number) => { if (statements.length >= statementNavigationLimits.statements) throw Error('budget'); statements.push({ start, end, delimiterStart, delimiterEnd }); };
  try {
    if (dialect === 'sqlite') scanSqliteStatementPositions(source, accept);
    else {
      const scanner = new SqlScriptScanner(mode.noBackslashEscapes === true, mode.ansiQuotes === true, mode.ansiQuotes !== undefined, mode.noBackslashEscapes !== undefined);
      const ranges = scanner.pushRanges(source, true, statementNavigationLimits.statements + 1);
      if (ranges.length > statementNavigationLimits.statements) return { status: 'blocked', reason: 'budget' };
      for (const range of ranges) accept(range.start, range.end, range.delimiterStart, range.delimiterEnd);
    }
    const result: StatementNavigationResult = { status: 'ready', statements };
    return validStatementNavigationResult(result, source) ? result : { status: 'blocked', reason: 'script' };
  } catch (reason) { return { status: 'blocked', reason: reason instanceof Error && reason.message === 'budget' ? 'budget' : 'script' }; }
}

/** 预览仅在本地从原文生成，不改分段；跳过普通前导注释，执行注释保留给用户辨认。 */
export function statementNavigationPreview(source: string, range: NavigableStatement, dialect: 'mysql' | 'mariadb' | 'sqlite'): string {
  let text = source.slice(range.start, range.end), index = 0;
  while (index < text.length) {
    const tail = text.slice(index), whitespace = dialect === 'sqlite' ? /^[\t\n\f\r \uFEFF]+/.exec(tail) : /^\s+/.exec(tail);
    if (whitespace) { index += whitespace[0].length; continue; }
    if (tail.startsWith('--') && (dialect === 'sqlite' || /[\x00-\x20\x7f]/.test(tail[2] ?? ' ')) || dialect !== 'sqlite' && tail.startsWith('#')) { const end = text.indexOf('\n', index); index = end < 0 ? text.length : end + 1; continue; }
    if (tail.startsWith('/*') && (dialect === 'sqlite' || !/^\/\*(?:!|\+|M!)/i.test(tail))) { const end = text.indexOf('*/', index + 2); if (end < 0) break; index = end + 2; continue; }
    break;
  }
  text = text.slice(index).replace(/[\t\r\n ]+/g, ' ');
  let preview = '', count = 0;
  for (const character of text) { if (count++ >= statementNavigationLimits.previewPoints) return preview + '…'; preview += character; }
  return preview;
}
