import type { TableInfo } from '../shared/contracts';
import type { DraftRow } from './dataChanges';
import { ownCell, rowEqual } from './lib';
import { tableGridZh as text } from './locales/tableGrid.zh-CN';

export const pageFindLimits = { query: 512, replacement: 4096, bytes: 16 * 1024 * 1024, matches: 50_000, memory: 128 * 1024 * 1024, timeoutMs: 1500, startupMs: 8000 } as const;
export interface PageFindOptions { kind: 'text' | 'null' | 'default'; query: string; caseSensitive: boolean; wholeCell: boolean; column?: string; regex?: boolean; captureReplacement?: boolean; }
export interface PageCellMatch { rowId: string; key: string; ranges: { start: number; end: number }[]; }
export interface PageOccurrence { rowId: string; key: string; range?: { start: number; end: number }; occurrence: number; }
export interface PageReplacement { generation: number; signature: string; rows: DraftRow[]; patches: { rowId: string; key: string; before: string; after: string }[]; }
/** 捕获内容及每处展开仅留在Worker的计划构造过程，不增加查找消息的传输负担。 */
type PlannedMatch = Omit<PageCellMatch, 'ranges'> & { ranges: (PageCellMatch['ranges'][number] & { replacement?: string })[] };
const encoder = new TextEncoder();
/** 累计 UTF-8 预算不能静默截断，否则预览和最终草稿会出现不同结果。 */
function budget(bytes: number) { if (bytes > pageFindLimits.bytes) throw new Error(text.budget); }
/** 逐字符计量 JSON 的 UTF-8 与转义开销，不先分配完整 JSON 或编码大型旁列。 */
function measureJson(value: unknown, total: { bytes: number }): void {
  const add = (bytes: number) => { total.bytes += bytes; budget(total.bytes); };
  if (typeof value === 'string') {
    add(2);
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) add(2);
      else if (code < 32) add(6);
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { add(4); index++; }
      else if (code >= 0xd800 && code <= 0xdfff) add(6);
      else add(code < 128 ? 1 : code < 2048 ? 2 : 3);
    }
  } else if (Array.isArray(value)) {
    add(2); for (let index = 0; index < value.length; index++) { if (index) add(1); measureJson(value[index] ?? null, total); }
  } else if (value !== null && typeof value === 'object') {
    add(2); let count = 0;
    for (const [key, cell] of Object.entries(value)) { if (cell === undefined) continue; if (count++) add(1); measureJson(key, total); add(1); measureJson(cell, total); }
  } else add(value === undefined ? 4 : JSON.stringify(value).length);
}
/** 在结构化复制之前计量整个请求；估算包含双向副本、UTF-16 文本及最多五万处结果。 */
export function assertPageFindTransfer(value: unknown): void {
  const total = { bytes: 0 }; measureJson(value, total);
  if (total.bytes * 6 + pageFindLimits.matches * 128 > pageFindLimits.memory) throw new Error(text.budget);
}
/** 字面模式只转义为安全正则，不向用户开放正则或替换表达式。 */
function literalPattern(options: PageFindOptions) { return new RegExp(options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options.caseSensitive ? 'gu' : 'giu'); }

/** 将同格多次出现展开为独立位置；NULL 和 DEFAULT 各自保留一个可导航位置。 */
export function pageOccurrences(matches: readonly PageCellMatch[]): PageOccurrence[] {
  return matches.flatMap(match => match.ranges.length ? match.ranges.map((range, index) => ({ rowId: match.rowId, key: match.key, range, occurrence: index + 1 })) : [{ rowId: match.rowId, key: match.key, occurrence: 1 }]);
}

