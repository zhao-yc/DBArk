import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { SqliteDraftRow } from './sqliteTableEditor';
import type { SqliteOriginalValue } from '../shared/sqliteTableEdit';
import { pageFindLimits } from './pageFindReplace';
import { PageTextSize, joinPageText, type PageTextSpan } from './pageFindText';

export const sqliteFindLimits = { ...pageFindLimits, rows: 1500, columns: 1024, patches: 10000, changedRows: 500, valueUnits: 65536, writeBytes: 2 * 1024 * 1024 } as const;
export const sqliteFindMessages = { invalid: 'SQLite当前页查找数据或回包无效。', budget: 'SQLite当前页查找或替换超过完整预算，未截断或暂存部分结果。', stale: '原SQLite页、草稿或查找选项已变化，请重新明确查找。', readonly: '当前SQLite页不能暂存文本替换。', cancelled: 'SQLite当前页查找已取消。', timeout: 'SQLite当前页查找超时，原线程已终止。', worker: 'SQLite查找线程未正常完成，未授予替换资格。', empty: '请输入当前页查找文字。', regexInvalid: '正则表达式无效。', noReplace: '只有实际TEXT且非生成列、非待删除的匹配格可以替换。', valueLimit: '替换后单元格超过65536字符，未暂存任何修改。', capture: '捕获组替换只允许明确启用的文本正则模式。' } as const;
export interface SqliteFindOptions { kind: 'text' | 'null' | 'default'; query: string; caseSensitive: boolean; wholeCell: boolean; column?: number; regex?: boolean; captureReplacement?: boolean; }
export interface SqliteFindMatch { rowId: string; column: number; ranges: { start: number; end: number }[]; replaceable: boolean; }
export interface SqliteFindOccurrence { rowId: string; column: number; range?: { start: number; end: number }; occurrence: number; replaceable: boolean; }
export interface SqliteTextPatch { rowId: string; column: number; before: string; after: string; }
export interface SqliteFindSource { columns: { name: string; generated: boolean }[]; rows: SqliteDraftRow[]; writable: boolean; options: SqliteFindOptions; }
export type SqliteFindWorkerRequest = { operation: 'find'; source: SqliteFindSource } | { operation: 'preview'; source: SqliteFindSource; replacement: string; only?: SqliteFindOccurrence };
export type SqliteFindWorkerResult = { status: 'ready'; operation: 'find'; matches: SqliteFindMatch[] } | { status: 'ready'; operation: 'preview'; matches: SqliteFindMatch[]; patches: SqliteTextPatch[] } | { status: 'blocked'; reason: string; message: string };
const limits = sqliteFindLimits, invalid = () => Error(sqliteFindMessages.invalid), unicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
/** 在复制前按真实JSON字节与双向内存估计限制完整输入，拒getter/原型/循环/稀疏数组。 */
export function copySqliteFindTransfer<T>(raw: T): T {
  let bytes = 0; const active = new Set<object>(); const add = (value: number) => { bytes += value; if (bytes > limits.bytes || bytes * 6 + limits.matches * 128 > limits.memory) throw Error(sqliteFindMessages.budget); };
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 16) throw invalid(); if (value === undefined) { add(4); return undefined; } if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) { add(JSON.stringify(value).length); return value; }
    if (typeof value === 'string') { if (value.length > limits.bytes) throw Error(sqliteFindMessages.budget); if (!unicode(value)) throw invalid(); const size = new PageTextSize(); size.append({ value, start: 0, end: value.length }); add(size.json + 2); return value; }
    if (!value || typeof value !== 'object' || active.has(value)) throw invalid(); const array = Array.isArray(value); if (array ? Object.getPrototypeOf(value) !== Array.prototype || value.length > limits.matches : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
    active.add(value); try { const keys = Reflect.ownKeys(value); if (!array && keys.length > 128) throw invalid(); if (array && keys.length !== value.length + 1) throw invalid(); const result: unknown[] | Record<string, unknown> = array ? [] : Object.create(null); add(2); let count = 0;
      for (const key of keys) { if (array && key === 'length') continue; const descriptor = Object.getOwnPropertyDescriptor(value, key); if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor) || array && !/^(?:0|[1-9][0-9]*)$/.test(key)) throw invalid(); if (descriptor.value === undefined && !array) continue; if (count++) add(1); if (!array) { visit(key, depth + 1); add(1); } const next = visit(descriptor.value, depth + 1); if (array) (result as unknown[]).push(next); else (result as Record<string, unknown>)[key] = next; }
      return result;
    } finally { active.delete(value); }
  }; return visit(raw, 0) as T;
}
/** 固定字段检查不能把任意SQL/回调或隐藏字段带入线程。 */
function fields(value: unknown, required: string[], optional: string[] = []): Record<string, any> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(); const keys = Object.keys(value); if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => !required.includes(key) && !optional.includes(key))) throw invalid(); return value as Record<string, any>; }
/** 查找选项保原文，NULL/DEFAULT与文字不同；列号绑定真实页列，不从字段名猜测。 */
export function copySqliteFindOptions(raw: SqliteFindOptions, width: number): SqliteFindOptions {
  const value = fields(copySqliteFindTransfer(raw), ['kind', 'query', 'caseSensitive', 'wholeCell'], ['column', 'regex', 'captureReplacement']);
  if (!['text', 'null', 'default'].includes(value.kind) || typeof value.query !== 'string' || value.query.length > limits.query || typeof value.caseSensitive !== 'boolean' || typeof value.wholeCell !== 'boolean' || value.regex !== undefined && typeof value.regex !== 'boolean' || value.captureReplacement !== undefined && typeof value.captureReplacement !== 'boolean' || value.column !== undefined && (!Number.isInteger(value.column) || value.column < 0 || value.column >= width)) throw invalid();
  if (value.captureReplacement && (value.kind !== 'text' || !value.regex)) throw Error(sqliteFindMessages.capture); if (value.kind === 'text' && !value.query) throw Error(sqliteFindMessages.empty); return { kind: value.kind, query: value.query, caseSensitive: value.caseSensitive, wholeCell: value.wholeCell, ...(value.column === undefined ? {} : { column: value.column }), regex: !!value.regex, captureReplacement: !!value.captureReplacement };
}
/** 原值不经Number；查找可阅读真实无穷REAL，替换资格只来自实际TEXT。 */
function checkCell(value: unknown): void { if (value === undefined) return; const item = fields(value, ['kind'], ['value']); if (item.kind === 'null') { if (Object.hasOwn(item, 'value')) throw invalid(); return; } if (!['text', 'integer', 'real', 'blob'].includes(item.kind) || typeof item.value !== 'string' || item.value.length > limits.bytes) throw invalid();
  if (item.kind === 'integer' && (!/^-?(?:0|[1-9][0-9]*)$/.test(item.value) || item.value.length > 20 || BigInt(item.value) < -9223372036854775808n || BigInt(item.value) > 9223372036854775807n)) throw invalid();
  if (item.kind === 'real' && !['Infinity', '-Infinity'].includes(item.value) && (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(item.value) || item.value.length > 64 || !Number.isFinite(Number(item.value)))) throw invalid(); if (item.kind === 'blob' && !/^(?:[0-9a-fA-F]{2})*$/.test(item.value)) throw invalid();
}
/** Worker和渲染端共核纯source，不能由剪贴板editable标志或伪造TableInfo授予替换权。 */
export function copySqliteFindSource(raw: SqliteFindSource): SqliteFindSource {
  const value = fields(copySqliteFindTransfer(raw), ['columns', 'rows', 'writable', 'options']); if (!Array.isArray(value.columns) || !value.columns.length || value.columns.length > limits.columns || !Array.isArray(value.rows) || value.rows.length > limits.rows || typeof value.writable !== 'boolean') throw invalid();
  const names = new Set<string>(), ids = new Set<string>(); for (const column of value.columns) { fields(column, ['name', 'generated']); if (typeof column.name !== 'string' || !column.name || column.name.length > 512 || column.name.includes('\0') || typeof column.generated !== 'boolean' || names.has(column.name.replace(/[A-Z]/g, (letter: string) => letter.toLowerCase()))) throw invalid(); names.add(column.name.replace(/[A-Z]/g, (letter: string) => letter.toLowerCase())); }
  for (const row of value.rows) { fields(row, ['id', 'values', 'deleted'], ['index']); if (typeof row.id !== 'string' || !row.id || row.id.length > 200 || row.id.includes('\0') || ids.has(row.id) || typeof row.deleted !== 'boolean' || row.index !== undefined && (!Number.isInteger(row.index) || row.index < 0 || row.index >= 1000) || !Array.isArray(row.values) || row.values.length !== value.columns.length) throw invalid(); ids.add(row.id); row.values.forEach(checkCell); }
  value.options = copySqliteFindOptions(value.options, value.columns.length); return value as SqliteFindSource;
}
/** 只捕获当前页数据，不读取数据库；只读页可以查找，替换时另核Main编辑快照。 */
export function sqliteFindSource(page: SqliteTablePage, rows: readonly SqliteDraftRow[], options: SqliteFindOptions): SqliteFindSource {
  const edit = page.edit, writable = edit?.kind === 'editable' && page.target.kind === 'table' && page.target.database === 'main' && typeof edit.snapshotId === 'string' && !!edit.snapshotId && Number.isFinite(Date.parse(edit.expiresAt)) && Date.parse(edit.expiresAt) > Date.now();
  if (edit?.kind === 'editable' && writable && (edit.columns.length !== page.columns.length || edit.columns.some((column, index) => column.name !== page.columns[index].name || !!column.generated !== !!page.columns[index].generated))) throw invalid();
  return copySqliteFindSource({ columns: page.columns.map(column => ({ name: column.name, generated: !!column.generated })), rows: rows as SqliteDraftRow[], writable, options });
}
/** 元数据完整绑定；原页所有before值由Client逐格按kind/value核对，避免重复构造巨型JSON。 */
export function sqliteFindSourceSignature(page: SqliteTablePage, source: SqliteFindSource): string { const edit = page.edit; const meta = edit?.kind === 'editable' ? [edit.kind, edit.snapshotId, edit.expiresAt, edit.columns, edit.locator] : edit; return JSON.stringify(copySqliteFindTransfer([page.schemaKey, page.target, page.columns, meta, source.columns, source.writable, source.options])); }
/** 每处命中独立导航；typed NULL和DEFAULT各只有一个位置，不伪造文本偏移。 */
export function sqliteFindOccurrences(matches: readonly SqliteFindMatch[]): SqliteFindOccurrence[] { return matches.flatMap<SqliteFindOccurrence>(match => match.ranges.length ? match.ranges.map((range, index) => ({ rowId: match.rowId, column: match.column, range: { ...range }, occurrence: index + 1, replaceable: match.replaceable })) : [{ rowId: match.rowId, column: match.column, occurrence: 1, replaceable: false }]); }
interface PlannedMatch extends SqliteFindMatch { captures?: RegExpExecArray[]; }
/** 用户模式只由实际Worker调用此编译器，字面查找也在线程内统一执行。 */
function pattern(options: SqliteFindOptions): RegExp | undefined { if (options.kind !== 'text') return; const source = options.regex ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); try { return new RegExp(options.regex && options.wholeCell ? '^(?:' + source + ')$' : source, options.caseSensitive ? 'gu' : 'giu'); } catch { throw Error(sqliteFindMessages.regexInvalid); } }
/** Unicode matchAll原生推进零宽模式；完整命中超过五万时拒绝，不静默截断。 */
function scan(source: SqliteFindSource, captures: boolean, only?: SqliteFindOccurrence): PlannedMatch[] {
  const options = source.options, regex = pattern(options), matches: PlannedMatch[] = []; let occurrences = 0, captureBytes = 0;
  for (const row of source.rows) { if (row.deleted) continue; for (let column = 0; column < source.columns.length; column++) { if (options.column !== undefined && options.column !== column) continue; const value = row.values[column], replaceable = source.writable && !source.columns[column].generated && value?.kind === 'text' && options.kind === 'text';
    if (options.kind !== 'text') { if (options.kind === 'null' && value?.kind === 'null' || options.kind === 'default' && value === undefined && row.index === undefined) { if (++occurrences > limits.matches) throw Error(sqliteFindMessages.budget); matches.push({ rowId: row.id, column, ranges: [], replaceable: false }); } continue; }
    if (!value || value.kind === 'null') continue; const before = value.value, ranges: SqliteFindMatch['ranges'] = [], saved: RegExpExecArray[] = [];
    for (const match of before.matchAll(regex!)) { if (options.wholeCell && (match.index !== 0 || match[0].length !== before.length)) continue; if (++occurrences > limits.matches) throw Error(sqliteFindMessages.budget); ranges.push({ start: match.index, end: match.index + match[0].length }); if (captures && replaceable && (!only || only.rowId === row.id && only.column === column && only.range?.start === match.index && only.range.end === match.index + match[0].length)) { captureBytes += match.length * 16 + match.reduce((sum, value) => sum + (value?.length ?? 0) * 2, 0) + Object.entries(match.groups ?? {}).reduce((sum, [name, value]) => sum + name.length * 2 + (value?.length ?? 0) * 2 + 16, 0); if (captureBytes + limits.bytes * 6 + limits.matches * 128 > limits.memory) throw Error(sqliteFindMessages.budget); saved.push(match); } }
    if (ranges.length) matches.push({ rowId: row.id, column, ranges, replaceable, ...(saved.length ? { captures: saved } : {}) });
  } } return matches;
}

