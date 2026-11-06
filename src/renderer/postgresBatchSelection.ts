import type { CellValue } from '../shared/contracts';
import { postgresTableLimits, type PostgresTableChange, type PostgresTableColumn, type PostgresTableField, type PostgresTablePage } from '../shared/postgresTable';
import { cellText } from './lib';
import { postgresBatchFillZh } from './locales/postgresBatchFill.zh-CN';

/** 一组勾选必须完整对应同一原页中的不同原行。已标记删除的行拒绝重新进入批量操作。 */
export function postgresBatchRows(page: PostgresTablePage, selected: ReadonlySet<number>, prior: (key: string) => PostgresTableChange | undefined) {
  const { rows } = postgresBatchFillZh;
  if (!page.pageToken || page.truncated || !selected.size || selected.size > postgresTableLimits.changes) throw Error(rows);
  const keys = new Set<string>();
  return [...selected].sort((a, b) => a - b).map(index => {
    const key = page.rowKeys?.[index], original = page.rows[index];
    if (!Number.isSafeInteger(index) || !original || !key || keys.has(key)) throw Error(rows);
    keys.add(key);
    const previous = prior(key);
    if (previous?.kind === 'delete') throw Error(rows);
    return { index, key, original, previous };
  });
}

export type PostgresBatchRow = ReturnType<typeof postgresBatchRows>[number];

export function postgresBatchEditableColumn(column: PostgresTableColumn): boolean {
  return !column.primary && !column.generated;
}

/** 两类批量编辑共用字段模式及大小校验，数据库类型转换仍由原事务执行。 */
export function postgresBatchValueValid(column: PostgresTableColumn, value: PostgresTableField['value']): boolean {
  return !(value.mode === 'null' && !column.nullable ||
    value.mode === 'binary' && (!column.binary || !/^(?:[0-9a-f]{2})*$/i.test(value.value)) ||
    'value' in value && (value.value.length > postgresTableLimits.value || /[\u0000\uD800-\uDFFF]/u.test(value.value)));
}

type Value = PostgresTableField['value'];
export function postgresBatchValueEqual(value: Value, previous: Value | undefined, original: CellValue): boolean {
  if (previous) return previous.mode === value.mode && (!('value' in value) ||
    'value' in previous && (value.mode === 'binary' ? previous.value.toLowerCase() === value.value.toLowerCase() : previous.value === value.value));
  if (value.mode === 'null') return original === null;
  if (value.mode === 'text') return typeof original === 'string' && original === value.value;
  if (value.mode === 'binary' && original !== null && typeof original === 'object')
    return original.base64.length <= 4 * Math.ceil(value.value.length / 6) && cellText(original).slice(2) === value.value.toLowerCase();
  return false;
}
