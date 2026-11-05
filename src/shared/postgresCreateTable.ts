import { z } from 'zod';
import { postgresIdentifier } from './postgresSql';

const utf8 = new TextEncoder();
const key = z.string().min(1).max(512).refine(value => !value.includes('\0'));
export const postgresNewIdentifier = z.string().min(1).max(63).refine(value =>
  utf8.encode(value).byteLength <= 63 && !/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(value) && !!value.trim(),
'标识符不能为空，且最多允许 63 个 UTF-8 字节');
export const postgresDdlText = z.string().max(4096).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
const target = z.object({ connectionId: key, database: key }).strict();

export const postgresCreateTypes = [
  'bigint', 'integer', 'smallint', 'text', 'varchar', 'numeric', 'boolean', 'date', 'timestamp',
  'timestamptz', 'uuid', 'jsonb', 'bytea', 'real', 'double precision',
] as const;
const type = z.enum(postgresCreateTypes);
const integerTypes = new Set<string>(['bigint', 'integer', 'smallint']);
export const postgresColumnTypeSchema = z.object({
  type,
  length: z.number().int().min(1).max(10485760).optional(),
  precision: z.number().int().min(1).max(1000).optional(),
  scale: z.number().int().min(0).max(1000).optional(),
}).strict().superRefine((field, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (field.length !== undefined && field.type !== 'varchar') issue('只有 varchar 支持长度');
  if ((field.precision !== undefined || field.scale !== undefined) && field.type !== 'numeric') issue('只有 numeric 支持精度和小数位');
  if (field.scale !== undefined && (field.precision === undefined || field.scale > field.precision)) issue('numeric 小数位不能超过精度');
});
export type PostgresColumnType = z.infer<typeof postgresColumnTypeSchema>;
export const postgresCreateColumnSchema = postgresColumnTypeSchema.safeExtend({
  name: postgresNewIdentifier, nullable: z.boolean(), primary: z.boolean(), unique: z.boolean(),
  identity: z.enum(['none', 'always', 'byDefault']),
  default: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('none') }).strict(), z.object({ mode: z.literal('literal'), value: postgresDdlText }).strict(),
    z.object({ mode: z.literal('currentDate') }).strict(), z.object({ mode: z.literal('currentTimestamp') }).strict(),
  ]),
  comment: postgresDdlText,
}).superRefine((field, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (field.identity !== 'none' && (!integerTypes.has(field.type) || field.default.mode !== 'none')) issue('标识列需要整数类型，且不能另设默认值');
  if (field.default.mode === 'currentDate' && field.type !== 'date') issue('当前日期默认值需要 date 类型');
  if (field.default.mode === 'currentTimestamp' && !['timestamp', 'timestamptz'].includes(field.type)) issue('当前时间默认值需要 timestamp 或 timestamptz 类型');
});

/** 表单只提交结构化字段；表名、类型、默认值和注释均有明确语法边界。 */
export const postgresCreateTablePreviewSchema = target.extend({
  schema: postgresNewIdentifier, table: postgresNewIdentifier, columns: z.array(postgresCreateColumnSchema).min(1).max(128), comment: postgresDdlText,
}).strict().superRefine((input, context) => {
  if (input.schema.startsWith('pg_') || input.schema === 'information_schema') context.addIssue({ code: 'custom', message: '请选择普通用户 schema' });
  if (new Set(input.columns.map(field => field.name)).size !== input.columns.length) context.addIssue({ code: 'custom', message: '字段名称不能重复' });
  if (input.columns.filter(field => field.primary).length > 32) context.addIssue({ code: 'custom', message: '主键最多允许 32 列' });
  const textSize = input.columns.reduce((total, field) => total + utf8.encode(field.comment).byteLength +
    (field.default.mode === 'literal' ? utf8.encode(field.default.value).byteLength : 0), utf8.encode(input.comment).byteLength);
  if (textSize > 128 * 1024) context.addIssue({ code: 'custom', message: '默认值与注释超过建表预算' });
});
export const postgresCreateTableSchemasSchema = target;
export const postgresCreateTableApplySchema = target.extend({ token: z.uuid() }).strict();
export type PostgresCreateTableTarget = z.infer<typeof target>;
export type PostgresCreateTableInput = z.infer<typeof postgresCreateTablePreviewSchema>;
export type PostgresCreateColumn = z.infer<typeof postgresCreateColumnSchema>;
export type PostgresCreateTableApply = z.infer<typeof postgresCreateTableApplySchema>;
export interface PostgresCreateTablePreview { token: string; statements: string[]; }
export interface PostgresCreateTableOutcome {
  outcome: 'committed' | 'notSent' | 'rolledBack' | 'unknown';
  message: string;
  table?: string;
}

