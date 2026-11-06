import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { sqliteEditValueSchema, type SqliteEditColumn } from '../shared/sqliteTableEdit';
import { sqliteTableImportAffinity } from '../shared/sqliteTableImport';
import { cellText } from './lib';
import type { PostgresRecordTransfer } from './postgresRecordTransfer';
import { prepareSqlitePaste, sqliteClipboardLimits, type SqliteClipboardCell, type SqlitePasteMapping } from './sqliteTableClipboard';
import { sqliteRecordTransferZh as text } from './locales/sqliteRecordTransfer.zh-CN';

export type SqliteTransferEngine = 'PostgreSQL' | 'MySQL' | 'MariaDB';

export function sqliteTransferEngine(snapshot: PostgresRecordTransfer | undefined): SqliteTransferEngine | undefined {
  const source = snapshot?.source;
  if (!source || !('title' in source) || source.dialect === 'sqlite') return undefined;
  if (source.dialect === 'mysql') return 'MySQL';
  if (source.dialect === 'mariadb') return 'MariaDB';
  return 'PostgreSQL';
}

/** 整批使用同一整数存储类型；网络整数只要一条超出 int64，就把该列原文统一保留为 TEXT。 */
export function queryToSqliteValues(snapshot: PostgresRecordTransfer): SqliteClipboardCell[][] {
  const engine = sqliteTransferEngine(snapshot);
  if (!engine) throw Error(text.unavailable);
  const postgres = engine === 'PostgreSQL';
  const integerTypes = postgres ? /^(?:smallint|integer|bigint)$/ : /^(?:TINY|SHORT|INT24|LONG|LONGLONG)$/;
  const integerCandidates = snapshot.columns.map(column => integerTypes.test(column.type));
  const integers = snapshot.columns.map((column, index) => integerCandidates[index] && (postgres || snapshot.rows.every(row => {
    const value = row.get(column.key);
    return value === null || sqliteEditValueSchema.safeParse({ kind: 'integer', value: String(value) }).success;
  })));
  return snapshot.rows.map(row => snapshot.columns.map((column, index) => {
    const value = row.get(column.key);
    if (value === undefined) throw Error(text.unavailable);
    if (value === null) return { kind: 'null' };
    if (typeof value === 'object') {
      if (value.base64.length > 4 * Math.ceil(sqliteClipboardLimits.valueUnits / 6)) throw Error(text.incompatible(column.name));
      return sqliteEditValueSchema.parse({ kind: 'blob', value: cellText(value).slice(2) });
    }
    if (integerCandidates[index] && typeof value === 'number' && !Number.isSafeInteger(value)) throw Error(text.unsafeInteger(column.name));
    return sqliteEditValueSchema.parse({
      kind: integers[index] ? 'integer' : 'text',
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
  if (value.kind === 'integer') return affinity === 'integer' || affinity === 'text' || !strict && (affinity === 'numeric' || affinity === 'blob');
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
  const textTargets = new Set<number>();
  for (const [index, field] of mapping.entries()) {
    if (field.column === null) continue;
    const target = targets.get(field.column);
    if (!target || field.kind !== 'preserve' || !values.every(row => accepts(target, !!edit.strict, row[index]))) throw Error(text.incompatible(field.column));
    if (sqliteTableImportAffinity(target.declaredType, !!edit.strict) === 'text') textTargets.add(index);
  }
  // 映射到 TEXT 时直接写入整数原文，后续较小的批次也能写入同一文本列。
  const input = values.map(row => row.map((value, index) => value?.kind === 'integer' && textTargets.has(index)
    ? { kind: 'text' as const, value: value.value } : value));
  return prepareSqlitePaste(page, input, mapping);
}
