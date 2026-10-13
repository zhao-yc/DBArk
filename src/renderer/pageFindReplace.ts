import type { TableInfo } from '../shared/contracts';
import type { DraftRow } from './dataChanges';
import { ownCell, rowEqual } from './lib';
import { tableGridZh as text } from './locales/tableGrid.zh-CN';

export const pageFindLimits = { query: 512, replacement: 4096, bytes: 16 * 1024 * 1024, matches: 50_000 } as const;
export interface PageFindOptions { kind: 'text' | 'null' | 'default'; query: string; caseSensitive: boolean; wholeCell: boolean; column?: string; }
export interface PageCellMatch { rowId: string; key: string; ranges: { start: number; end: number }[]; }
export interface PageReplacement { generation: number; signature: string; rows: DraftRow[]; patches: { rowId: string; key: string; before: string; after: string }[]; }
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
/** 字面模式只转义为安全正则，不向用户开放正则或替换表达式。 */
function literalPattern(options: PageFindOptions) { return new RegExp(options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options.caseSensitive ? 'gu' : 'giu'); }

/** 使用完整自有原值扫描当前页，NULL/DEFAULT 独立于文字，二进制不转成预览匹配。 */
export function findPageCells(rows: readonly DraftRow[], visibleKeys: readonly string[], options: PageFindOptions): PageCellMatch[] {
  if (options.query.length > pageFindLimits.query) throw new Error(text.queryLimit);
  if (options.kind === 'text' && !options.query) throw new Error(text.empty);
  const keys = options.column ? visibleKeys.filter(key => key === options.column) : visibleKeys;
  const matches: PageCellMatch[] = []; let scanned = 0, occurrences = 0;
  const pattern = options.kind === 'text' ? literalPattern(options) : null;
  for (const row of rows) {
    if (row.deleted) continue;
    for (const key of keys) {
      const value = ownCell(row.data, key);
      if (options.kind !== 'text') { if ((options.kind === 'null' && value === null) || (options.kind === 'default' && row.inserted && value === undefined)) matches.push({ rowId: row.id, key, ranges: [] }); }
      else if (value !== null && value !== undefined && typeof value !== 'object') {
        const source = String(value); budget(scanned + source.length); scanned += encoder.encode(source).byteLength; budget(scanned);
        const ranges = [];
        for (const match of source.matchAll(pattern!)) {
          if (options.wholeCell && (match.index !== 0 || match[0].length !== source.length)) continue;
          ranges.push({ start: match.index, end: match.index + match[0].length });
          if (++occurrences > pageFindLimits.matches) throw new Error(text.budget);
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
  return info.engine.toUpperCase() === 'INNODB' && !!info.editableKey.length && !!column && !column.generated && /^(?:CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT)\b/i.test(column.type);
}
/** 库表保持大小写语义，完整列类型和可靠键变化使预览失效。 */
function tableSignature(info: TableInfo) { return JSON.stringify([info.database, info.name, info.engine, info.editableKey, info.columns]); }

/** 先产生完整替换计划和受影响行快照，替换值中的美元符号不是插值。 */
export function previewPageReplacement(rows: readonly DraftRow[], keys: readonly string[], options: PageFindOptions, replacement: string, info: TableInfo, generation: number): PageReplacement {
  if (replacement.length > pageFindLimits.replacement) throw new Error(text.replacementLimit);
  if (options.kind !== 'text') throw new Error(text.noReplace);
  const matches = findPageCells(rows, keys, options), patches: PageReplacement['patches'] = []; let outputBytes = 0;
  for (const match of matches) {
    if (!pageReplaceWritable(info, match.key)) continue;
    const row = rows.find(row => row.id === match.rowId)!; const before = ownCell(row.data, match.key); if (typeof before !== 'string') continue;
    let offset = 0, after = '', cellBytes = 0;
    for (const range of match.ranges) { const part = before.slice(offset, range.start) + replacement; cellBytes += encoder.encode(part).byteLength; budget(outputBytes + cellBytes); after += part; offset = range.end; }
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
