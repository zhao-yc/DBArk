import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { SqliteOriginalValue } from '../shared/sqliteTableEdit';
import type { SqliteDraftRow } from './sqliteTableEditor';
import { sqliteTableEditZh as text } from './locales/sqliteTableEdit.zh-CN';

export interface SqliteDuplicateSource { readonly row: SqliteDraftRow; }
interface Source {
  page: SqliteTablePage; rows: SqliteDraftRow[]; source: SqliteDraftRow; values: SqliteDraftRow['values'];
  original: SqliteDraftRow['values']; edit: SqliteTablePage['edit']; schemaKey: string; columns: string;
  id: string; index: number | undefined; snapshot: string; expiresAt: string;
}
const sources = new WeakMap<SqliteDuplicateSource, Source>();

/** 原始typed值只复制自有数据字段；非有限原REAL可显示并由用户修改，不在此伪造新值资格。 */
function copyOriginal(value: SqliteOriginalValue | undefined): SqliteOriginalValue | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error(text.invalid);
  const keys = Reflect.ownKeys(value), fields = new Map<string, unknown>();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) throw Error(text.invalid);
    fields.set(key, descriptor.value);
  }
  const kind = fields.get('kind');
  if (kind === 'null' && fields.size === 1) return { kind: 'null' };
  if (!['text', 'integer', 'real', 'blob'].includes(kind as string) || fields.size !== 2 || !fields.has('value') || typeof fields.get('value') !== 'string') throw Error(text.invalid);
  return { kind: kind as 'text' | 'integer' | 'real' | 'blob', value: fields.get('value') as string };
}

/** 只准备独立虚拟新增行，不调用editor.add、剪贴板或IPC；生成列全部省略，键保留供明确修改。 */
export function prepareSqliteDuplicate(page: SqliteTablePage, rows: SqliteDraftRow[], source: SqliteDraftRow, id: string): SqliteDuplicateSource {
  const edit = page.edit, width = page.columns.length;
  if (edit?.kind !== 'editable' || !width || width > 1024 || edit.columns.length !== width || !rows.includes(source) || source.deleted || source.values.length !== width || !id || rows.some(row => row.id === id) || edit.columns.some((column, i) => column.name !== page.columns[i].name || column.generated !== !!page.columns[i].generated)) throw Error(text.invalid);
  if (Reflect.ownKeys(source.values).length !== width + 1) throw Error(text.invalid);
  const original = Array.from({ length: width }, (_, i) => {
    const descriptor = Object.getOwnPropertyDescriptor(source.values, String(i));
    if (!descriptor?.enumerable || !('value' in descriptor)) throw Error(text.invalid);
    return copyOriginal(descriptor.value);
  });
  const values = original.map((value, i) => edit.columns[i].generated ? undefined : value === undefined ? undefined : Object.freeze({ ...value }));
  Object.freeze(values);
  const row: SqliteDraftRow = Object.freeze({ id, values, deleted: false }), result = Object.freeze({ row });
  sources.set(result, { page, rows, source, values: source.values, original, edit, schemaKey: page.schemaKey, columns: JSON.stringify([page.columns, edit.columns]), id: source.id, index: source.index, snapshot: edit.snapshotId, expiresAt: edit.expiresAt });
  return result;
}

/** 公开行或同名克隆都不代表原来源；完整原值、元数据、页与数组身份必须仍一致。 */
export function sqliteDuplicateSourceCurrent(plan: SqliteDuplicateSource, page: SqliteTablePage, rows: SqliteDraftRow[]): boolean {
  const state = sources.get(plan);
  if (!state || state.page !== page || state.rows !== rows || !rows.includes(state.source) || state.source.deleted || state.source.id !== state.id || state.source.index !== state.index || state.source.values !== state.values || page.edit !== state.edit || page.edit?.kind !== 'editable' || page.edit.snapshotId !== state.snapshot || page.edit.expiresAt !== state.expiresAt || page.schemaKey !== state.schemaKey || JSON.stringify([page.columns, page.edit.columns]) !== state.columns || state.values.length !== state.original.length || Reflect.ownKeys(state.values).length !== state.original.length + 1) return false;
  try {
    return state.original.every((before, i) => {
      const descriptor = Object.getOwnPropertyDescriptor(state.values, String(i));
      if (!descriptor?.enumerable || !('value' in descriptor)) return false;
      const after = copyOriginal(descriptor.value);
      return before === undefined ? after === undefined : !!after && before.kind === after.kind && (before.kind === 'null' || after.kind !== 'null' && before.value === after.value);
    });
  } catch { return false; }
}
