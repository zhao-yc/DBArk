import { postgresTableLimits, type PostgresTableChange, type PostgresTableColumn, type PostgresTableField, type PostgresTablePage } from '../shared/postgresTable';
import type { DraftRow } from './dataChanges';
import { ownCell } from './lib';
import type { PageOccurrence } from './pageFindReplace';
import { postgresTableFindZh as text } from './locales/postgresTableFind.zh-CN';

type Prior = (key: string) => PostgresTableChange | undefined;

/** 用本页原行和现有更新草稿构造查找视图，保留网格行索引；DEFAULT 还没有可查找的值。 */
export function postgresFindRows(page: PostgresTablePage, prior: Prior): DraftRow[] {
  return page.rows.map((row, index) => {
    const key = page.rowKeys?.[index];
    const change = key ? prior(key) : undefined;
    let data = row;
    if (change?.kind === 'update') {
      data = { ...row };
      for (const { column, value } of change.fields) {
        if (value.mode === 'text' || value.mode === 'null') data[column] = value.mode === 'null' ? null : value.value;
        else delete data[column];
      }
    }
    return { id: String(index), data, inserted: false, deleted: change?.kind === 'delete' };
  });
}

/** PostgreSQL 协议也将数字、日期等作为字符串传输，替换资格必须由目录类型确定。 */
export function postgresFindWritable(column: PostgresTableColumn): boolean {
  return !column.generated && !column.binary && /^(?:text|character(?: varying)?(?:\([1-9]\d*\))?)$/.test(column.type);
}

export interface PostgresFindPlan {
  changes: PostgresTableChange[];
  patches: { row: number; column: PostgresTableColumn; before: string; after: string }[];
}

/** 只按原文范围进行字面替换，合并同一主键的其它暂存字段；先完成整个计划再写入草稿。 */
export function postgresFindPlan(page: PostgresTablePage, rows: readonly DraftRow[], columns: readonly PostgresTableColumn[],
  occurrences: readonly PageOccurrence[], replacement: string, prior: Prior): PostgresFindPlan {
  if (!page.pageToken || !page.capabilities.update || rows.length !== page.rows.length) throw Error(text.stale);
  if (/[\u0000\uD800-\uDFFF]/u.test(replacement)) throw Error(text.invalidValue);
  const grouped = new Map<number, Map<PostgresTableColumn, { start: number; end: number }[]>>();
  const byKey = new Map(columns.map(column => [column.key, column]));
  for (const match of occurrences) {
    const row = Number(match.rowId), column = byKey.get(match.key);
    if (!column || !page.columns.includes(column) || !match.range || rows[row]?.id !== match.rowId || rows[row].deleted)
      throw Error(text.stale);
    if (!postgresFindWritable(column)) continue;
    const fields = grouped.get(row) ?? new Map<PostgresTableColumn, { start: number; end: number }[]>();
    const ranges = fields.get(column) ?? [];
    ranges.push(match.range);
    fields.set(column, ranges);
    grouped.set(row, fields);
  }
  const patches: PostgresFindPlan['patches'] = [], changes: PostgresTableChange[] = [];
  let total = 0;
  for (const [row, fields] of grouped) {
    const key = page.rowKeys?.[row], nextFields: PostgresTableField[] = [];
    if (!key) throw Error(text.stale);
    const previous = prior(key);
    if (previous?.kind === 'delete') throw Error(text.stale);
    for (const [column, ranges] of fields) {
      const before = ownCell(rows[row].data, column.key);
      if (typeof before !== 'string') throw Error(text.stale);
      let end = 0, units = before.length;
      const pieces: string[] = [];
      for (const range of ranges) {
        if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < end ||
          range.end <= range.start || range.end > before.length) throw Error(text.stale);
        units += replacement.length - (range.end - range.start);
        pieces.push(before.slice(end, range.start), replacement);
        end = range.end;
      }
      if (units > postgresTableLimits.value) throw Error(text.limit);
      const after = pieces.join('') + before.slice(end);
      if (before === after) continue;
      total += 32 + after.length * 4;
      if (total > postgresTableLimits.draft) throw Error(text.limit);
      patches.push({ row, column, before, after });
      nextFields.push({ column: column.key, value: { mode: 'text', value: after } });
    }
    if (nextFields.length) {
      const existing = previous?.kind === 'update' ? previous.fields.filter(field => !nextFields.some(next => next.column === field.column)) : [];
      changes.push({ kind: 'update', row, fields: [...existing, ...nextFields] });
    }
  }
  if (!changes.length) throw Error(text.noChange);
  return { changes, patches };
}
