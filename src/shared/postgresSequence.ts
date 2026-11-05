import { z } from 'zod';
import { postgresCreateTableSchemasSchema, postgresDdlLiteral, postgresDdlText, postgresNewIdentifier } from './postgresCreateTable';
import { postgresIdentifier } from './postgresSql';
import { postgresStructureInputSchema } from './postgresStructure';

const integer = z.string().regex(/^-?(?:0|[1-9][0-9]{0,18})$/);
const sequenceTypes = ['smallint', 'integer', 'bigint'] as const;
const sequenceType = z.enum(sequenceTypes);
export const postgresSequenceReadSchema = postgresStructureInputSchema;
const sequenceSettings = z.object({ dataType: sequenceType, cycle: z.boolean(), start: integer,
  increment: integer, minimum: integer, maximum: integer, cache: integer });
export const postgresSequenceCreateSchema = postgresCreateTableSchemasSchema.extend({
  schema: postgresNewIdentifier, name: postgresNewIdentifier, dataType: sequenceType, cycle: z.boolean(),
  start: integer.or(z.literal('')), increment: integer.or(z.literal('')), minimum: integer.or(z.literal('')),
  maximum: integer.or(z.literal('')), cache: integer.or(z.literal('')), comment: postgresDdlText,
}).strict();
export type PostgresSequenceCreateInput = z.infer<typeof postgresSequenceCreateSchema>;
export type PostgresSequenceReadInput = z.infer<typeof postgresSequenceReadSchema>;

export const postgresSequenceInfoSchema = z.object({
  schema: z.string().min(1), name: z.string().min(1), dataType: sequenceType,
  start: integer, increment: integer, minimum: integer, maximum: integer, cache: integer,
  cycle: z.boolean(), lastValue: integer.nullable(), comment: z.string().nullable(),
  ownedBy: z.object({ schema: z.string(), relation: z.string(), column: z.string(), identity: z.boolean() }).strict().nullable(),
  owner: z.string().min(1),
  canManage: z.boolean(), stamp: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type PostgresSequenceInfo = z.infer<typeof postgresSequenceInfoSchema>;

const manageTarget = postgresStructureInputSchema.extend({ stamp: postgresSequenceInfoSchema.shape.stamp });
const roleKey = z.string().regex(/^[1-9][0-9]{0,9}$/);
const columnKey = z.string().regex(/^[1-9][0-9]{0,9}:[1-9][0-9]{0,3}$/);
export const postgresSequenceTargetsSchema = manageTarget.extend({ kind: z.enum(['column', 'role']),
  search: z.string().max(256).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value)) }).strict();
export type PostgresSequenceTargetsInput = z.infer<typeof postgresSequenceTargetsSchema>;
export type PostgresSequenceTargets = { choices: { key: string; label: string }[]; limited: boolean };
export const postgresSequenceManageSchema = z.discriminatedUnion('action', [
  manageTarget.extend({ action: z.literal('edit'), ...sequenceSettings.shape, comment: postgresDdlText.optional(),
    restart: integer.or(z.literal('')) }).strict(),
  manageTarget.extend({ action: z.literal('rename'), name: postgresNewIdentifier }).strict(),
  manageTarget.extend({ action: z.literal('drop') }).strict(),
  manageTarget.extend({ action: z.literal('bind'), key: columnKey }).strict(),
  manageTarget.extend({ action: z.literal('detach') }).strict(),
  manageTarget.extend({ action: z.literal('owner'), key: roleKey }).strict(),
]);
export type PostgresSequenceManageInput = z.infer<typeof postgresSequenceManageSchema>;

const limits = {
  smallint: [-32768n, 32767n], integer: [-2147483648n, 2147483647n],
  bigint: [-9223372036854775808n, 9223372036854775807n],
} as const;

/** 校验序列的全部精确参数，创建时补齐升降序默认值。 */
function sequenceParameters(input: z.infer<typeof sequenceSettings>) {
  const [lower, upper] = limits[input.dataType], [bigLower, bigUpper] = limits.bigint;
  const increment = BigInt(input.increment || '1'), cache = BigInt(input.cache || '1');
  if (increment === 0n || increment < bigLower || increment > bigUpper || cache < 1n || cache > bigUpper)
    throw Error('增量必须为非零 64 位整数，缓存必须为正 64 位整数');
  const minimum = input.minimum ? BigInt(input.minimum) : increment > 0n ? 1n : lower;
  const maximum = input.maximum ? BigInt(input.maximum) : increment > 0n ? upper : -1n;
  const start = input.start ? BigInt(input.start) : increment > 0n ? minimum : maximum;
  if (minimum < lower || maximum > upper || minimum >= maximum || start < minimum || start > maximum)
    throw Error('起始值和上下限须符合数据类型，且最小值小于最大值');
  const options = ' AS ' + input.dataType +
    ' INCREMENT BY ' + increment + ' MINVALUE ' + minimum + ' MAXVALUE ' + maximum +
    ' START WITH ' + start + ' CACHE ' + cache + (input.cycle ? ' CYCLE' : ' NO CYCLE');
  const expected = { dataType: input.dataType, start: String(start), increment: String(increment), minimum: String(minimum),
    maximum: String(maximum), cache: String(cache), cycle: input.cycle };
  return { options, expected, minimum, maximum };
}

/** 用 PostgreSQL 的升降序默认值生成明确的 SQL，全程保留 64 位整数。 */
export function postgresSequencePlan(raw: PostgresSequenceCreateInput) {
  const input = postgresSequenceCreateSchema.parse(raw);
  const { options, expected } = sequenceParameters(input);
  const table = postgresIdentifier(input.schema) + '.' + postgresIdentifier(input.name);
  const statements = ['CREATE SEQUENCE ' + table + options];
  if (input.comment) statements.push('COMMENT ON SEQUENCE ' + table + ' IS ' + postgresDdlLiteral(input.comment));
  return { table, statements, expected: { ...expected, comment: input.comment || null } };
}

/** 只生成实际变更的 SQL。显式重启使用事务内的 RESTART，避免 setval 的即时副作用。 */
export function postgresSequenceEditPlan(input: Extract<PostgresSequenceManageInput, { action: 'edit' }>, original: PostgresSequenceInfo, table: string) {
  const { options, expected, minimum, maximum } = sequenceParameters(input);
  const restart = input.restart ? BigInt(input.restart) : null;
  if (restart !== null && (restart < minimum || restart > maximum)) throw Error('重启值须在序列上下限内');
  const comment = input.comment === undefined ? original.comment : input.comment || null;
  const configurationChanged = (Object.keys(expected) as (keyof typeof expected)[])
    .some(key => original[key] !== expected[key]);
  const statements: string[] = [];
  if (configurationChanged || restart !== null) statements.push('ALTER SEQUENCE ' + table +
    (configurationChanged ? options : '') + (restart === null ? '' : ' RESTART WITH ' + restart));
  if (original.comment !== comment) statements.push('COMMENT ON SEQUENCE ' + table +
    ' IS ' + (comment === null ? 'NULL' : postgresDdlLiteral(comment)));
  if (!statements.length) throw Error('请修改序列参数或填写重启值');
  return { statements, expected: { ...expected, comment }, restart: restart?.toString() };
}
