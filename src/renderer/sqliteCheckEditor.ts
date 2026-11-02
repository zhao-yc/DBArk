import type { SqliteTableRebuildInspectOutput } from '../shared/sqliteTableRebuild';
import { inspectSqliteTableChecks, type SqliteTableCheckSource } from '../shared/sqliteTableRebuildPlan';
import { buildSqliteTableCheck, sqliteTableCheckDefinitionSchema, sqliteTableCheckEditsSchema, sqliteTableCheckLimits, type SqliteTableCheckDefinition, type SqliteTableCheckEdit } from '../shared/sqliteTableChecks';
import { sqliteCheckZh as text } from './locales/sqliteCheck.zh-CN';

export interface SqliteCheckForm {
  token: string; editing?: SqliteTableCheckEdit; original?: SqliteTableCheckSource;
  name: string; location: SqliteTableCheckDefinition['location']; column: string; expression: string; legacyAccepted: boolean;
}
export type SqliteCheckAction =
  | { kind: 'open'; ordinal?: number; edit?: SqliteTableCheckEdit }
  | { kind: 'remove'; ordinal: number } | { kind: 'undo'; edit: SqliteTableCheckEdit }
  | { kind: 'stage' | 'cancel'; token: string }
  | { kind: 'field'; token: string; field: 'name' | 'location' | 'column' | 'expression'; value: string }
  | { kind: 'flag'; token: string; value: boolean };
/** 仅构造纯声明来源，不访问数据库或签发执行权。 */
export const sqliteCheckSource = (catalogue: SqliteTableRebuildInspectOutput) => ({ table: catalogue.target.table, tableSql: catalogue.tableSql, columns: catalogue.columns });
/** 所有既有表达式替换均须核对完整原文，不能默默规范化旧命名和兼容语法。 */
export function sqliteCheckNeedsAcknowledgement(form: SqliteCheckForm): boolean { return !!form.original; }
/** 原序号和准确SQL绑定源，编辑队列使用原对象引用；相同内容不能冒充旧草稿。 */
export function openSqliteCheckForm(catalogue: SqliteTableRebuildInspectOutput, edits: readonly SqliteTableCheckEdit[], action: Extract<SqliteCheckAction, { kind: 'open' }>, id: () => string): SqliteCheckForm {
  const originals = inspectSqliteTableChecks(sqliteCheckSource(catalogue)), editing = action.edit ?? (action.ordinal === undefined ? undefined : edits.find(edit => edit.kind !== 'add' && edit.ordinal === action.ordinal));
  if (action.edit && (action.ordinal !== undefined || !edits.includes(action.edit)) || editing?.kind === 'remove') throw Error(text.invalid);
  const ordinal = editing && editing.kind !== 'add' ? editing.ordinal : action.ordinal, original = ordinal === undefined ? undefined : originals[ordinal];
  if (ordinal !== undefined && !original || editing?.kind === 'replace' && editing.expectedSql !== original?.sql) throw Error(text.invalid);
  const value = editing?.definition;
  return { token: id(), ...(editing ? { editing } : {}), ...(original ? { original } : {}), name: value ? value.name ?? '' : original?.names.at(-1) ?? '', location: value?.location ?? original?.location ?? 'table', column: value?.location === 'column' ? value.column : original?.column ?? catalogue.columns[0].name, expression: value?.expression ?? original?.expression ?? '', legacyAccepted: false };
}
/** 连续输入读取live表单，未完成表达式保留到暂存时校验；位置切换不删除输入。 */
export function updateSqliteCheckForm(form: SqliteCheckForm, action: SqliteCheckAction): SqliteCheckForm {
  if (!('token' in action) || action.token !== form.token) throw Error(text.staleForm);
  if (action.kind === 'flag') return { ...form, legacyAccepted: action.value };
  if (action.kind !== 'field') throw Error(text.invalid);
  if (action.value.length > (action.field === 'expression' ? sqliteTableCheckLimits.expressionBytes : 512) || action.field === 'location' && !['column', 'table'].includes(action.value)) throw Error(text.invalidDefinition);
  return { ...form, [action.field]: action.value, legacyAccepted: false };
}
/** 暂存只校验准确原对象、词法隔离和结构；同批名称交换留完整Main计划统一核对。 */
export function stageSqliteCheckForm(catalogue: SqliteTableRebuildInspectOutput, edits: readonly SqliteTableCheckEdit[], form: SqliteCheckForm): SqliteTableCheckEdit[] {
  if (form.editing && !edits.includes(form.editing)) throw Error(text.staleForm);
  if (sqliteCheckNeedsAcknowledgement(form) && !form.legacyAccepted) throw Error(text.legacyRequired);
  const parsed = sqliteTableCheckDefinitionSchema.safeParse({ name: form.name === '' ? null : form.name, location: form.location, ...(form.location === 'column' ? { column: form.column } : {}), expression: form.expression });
  if (!parsed.success) throw Error(text.invalidDefinition); buildSqliteTableCheck(parsed.data, catalogue.columns);
  const original = form.original ? inspectSqliteTableChecks(sqliteCheckSource(catalogue))[form.original.ordinal] : undefined;
  if (form.original && (!original || original.sql !== form.original.sql)) throw Error(text.invalid);
  const value: SqliteTableCheckEdit = original ? { kind: 'replace', ordinal: original.ordinal, expectedSql: original.sql, definition: parsed.data } : { kind: 'add', definition: parsed.data }, next = [...edits];
  if (form.editing) next[next.indexOf(form.editing)] = value; else next.push(value);
  return sqliteTableCheckEditsSchema.parse(next);
}
/** 移除只生成本地准确补丁；未选择的重复/同名声明不会被批量删除。 */
export function removeSqliteCheck(catalogue: SqliteTableRebuildInspectOutput, edits: readonly SqliteTableCheckEdit[], ordinal: number): SqliteTableCheckEdit[] {
  const original = inspectSqliteTableChecks(sqliteCheckSource(catalogue))[ordinal]; if (!original) throw Error(text.invalid);
  return sqliteTableCheckEditsSchema.parse([...edits.filter(edit => edit.kind === 'add' || edit.ordinal !== ordinal), { kind: 'remove', ordinal, expectedSql: original.sql }]);
}
