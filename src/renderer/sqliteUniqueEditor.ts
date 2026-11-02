import type { SqliteTableRebuildInspectOutput } from '../shared/sqliteTableRebuild';
import { inspectSqliteTableUniques, type SqliteTableUniqueSource } from '../shared/sqliteTableRebuildPlan';
import { buildSqliteTableUnique, sqliteTableUniqueDefinitionSchema, sqliteTableUniqueEditsSchema, sqliteTableUniqueLimits, sqliteUniqueConflicts, type SqliteTableUniqueDefinition, type SqliteTableUniqueEdit } from '../shared/sqliteTableUnique';
import { sqliteUniqueZh as text } from './locales/sqliteUnique.zh-CN';

export interface SqliteUniqueForm {
  token: string; editing?: SqliteTableUniqueEdit; original?: SqliteTableUniqueSource;
  name: string; location: SqliteTableUniqueDefinition['location']; conflict: string; legacyAccepted: boolean;
  columns: { id: string; column: string; collation: string; order: string }[];
}
export type SqliteUniqueAction =
  | { kind: 'open'; ordinal?: number; edit?: SqliteTableUniqueEdit }
  | { kind: 'remove'; ordinal: number } | { kind: 'undo'; edit: SqliteTableUniqueEdit }
  | { kind: 'stage' | 'cancel' | 'add-field'; token: string }
  | { kind: 'field'; token: string; field: 'name' | 'location' | 'conflict'; value: string }
  | { kind: 'flag'; token: string; field: 'legacyAccepted'; value: boolean }
  | { kind: 'column'; token: string; id: string; field: 'column' | 'collation' | 'order'; value: string }
  | { kind: 'move'; token: string; id: string; direction: -1 | 1 }
  | { kind: 'remove-field'; token: string; id: string };
