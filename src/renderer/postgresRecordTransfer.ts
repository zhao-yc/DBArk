import { create } from 'zustand';
import type { CellValue } from '../shared/contracts';
import { postgresTableLimits, type PostgresTableChange, type PostgresTableColumn, type PostgresTablePage, type PostgresTableTarget } from '../shared/postgresTable';
import { ownCell } from './lib';
import { postgresRecordTransferZh as text } from './locales/postgresRecordTransfer.zh-CN';
import { postgresClipboardFieldValue } from './postgresGridPaste';

export type PostgresTransferTable = Pick<PostgresTableTarget, 'connectionId' | 'database' | 'table'> & { label: string };
export interface PostgresRecordTransfer {
  readonly source: PostgresTransferTable;
  readonly columns: readonly PostgresTableColumn[];
  readonly rows: readonly ReadonlyMap<string, CellValue>[];
}

// 每个窗口只保留一批有界快照。原值不进入持久化状态或系统剪贴板。
export const usePostgresRecordTransfer = create<{ snapshot?: PostgresRecordTransfer }>(() => ({}));

export function samePostgresTransferTable(left: PostgresTransferTable, right: PostgresTransferTable) {
  return left.connectionId === right.connectionId && left.database === right.database && left.table === right.table;
}

/** 只复制已勾选行的可见字段原值，脱离源表页后仍能核对来源。 */
export function capturePostgresRecordTransfer(
  source: PostgresTransferTable, page: PostgresTablePage, columns: readonly PostgresTableColumn[], selected: ReadonlySet<number>,
): PostgresRecordTransfer {
  if (!page.exportToken || page.truncated || columns.some(column => !page.columns.includes(column))) throw Error(text.stale);
  if (!selected.size || selected.size > postgresTableLimits.changes || !columns.length || columns.length > postgresTableLimits.fields)
    throw Error(text.limits);
  let size = 0;
  const rows = [...selected].sort((left, right) => left - right).map(index => {
    const row = page.rows[index];
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

export function postgresTransferColumnsCompatible(source: PostgresTableColumn, target: PostgresTableColumn) {
  return !target.generated && !!source.binary === !!target.binary;
}

/** 自动匹配要求名称和类型相同。带序列默认的目标列由用户明确决定是否复制。 */
export function defaultPostgresTransferMapping(source: PostgresRecordTransfer, targets: readonly PostgresTableColumn[]) {
  const fields = new Map(source.columns.map(column => [column.name, column]));
  return new Map(targets.flatMap(target => {
    const column = fields.get(target.name);
    return column && column.type === target.type && !target.sequenceDefault && postgresTransferColumnsCompatible(column, target)
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
