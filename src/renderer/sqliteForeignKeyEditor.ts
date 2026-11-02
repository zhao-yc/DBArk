import type { SqliteTableRebuildInspectOutput, SqliteTableRebuildChange } from '../shared/sqliteTableRebuild';
import type { SqliteTablePrimaryKeyEdit } from '../shared/sqliteTablePrimaryKey';
import type { SqliteTableUniqueEdit } from '../shared/sqliteTableUnique';
import type { SqliteTableCheckEdit } from '../shared/sqliteTableChecks';
type ConstraintContext = { primaryKeyEdit?: SqliteTablePrimaryKeyEdit; uniqueEdits?: readonly SqliteTableUniqueEdit[]; checkEdits?: readonly SqliteTableCheckEdit[]; changes: readonly SqliteTableRebuildChange[] };
import { compileSqliteTableForeignKeys, compileSqliteTableRebuildDefinition, inspectSqliteTableForeignKeys, type SqliteTableForeignKeySource } from '../shared/sqliteTableRebuildPlan';
import { sqliteTableForeignKeyDefinitionSchema, sqliteTableForeignKeyEditsSchema, sqliteTableForeignKeyLimits, type SqliteTableForeignKeyDefinition, type SqliteTableForeignKeyEdit } from '../shared/sqliteTableForeignKeys';
import { sqliteTableCreateActions } from '../shared/sqliteTableCreate';
import { sqliteForeignKeysZh as text } from './locales/sqliteForeignKeys.zh-CN';

export interface SqliteForeignKeyForm {
  token: string; editing?: SqliteTableForeignKeyEdit; original?: SqliteTableForeignKeySource;
  name: string; parent: string; implicit: boolean; legacyAccepted: boolean;
  mappings: { id: string; local: string; parent: string }[];
  onDelete: SqliteTableForeignKeyDefinition['onDelete']; onUpdate: SqliteTableForeignKeyDefinition['onUpdate']; deferral: SqliteTableForeignKeyDefinition['deferral'];
}
export type SqliteForeignKeyAction =
  | { kind: 'open'; ordinal?: number; edit?: SqliteTableForeignKeyEdit }
  | { kind: 'remove'; ordinal: number } | { kind: 'undo'; edit: SqliteTableForeignKeyEdit }
  | { kind: 'cancel' | 'stage' | 'add-mapping'; token: string }
  | { kind: 'field'; token: string; field: 'name' | 'parent' | 'onDelete' | 'onUpdate' | 'deferral'; value: string }
  | { kind: 'flag'; token: string; field: 'implicit' | 'legacyAccepted'; value: boolean }
  | { kind: 'mapping'; token: string; id: string; field: 'local' | 'parent'; value: string }
  | { kind: 'move'; token: string; id: string; direction: -1 | 1 }
  | { kind: 'remove-mapping'; token: string; id: string };