export const sqliteUniqueSource = (catalogue: SqliteTableRebuildInspectOutput) => ({ table: catalogue.target.table, tableSql: catalogue.tableSql, columns: catalogue.columns });
/** 替换既有声明均须明确核对，不能默默丢弃原特殊词法或合并重复字段。 */
export function sqliteUniqueNeedsAcknowledgement(form: SqliteUniqueForm): boolean { return !!form.original; }
/** 编辑队列按准确引用，原声明按序号和SQL绑定；自动索引名称不能成为编辑身份。 */
export function openSqliteUniqueForm(catalogue: SqliteTableRebuildInspectOutput, edits: readonly SqliteTableUniqueEdit[], action: Extract<SqliteUniqueAction, { kind: 'open' }>, id: () => string): SqliteUniqueForm {
  const originals = inspectSqliteTableUniques(sqliteUniqueSource(catalogue));
  const editing = action.edit ?? (action.ordinal === undefined ? undefined : edits.find(edit => edit.kind !== 'add' && edit.ordinal === action.ordinal));
  if (action.edit && (action.ordinal !== undefined || !edits.includes(action.edit)) || editing?.kind === 'remove') throw Error(text.invalid);
  const ordinal = editing && editing.kind !== 'add' ? editing.ordinal : action.ordinal, original = ordinal === undefined ? undefined : originals[ordinal];
  if (ordinal !== undefined && !original || editing?.kind === 'replace' && editing.expectedSql !== original?.sql) throw Error(text.invalid);
  const value = editing?.definition ?? (original ? { name: original.names.at(-1) ?? null, location: original.location, columns: original.columns, conflict: original.conflict } : undefined);
  const fold = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
  return { token: id(), ...(editing ? { editing } : {}), ...(original ? { original } : {}), name: value?.name ?? '', location: value?.location ?? 'table', conflict: value?.conflict ?? '', legacyAccepted: false,
    columns: (value?.columns ?? [{ column: catalogue.columns[0].name, collation: null, order: null }]).map(term => ({ id: id(), column: catalogue.columns.find(column => fold(column.name) === fold(term.column))?.name ?? term.column, collation: term.collation ?? '', order: term.order ?? '' })) };
}
/** 连续输入读取live草稿，字段用稳定身份；重排、移除及旧表单事件不能命中另一行。 */
export function updateSqliteUniqueForm(form: SqliteUniqueForm, action: SqliteUniqueAction, id: () => string): SqliteUniqueForm {
  if (!('token' in action) || action.token !== form.token) throw Error(text.staleForm);
  if (action.kind === 'field') {
    if (action.value.length > 512 || action.field === 'location' && !['column', 'table'].includes(action.value) || action.field === 'conflict' && action.value !== '' && !sqliteUniqueConflicts.includes(action.value as typeof sqliteUniqueConflicts[number])) throw Error(text.invalidDefinition);
    return { ...form, [action.field]: action.value };
  }
  if (action.kind === 'flag') return { ...form, [action.field]: action.value };
  if (action.kind === 'add-field') { if (form.columns.length >= sqliteTableUniqueLimits.parts) throw Error(text.invalidDefinition); return { ...form, columns: [...form.columns, { id: id(), column: '', collation: '', order: '' }] }; }
  if (action.kind !== 'column' && action.kind !== 'move' && action.kind !== 'remove-field') throw Error(text.invalid);
  const columns = [...form.columns], index = columns.findIndex(column => column.id === action.id); if (index < 0) throw Error(text.staleForm);
  if (action.kind === 'column') { if (action.value.length > 512 || action.field === 'order' && !['', 'ASC', 'DESC'].includes(action.value)) throw Error(text.invalidDefinition); columns[index] = { ...columns[index], [action.field]: action.value }; }
  if (action.kind === 'remove-field') { if (columns.length === 1) throw Error(text.invalidDefinition); columns.splice(index, 1); }
  if (action.kind === 'move') { const next = index + action.direction; if (next < 0 || next >= columns.length) throw Error(text.invalidDefinition); [columns[index], columns[next]] = [columns[next], columns[index]]; }
  return { ...form, columns };
}
/** 暂存核结构与准确原目标，允许尚待其它草稿解决的名称交换；整批预览再由Main独立编译。 */
export function stageSqliteUniqueForm(catalogue: SqliteTableRebuildInspectOutput, edits: readonly SqliteTableUniqueEdit[], form: SqliteUniqueForm): SqliteTableUniqueEdit[] {
  if (form.editing && !edits.includes(form.editing)) throw Error(text.staleForm);
  if (sqliteUniqueNeedsAcknowledgement(form) && !form.legacyAccepted) throw Error(text.legacyRequired);
  const parsed = sqliteTableUniqueDefinitionSchema.safeParse({ name: form.name === '' ? null : form.name, location: form.location, columns: form.columns.map(term => ({ column: term.column, collation: term.collation === '' ? null : term.collation, order: term.order === '' ? null : term.order })), conflict: form.conflict === '' ? null : form.conflict });
  if (!parsed.success) throw Error(text.invalidDefinition); buildSqliteTableUnique(parsed.data, catalogue.columns);
  const original = form.original ? inspectSqliteTableUniques(sqliteUniqueSource(catalogue))[form.original.ordinal] : undefined;
  if (form.original && (!original || original.sql !== form.original.sql)) throw Error(text.invalid);
  const value: SqliteTableUniqueEdit = original ? { kind: 'replace', ordinal: original.ordinal, expectedSql: original.sql, definition: parsed.data } : { kind: 'add', definition: parsed.data }, next = [...edits];
  if (form.editing) next[next.indexOf(form.editing)] = value; else next.push(value);
  return sqliteTableUniqueEditsSchema.parse(next);
}
/** 标记移除只生成本地准确补丁；父键有效性与整批命名空间在完整预览及真实事务内核对。 */
export function removeSqliteUnique(catalogue: SqliteTableRebuildInspectOutput, edits: readonly SqliteTableUniqueEdit[], ordinal: number): SqliteTableUniqueEdit[] {
  const original = inspectSqliteTableUniques(sqliteUniqueSource(catalogue))[ordinal]; if (!original) throw Error(text.invalid);
  return sqliteTableUniqueEditsSchema.parse([...edits.filter(edit => edit.kind === 'add' || edit.ordinal !== ordinal), { kind: 'remove', ordinal, expectedSql: original.sql }]);
}
