import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { sqliteEditValueSchema, type SqliteEditColumn } from '../shared/sqliteTableEdit';
import { sqliteTableImportAffinity } from '../shared/sqliteTableImport';
import { cellText } from './lib';
import type { PostgresRecordTransfer } from './postgresRecordTransfer';
import { prepareSqlitePaste, sqliteClipboardLimits, type SqliteClipboardCell, type SqlitePasteMapping } from './sqliteTableClipboard';
import { sqliteRecordTransferZh as text } from './locales/sqliteRecordTransfer.zh-CN';

export function isPostgresQueryTransfer(snapshot: PostgresRecordTransfer | undefined): snapshot is PostgresRecordTransfer {
  return !!snapshot && 'title' in snapshot.source && !snapshot.source.dialect;
}

/** 只对真实 PostgreSQL 整型保留 INTEGER，任意精度小数不经过 Number。 */
export function postgresToSqliteValues(snapshot: PostgresRecordTransfer): SqliteClipboardCell[][] {
  if (!isPostgresQueryTransfer(snapshot)) throw Error(text.unavailable);
  return snapshot.rows.map(row => snapshot.columns.map(column => {
    const value = row.get(column.key);
    if (value === undefined) throw Error(text.unavailable);
    if (value === null) return { kind: 'null' };
    if (typeof value === 'object') {
      if (value.base64.length > 4 * Math.ceil(sqliteClipboardLimits.valueUnits / 6)) throw Error(text.incompatible(column.name));
      return sqliteEditValueSchema.parse({ kind: 'blob', value: cellText(value).slice(2) });
    }
    return sqliteEditValueSchema.parse({
      kind: /^(?:smallint|integer|bigint)$/.test(column.type) ? 'integer' : 'text',
      value: String(value),
    });
  }));
}

/** 目标可能隐式转换数值。只接受能够保留原类型的亲和性，STRICT ANY 保留所有非 NULL 类型。 */
function accepts(column: SqliteEditColumn, strict: boolean, value: SqliteClipboardCell): boolean {
  if (!value || column.generated) return false;
  if (value.kind === 'null') return column.nullable && !column.primary;
  if (strict && column.declaredType.toUpperCase() === 'ANY') return true;
  const affinity = sqliteTableImportAffinity(column.declaredType, strict);
  if (value.kind === 'text') return affinity === 'text' || !strict && affinity === 'blob';
  if (value.kind === 'integer') return affinity === 'integer' || !strict && (affinity === 'numeric' || affinity === 'blob');
  return value.kind === 'blob' && (affinity === 'blob' || !strict && !column.primary);
}

export function sqliteTransferTargets(page: SqliteTablePage, values: readonly SqliteClipboardCell[][], index: number) {
  const edit = page.edit;
  return edit?.kind === 'editable'
    ? edit.columns.filter(column => values.every(row => accepts(column, !!edit.strict, row[index]))) : [];
}

export function defaultSqliteTransferMapping(snapshot: PostgresRecordTransfer, page: SqliteTablePage, values: readonly SqliteClipboardCell[][]): SqlitePasteMapping {
  const edit = page.edit, targets = new Map(edit?.kind === 'editable' ? edit.columns.map(column => [column.name, column]) : []);
  const names = new Map<string, number>();
  for (const { name } of snapshot.columns) {
    const key = name.toLowerCase();
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  return snapshot.columns.map(({ name }, index) => {
    const target = targets.get(name);
    const column = edit?.kind === 'editable' && target && names.get(name.toLowerCase()) === 1 &&
      values.every(row => accepts(target, !!edit.strict, row[index])) ? name : null;
    return { column, kind: 'preserve' };
  });
}

export function prepareSqliteRecordTransfer(page: SqliteTablePage, values: SqliteClipboardCell[][], mapping: SqlitePasteMapping) {
  const edit = page.edit;
  if (edit?.kind !== 'editable') throw Error(text.unavailable);
  const targets = new Map(edit.columns.map(column => [column.name, column]));
  for (const [index, field] of mapping.entries()) {
    if (field.column === null) continue;
    const target = targets.get(field.column);
    if (!target || field.kind !== 'preserve' || !values.every(row => accepts(target, !!edit.strict, row[index]))) throw Error(text.incompatible(field.column));
  }
  return prepareSqlitePaste(page, values, mapping);
}