export const sqliteForeignKeySource = (catalogue: SqliteTableRebuildInspectOutput) => ({ table: catalogue.target.table, tableSql: catalogue.tableSql, columns: catalogue.columns });
/** 特殊原文不能在常规表单中静默丢弃；保留原约束时不需要转换。 */
export function sqliteForeignKeyNeedsAcknowledgement(form: SqliteForeignKeyForm): boolean {
  const original = form.original; return !!original && (original.matches.length > 0 || original.onInsert.length > 0 || original.names.length > 1 || original.names.some(name => !name));
}
/** 源序号和准确SQL共同绑定；原匿名／重名外键不按显示名称猜测。 */
export function openSqliteForeignKeyForm(catalogue: SqliteTableRebuildInspectOutput, edits: readonly SqliteTableForeignKeyEdit[], action: Extract<SqliteForeignKeyAction, { kind: 'open' }>, id: () => string): SqliteForeignKeyForm {
  const originals = inspectSqliteTableForeignKeys(sqliteForeignKeySource(catalogue));
  const editing = action.edit ?? (action.ordinal === undefined ? undefined : edits.find(edit => edit.kind !== 'add' && edit.ordinal === action.ordinal));
  if (action.edit && (action.ordinal !== undefined || !edits.includes(action.edit)) || editing?.kind === 'remove') throw Error(text.invalid);
  const ordinal = editing && editing.kind !== 'add' ? editing.ordinal : action.ordinal, original = ordinal === undefined ? undefined : originals[ordinal];
  if (ordinal !== undefined && !original) throw Error(text.invalid);
  const value = editing ? editing.definition : original ? { name: original.names.at(-1) ?? null, columns: [...original.columns], referencedTable: original.referencedTable, referencedColumns: [...original.referencedColumns], onDelete: original.onDelete, onUpdate: original.onUpdate, deferral: original.deferral } : undefined;
  return { token: id(), ...(editing ? { editing } : {}), ...(original ? { original } : {}), name: value?.name ?? '', parent: value?.referencedTable ?? '', implicit: value ? value.referencedColumns.length === 0 : false, legacyAccepted: false,
    mappings: (value?.columns ?? [catalogue.columns[0].name]).map((local, index) => ({ id: id(), local, parent: value?.referencedColumns[index] ?? '' })), onDelete: value?.onDelete ?? 'NO ACTION', onUpdate: value?.onUpdate ?? 'NO ACTION', deferral: value?.deferral ?? 'not-deferrable' };
}
/** 连续输入读取最新表单；行身份不随重排改变，已移除行或旧表单事件不能作用到新对象。 */
export function updateSqliteForeignKeyForm(form: SqliteForeignKeyForm, action: SqliteForeignKeyAction, id: () => string): SqliteForeignKeyForm {
  if (!('token' in action) || action.token !== form.token) throw Error(text.staleForm);
  if (action.kind === 'field') {
    if (action.value.length > 512 || (action.field === 'onDelete' || action.field === 'onUpdate') && !sqliteTableCreateActions.includes(action.value as typeof form.onDelete) || action.field === 'deferral' && !['not-deferrable', 'immediate', 'deferred'].includes(action.value)) throw Error(text.invalid);
    return { ...form, [action.field]: action.value };
  }
  if (action.kind === 'flag') return { ...form, [action.field]: action.value };
  if (action.kind === 'add-mapping') { if (form.mappings.length >= sqliteTableForeignKeyLimits.parts) throw Error(text.invalid); return { ...form, mappings: [...form.mappings, { id: id(), local: '', parent: '' }] }; }
  if (action.kind !== 'mapping' && action.kind !== 'move' && action.kind !== 'remove-mapping') throw Error(text.invalid);
  const index = form.mappings.findIndex(row => row.id === action.id); if (index < 0) throw Error(text.staleForm); const mappings = [...form.mappings];
  if (action.kind === 'mapping') { if (action.value.length > 512) throw Error(text.invalid); mappings[index] = { ...mappings[index], [action.field]: action.value }; }
  if (action.kind === 'remove-mapping') { if (mappings.length <= 1) throw Error(text.invalid); mappings.splice(index, 1); }
  if (action.kind === 'move') { const next = index + action.direction; if (next < 0 || next >= mappings.length) throw Error(text.invalid); [mappings[index], mappings[next]] = [mappings[next], mappings[index]]; }
  return { ...form, mappings };
}
/** 暂存前试编译整组本地补丁，冲突、未知字段和超预算不会改写原队列；不发送IPC。 */
export function stageSqliteForeignKeyForm(catalogue: SqliteTableRebuildInspectOutput, edits: readonly SqliteTableForeignKeyEdit[], form: SqliteForeignKeyForm, primary?: ConstraintContext): SqliteTableForeignKeyEdit[] {
  if (sqliteForeignKeyNeedsAcknowledgement(form) && !form.legacyAccepted) throw Error(text.legacyRequired);
  const parsedDefinition = sqliteTableForeignKeyDefinitionSchema.safeParse({ name: form.name === '' ? null : form.name, columns: form.mappings.map(row => row.local), referencedTable: form.parent, referencedColumns: form.implicit ? [] : form.mappings.map(row => row.parent), onDelete: form.onDelete, onUpdate: form.onUpdate, deferral: form.deferral });
  if (!parsedDefinition.success) throw Error(text.invalidDefinition);
  const definition = parsedDefinition.data;
  const value: SqliteTableForeignKeyEdit = form.original ? { kind: 'replace', ordinal: form.original.ordinal, expectedSql: form.original.sql, definition } : { kind: 'add', definition }, next = [...edits];
  if (form.editing) { const index = next.indexOf(form.editing); if (index < 0) throw Error(text.staleForm); next[index] = value; } else next.push(value);
  const parsed = sqliteTableForeignKeyEditsSchema.parse(next);
  if (primary) compileSqliteTableRebuildDefinition({ ...sqliteForeignKeySource(catalogue), ...primary, foreignKeyEdits: parsed, candidateName: '__dbark_rebuild_' + '0'.repeat(32) });
  else compileSqliteTableForeignKeys(sqliteForeignKeySource(catalogue), parsed);
  return parsed;
}
/** 标记移除沿用原声明身份；撤销只是删除本地补丁，原库和其它字段草稿不变。 */
export function removeSqliteForeignKey(catalogue: SqliteTableRebuildInspectOutput, edits: readonly SqliteTableForeignKeyEdit[], ordinal: number, primary?: ConstraintContext): SqliteTableForeignKeyEdit[] {
  const original = inspectSqliteTableForeignKeys(sqliteForeignKeySource(catalogue))[ordinal]; if (!original) throw Error(text.invalid);
  const next = [...edits.filter(edit => edit.kind === 'add' || edit.ordinal !== ordinal), { kind: 'remove' as const, ordinal, expectedSql: original.sql }];
  const parsed = sqliteTableForeignKeyEditsSchema.parse(next);
  if (primary) compileSqliteTableRebuildDefinition({ ...sqliteForeignKeySource(catalogue), ...primary, foreignKeyEdits: parsed, candidateName: '__dbark_rebuild_' + '0'.repeat(32) });
  else compileSqliteTableForeignKeys(sqliteForeignKeySource(catalogue), parsed);
  return parsed;
}
