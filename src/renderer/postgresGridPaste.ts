import { postgresTableLimits, type PostgresTableChange, type PostgresTableColumn, type PostgresTableField, type PostgresTablePage } from '../shared/postgresTable';
import { cellClipboardType, decodeClipboard, type ClipboardCell } from './gridClipboard';
import { postgresGridPasteZh as text } from './locales/postgresGridPaste.zh-CN';

export function postgresClipboardInput(data: Pick<DataTransfer, 'getData' | 'types'> | null) {
  if (!data) throw Error(text.invalid);
  const typed = data.types.includes(cellClipboardType) ? data.getData(cellClipboardType) : undefined;
  if (typed === '' || typed === undefined && !data.types.includes('text/plain')) throw Error(text.invalid);
  return { typed, plain: data.getData('text/plain') };
}

function fieldValue(value: ClipboardCell, column: PostgresTableColumn): PostgresTableField['value'] {
  if (value === undefined) return { mode: 'default' };
  if (value === null) {
    if (!column.nullable) throw Error(text.notNull(column.name));
    return { mode: 'null' };
  }
  if (typeof value === 'object') {
    // 先限编码长度，避免为无法进入十六进制草稿的值分配大缓冲区。
    if (!column.binary || value.base64.length > 4 * Math.ceil(postgresTableLimits.value / 6)) throw Error(text.binary(column.name));
    const bytes = atob(value.base64);
    if (bytes.length * 2 > postgresTableLimits.value) throw Error(text.binary(column.name));
    return { mode: 'binary', value: Array.from(bytes, byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('') };
  }
  const literal = String(value);
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value) ||
    literal.length > postgresTableLimits.value || /[\u0000\uD800-\uDFFF]/u.test(literal)) throw Error(text.value(column.name));
  return { mode: 'text', value: literal };
}

/** 完整计划仅使用当前页和可见列。任一越界或不可写字段导致整批拒绝。 */
export function postgresGridPasteChanges(
  page: PostgresTablePage, columns: readonly PostgresTableColumn[], startKey: string,
  source: { typed?: string; plain: string }, startRow?: number, prior?: (key: string) => PostgresTableChange | undefined,
): PostgresTableChange[] {
  const matrix = decodeClipboard(source.typed ?? '', source.plain, { maximum: postgresTableLimits.changes, message: text.rowLimit });
  const width = matrix[0]?.length ?? 0;
  if (!width || matrix.some(row => row.length !== width)) throw Error(text.rectangle);
  const startColumn = columns.findIndex(column => column.key === startKey);
  if (startColumn < 0 || startColumn + width > columns.length ||
    (startRow !== undefined && (!Number.isSafeInteger(startRow) || startRow < 0 || startRow + matrix.length > page.rows.length))) throw Error(text.bounds);
  const targets = columns.slice(startColumn, startColumn + width);
  for (const column of targets) {
    if (!page.columns.includes(column)) throw Error(text.expired);
    if (column.generated) throw Error(text.generated(column.name));
  }
  const replaced = new Set(targets.map(column => column.key));
  return matrix.map((values, index) => {
    const fields = values.map((value, column) => ({ column: targets[column].key, value: fieldValue(value, targets[column]) }));
    if (startRow === undefined) return { kind: 'insert', fields };
    const row = startRow + index, key = page.rowKeys?.[row];
    if (!key) throw Error(text.expired);
    const previous = prior?.(key);
    if (previous?.kind === 'delete') throw Error(text.deleted);
    const retained = previous?.kind === 'update' ? previous.fields.filter(field => !replaced.has(field.column)) : [];
    return { kind: 'update', row, fields: [...retained, ...fields] };
  });
}
