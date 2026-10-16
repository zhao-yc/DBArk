import { createHash } from 'node:crypto';
import type { DatabaseSearchPattern } from '../shared/databaseSearchPattern';
import { definitionNavigationLimits as limits, validateDefinitionNavigationResult, type DefinitionNavigationResult } from '../shared/definitionNavigation';

/** 只认可ASCII逐字符转换及其余原文不变；不猜服务器对其它Unicode字符的大小写映射。 */
function exactCaseMap(original: string, folded: unknown): folded is string {
  if (typeof folded !== 'string' || folded.length !== original.length) return false;
  for (let index = 0; index < original.length; index++) {
    const unit = original.charCodeAt(index), expected = unit >= 65 && unit <= 90 ? unit + 32 : unit;
    if (folded.charCodeAt(index) !== expected) return false;
  }
  return true;
}
/** 服务器已经判定命中；本函数只为可证明的普通文字提供有界位置，绝不重跑服务器正则。 */
export function definitionNavigationResult(sql: string, pattern: DatabaseSearchPattern, facts: { navigationText?: unknown; navigationNeedle?: unknown } = {}): DefinitionNavigationResult {
  const digest = createHash('sha256').update(sql).digest('hex');
  const unavailable = (reason: 'server-regexp' | 'case-mapping' | 'positions-unavailable'): DefinitionNavigationResult => ({ digest, status: 'unavailable', reason });
  if (Buffer.byteLength(sql) > limits.sourceBytes) return unavailable('positions-unavailable');
  if (pattern.mode === 'regexp') return unavailable('server-regexp');
  let source = sql, needle = pattern.text;
  if (!pattern.caseSensitive) {
    if (!exactCaseMap(sql, facts.navigationText) || !exactCaseMap(pattern.text, facts.navigationNeedle)) return unavailable('case-mapping');
    source = facts.navigationText; needle = facts.navigationNeedle;
  }
  if (!needle.length) return unavailable('positions-unavailable');
  const ranges: { offset: number; length: number }[] = [];
  let offset = pattern.mode === 'whole' ? source === needle ? 0 : -1 : pattern.mode === 'prefix' ? source.startsWith(needle) ? 0 : -1 : source.indexOf(needle);
  while (offset >= 0) {
    // 额外探到第201处才标记截断；恰好200处不能伪称仍有命中。
    if (ranges.length === limits.matches) return validateDefinitionNavigationResult({ digest, status: 'ready', ranges, limitReached: true }, sql);
    ranges.push({ offset, length: needle.length });
    if (pattern.mode !== 'contains') break;
    offset = source.indexOf(needle, offset + needle.length);
  }
  return ranges.length ? validateDefinitionNavigationResult({ digest, status: 'ready', ranges, limitReached: false }, sql) : unavailable('positions-unavailable');
}
