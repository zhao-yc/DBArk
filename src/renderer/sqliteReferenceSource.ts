import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { sqliteEditValueSchema, type SqliteOriginalValue } from '../shared/sqliteTableEdit';
import type { SqliteDraftRow } from './sqliteTableEditor';
import { sqliteReadCellOriginal } from './sqliteTableCellFilter';
import { ownCell } from './lib';

/** 只捕获准确原行；无关的大BLOB不阻止读取其它外键，作为外键值时仍明确拒绝。 */
export function captureSqliteReferenceSource(page: SqliteTablePage, index: number, edit?: { row: SqliteDraftRow; rows: SqliteDraftRow[] }): { values: readonly (SqliteOriginalValue | undefined)[]; current(): boolean } {
  const row = edit?.row ?? page.result.rows[index], rows = edit?.rows ?? page.result.rows, fields = edit?.row.values;
  if (!row || edit && (row !== edit.row || !edit.rows.includes(edit.row) || edit.row.deleted) || !edit && (!Number.isSafeInteger(index) || index < 0)) throw Error('请先选择当前表中的准确行');
  const metadata = JSON.stringify([page.target, page.schemaKey, page.columns, page.result.columns]), types = page.storageTypes, result = page.result;
  const snapshot = (value: unknown) => value && typeof value === 'object' ? { ...value } : value;
  // 二进制和typed值只比较不可变字符串，不在每次store通知时复制大型BLOB的JSON。
  const same = (value: unknown, original: unknown): boolean => {
    if (!value || typeof value !== 'object' || !original || typeof original !== 'object') return Object.is(value, original);
    if ('kind' in value && 'kind' in original) return value.kind === original.kind && ('value' in value ? value.value : undefined) === ('value' in original ? original.value : undefined);
    return 'type' in value && value.type === 'binary' && 'type' in original && original.type === 'binary' && 'base64' in value && 'base64' in original && value.base64 === original.base64;
  };
  const originals = edit ? fields!.map(value => value ? { ...value } : undefined) : page.result.columns.map((_column, i) => { try { return sqliteEditValueSchema.parse(sqliteReadCellOriginal(page, index, i)); } catch { return undefined; } });
  const raw = edit ? fields!.map(snapshot) : page.result.columns.map(column => snapshot(ownCell(page.result.rows[index], column.key)));
  let valid = true;
  return { values: Object.freeze(originals), current() {
    if (!valid) return false;
    try {
      if (JSON.stringify([page.target, page.schemaKey, page.columns, page.result.columns]) !== metadata || page.result !== result || page.storageTypes !== types) valid = false;
      if (edit) {
        if (edit.rows !== rows || !edit.rows.includes(edit.row) || edit.row !== row || edit.row.deleted || edit.row.values !== fields || edit.row.values.length !== raw.length || edit.row.values.some((value, i) => !same(value, raw[i]))) valid = false;
      } else if (page.result.rows !== rows || page.result.rows[index] !== row || page.result.columns.some((column, i) => !same(ownCell(page.result.rows[index], column.key), raw[i]))) valid = false;
    } catch { valid = false; }
    return valid;
  } };
}
