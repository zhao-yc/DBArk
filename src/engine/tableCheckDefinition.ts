import { tableCheckLimits, tableCheckMessages as text } from '../shared/tableChecks';
import { tableColumnPatchLimits, type DefinitionRange, type TableColumnDefinitionDocument, type TableDefinitionContext } from '../shared/tableColumnPatches';
import { tableDefinitionTokens, type TableDefinitionToken } from './tableColumnDefinition';

export interface ParsedTableCheck {
  range: DefinitionRange; rawSql: string; name?: string; nameRange?: DefinitionRange;
  location: 'table' | 'column'; columnName?: string;
  expression: string; expressionRange: DefinitionRange; enforced: boolean | null; opaqueReasons: string[];
}
export interface TableCheckDefinitionRead {
  source: string; checks: ParsedTableCheck[]; coverage: 'complete' | 'unknown'; reasons: string[]; preserved: string;
}
export interface TableCheckExpression { sql: string; key: string; }
type Token = TableDefinitionToken;
const word = (token: Token | undefined) => token?.kind === 'word' ? token.value.toUpperCase() : '';
const symbol = (token: Token | undefined, value: string) => token?.kind === 'symbol' && token.value === value;
const nameToken = (token: Token | undefined): token is Token => !!token && ['word', 'identifier'].includes(token.kind);

/** 共用词法器略过普通注释；额外拒绝gap中的可执行前缀，不能漏掉未知大小写形式。 */
function executableGap(source: string, tokens: readonly Token[], from = 0, until = source.length): boolean {
  let cursor = from;
  for (const token of tokens) { if (/\/\*(?:!|m!)/i.test(source.slice(cursor, token.start))) return true; cursor = token.end; }
  return /\/\*(?:!|m!)/i.test(source.slice(cursor, until));
}

/** 有效Unicode和明确模式先于词法；不能通过编码替换或未知引号模式拼接DDL。 */
function assertSource(value: string, context: TableDefinitionContext, expression: boolean): void {
  const units = expression ? tableCheckLimits.expressionUnits : tableColumnPatchLimits.definitionBytes;
  const bytes = expression ? tableCheckLimits.expressionBytes : tableColumnPatchLimits.definitionBytes;
  if (typeof value !== 'string' || value.length > units || Buffer.byteLength(value) > bytes || /\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw Error(text.expression);
  if (!context || !['mysql', 'mariadb'].includes(context.dialect) || typeof context.mode?.ansiQuotes !== 'boolean' || typeof context.mode?.noBackslashEscapes !== 'boolean' || context.mode.ansiQuotesKnown === false || context.mode.noBackslashEscapesKnown === false) throw Error(text.expression);
}

/** 只证明一个表达式不能逃离CHECK括号；函数、CASE、JSON、正则和类型语义由服务器判定。 */
export function assertTableCheckExpression(expression: string, context: TableDefinitionContext): TableCheckExpression {
  assertSource(expression, context, true);
  let tokens: Token[];
  try { tokens = tableDefinitionTokens(expression, context); } catch { throw Error(text.expression); }
  if (!tokens.length || executableGap(expression, tokens)) throw Error(text.expression);
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === 'executable' || symbol(token, ';') || symbol(token, ',') && depth === 0) throw Error(text.expression);
    if (symbol(token, '(')) { if (++depth > tableColumnPatchLimits.nesting) throw Error(text.expression); }
    else if (symbol(token, ')') && --depth < 0) throw Error(text.expression);
  }
  if (depth !== 0) throw Error(text.expression);
  // 只消去覆盖整个表达式的外括号，不能改变结合、操作符、数字精度或字面量语义。
  let start = 0, end = tokens.length;
  while (symbol(tokens[start], '(') && symbol(tokens[end - 1], ')')) {
    let nested = 0, all = true;
    for (let index = start; index < end; index++) {
      if (symbol(tokens[index], '(')) nested++;
      else if (symbol(tokens[index], ')') && --nested === 0 && index !== end - 1) { all = false; break; }
    }
    if (!all) break; start++; end--;
  }
  if (start === end) throw Error(text.expression);
  const key = JSON.stringify(tokens.slice(start, end).map(token => [token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value]));
  return { sql: expression, key };
}

