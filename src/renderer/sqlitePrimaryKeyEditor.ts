import type { SqliteTableRebuildInspectOutput } from '../shared/sqliteTableRebuild';
import { inspectSqliteTablePrimaryKey, type SqliteTablePrimaryKeySource } from '../shared/sqliteTableRebuildPlan';
import { buildSqliteTablePrimaryKey, sqliteTablePrimaryKeyDefinitionSchema, sqliteTablePrimaryKeyEditSchema, sqliteTablePrimaryKeyLimits, sqlitePrimaryKeyConflicts, type SqliteTablePrimaryKeyDefinition, type SqliteTablePrimaryKeyEdit } from '../shared/sqliteTablePrimaryKey';
import { sqlitePrimaryKeyZh as text } from './locales/sqlitePrimaryKey.zh-CN';

export interface SqlitePrimaryKeyForm {
  token: string; editing?: SqliteTablePrimaryKeyEdit; original?: Readonly<SqliteTablePrimaryKeySource>;
  name: string; location: SqliteTablePrimaryKeyDefinition['location']; conflict: string; autoIncrement: boolean; legacyAccepted: boolean;
  columns: { id: string; column: string; collation: string; order: string }[];
}
export type SqlitePrimaryKeyAction =
  | { kind: 'open' | 'remove' | 'undo'; expected: SqliteTablePrimaryKeyEdit | undefined }
  | { kind: 'stage' | 'cancel' | 'add-field'; token: string }
  | { kind: 'field'; token: string; field: 'name' | 'location' | 'conflict'; value: string }
  | { kind: 'flag'; token: string; field: 'autoIncrement' | 'legacyAccepted'; value: boolean }
  | { kind: 'column'; token: string; id: string; field: 'column' | 'collation' | 'order'; value: string }
  | { kind: 'move'; token: string; id: string; direction: -1 | 1 }
  | { kind: 'remove-field'; token: string; id: string };