/** 原ECMAScript捕获模板规则只在线程内展开；所有切片先计预算，不直接replace分配放大文本。 */
function* captureParts(template: string, source: string, match: RegExpExecArray): Generator<PageTextSpan> {
  let offset = 0;
  for (let index = 0; index < template.length;) {
    if (template[index] !== '$') { index++; continue; }
    if (offset < index) yield { value: template, start: offset, end: index };
    const token = template[index + 1]; let end = index + 2, value: string, start = 0, stop: number | undefined;
    if (token === '$') { value = template; start = index; stop = index + 1; }
    else if (token === '&') value = match[0];
    else if (token === '`') { value = source; stop = match.index; }
    else if (token === "'") { value = source; start = match.index + match[0].length; }
    else if (token >= '0' && token <= '9') {
      const second = template[index + 2]; let digits = second >= '0' && second <= '9' ? 2 : 1, capture = Number(template.slice(index + 1, index + 1 + digits));
      // 两位引用越界时退回一位；$0保持字面，$01在第一组存在时引用第一组。
      if (capture >= match.length && digits === 2) { digits = 1; capture = Number(token); }
      end = index + 1 + digits;
      if (capture > 0 && capture < match.length) value = match[capture] ?? ''; else { value = template; start = index; stop = end; }
    } else if (token === '<' && match.groups && template.indexOf('>', index + 2) >= 0) {
      end = template.indexOf('>', index + 2) + 1; const name = template.slice(index + 2, end - 1);
      value = Object.hasOwn(match.groups, name) ? match.groups[name] ?? '' : '';
    } else { end = index + 1; value = template; start = index; stop = end; }
    if (start < (stop ?? value.length)) yield { value, start, end: stop ?? value.length }; index = offset = end;
  }
  if (offset < template.length) yield { value: template, start: offset, end: template.length };
}