/** 仅列出本批明确支持的版本族；不能把5.7“接受语法但忽略”当作可实施约束。 */
export function tableCheckVersionCapabilities(dialect: TableDefinitionContext['dialect'], serverVersion: string): { writable: boolean; allowsNotEnforced: boolean } {
  const parsed = /^(\d+)\.(\d+)\.(\d+)(?:[-+]|$)/.exec(serverVersion.replace(/^5\.5\.5-/, ''));
  if (!parsed) return { writable: false, allowsNotEnforced: false };
  const [major, minor, patch] = parsed.slice(1).map(Number);
  const writable = dialect === 'mysql' ? major === 8 && (minor === 0 && patch >= 16 || minor === 4) : major === 10 && minor === 11 || major === 11 && minor === 4;
  return { writable, allowsNotEnforced: writable && dialect === 'mysql' };
}

/** 真实括号组只看symbol；字符串、引用名字及注释内的括号不能移动约束边界。 */
function closeGroup(tokens: Token[], open: number): number {
  if (!symbol(tokens[open], '(')) throw Error(text.incomplete);
  let depth = 0;
  for (let index = open; index < tokens.length; index++) {
    if (symbol(tokens[index], '(')) { if (++depth > tableColumnPatchLimits.nesting) throw Error(text.incomplete); }
    else if (symbol(tokens[index], ')') && --depth === 0) return index;
  }
  throw Error(text.incomplete);
}

/** 名称前缀和CHECK关键字在同一组token中精确匹配，不按全文同名字符串定位。 */
function checkStart(tokens: Token[], start: number): { check: number; name?: Token } | undefined {
  if (word(tokens[start]) === 'CHECK') return { check: start };
  if (word(tokens[start]) !== 'CONSTRAINT') return;
  if (word(tokens[start + 1]) === 'CHECK') return { check: start + 1 };
  if (nameToken(tokens[start + 1]) && word(tokens[start + 2]) === 'CHECK') return { check: start + 2, name: tokens[start + 1] };
}

/** 仅解开MySQL准确的NOT ENFORCED版本后缀；其它执行注释不能悄悄变成普通空白。 */
function readCheck(document: TableColumnDefinitionDocument, tokens: Token[], start: number, location: ParsedTableCheck['location'], columnName: string | undefined, serverVersion: string): { parsed: ParsedTableCheck; next: number } | undefined {
  const opening = checkStart(tokens, start); if (!opening) return;
  const open = opening.check + 1, close = closeGroup(tokens, open), reasons: string[] = [], capabilities = tableCheckVersionCapabilities(document.context.dialect, serverVersion);
  const expressionRange = { start: tokens[open].end, end: tokens[close].start }, expression = document.source.slice(expressionRange.start, expressionRange.end);
  try { assertTableCheckExpression(expression, document.context); } catch { reasons.push(text.expression); }
  let next = close + 1, enforced: boolean | null = capabilities.writable ? true : null;
  if (word(tokens[next]) === 'ENFORCED') { if (!capabilities.allowsNotEnforced) reasons.push(text.unsupported); enforced = capabilities.allowsNotEnforced ? true : null; next++; }
  else if (word(tokens[next]) === 'NOT' && word(tokens[next + 1]) === 'ENFORCED') { if (!capabilities.allowsNotEnforced) reasons.push(text.unsupported); enforced = capabilities.allowsNotEnforced ? false : null; next += 2; }
  else if (tokens[next]?.kind === 'executable') {
    const flag = tokens[next];
    if (capabilities.allowsNotEnforced && /^\/\*!80016[ \t\r\n]+NOT[ \t\r\n]+ENFORCED[ \t\r\n]*\*\/$/i.test(flag.value)) enforced = false;
    else { enforced = null; reasons.push(text.incomplete); }
    next++;
  }
  const range = { start: tokens[start].start, end: tokens[next - 1].end };
  return { parsed: { range, rawSql: document.source.slice(range.start, range.end), ...(opening.name ? { name: opening.name.value, nameRange: { start: opening.name.start, end: opening.name.end } } : {}), location, ...(columnName === undefined ? {} : { columnName }), expression, expressionRange, enforced, opaqueReasons: reasons }, next };
}