export const sqlitePrimaryKeySource = (catalogue: SqliteTableRebuildInspectOutput) => ({ table: catalogue.target.table, tableSql: catalogue.tableSql, columns: catalogue.columns });
/** 特殊原文必须由用户明确核对后才能规范化，保留原主键时原文保持。 */
export function sqlitePrimaryKeyNeedsAcknowledgement(form: SqlitePrimaryKeyForm): boolean {
  return !!form.original;
}
/** 一个主键原目标绑定完整SQL；编辑草稿以准确引用识别，不把旧回调用于后继草稿。 */
export function openSqlitePrimaryKeyForm(catalogue: SqliteTableRebuildInspectOutput, edit: SqliteTablePrimaryKeyEdit | undefined, id: () => string): SqlitePrimaryKeyForm {
  if (edit?.kind === 'remove') throw Error(text.invalid);
  const original = inspectSqliteTablePrimaryKey(sqlitePrimaryKeySource(catalogue)).primaryKey ?? undefined;
  if (edit && (edit.kind === 'add' ? !!original : !original || original.sql !== edit.expectedSql)) throw Error(text.invalid);
  const value = edit?.definition ?? (original ? { name: original.names.at(-1) ?? null, location: original.location, columns: original.columns, conflict: original.conflict, autoIncrement: original.autoIncrement } : undefined);
  const first = catalogue.columns.find(column => column.hidden === 0)?.name ?? '';
  return { token: id(), ...(edit ? { editing: edit } : {}), ...(original ? { original } : {}), name: value?.name ?? '', location: value?.location ?? 'table', conflict: value?.conflict ?? '', autoIncrement: value?.autoIncrement ?? false, legacyAccepted: false,
    columns: (value?.columns ?? [{ column: first, collation: null, order: null }]).map(term => ({ id: id(), column: catalogue.columns.find(column => column.name.replace(/[A-Z]/g, letter => letter.toLowerCase()) === term.column.replace(/[A-Z]/g, letter => letter.toLowerCase()))?.name ?? term.column, collation: term.collation ?? '', order: term.order ?? '' })) };
}
/** 连续输入按live表单和稳定字段身份更新；重排、移除、重读后旧事件不能命中另一字段。 */
export function updateSqlitePrimaryKeyForm(form: SqlitePrimaryKeyForm, action: SqlitePrimaryKeyAction, id: () => string): SqlitePrimaryKeyForm {
  if (!('token' in action) || action.token !== form.token) throw Error(text.staleForm);
  if (action.kind === 'field') {
    if (action.value.length > 512 || action.field === 'location' && !['column', 'table'].includes(action.value) || action.field === 'conflict' && action.value !== '' && !sqlitePrimaryKeyConflicts.includes(action.value as typeof sqlitePrimaryKeyConflicts[number])) throw Error(text.invalidDefinition);
    return { ...form, [action.field]: action.value };
  }
  if (action.kind === 'flag') return { ...form, [action.field]: action.value };
  if (action.kind === 'add-field') { if (form.columns.length >= sqliteTablePrimaryKeyLimits.parts) throw Error(text.invalidDefinition); return { ...form, columns: [...form.columns, { id: id(), column: '', collation: '', order: '' }] }; }
  if (action.kind !== 'column' && action.kind !== 'move' && action.kind !== 'remove-field') throw Error(text.invalid);
  const columns = [...form.columns], index = columns.findIndex(column => column.id === action.id); if (index < 0) throw Error(text.staleForm);
  if (action.kind === 'column') { if (action.value.length > 512 || action.field === 'order' && !['', 'ASC', 'DESC'].includes(action.value)) throw Error(text.invalidDefinition); columns[index] = { ...columns[index], [action.field]: action.value }; }
  if (action.kind === 'remove-field') { if (columns.length === 1) throw Error(text.invalidDefinition); columns.splice(index, 1); }
  if (action.kind === 'move') { const next = index + action.direction; if (next < 0 || next >= columns.length) throw Error(text.invalidDefinition); [columns[index], columns[next]] = [columns[next], columns[index]]; }
  return { ...form, columns };
}
/** 暂存只核对结构及原目标，允许尚待其他补丁解决的类型／命名组合；整批预览由Main独立编译。 */
export function stageSqlitePrimaryKeyForm(catalogue: SqliteTableRebuildInspectOutput, edit: SqliteTablePrimaryKeyEdit | undefined, form: SqlitePrimaryKeyForm): SqliteTablePrimaryKeyEdit {
  if (edit !== form.editing) throw Error(text.staleForm);
  if (sqlitePrimaryKeyNeedsAcknowledgement(form) && !form.legacyAccepted) throw Error(text.legacyRequired);
  const parsed = sqliteTablePrimaryKeyDefinitionSchema.safeParse({ name: form.name === '' ? null : form.name, location: form.location, columns: form.columns.map(term => ({ column: term.column, collation: term.collation === '' ? null : term.collation, order: term.order === '' ? null : term.order })), conflict: form.conflict === '' ? null : form.conflict, autoIncrement: form.autoIncrement });
  if (!parsed.success) throw Error(text.invalidDefinition); buildSqliteTablePrimaryKey(parsed.data, catalogue.columns);
  const original = inspectSqliteTablePrimaryKey(sqlitePrimaryKeySource(catalogue)).primaryKey;
  if ((original?.sql ?? undefined) !== form.original?.sql) throw Error(text.invalid);
  return sqliteTablePrimaryKeyEditSchema.parse(original ? { kind: 'replace', expectedSql: original.sql, definition: parsed.data } : { kind: 'add', definition: parsed.data });
}
/** 移除仍绑定准确原文，WR只可完整替换；不会自动移除其他外键或索引。 */
export function removeSqlitePrimaryKey(catalogue: SqliteTableRebuildInspectOutput): SqliteTablePrimaryKeyEdit {
  const value = inspectSqliteTablePrimaryKey(sqlitePrimaryKeySource(catalogue)); if (!value.primaryKey) throw Error(text.invalid); if (value.withoutRowid) throw Error(text.wrRemove);
  return { kind: 'remove', expectedSql: value.primaryKey.sql };
}
