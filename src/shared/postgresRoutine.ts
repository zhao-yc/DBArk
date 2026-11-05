import { z } from 'zod';
import { postgresStructureInputSchema } from './postgresStructure';
import { postgresCreateTableSchemasSchema, postgresDdlText, postgresNewIdentifier } from './postgresCreateTable';
import { scanPostgresEditorTokens } from './postgresSql';

export const postgresRoutineReadSchema = postgresStructureInputSchema.omit({ table: true }).extend({
  kind: z.enum(['function', 'procedure']),
  name: z.string().min(1).max(64 * 1024).refine(value => !value.includes('\0')),
}).strict();
export type PostgresRoutineReadInput = z.infer<typeof postgresRoutineReadSchema>;

export const postgresRoutineInfoSchema = z.object({
  name: z.string().min(1), category: z.enum(['f', 'p', 'w']), arguments: z.string(), returns: z.string().nullable(),
  language: z.string(), owner: z.string(), volatility: z.enum(['i', 's', 'v']), securityDefiner: z.boolean(),
  comment: z.string().nullable(), definition: z.string().min(1),
}).strict();
export type PostgresRoutineInfo = z.infer<typeof postgresRoutineInfoSchema>;

const utf8 = new TextEncoder();
const typeName = z.string().trim().min(1).max(512).refine(value => {
  const tokens = scanPostgresEditorTokens(value, 64);
  return !value.includes('\0') && !!tokens?.every(token => token.kind === 'word' ||
    token.kind === 'identifier' && !token.open || token.kind === 'punct' && ['.', '[', ']'].includes(token.text));
}, '参数和返回类型须为 PostgreSQL 类型名或数组类型');
const routineParameter = z.object({ name: postgresNewIdentifier, type: typeName, mode: z.enum(['in', 'out', 'inout', 'variadic']),
  default: z.discriminatedUnion('mode', [z.object({ mode: z.literal('none') }).strict(), z.object({ mode: z.literal('null') }).strict(),
    z.object({ mode: z.literal('literal'), value: postgresDdlText }).strict()]),
}).strict();
const routineCreateTarget = postgresCreateTableSchemasSchema.extend({
  schema: postgresNewIdentifier, name: postgresNewIdentifier, language: z.enum(['sql', 'plpgsql']), securityDefiner: z.boolean(),
  parameters: z.array(routineParameter).max(100), comment: postgresDdlText,
  body: z.string().min(1).max(128 * 1024).refine(value => !!value.trim() && !/[\u0000\uD800-\uDFFF]/u.test(value), '例程正文不能为空且须为有效文本'),
});
export const postgresRoutineCreateSchema = z.discriminatedUnion('kind', [
  routineCreateTarget.extend({ kind: z.literal('function'), returns: typeName.or(z.literal('')),
    setReturning: z.boolean(), volatility: z.enum(['volatile', 'stable', 'immutable']) }).strict(),
  routineCreateTarget.extend({ kind: z.literal('procedure') }).strict(),
]).superRefine((input, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (input.schema.startsWith('pg_') || input.schema === 'information_schema') issue('请选择普通用户 schema');
  if (new Set(input.parameters.map(parameter => parameter.name)).size !== input.parameters.length) issue('参数名称不能重复');
  if (input.parameters.some(parameter => parameter.mode === 'out' && parameter.default.mode !== 'none')) issue('OUT 参数不能设置默认值');
  if (input.kind === 'function' && input.parameters.some(parameter => parameter.mode === 'out' || parameter.mode === 'inout') === !!input.returns)
    issue('函数须填写返回类型或使用输出参数推导返回类型');
  const size = utf8.encode(input.body).length + utf8.encode(input.comment).length + input.parameters.reduce((total, parameter) =>
    total + (parameter.default.mode === 'literal' ? utf8.encode(parameter.default.value).length : 0), 0);
  if (size > 128 * 1024) issue('正文、默认值和注释超过 128 KiB');
});
export type PostgresRoutineCreateInput = z.infer<typeof postgresRoutineCreateSchema>;