/** 单处替换后跳过新插入的文字，再按当前页行/可见列顺序前进；末尾只循环定位，不再次替换。 */
export function nextPageOccurrenceAfterReplacement(rows: readonly DraftRow[], keys: readonly string[], occurrences: readonly PageOccurrence[], current: PageOccurrence, replacement: string): number {
  if (!occurrences.length || !current.range) return -1;
  const rowOrder = new Map(rows.map((row, index) => [row.id, index])), keyOrder = new Map(keys.map((key, index) => [key, index]));
  const row = rowOrder.get(current.rowId), column = keyOrder.get(current.key); if (row === undefined || column === undefined) return -1;
  const end = current.range.start + replacement.length, zeroWidth = current.range.start === current.range.end;
  const index = occurrences.findIndex(match => {
    const targetRow = rowOrder.get(match.rowId), targetColumn = keyOrder.get(match.key); if (targetRow === undefined || targetColumn === undefined) return false;
    if (targetRow !== row) return targetRow > row;
    if (targetColumn !== column) return targetColumn > column;
    return !!match.range && (zeroWidth ? match.range.start > end : match.range.start >= end);
  });
  return index < 0 ? 0 : index;
}

/** 使用完整自有原值扫描当前页，NULL/DEFAULT 独立于文字，二进制不转成预览匹配。 */
export function findPageCells(rows: readonly DraftRow[], visibleKeys: readonly string[], options: PageFindOptions): PageCellMatch[] {
  if (options.regex) throw new Error(text.workerRequired);
  if (options.query.length > pageFindLimits.query) throw new Error(text.queryLimit);
  return scanPageCells(rows, visibleKeys, options, options.kind === 'text' ? literalPattern(options) : null);
}

/** 用户正则只允许实际 Worker 调用；渲染线程的同步入口始终拒绝用户模式。 */
export function findPageCellsInWorker(rows: readonly DraftRow[], visibleKeys: readonly string[], options: PageFindOptions): PageCellMatch[] {
  return scanPageCells(rows, visibleKeys, options, workerPattern(options));
}

/** 仅由Worker入口编译用户模式，查找与预览共用同一flags及整格边界。 */
function workerPattern(options: PageFindOptions): RegExp | null {
  let pattern: RegExp | null = null;
  if (options.kind === 'text') {
    if (options.query.length > pageFindLimits.query) throw new Error(text.queryLimit);
    try { pattern = options.regex ? new RegExp(options.wholeCell ? `^(?:${options.query})$` : options.query, options.caseSensitive ? 'gu' : 'giu') : literalPattern(options); }
    catch { throw new Error(text.regexInvalid); }
  }
  return pattern;
}

/** matchAll 在 Unicode 模式下按码点推进零宽命中，返回坐标始终保留原文 UTF-16 偏移。 */
function scanPageCells(rows: readonly DraftRow[], visibleKeys: readonly string[], options: PageFindOptions, pattern: RegExp | null, substitute?: (row: DraftRow, key: string, source: string, match: RegExpExecArray) => string | undefined): PlannedMatch[] {
  if (options.query.length > pageFindLimits.query) throw new Error(text.queryLimit);
  if (options.kind === 'text' && !options.query) throw new Error(text.empty);
  const keys = options.column ? visibleKeys.filter(key => key === options.column) : visibleKeys;
  const matches: PlannedMatch[] = []; let scanned = 0, occurrences = 0;
  for (const row of rows) {
    if (row.deleted) continue;
    for (const key of keys) {
      const value = ownCell(row.data, key);
      if (options.kind !== 'text') { if ((options.kind === 'null' && value === null) || (options.kind === 'default' && row.inserted && value === undefined)) matches.push({ rowId: row.id, key, ranges: [] }); }
      else if (value !== null && value !== undefined && typeof value !== 'object') {
        const source = String(value); budget(scanned + source.length); scanned += encoder.encode(source).byteLength; budget(scanned);
        const ranges: PlannedMatch['ranges'] = [];
        for (const match of source.matchAll(pattern!)) {
          if (options.wholeCell && (match.index !== 0 || match[0].length !== source.length)) continue;
          if (++occurrences > pageFindLimits.matches) throw new Error(text.budget);
          const replacement = substitute?.(row, key, source, match);
          ranges.push({ start: match.index, end: match.index + match[0].length, ...(replacement === undefined ? {} : { replacement }) });
        }
        if (ranges.length) matches.push({ rowId: row.id, key, ranges });
      }
      if (matches.length > pageFindLimits.matches) throw new Error(text.budget);
    }
  }
  return matches;
}

