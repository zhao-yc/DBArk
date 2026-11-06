import { z } from 'zod';
import type { DataRow } from '../shared/contracts';
import { postgresTableFieldValueSchema, type PostgresTableColumn, type PostgresTableField } from '../shared/postgresTable';
import { assertTextInputBudget } from './boundedTextInput';
import { parseRecordInputDocumentTree } from './jsonLexicalTree';
import { ownCell } from './lib';
import { postgresRecordJsonZh as text } from './locales/postgresRecordJson.zh-CN';

export const postgresRecordJsonBudget = { units: 2 * 1024 * 1024, bytes: 2 * 1024 * 1024, message: text.limited };
const format = 'tabrelio-postgresql-record-edit';
const originalSchema = z.union([z.string(), z.null(), z.object({ type: z.literal('binary'), base64: z.string() }).strict()]);
const document = z.object({ format: z.literal(format), version: z.literal(1), fields: z.array(z.object({
  key: z.string(), name: z.string(), type: z.string(), generated: z.boolean(), original: originalSchema.optional(), assignment: z.unknown(),
}).strict()).min(1).max(1022) }).strict();
const unchanged = z.object({ mode: z.literal('unchanged') }).strict();
type Original = z.infer<typeof originalSchema>;
type Values = Map<string, PostgresTableField['value']>;
interface RecordJsonColumn { key: string; name: string; type: string; generated: boolean; nullable: boolean; binary: boolean; original?: Original; }
export interface PostgresRecordJsonInput { initial: string; columns: readonly RecordJsonColumn[]; }
export interface PostgresRecordJsonBuffer { input: PostgresRecordJsonInput; source: string; }

/** 原值与待赋值分别保存。原始 JSON 字段作为文本，重复成员或大数字不会经过 JSON 对象转换。 */
export function beginPostgresRecordJson(columns: readonly PostgresTableColumn[], original: DataRow | undefined, values: Values): PostgresRecordJsonBuffer {
  if (!columns.length || columns.length > 1022 || new Set(columns.map(column => column.key)).size !== columns.length) throw Error(text.invalid);
  let units = 0;
  const captured: RecordJsonColumn[] = columns.map(({ key, name, type, generated, nullable, binary }) => {
    const read = original && originalSchema.safeParse(ownCell(original, key));
    if (read && !read.success) throw Error(text.invalid);
    const raw = read?.data;
    const assignment = values.get(key);
    units += key.length + name.length + type.length + (typeof raw === 'string' ? raw.length : raw?.base64.length ?? 0) +
      (assignment && 'value' in assignment ? assignment.value.length : 0);
    if (units > postgresRecordJsonBudget.units) throw Error(text.limited);
    return { key, name, type, generated, nullable, binary, original: raw };
  });
  const fields = captured.map(({ key, name, type, generated, original }) => ({ key, name, type, generated, original,
    assignment: values.get(key) ?? { mode: 'unchanged' } }));
  const source = JSON.stringify({ format, version: 1, fields }, null, 2);
  assertTextInputBudget(source, postgresRecordJsonBudget);
  return { input: { initial: source, columns: captured }, source };
}

function sameOriginal(expected: Original | undefined, actual: Original | undefined): boolean {
  return typeof expected === 'object' && expected !== null ? actual != null && typeof actual === 'object' && actual.base64 === expected.base64 : expected === actual;
}

/** 校验整份文档后才交付赋值。只解析外层编辑文档，字符串里的数据库值仍由原写入路径处理。 */
export function readPostgresRecordJson({ input, source }: PostgresRecordJsonBuffer): Values {
  assertTextInputBudget(source, postgresRecordJsonBudget);
  const lexical = parseRecordInputDocumentTree(source);
  if (lexical.status !== 'ready') throw Error(lexical.status === 'limited' ? text.limited : text.invalid);
  for (const node of lexical.nodes) if (node.kind === 'object' && new Set(node.members.map(member => member.key)).size !== node.members.length)
    throw Error(text.duplicate);
  const decoded = document.safeParse(JSON.parse(source));
  if (!decoded.success || decoded.data.fields.length !== input.columns.length) throw Error(text.invalid);
  const values: Values = new Map();
  decoded.data.fields.forEach((field, index) => {
    const column = input.columns[index];
    if (field.key !== column.key || field.name !== column.name || field.type !== column.type || field.generated !== column.generated ||
      !sameOriginal(column.original, field.original)) throw Error(text.invalid);
    if (unchanged.safeParse(field.assignment).success) return;
    if (column.generated) throw Error(text.locked(column.name));
    const parsed = postgresTableFieldValueSchema.safeParse(field.assignment);
    if (!parsed.success || parsed.data.mode === 'null' && !column.nullable || parsed.data.mode === 'binary' && !column.binary ||
      parsed.data.mode === 'text' && /[\uD800-\uDFFF]/u.test(parsed.data.value)) throw Error(text.value(column.name));
    values.set(column.key, parsed.data);
  });
  return values;
}
