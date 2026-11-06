import { create } from 'zustand';
import type { CellValue, DataRow, QueryResult, ResultColumn } from '../shared/contracts';
import { copySqliteResultStorage, type SqliteResultStorageCode } from '../shared/sqliteResultStorage';
import { postgresTableLimits, type PostgresTableChange, type PostgresTableColumn, type PostgresTablePage, type PostgresTableTarget } from '../shared/postgresTable';
import { ownCell } from './lib';
import { postgresRecordTransferZh as text } from './locales/postgresRecordTransfer.zh-CN';
import { postgresClipboardFieldValue } from './postgresGridPaste';

export type PostgresTransferTable = Pick<PostgresTableTarget, 'connectionId' | 'database' | 'table'> & { label: string };
type PostgresTransferQuery = Omit<PostgresTransferTable, 'table'> & { title: string; result: number; truncated: boolean; dialect?: 'sqlite' };
export type PostgresTransferSource = PostgresTransferTable | PostgresTransferQuery;
export type PostgresTransferColumn = ResultColumn & { binary?: boolean; position?: number; mixedBinary?: true; automaticType?: string };
export interface PostgresRecordTransfer {
  readonly source: PostgresTransferSource;
  readonly columns: readonly PostgresTransferColumn[];
  readonly rows: readonly ReadonlyMap<string, CellValue>[];
}

// 每个窗口只保留一批有界快照。原值不进入持久化状态或系统剪贴板。
export const usePostgresRecordTransfer = create<{ snapshot?: PostgresRecordTransfer }>(() => ({}));

export function samePostgresTransferTable(left: PostgresTransferSource, right: PostgresTransferTable) {
  return 'table' in left && left.connectionId === right.connectionId && left.database === right.database && left.table === right.table;
}

/** 只复制已勾选行的可见字段原值，脱离源表页后仍能核对来源。 */
export function capturePostgresRecordTransfer(
  source: PostgresTransferTable, page: PostgresTablePage, columns: readonly PostgresTableColumn[], selected: ReadonlySet<number>,
): PostgresRecordTransfer {
  if (!page.exportToken || page.truncated || columns.some(column => !page.columns.includes(column))) throw Error(text.stale);
  return captureRows(source, page.rows, columns, [...selected].sort((left, right) => left - right));
}

/** 选行控制器已经冻结显示顺序和可见字段。类型仍由同一绑定的 PostgreSQL 元数据提供。 */
export function capturePostgresQueryTransfer(
  source: Omit<PostgresTransferQuery, 'truncated'>, selected: QueryResult, columns: readonly ResultColumn[],
): PostgresRecordTransfer {
  if (selected.columns.length !== columns.length ||
      columns.some((column, index) => selected.columns[index].key !== column.key || selected.columns[index].name !== column.name))
    throw Error(text.stale);
  const fields = columns.map((column, index) => ({
    ...column, type: column.type.toLowerCase(), binary: column.type === 'BYTEA', position: index + 1,
  }));
  const { connectionId, database, label, title, result } = source;
  return captureRows({ connectionId, database, label, title, result, truncated: selected.truncated },
    selected.rows, fields, selected.rows.map((_, index) => index));
}

const sqliteTypes = { i: 'INTEGER', r: 'REAL', t: 'TEXT', b: 'BLOB', n: 'NULL' } as const;
const sqliteAutomaticTypes: Partial<Record<SqliteResultStorageCode, string>> = {
  i: 'bigint', r: 'double precision', t: 'text', b: 'bytea',
};

/** SQLite 存储类来自逐格证据，文本数字保持原文，混合字节与标量的列没有安全的统一映射。 */
export function captureSqliteQueryTransfer(
  source: Omit<PostgresTransferQuery, 'truncated' | 'dialect'>, selected: QueryResult,
): PostgresRecordTransfer {
  if (!selected.rows.length || selected.rows.length > postgresTableLimits.changes ||
      !selected.columns.length || selected.columns.length > postgresTableLimits.fields) throw Error(text.limits);
  const storage = copySqliteResultStorage(selected.sqliteStorage, selected.columns, selected.rows);
  const columns = selected.columns.map((column, index): PostgresTransferColumn => {
    const types = [...new Set(storage.rows.map(row => row[index] as SqliteResultStorageCode))].sort();
    const nonNull = types.filter(type => type !== 'n');
    const binary = nonNull.length ? nonNull.includes('b') : undefined;
    return { ...column, type: types.map(type => sqliteTypes[type]).join(' / '), position: index + 1, binary,
      ...(binary && nonNull.length > 1 ? { mixedBinary: true } : {}),
      automaticType: nonNull.length === 1 ? sqliteAutomaticTypes[nonNull[0]] : undefined };
  });
  const { connectionId, database, label, title, result } = source;
  return captureRows({ connectionId, database, label, title, result, truncated: selected.truncated, dialect: 'sqlite' },
    selected.rows, columns, selected.rows.map((_, index) => index));
}

