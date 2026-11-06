import type { CellValue } from '../shared/contracts';
import { postgresTableLimits, type PostgresTableChange, type PostgresTableColumn, type PostgresTableField, type PostgresTablePage } from '../shared/postgresTable';
import { cellText, ownCell } from './lib';
import { postgresBatchFillZh as text } from './locales/postgresBatchFill.zh-CN';

export function postgresBatchFillColumn(column: PostgresTableColumn): boolean {
  return !column.primary && !column.generated;
}

type Value = PostgresTableField['value'];
function equal(value: Value, previous: Value | undefined, original: CellValue): boolean {
  if (previous) return previous.mode === value.mode && (!('value' in value) ||
    'value' in previous && (value.mode === 'binary' ? previous.value.toLowerCase() === value.value.toLowerCase() : previous.value === value.value));
  if (value.mode === 'null') return original === null;
  if (value.mode === 'text') return typeof original === 'string' && original === value.value;
  if (value.mode === 'binary' && original !== null && typeof original === 'object')
    return original.base64.length <= 4 * Math.ceil(value.value.length / 6) && cellText(original).slice(2) === value.value.toLowerCase();
  return false;
}

/** 以明确的勾选行、原行键和可见列构造整批草稿。其它字段及已暂存行版本由原工作区保留。 */
export function postgresBatchFillChanges(page: PostgresTablePage, visible: readonly PostgresTableColumn[],
  selected: ReadonlySet<number>, fields: readonly PostgresTableField[], prior: (key: string) => PostgresTableChange | undefined): PostgresTableChange[] {
  if (!page.pageToken || !page.capabilities.update || page.truncated || !selected.size || selected.size > postgresTableLimits.changes)
    throw Error(text.rows);
  const seen = new Set<string>();
  if (!fields.length || fields.length > postgresTableLimits.fields) throw Error(text.fields);
  for (const { column: key, value } of fields) {
    const column = visible.find(item => item.key === key);
    if (!column || !page.columns.includes(column) || !postgresBatchFillColumn(column) || seen.has(key)) throw Error(text.fields);
    if (value.mode === 'null' && !column.nullable ||
        value.mode === 'binary' && (!column.binary || !/^(?:[0-9a-f]{2})*$/i.test(value.value)) ||
        'value' in value && (value.value.length > postgresTableLimits.value || /[\u0000\uD800-\uDFFF]/u.test(value.value)))
      throw Error(text.invalid);
    seen.add(key);
  }
  const rowKeys = new Set<string>(), result: PostgresTableChange[] = [];
  for (const row of [...selected].sort((a, b) => a - b)) {
    const key = page.rowKeys?.[row], original = page.rows[row];
    if (!Number.isSafeInteger(row) || !original || !key || rowKeys.has(key)) throw Error(text.rows);
    rowKeys.add(key);
    const previous = prior(key);
    if (previous?.kind === 'delete') throw Error(text.rows);
    const previousFields = previous?.kind === 'update' ? previous.fields : [];
    const changed = fields.filter(field => {
      const raw = ownCell(original, field.column);
      if (raw === undefined) throw Error(text.rows);
      return !equal(field.value, previousFields.find(item => item.column === field.column)?.value, raw);
    });
    if (!changed.length) continue;
    const replaced = new Set(changed.map(field => field.column));
    result.push({ kind: 'update', row, fields: [...previousFields.filter(field => !replaced.has(field.column)), ...changed] });
  }
  return result;
}
