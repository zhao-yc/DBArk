import { z } from 'zod';
import { postgresStructureInputSchema } from './postgresStructure';
import { postgresCreateTableSchemasSchema, postgresDdlText, postgresNewIdentifier } from './postgresCreateTable';
import { postgresIdentifier, scanPostgresEditorTokens } from './postgresSql';

export const postgresRoutineReadSchema = postgresStructureInputSchema.omit({ table: true }).extend({
  kind: z.enum(['function', 'procedure']),
  name: z.string().min(1).max(64 * 1024).refine(value => !value.includes('\0')),
}).strict();
export type PostgresRoutineReadInput = z.infer<typeof postgresRoutineReadSchema>;
const routineStamp = z.string().regex(/^[a-f0-9]{64}$/);
const routineBody = z.string().min(1).max(128 * 1024)
  .refine(value => !!value.trim() && !/[\u0000\uD800-\uDFFF]/u.test(value), '例程正文不能为空且须为有效文本')
  .refine(value => new TextEncoder().encode(value).length <= 128 * 1024, '例程正文超过 128 KiB');
const routineManageTarget = postgresRoutineReadSchema.extend({ stamp: routineStamp });
const volatility = z.enum(['i', 's', 'v']);
const parallel = z.enum(['u', 'r', 's']);
const estimate = z.string().max(32).regex(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/, '请输入正数或科学计数法')
  .refine(value => Number(value) > 0 && Number.isFinite(Number(value)), '估算值须为有限正数');
const routineProperties = z.object({
  volatility, parallel, strict: z.boolean(), securityDefiner: z.boolean(), cost: z.string(),
  rows: z.string().nullable(), comment: z.string().nullable(),
});
const routinePropertyChanges = routineProperties.extend({
  cost: estimate, rows: estimate, comment: postgresDdlText.min(1).nullable(),
}).partial().strict().refine(value => Object.keys(value).length > 0, '请修改至少一项例程属性');
export type PostgresRoutineProperties = z.infer<typeof routineProperties>;
export const postgresRoutineManageSchema = z.discriminatedUnion('action', [
  routineManageTarget.extend({ action: z.literal('rename'), newName: postgresNewIdentifier }).strict(),
  routineManageTarget.extend({ action: z.literal('drop') }).strict(),
  routineManageTarget.extend({ action: z.literal('edit'), body: routineBody }).strict(),
  routineManageTarget.extend({ action: z.literal('properties'), changes: routinePropertyChanges }).strict(),
]);
export type PostgresRoutineManageInput = z.infer<typeof postgresRoutineManageSchema>;

const routineCallParameter = z.object({
  mode: z.enum(['i', 'o', 'b', 'v', 't']),
  cast: z.object({ schema: z.string(), name: z.string() }).nullable(),
});
const routineCallMetadata = z.object({
  schema: z.string(), name: z.string(), parameters: z.array(routineCallParameter), setReturning: z.boolean(),
});

export const postgresRoutineInfoSchema = routineProperties.extend({
  name: z.string().min(1), category: z.enum(['f', 'p', 'w']), arguments: z.string(), returns: z.string().nullable(),
  language: z.string(), owner: z.string(), definition: z.string().min(1),
  configuration: z.array(z.string()).nullable(),
  invocation: routineCallMetadata.nullable(),
  canManage: z.boolean(), stamp: routineStamp, editableBody: z.string().nullable(),
}).strict();
export type PostgresRoutineInfo = z.infer<typeof postgresRoutineInfoSchema>;

/** 调用草稿只使用目录返回的对象名和类型名。实际值在查询窗口绑定。 */
export function buildPostgresRoutineCall(info: PostgresRoutineInfo): string | undefined {
  const metadata = info.invocation;
  if (!metadata) return;
  const procedure = info.category === 'p';
  const isInput = (parameter: typeof metadata.parameters[number]) => parameter.mode !== 'o' && parameter.mode !== 't';
  const parameters = metadata.parameters.filter(parameter => isInput(parameter) || procedure && parameter.mode === 'o');
  if (parameters.some((parameter, index) => !parameter.cast || parameter.mode === 'v' && index !== parameters.length - 1)) return;
  if (metadata.setReturning && info.returns === 'SETOF record' &&
      !metadata.parameters.some(parameter => ['o', 'b', 't'].includes(parameter.mode))) return;
  let next = 1;
  const args = parameters.map(parameter => {
    const cast = parameter.cast!;
    const value = isInput(parameter) ? '$' + next++ : 'NULL';
    return (parameter.mode === 'v' ? 'VARIADIC ' : '') + value + '::' +
      postgresIdentifier(cast.schema) + '.' + postgresIdentifier(cast.name);
  });
  const call = postgresIdentifier(metadata.schema) + '.' + postgresIdentifier(metadata.name) + '(' + args.join(', ') + ')';
  if (procedure) return 'CALL ' + call + ';';
  if (metadata.setReturning) return 'SELECT * FROM ' + call + ';';
  return 'SELECT ' + call + (info.category === 'w' ? ' OVER ()' : '') + ' AS "结果";';
}

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