/** 根据真实匹配的原文区间构造最终片段；字面替换中的美元符号保持原字符。 */
function* parts(before: string, ranges: SqliteFindMatch['ranges'], replacement: string, captures: RegExpExecArray[] = []): Generator<PageTextSpan> {
  let offset = 0, captureIndex = 0; for (const range of ranges) { if (offset < range.start) yield { value: before, start: offset, end: range.start }; while (captureIndex < captures.length && captures[captureIndex].index < range.start) captureIndex++; const candidate = captures[captureIndex], capture = candidate && candidate.index === range.start && candidate.index + candidate[0].length === range.end ? captures[captureIndex++] : undefined; if (capture) yield* captureParts(replacement, before, capture); else if (replacement) yield { value: replacement, start: 0, end: replacement.length }; offset = range.end; } if (offset < before.length) yield { value: before, start: offset, end: before.length };
}
/** 全文片段比较不分配after，同值替换不制造草稿。 */
function unchanged(before: string, spans: Iterable<PageTextSpan>): boolean { let index = 0; for (const span of spans) for (let at = span.start; at < span.end; at++) if (before.charCodeAt(index++) !== span.value.charCodeAt(at)) return false; return index === before.length; }
/** Worker唯一入口：真实模式匹配和捕获替换全部在隔离线程执行，返回完整结果或固定阻断。 */
export function runSqliteTableFindInWorker(raw: SqliteFindWorkerRequest): SqliteFindWorkerResult {
  try {
    const input = fields(copySqliteFindTransfer(raw), ['operation', 'source'], ['replacement', 'only']); if (!['find', 'preview'].includes(input.operation) || input.operation === 'find' && (Object.hasOwn(input, 'replacement') || Object.hasOwn(input, 'only'))) throw invalid();
    const source = copySqliteFindSource(input.source), capture = source.options.captureReplacement === true;
    if (input.operation === 'preview' && (source.options.kind !== 'text' || !source.writable)) throw Error(sqliteFindMessages.noReplace);
    if (input.operation === 'preview' && (typeof input.replacement !== 'string' || input.replacement.length > limits.replacement || !unicode(input.replacement))) throw invalid();
    const only = input.only as SqliteFindOccurrence | undefined; if (only) { fields(only, ['rowId', 'column', 'occurrence', 'replaceable', 'range']); fields(only.range, ['start', 'end']); if (only.replaceable !== true) throw invalid(); }
    const matches = scan(source, input.operation === 'preview' && capture, only), publicMatches = matches.map(({ captures: _captures, ...match }) => match);
    if (input.operation === 'find') return copySqliteFindTransfer({ status: 'ready', operation: 'find', matches: publicMatches });
    if (only && !sqliteFindOccurrences(publicMatches).some(value => value.rowId === only.rowId && value.column === only.column && value.occurrence === only.occurrence && value.replaceable && value.range?.start === only.range?.start && value.range?.end === only.range?.end)) throw invalid();
    const planned: { rowId: string; column: number; before: string; ranges: SqliteFindMatch['ranges']; captures?: RegExpExecArray[]; size: PageTextSize }[] = []; let bytes = 0; const changedRows = new Set<string>();
    for (const match of matches) { if (!match.replaceable || only && (match.rowId !== only.rowId || match.column !== only.column)) continue; const row = source.rows.find(row => row.id === match.rowId)!, value = row.values[match.column]; if (value?.kind !== 'text') throw invalid(); const ranges = only ? match.ranges.filter(range => range.start === only.range?.start && range.end === only.range.end) : match.ranges; if (!ranges.length) continue;
      const spans = () => parts(value.value, ranges, input.replacement, match.captures), size = new PageTextSize(); for (const span of spans()) { size.append(span); if (size.units > limits.valueUnits) throw Error(sqliteFindMessages.valueLimit); }
      if (size.units === value.value.length && unchanged(value.value, spans())) continue; const nameSize = new PageTextSize(); nameSize.append({ value: source.columns[match.column].name, start: 0, end: source.columns[match.column].name.length }); bytes += size.utf8 + nameSize.utf8; if (bytes > limits.writeBytes || planned.length >= limits.patches) throw Error(sqliteFindMessages.budget); changedRows.add(row.id); if (changedRows.size > limits.changedRows) throw Error(sqliteFindMessages.budget); planned.push({ rowId: row.id, column: match.column, before: value.value, ranges, captures: match.captures, size });
    }
    if (!planned.length) throw Error(sqliteFindMessages.noReplace);
    const patches = planned.map(value => ({ rowId: value.rowId, column: value.column, before: value.before, after: joinPageText(parts(value.before, value.ranges, input.replacement, value.captures)) })); if (patches.some(patch => !unicode(patch.after))) throw invalid();
    return copySqliteFindTransfer({ status: 'ready', operation: 'preview', matches: publicMatches, patches });
  } catch (reason) { const message = reason instanceof Error && Object.values(sqliteFindMessages).includes(reason.message as any) ? reason.message : sqliteFindMessages.invalid; return { status: 'blocked', reason: message === sqliteFindMessages.budget ? 'budget' : 'invalid', message }; }
}
