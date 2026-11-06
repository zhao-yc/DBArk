import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { CellValue } from '../shared/contracts';
import { sqliteEditValueSchema, type SqliteEditColumn } from '../shared/sqliteTableEdit';
import { sqliteTableImportAffinity } from '../shared/sqliteTableImport';
import { sqliteResultCellMatches } from '../shared/sqliteResultStorage';
import { cellText } from './lib';
import type { PostgresRecordTransfer } from './postgresRecordTransfer';
import { prepareSqlitePaste, sqliteClipboardLimits, type SqliteClipboardCell, type SqlitePasteMapping } from './sqliteTableClipboard';
import { sqliteRecordTransferZh as text } from './locales/sqliteRecordTransfer.zh-CN';

export type SqliteTransferEngine = 'PostgreSQL' | 'MySQL' | 'MariaDB' | 'SQLite';

export function sqliteTransferEngine(snapshot: PostgresRecordTransfer | undefined): SqliteTransferEngine | undefined {
  const source = snapshot?.source;
  if (!source || !('title' in source)) return undefined;
  if (source.dialect === 'sqlite') return 'SQLite';
  if (source.dialect === 'mysql') return 'MySQL';
  if (source.dialect === 'mariadb') return 'MariaDB';
  return 'PostgreSQL';
}

function transferBlob(value: Extract<CellValue, object>, column: string) {
  if (value.base64.length > 4 * Math.ceil(sqliteClipboardLimits.valueUnits / 6)) throw Error(text.incompatible(column));
  return sqliteEditValueSchema.parse({ kind: 'blob', value: cellText(value).slice(2) });
}

/** SQLite 的存储类随行变化，不能用列声明或数字外观推断。无穷大沿编辑器原门槛，仅允许跳过该字段。 */
function sqliteSourceValues(snapshot: PostgresRecordTransfer): SqliteClipboardCell[][] {
  const storage = snapshot.sqliteStorage;
  if (!storage || storage.length !== snapshot.rows.length) throw Error(text.unavailable);
  return snapshot.rows.map((row, index) => {
    const codes = storage[index];
    if (codes.length !== snapshot.columns.length) throw Error(text.unavailable);
    return snapshot.columns.map((column, position) => {
      const code = codes[position], value = row.get(column.key);
      if (!sqliteResultCellMatches(code, value)) throw Error(text.unavailable);
      if (code === 'n') return { kind: 'null' };
      if (code === 'r' && (value === 'Infinity' || value === '-Infinity')) return undefined;
      if (code === 'b') {
        if (typeof value !== 'object' || value === null) throw Error(text.unavailable);
        return transferBlob(value, column.name);
      }
      return sqliteEditValueSchema.parse({ kind: code === 'i' ? 'integer' : code === 'r' ? 'real' : 'text', value });
    });
  });
}

/** 整批使用同一整数存储类型；网络整数只要一条超出 int64，就把该列原文统一保留为 TEXT。 */
export function queryToSqliteValues(snapshot: PostgresRecordTransfer): SqliteClipboardCell[][] {
  const engine = sqliteTransferEngine(snapshot);
  if (!engine) throw Error(text.unavailable);
  if (engine === 'SQLite') return sqliteSourceValues(snapshot);
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
    if (typeof value === 'object') return transferBlob(value, column.name);
    if (integerCandidates[index] && typeof value === 'number' && !Number.isSafeInteger(value)) throw Error(text.unsafeInteger(column.name));
    return sqliteEditValueSchema.parse({
      kind: integers[index] ? 'integer' : 'text',
      value: String(value),
    });
  }));
}

/** 目标可能隐式转换数值。只接受能够保留原类型的亲和性，STRICT ANY 保留所有非 NULL 类型。 */
function accepts(column: SqliteEditColumn, strict: boolean, value: SqliteClipboardCell, preserveStorage: boolean): boolean {
  if (!value || column.generated) return false;
  if (value.kind === 'null') return column.nullable && !column.primary;
  if (strict && column.declaredType.toUpperCase() === 'ANY') return true;
  const affinity = sqliteTableImportAffinity(column.declaredType, strict);
  if (value.kind === 'text') return affinity === 'text' || !strict && affinity === 'blob';
  if (value.kind === 'integer') return affinity === 'integer' || !preserveStorage && affinity === 'text' || !strict && (affinity === 'numeric' || affinity === 'blob');
  // SQLite 的 REAL 亲和性可能按整数压缩 -0，只有无亲和性或 STRICT ANY 能保留符号。
  if (value.kind === 'real') return !strict && affinity === 'blob' || affinity === 'real' && value.value !== '-0';
  return value.kind === 'blob' && (affinity === 'blob' || !strict && !column.primary);
}

export function sqliteTransferTargets(snapshot: PostgresRecordTransfer, page: SqliteTablePage, values: readonly SqliteClipboardCell[][], index: number) {
  const edit = page.edit, preserveStorage = sqliteTransferEngine(snapshot) === 'SQLite';
  return edit?.kind === 'editable'
    ? edit.columns.filter(column => values.every(row => accepts(column, !!edit.strict, row[index], preserveStorage))) : [];
}

export function defaultSqliteTransferMapping(snapshot: PostgresRecordTransfer, page: SqliteTablePage, values: readonly SqliteClipboardCell[][]): SqlitePasteMapping {
  const edit = page.edit, targets = new Map(edit?.kind === 'editable' ? edit.columns.map(column => [column.name, column]) : []);
  const preserveStorage = sqliteTransferEngine(snapshot) === 'SQLite';
  const names = new Map<string, number>();
  for (const { name } of snapshot.columns) {
    const key = name.toLowerCase();
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  return snapshot.columns.map(({ name }, index) => {
    const target = targets.get(name);
    const column = edit?.kind === 'editable' && target && names.get(name.toLowerCase()) === 1 &&
      values.every(row => accepts(target, !!edit.strict, row[index], preserveStorage)) ? name : null;
    return { column, kind: 'preserve' };
  });
}

export function prepareSqliteRecordTransfer(snapshot: PostgresRecordTransfer, page: SqliteTablePage, values: SqliteClipboardCell[][], mapping: SqlitePasteMapping) {
  const edit = page.edit;
  if (edit?.kind !== 'editable') throw Error(text.unavailable);
  const targets = new Map(edit.columns.map(column => [column.name, column]));
  const preserveStorage = sqliteTransferEngine(snapshot) === 'SQLite';
  const textTargets = new Set<number>();
  for (const [index, field] of mapping.entries()) {
    if (field.column === null) continue;
    const target = targets.get(field.column);
    if (!target || field.kind !== 'preserve' || !values.every(row => accepts(target, !!edit.strict, row[index], preserveStorage))) throw Error(text.incompatible(field.column));
    if (!preserveStorage && sqliteTableImportAffinity(target.declaredType, !!edit.strict) === 'text') textTargets.add(index);
  }
  // 映射到 TEXT 时直接写入整数原文，后续较小的批次也能写入同一文本列。
  const input = values.map(row => row.map((value, index) => value?.kind === 'integer' && textTargets.has(index)
    ? { kind: 'text' as const, value: value.value } : value));
  return prepareSqlitePaste(page, input, mapping);
}