/** 两种来源共用预算及原值复制。暂存不包含 SQL 正文。 */
function captureRows(source: PostgresTransferSource, original: readonly DataRow[], columns: readonly PostgresTransferColumn[], indices: readonly number[]): PostgresRecordTransfer {
  if (!indices.length || indices.length > postgresTableLimits.changes || !columns.length || columns.length > postgresTableLimits.fields)
    throw Error(text.limits);
  let size = 0;
  const rows = indices.map(index => {
    const row = original[index];
    if (!Number.isSafeInteger(index) || !row) throw Error(text.stale);
    return new Map(columns.map(column => {
      const value = ownCell(row, column.key);
      if (value === undefined) throw Error(text.invalid(column.name));
      size += 32 + (typeof value === 'string' ? 4 * value.length : value && typeof value === 'object' ? value.base64.length : 0);
      if (size > postgresTableLimits.draft) throw Error(text.limits);
      return [column.key, typeof value === 'object' && value ? { ...value } : value];
    }));
  });
  return { source, columns: columns.map(column => ({ ...column })), rows };
}

export function postgresTransferColumnsCompatible(source: PostgresTransferColumn, target: PostgresTableColumn) {
  return !target.generated && !source.mixedBinary && (source.binary === undefined || source.binary === !!target.binary);
}

/** 自动匹配要求名称和类型相同。带序列默认的目标列由用户明确决定是否复制。 */
export function defaultPostgresTransferMapping(source: PostgresRecordTransfer, targets: readonly PostgresTableColumn[]) {
  const fields = new Map<string, PostgresTransferColumn | undefined>();
  for (const column of source.columns) fields.set(column.name, fields.has(column.name) ? undefined : column);
  const sqlite = 'dialect' in source.source && source.source.dialect === 'sqlite';
  return new Map(targets.flatMap(target => {
    const column = fields.get(target.name);
    return column && (sqlite ? column.automaticType : column.type) === target.type && !target.sequenceDefault && postgresTransferColumnsCompatible(column, target)
      ? [[target.key, column.key] as const] : [];
  }).slice(0, postgresTableLimits.fields));
}

/** 所有记录先完成映射和字段校验，再作为一组 INSERT 草稿交给目标表。 */
export function postgresTransferChanges(
  source: PostgresRecordTransfer, page: PostgresTablePage, mapping: ReadonlyMap<string, string>,
): PostgresTableChange[] {
  if (!page.pageToken || !page.capabilities.insert) throw Error(text.stale);
  if (!mapping.size) throw Error(text.empty);
  if (mapping.size > postgresTableLimits.fields) throw Error(text.limits);
  const targets = new Map(page.columns.map(column => [column.key, column]));
  const inputs = new Map(source.columns.map(column => [column.key, column]));
  const fields = [...mapping].map(([targetKey, sourceKey]) => {
    const target = targets.get(targetKey), input = inputs.get(sourceKey);
    if (!target || !input || !postgresTransferColumnsCompatible(input, target)) throw Error(text.incompatible(target?.name ?? targetKey));
    return { target, input };
  });
  const required = page.columns.find(column => !column.generated && !column.nullable && !column.defaultValue && !mapping.has(column.key));
  if (required) throw Error(text.required(required.name));
  let size = 0;
  return source.rows.map(row => ({
    kind: 'insert',
    fields: fields.map(({ target, input }) => {
      const original = row.get(input.key);
      if (original === undefined) throw Error(text.invalid(input.name));
      const value = postgresClipboardFieldValue(original, target);
      // 同一来源允许映射给多个目标列，生成整批前限制放大后的草稿尺寸。
      size += 32 + ('value' in value ? 4 * value.value.length : 0);
      if (size > postgresTableLimits.draft) throw Error(text.limits);
      return { column: target.key, value };
    }),
  }));
}