/** 显式 E 字符串只含转义后的数据，不依赖服务器 standard_conforming_strings。 */
export function postgresDdlLiteral(value: string): string {
  return "E'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
}

/** 建表和新增列共用同一份字段 SQL 与服务器默认值校验数据。 */
export function postgresColumnDefinition(field: PostgresCreateColumn) {
  const sqlType = postgresColumnTypeSql(field);
  const parts = [postgresIdentifier(field.name), sqlType];
  if (field.identity !== 'none') parts.push(field.identity === 'always' ? 'GENERATED ALWAYS AS IDENTITY' : 'GENERATED BY DEFAULT AS IDENTITY');
  if (!field.nullable || field.primary || field.identity !== 'none') parts.push('NOT NULL');
  if (field.unique) parts.push('UNIQUE');
  if (field.default.mode === 'literal') parts.push('DEFAULT ' + postgresDdlLiteral(field.default.value) + '::' + sqlType);
  if (field.default.mode === 'currentDate') parts.push('DEFAULT CURRENT_DATE');
  if (field.default.mode === 'currentTimestamp') parts.push('DEFAULT CURRENT_TIMESTAMP');
  return { sql: parts.join(' '), check: field.default.mode === 'literal'
    ? { name: field.name, type: sqlType, value: field.default.value, length: field.length } : undefined };
}

/** 类型仅由白名单和受限整数构成，不将用户文本当作 SQL 类型表达式。 */
export function postgresColumnTypeSql(field: PostgresColumnType): string {
  if (field.type === 'varchar' && field.length !== undefined) return 'varchar(' + field.length + ')';
  if (field.type === 'numeric' && field.precision !== undefined) return 'numeric(' + field.precision + ', ' + (field.scale ?? 0) + ')';
  return field.type;
}

/** 同一计划生成预览和执行文本，默认值参数先经服务器实际类型校验。 */
export function postgresCreateTablePlan(raw: PostgresCreateTableInput): {
  table: string; statements: string[]; checks: { name: string; type: string; value: string }[];
} {
  const input = postgresCreateTablePreviewSchema.parse(raw);
  const table = postgresIdentifier(input.schema) + '.' + postgresIdentifier(input.table);
  const checks: { name: string; type: string; value: string }[] = [];
  const fields = input.columns.map(field => {
    const { sql, check } = postgresColumnDefinition(field);
    if (check) checks.push({ name: check.name, type: check.type, value: check.value });
    return '  ' + sql;
  });
  const primary = input.columns.filter(field => field.primary).map(field => postgresIdentifier(field.name));
  if (primary.length) fields.push('  PRIMARY KEY (' + primary.join(', ') + ')');
  const statements = ['CREATE TABLE ' + table + ' (\n' + fields.join(',\n') + '\n)'];
  if (input.comment) statements.push('COMMENT ON TABLE ' + table + ' IS ' + postgresDdlLiteral(input.comment));
  for (const field of input.columns) if (field.comment) {
    statements.push('COMMENT ON COLUMN ' + table + '.' + postgresIdentifier(field.name) + ' IS ' + postgresDdlLiteral(field.comment));
  }
  return { table, statements, checks };
}