/** 替换资格与元数据快照共用真实列定义，不能把数字字符串当普通文本列。 */
export function pageReplaceWritable(info: TableInfo, key: string): boolean {
  const column = info.columns.find(column => column.name === key);
  return info.objectKind !== 'view' && info.engine.toUpperCase() === 'INNODB' && !!info.editableKey.length && !!column && !column.generated && /^(?:CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT)\b/i.test(column.type);
}
/** 库表保持大小写语义，完整列类型和可靠键变化使预览失效。 */
function tableSignature(info: TableInfo) { return JSON.stringify([info.database, info.name, info.objectKind, info.engine, info.editableKey, info.columns]); }

/** 先产生完整替换计划和受影响行快照，替换值中的美元符号不是插值。 */
export function previewPageReplacement(rows: readonly DraftRow[], keys: readonly string[], options: PageFindOptions, replacement: string, info: TableInfo, generation: number, only?: PageOccurrence): PageReplacement {
  if (options.captureReplacement) throw new Error(text.workerRequired);
  return planPageReplacement(rows, findPageCells(rows, keys, options), options, replacement, info, generation, only);
}

/** Worker 内匹配后构造预览，不能把用户模式回传到渲染线程重新执行。 */
export function previewPageReplacementInWorker(rows: readonly DraftRow[], keys: readonly string[], options: PageFindOptions, replacement: string, info: TableInfo, generation: number, only?: PageOccurrence): PageReplacement {
  if (replacement.length > pageFindLimits.replacement) throw new Error(text.replacementLimit);
  if (options.captureReplacement && (options.kind !== 'text' || !options.regex)) throw new Error(text.captureRequiresRegex);
  let expandedBytes = 0;
  const matches = scanPageCells(rows, keys, options, workerPattern(options), options.captureReplacement ? (row, key, source, match) => {
    // 单处只展开指定的原文边界；非文本、只读或其它命中不能消耗替换输出预算。
    if ((only && (only.rowId !== row.id || only.key !== key || only.range?.start !== match.index || only.range?.end !== match.index + match[0].length)) || !pageReplaceWritable(info, key) || typeof ownCell(row.data, key) !== 'string') return undefined;
    return expandCaptureReplacement(replacement, source, match, part => { budget(expandedBytes + part.length); expandedBytes += encoder.encode(part).byteLength; budget(expandedBytes); });
  } : undefined);
  return planPageReplacement(rows, matches, options, replacement, info, generation, only);
}

/** 按ECMAScript GetSubstitution展开静态模板；每段先计量，不能先分配放大后的完整字符串。 */
function expandCaptureReplacement(template: string, source: string, match: RegExpExecArray, count: (part: string) => void): string {
  const parts: string[] = []; let offset = 0;
  const append = (part: string) => { if (part) { count(part); parts.push(part); } };
  for (let index = 0; index < template.length;) {
    if (template[index] !== '$') { index++; continue; }
    append(template.slice(offset, index));
    const token = template[index + 1]; let end = index + 2, part: string;
    if (token === '$') part = '$';
    else if (token === '&') part = match[0];
    else if (token === '`') part = source.slice(0, match.index);
    else if (token === "'") part = source.slice(match.index + match[0].length);
    else if (token >= '0' && token <= '9') {
      const second = template[index + 2]; let digits = second >= '0' && second <= '9' ? 2 : 1, capture = Number(template.slice(index + 1, index + 1 + digits));
      // 两位引用越界时退回一位；$0保持字面，$01在第一组存在时引用第一组。
      if (capture >= match.length && digits === 2) { digits = 1; capture = Number(token); }
      end = index + 1 + digits; part = capture > 0 && capture < match.length ? match[capture] ?? '' : template.slice(index, end);
    } else if (token === '<' && match.groups && template.indexOf('>', index + 2) >= 0) {
      end = template.indexOf('>', index + 2) + 1; const name = template.slice(index + 2, end - 1);
      part = Object.hasOwn(match.groups, name) ? match.groups[name] ?? '' : '';
    } else { end = index + 1; part = '$'; }
    append(part); index = offset = end;
  }
  append(template.slice(offset)); return parts.join('');
}

