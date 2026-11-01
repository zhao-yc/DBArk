import { assertSqliteStorageTypes, sqliteTableFilterSchema, type SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { SqliteOriginalValue } from '../shared/sqliteTableEdit';
import type { SqliteFilterDraft } from './sqliteTableBrowser';
import type { SqliteDraftRow } from './sqliteTableEditor';
import { sqliteTableCellFilterZh as text } from './locales/sqliteTableCellFilter.zh-CN';

export interface SqliteCellFilterSource {
  readonly column: string;
  readonly value: Readonly<SqliteOriginalValue>;
  current(): boolean;
  draft(exclude: boolean, id: string): SqliteFilterDraft;
}

/** 仅读准确数据属性，拒绝getter；类型来自原SQLite协议，而不是显示文本或列声明。 */
function own(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor)) throw Error(text.unavailable);
  return descriptor.value;
}
/** 原只读页补充存储类型事实；不把数字样式TEXT误当INTEGER，也不解析格式化显示。 */
function original(page: SqliteTablePage, index: number, column: number): SqliteOriginalValue {
  assertSqliteStorageTypes(page);
  if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(column) || column < 0 || !page.columns[column] || !page.storageTypes?.[index]) throw Error(text.unavailable);
  const row = own(page.result.rows, index), info = page.result.columns[column];
  if (!row || typeof row !== 'object' || !info || info.name !== page.columns[column].name) throw Error(text.unavailable);
  const value = own(row, info.key), kind = page.storageTypes[index][column];
  if (kind === 'n' && value === null) return { kind: 'null' };
  if ((kind === 't' || kind === 'i' || kind === 'r') && typeof value === 'string') return { kind: kind === 't' ? 'text' : kind === 'i' ? 'integer' : 'real', value };
  if (kind === 'b' && value && typeof value === 'object' && own(value, 'type') === 'binary') {
    const encoded = own(value, 'base64');
    if (typeof encoded !== 'string' || encoded.length > 43692 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw Error(text.unsupported);
    const bytes = atob(encoded); if (btoa(bytes) !== encoded) throw Error(text.unsupported);
    let hex = ''; for (let i = 0; i < bytes.length; i++) hex += bytes.charCodeAt(i).toString(16).padStart(2, '0');
    return { kind: 'blob', value: hex };
  }
  throw Error(text.unavailable);
}

/** 绑定准确页及原格；可编辑页还核原index及完整原值，新增、删除和已修改格不提供筛选来源。 */
export function captureSqliteCellFilter(page: SqliteTablePage, index: number, column: number, current: () => boolean, edit?: { rows: readonly SqliteDraftRow[]; row: SqliteDraftRow }): SqliteCellFilterSource {
  const value = Object.freeze(original(page, index, column)), metadata = page.columns[column], resultColumn = page.result.columns[column], result = page.result, resultRows = result.rows, resultRow = resultRows[index], types = page.storageTypes, columns = page.columns, target = page.target;
  const signature = JSON.stringify([target, page.schemaKey, metadata, resultColumn, value]), name = metadata.name;
  const editPage = page.edit, editValues = edit?.row.values, editOriginal = editPage?.kind === 'editable' ? editPage.rows[index]?.[column] : undefined;
  let valid = true;
  /** 一旦来源或类型变化即永久失效；目标A→B→A不能复活已观察到的旧格。 */
  function check(): boolean {
    if (!valid) return false;
    try {
      valid = current() && page.target === target && page.columns === columns && page.columns[column] === metadata && page.result === result && page.result.rows === resultRows && resultRows[index] === resultRow && result.columns[column] === resultColumn && page.storageTypes === types && signature === JSON.stringify([page.target, page.schemaKey, page.columns[column], result.columns[column], original(page, index, column)])
        && (!edit || page.edit === editPage && edit.rows.includes(edit.row) && !edit.row.deleted && edit.row.index === index && edit.row.values === editValues && JSON.stringify(edit.row.values[column]) === JSON.stringify(value) && JSON.stringify(editOriginal) === JSON.stringify(value) && page.edit?.kind === 'editable' && page.edit.rows[index]?.[column] === editOriginal);
    } catch { valid = false; }
    return valid;
  }
  /** NULL生成明确的IS NULL/IS NOT NULL；其余值先走原严格typed条件合同。 */
  function draft(exclude: boolean, id: string): SqliteFilterDraft {
    if (!check()) throw Error(text.unavailable);
    const filter = value.kind === 'null' ? { column: name, operator: exclude ? 'notNull' as const : 'isNull' as const } : { column: name, operator: exclude ? 'ne' as const : 'eq' as const, value: { ...value } };
    if (!sqliteTableFilterSchema.safeParse(filter).success) throw Error(text.unsupported);
    return { id, column: name, operator: filter.operator, kind: value.kind === 'null' ? 'text' : value.kind, value: value.kind === 'null' ? '' : value.value };
  }
  if (!check()) throw Error(text.unavailable);
  // 构造即验证所有原值；非有限REAL及超长值不可先显示成可用动作。
  draft(false, 'validate');
  return Object.freeze({ column: name, value, current: check, draft });
}
