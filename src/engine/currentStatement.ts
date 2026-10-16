import type { SqlLexicalMode } from '../shared/queryParameters';
import { queryParameterLimits } from '../shared/queryParameters';
import { SqlScriptScanner, type SqlStatementRange } from './sql';

/** 扫描完整原文，模式只由调用方提供的当前会话事实决定，不预演前面的 SET/CALL。 */
export function sqlStatementRanges(source: string, mode: SqlLexicalMode): SqlStatementRange[] {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > queryParameterLimits.sqlBytes) throw new Error('SQL 模板不能超过 20 MiB');
  return new SqlScriptScanner(mode.noBackslashEscapes, mode.ansiQuotes, mode.ansiQuotesKnown !== false, mode.noBackslashEscapesKnown !== false).pushRanges(source, true);
}

/** 光标是 Monaco 原模型的 UTF-16 偏移；无有效语句时返回空，绝不退回全文或跨空白寻找下一句。 */
export function currentSqlStatement(source: string, offset: number, mode: SqlLexicalMode): SqlStatementRange | undefined {
  if (typeof source !== 'string' || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length) throw new Error('当前语句光标位置无效，请重新选择');
  if (source[offset - 1] === '\r' && source[offset] === '\n') throw new Error('当前语句光标不能位于 CRLF 换行内部');
  if (offset > 0 && offset < source.length && /[\uD800-\uDBFF]/.test(source[offset - 1]) && /[\uDC00-\uDFFF]/.test(source[offset])) throw new Error('当前语句光标不能位于 Unicode 代理对内部');
  const ranges = sqlStatementRanges(source, mode);
  // 优先选择包含当前位置的半开区间，紧邻下一句的分隔符边界因此归下一句。
  const containing = ranges.find(range => offset >= range.start && offset < range.delimiterEnd);
  if (containing) return containing;
  // 文档末尾或分隔符后立即换行的行末归刚结束的语句；其余纯空白保持不执行。
  return ranges.find(range => offset >= range.start && offset === range.delimiterEnd && (offset === source.length || source[offset] === '\r' || source[offset] === '\n'));
}