/** 已有界的范围按原文顺序拼接；默认字面，显式捕获模式使用Worker已经展开的文字。 */
function planPageReplacement(rows: readonly DraftRow[], matches: PlannedMatch[], options: PageFindOptions, replacement: string, info: TableInfo, generation: number, only?: PageOccurrence): PageReplacement {
  if (replacement.length > pageFindLimits.replacement) throw new Error(text.replacementLimit);
  if (options.kind !== 'text') throw new Error(text.noReplace);
  const patches: PageReplacement['patches'] = []; let outputBytes = 0;
  for (const match of matches) {
    if (only && (only.rowId !== match.rowId || only.key !== match.key)) continue;
    if (!pageReplaceWritable(info, match.key)) continue;
    const row = rows.find(row => row.id === match.rowId)!; const before = ownCell(row.data, match.key); if (typeof before !== 'string') continue;
    let offset = 0, after = '', cellBytes = 0;
    const ranges = only ? match.ranges.filter(range => range.start === only.range?.start && range.end === only.range?.end) : match.ranges;
    if (!ranges.length) continue;
    for (const range of ranges) { const part = before.slice(offset, range.start) + (range.replacement ?? replacement); cellBytes += encoder.encode(part).byteLength; budget(outputBytes + cellBytes); after += part; offset = range.end; }
    const tail = before.slice(offset); cellBytes += encoder.encode(tail).byteLength; budget(outputBytes + cellBytes); after += tail; if (after === before) continue;
    outputBytes += cellBytes;
    patches.push({ rowId: row.id, key: match.key, before, after });
  }
  if (!patches.length) throw new Error(text.noReplace);
  const ids = new Set(patches.map(patch => patch.rowId)); const snapshots = rows.filter(row => ids.has(row.id));
  // 同一总预算覆盖补丁前后文本、整行 data/original（含未查找的 BLOB）和元数据；先计量再复制。
  const total = { bytes: 0 }; measureJson(patches, total); measureJson(snapshots, total); measureJson(info, total);
  return { generation, signature: tableSignature(info), rows: structuredClone(snapshots), patches };
}

/** 整批先核对本地快照再一次写草稿，原始行和非目标字段保持不变。 */
export function applyPageReplacement(rows: readonly DraftRow[], preview: PageReplacement, info: TableInfo, generation: number): DraftRow[] {
  if (preview.generation !== generation || preview.signature !== tableSignature(info)) throw new Error(text.changed);
  const currentBudget = { bytes: 0 };
  for (const saved of preview.rows) {
    const current = rows.find(row => row.id === saved.id);
    if (current) measureJson(current, currentBudget);
    if (!current || current.deleted || current.inserted !== saved.inserted || !rowEqual(current.data, saved.data) || JSON.stringify(current.original) !== JSON.stringify(saved.original)) throw new Error(text.changed);
  }
  const patches = new Map<string, [string, string][]>();
  for (const patch of preview.patches) { if (!pageReplaceWritable(info, patch.key)) throw new Error(text.changed); const group = patches.get(patch.rowId) ?? []; group.push([patch.key, patch.after]); patches.set(patch.rowId, group); }
  return rows.map(row => patches.has(row.id) ? { ...row, data: { ...row.data, ...Object.fromEntries(patches.get(row.id)!) } } : row);
}
