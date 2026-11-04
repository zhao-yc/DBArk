import { z } from 'zod';
import { sqliteEditValueSchema, sqliteTableEditLimits, type SqliteEditColumn, type SqliteOriginalValue } from '../shared/sqliteTableEdit';
import { parseRecordInputDocumentTree } from './jsonLexicalTree';
import { assertTextInputBudget } from './boundedTextInput';
import { sqliteRecordJsonZh as text } from './locales/sqliteRecordJson.zh-CN';

export const sqliteRecordJsonBudget = Object.freeze({ units: 2 * 1024 * 1024, bytes: 2 * 1024 * 1024, message: text.limited });
interface Field { name: string; declaredType: string; generated: boolean; value: SqliteOriginalValue | { kind: 'default' }; }
export interface SqliteRecordJsonInput { readonly initial: string; readonly columns: readonly SqliteEditColumn[]; readonly values: readonly (SqliteOriginalValue | undefined)[]; readonly inserted: boolean; }
const documentSchema = z.object({ format: z.literal('DBArk-SQLite-record'), version: z.literal(1), fields: z.array(z.object({ name: z.string(), declaredType: z.string(), generated: z.boolean(), value: z.unknown() }).strict()).min(1).max(1024) }).strict();

/** 比较完整typed值，拒绝额外成员；未改动的原生非有限REAL及大BLOB可原样保留。 */
function same(value: unknown, original: Field['value']): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value), expected = 'value' in original ? ['kind', 'value'] : ['kind'];
  return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key)) && (value as Field['value']).kind === original.kind && (!('value' in original) || (value as SqliteOriginalValue & { value: string }).value === original.value);
}

/** 来源先按原文总量预检，再构建有界文档；不截取大字段，不把DEFAULT或NULL混为一类。 */
export function beginSqliteRecordJson(columns: readonly SqliteEditColumn[], values: readonly (SqliteOriginalValue | undefined)[], inserted: boolean): SqliteRecordJsonInput {
  if (!columns.length || columns.length > 1024 || values.length !== columns.length || new Set(columns.map(column => column.name)).size !== columns.length) throw Error(text.invalid);
  let units = 0;
  const fields: Field[] = columns.map((column, index) => {
    const value = values[index]; units += column.name.length + column.declaredType.length + (value && value.kind !== 'null' ? value.value.length : 0);
    if (units > sqliteRecordJsonBudget.units) throw Error(text.limited);
    if (value === undefined && !inserted) throw Error(text.defaultExisting);
    return { name: column.name, declaredType: column.declaredType, generated: column.generated, value: value ?? { kind: 'default' } };
  });
  const initial = JSON.stringify({ format: 'DBArk-SQLite-record', version: 1, fields }, null, 2); assertTextInputBudget(initial, sqliteRecordJsonBudget);
  const frozenValues = values.map(value => value === undefined ? undefined : Object.freeze({ ...value }));
  return Object.freeze({ initial, columns: Object.freeze(columns.map(column => Object.freeze({ ...column }))), values: Object.freeze(frozenValues), inserted });
}

/** 词法预检先识别所有重复成员再解码；完整核验后才返回一整行，不发布任何部分修改。 */
export function readSqliteRecordJson(input: SqliteRecordJsonInput, source: string): (SqliteOriginalValue | undefined)[] {
  assertTextInputBudget(source, sqliteRecordJsonBudget);
  const lexical = parseRecordInputDocumentTree(source);
  if (lexical.status !== 'ready') throw Error(lexical.status === 'limited' ? text.limited : text.invalid);
  for (const node of lexical.nodes) if (node.kind === 'object') {
    const keys = new Set<string>(); for (const member of node.members) { if (keys.has(member.key)) throw Error(text.duplicate); keys.add(member.key); }
  }
  const result = documentSchema.safeParse(JSON.parse(source));
  if (!result.success || result.data.fields.length !== input.columns.length) throw Error(text.invalid);
  return result.data.fields.map((field, index) => {
    const column = input.columns[index], original = input.values[index];
    if (field.name !== column.name || field.declaredType !== column.declaredType || field.generated !== column.generated) throw Error(text.invalid);
    if (same(field.value, original ?? { kind: 'default' })) return original;
    if (column.generated || original?.kind === 'blob' && original.value.length > sqliteTableEditLimits.valueUnits) throw Error(text.locked);
    if (same(field.value, { kind: 'default' })) { if (!input.inserted) throw Error(text.defaultExisting); return undefined; }
    const parsed = sqliteEditValueSchema.safeParse(field.value); if (!parsed.success) throw Error(text.value(column.name)); return parsed.data;
  });
}