/** 只排除实际CHECK范围及其边界空白；其余列、约束、普通注释与表尾均保原始片段。 */
function preserved(document: TableColumnDefinitionDocument, checks: readonly ParsedTableCheck[]): string {
  const parts: string[] = [];
  for (const item of document.items) {
    const within = checks.filter(check => check.range.start >= item.range.start && check.range.end <= item.range.end).sort((a, b) => a.range.start - b.range.start);
    if (item.kind === 'constraint' && within.length && within[0].location === 'table') continue;
    let cursor = item.range.start; const fragments: string[] = [];
    for (const check of within) { if (check.range.start < cursor) throw Error(text.incomplete); fragments.push(document.source.slice(cursor, check.range.start).trim()); cursor = check.range.end; }
    fragments.push(document.source.slice(cursor, item.range.end).trim()); parts.push(fragments.filter(Boolean).join(' '));
  }
  return JSON.stringify([document.head.raw, parts, document.tail.raw]);
}

/** 同时覆盖表级与列级；陌生约束、未知列后缀或未消费尾部使coverage明确unknown。 */
export function readTableCheckDefinition(document: TableColumnDefinitionDocument, serverVersion: string): TableCheckDefinitionRead {
  assertSource(document.source, document.context, false);
  const checks: ParsedTableCheck[] = [], reasons: string[] = [];
  const mark = (reason: string = text.incomplete) => { if (!reasons.includes(reason)) reasons.push(reason); };
  for (const item of document.items) {
    if (document.source.slice(item.range.start, item.range.end) !== item.raw) throw Error(text.incomplete);
    const tokens = tableDefinitionTokens(item.raw, document.context).map(token => ({ ...token, start: token.start + item.range.start, end: token.end + item.range.start }));
    if (executableGap(document.source, tokens, item.range.start, item.range.end)) mark();
    if (item.kind === 'constraint') {
      try {
        const found = readCheck(document, tokens, 0, 'table', undefined, serverVersion);
        if (found) {
          if (found.next !== tokens.length) found.parsed.opaqueReasons.push(text.incomplete);
          // 表级项的前后注释/空白也属于这份原约束片段，旁约束核验不能丢这些原始字节。
          found.parsed.range = { ...item.range }; found.parsed.rawSql = item.raw; checks.push(found.parsed);
        }
        else {
          let cursor = 0;
          if (word(tokens[cursor]) === 'CONSTRAINT') { cursor++; if (nameToken(tokens[cursor]) && !['PRIMARY', 'UNIQUE', 'FOREIGN'].includes(word(tokens[cursor]))) cursor++; }
          if (!['PRIMARY', 'UNIQUE', 'KEY', 'INDEX', 'FULLTEXT', 'SPATIAL', 'FOREIGN'].includes(word(tokens[cursor])) || tokens.some(token => token.kind === 'executable')) mark();
        }
      } catch { mark(); }
    } else {
      let depth = 0;
      for (let cursor = 1; cursor < tokens.length;) {
        const token = tokens[cursor];
        if (!depth && checkStart(tokens, cursor)) {
          try { const found = readCheck(document, tokens, cursor, 'column', item.name, serverVersion)!; checks.push(found.parsed); cursor = found.next; continue; }
          catch { mark(); break; }
        }
        if (symbol(token, '(')) depth++; else if (symbol(token, ')')) depth--;
        if (depth < 0) { mark(); break; } cursor++;
      }
      const owned = checks.filter(check => check.columnName === item.name);
      for (const attribute of item.attributes) if (attribute.kind === 'opaque' && !owned.some(check => attribute.range.start >= check.range.start && attribute.range.end <= check.range.end)) mark();
      for (const token of tokens) if (token.kind === 'executable' && !owned.some(check => token.start >= check.range.start && token.end <= check.range.end)) mark();
    }
    if (checks.length > tableCheckLimits.checks) throw Error(text.incomplete);
  }
  const names = new Set<string>();
  for (const check of checks) {
    if (check.name) { const folded = check.name.toLowerCase(); if (names.has(folded)) { check.opaqueReasons.push(text.incomplete); mark(); } names.add(folded); }
    for (const reason of check.opaqueReasons) mark(reason);
  }
  return { source: document.source, checks, coverage: reasons.length ? 'unknown' : 'complete', reasons, preserved: preserved(document, checks) };
}
