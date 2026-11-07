import { createHash } from 'node:crypto';
import type { DatabaseSearchPattern } from '../shared/databaseSearchPattern';
import { definitionNavigationLimits as limits, validateDefinitionNavigationResult, type DefinitionNavigationResult } from '../shared/definitionNavigation';

interface RegexpEvidence { marked: unknown; start: string; end: string; }

/** 去掉服务端边界后必须逐段等于原文，验证偏移量的同时避免把替换文本误当定义。 */
function regexpPositions(source: string, { marked, start, end }: RegexpEvidence) {
  if (typeof marked !== 'string' || start.length !== 1 || end.length !== 1 || start === end ||
      source.includes(start) || source.includes(end) || marked.length > source.length * 3 + 2) return;
  const ranges: { offset: number; length: number }[] = [];
  let read = 0, offset = 0, limitReached = false;
  for (;;) {
    const next = marked.indexOf(start, read);
    const prefix = marked.slice(read, next === -1 ? undefined : next);
    if (!source.startsWith(prefix, offset)) return;
    offset += prefix.length;
    if (next === -1) return offset === source.length && ranges.length ? { ranges, limitReached } : undefined;
    const close = marked.indexOf(end, next + 1);
    if (close === -1) return;
    const value = marked.slice(next + 1, close);
    if (!source.startsWith(value, offset)) return;
    if (value.length) {
      if (ranges.length < limits.matches) ranges.push({ offset, length: value.length });
      else limitReached = true;
    }
    offset += value.length;
    read = close + 1;
  }
}

/** 只认可ASCII逐字符转换及其余原文不变；不猜服务器对其它Unicode字符的大小写映射。 */
function exactCaseMap(original: string, folded: unknown): folded is string {
  if (typeof folded !== 'string' || folded.length !== original.length) return false;
  for (let index = 0; index < original.length; index++) {
    const unit = original.charCodeAt(index), expected = unit >= 65 && unit <= 90 ? unit + 32 : unit;
    if (folded.charCodeAt(index) !== expected) return false;
  }
  return true;
}
/** 服务器已经判定命中，客户端只从可核对的原文和服务端证据推导位置。 */
export function definitionNavigationResult(sql: string, pattern: DatabaseSearchPattern,
  facts: { navigationText?: unknown; navigationNeedle?: unknown; regexp?: RegexpEvidence } = {}): DefinitionNavigationResult {
  const digest = createHash('sha256').update(sql).digest('hex');
  const unavailable = (reason: 'server-regexp' | 'case-mapping' | 'positions-unavailable'): DefinitionNavigationResult => ({ digest, status: 'unavailable', reason });
  if (Buffer.byteLength(sql) > limits.sourceBytes) return unavailable('positions-unavailable');
  if (pattern.mode === 'regexp') {
    const positions = facts.regexp && regexpPositions(sql, facts.regexp);
    if (!positions) return unavailable('server-regexp');
    const result = { digest, status: 'ready', ...positions };
    try { return validateDefinitionNavigationResult(result, sql); }
    catch { return unavailable('positions-unavailable'); }
  }
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
