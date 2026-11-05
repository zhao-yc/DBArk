import { z } from 'zod';
import { postgresCreateTableSchemasSchema, postgresDdlLiteral, postgresDdlText, postgresNewIdentifier } from './postgresCreateTable';
import { postgresIdentifier } from './postgresSql';
import { postgresStructureInputSchema } from './postgresStructure';

const integer = z.string().regex(/^-?(?:0|[1-9][0-9]{0,18})$/);
const sequenceTypes = ['smallint', 'integer', 'bigint'] as const;
const sequenceType = z.enum(sequenceTypes);
export const postgresSequenceReadSchema = postgresStructureInputSchema;
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
}).strict();
export type PostgresSequenceInfo = z.infer<typeof postgresSequenceInfoSchema>;

const limits = {
  smallint: [-32768n, 32767n], integer: [-2147483648n, 2147483647n],
  bigint: [-9223372036854775808n, 9223372036854775807n],
} as const;

/** 用 PostgreSQL 的升降序默认值生成明确的 SQL，全程保留 64 位整数。 */
export function postgresSequencePlan(raw: PostgresSequenceCreateInput) {
  const input = postgresSequenceCreateSchema.parse(raw);
  const [lower, upper] = limits[input.dataType], [bigLower, bigUpper] = limits.bigint;
  const increment = BigInt(input.increment || '1'), cache = BigInt(input.cache || '1');
  if (increment === 0n || increment < bigLower || increment > bigUpper || cache < 1n || cache > bigUpper)
    throw Error('增量必须为非零 64 位整数，缓存必须为正 64 位整数');
  const minimum = input.minimum ? BigInt(input.minimum) : increment > 0n ? 1n : lower;
  const maximum = input.maximum ? BigInt(input.maximum) : increment > 0n ? upper : -1n;
  const start = input.start ? BigInt(input.start) : increment > 0n ? minimum : maximum;
  if (minimum < lower || maximum > upper || minimum >= maximum || start < minimum || start > maximum)
    throw Error('起始值和上下限须符合数据类型，且最小值小于最大值');
  const table = postgresIdentifier(input.schema) + '.' + postgresIdentifier(input.name);
  const statements = ['CREATE SEQUENCE ' + table + ' AS ' + input.dataType +
    ' INCREMENT BY ' + increment + ' MINVALUE ' + minimum + ' MAXVALUE ' + maximum +
    ' START WITH ' + start + ' CACHE ' + cache + (input.cycle ? ' CYCLE' : ' NO CYCLE')];
  if (input.comment) statements.push('COMMENT ON SEQUENCE ' + table + ' IS ' + postgresDdlLiteral(input.comment));
  const expected = { dataType: input.dataType, start: String(start), increment: String(increment), minimum: String(minimum),
    maximum: String(maximum), cache: String(cache), cycle: input.cycle, comment: input.comment || null };
  return { table, statements, expected };
}
