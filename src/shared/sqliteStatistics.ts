import { z } from 'zod';
import { sqliteRowCountSchema as count, sqliteTablePageSchema } from './sqliteTableBrowse';
import { sqliteValueOptionSchema } from './sqliteValueOptions';

export const sqliteStatisticsLimits = { groups: 5, bytes: 1024 * 1024, cellBytes: 65536, active: 2 } as const;
export const sqliteStorageKinds = ['blob', 'integer', 'null', 'real', 'text'] as const;
const page = sqliteTablePageSchema.shape;
const aggregateSource = { connectionId: page.connectionId, database: z.literal('main'), table: page.table, schemaKey: z.string().regex(/^[a-f0-9]{64}$/), taskId: page.taskId, mode: page.mode, filters: page.filters };
/** 聚合沿分页筛选预算，拒绝额外 SQL、路径、分页及会话权限。 */
function validateConditions(input: z.infer<typeof sqliteRowCountInputBase>, context: z.RefinementCtx): void {
  // 只把分页合同声明的字段交给原条件验证，不能用额外统计字段绕过预算。
  const conditions = sqliteTablePageSchema.safeParse({ connectionId: input.connectionId, database: input.database, table: input.table, taskId: input.taskId, mode: input.mode, filters: input.filters, sort: [], offset: 0, limit: 1 });
  if (!conditions.success) for (const issue of conditions.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
}
const sqliteRowCountInputBase = z.object(aggregateSource).strict();
export const sqliteRowCountInputSchema = sqliteRowCountInputBase.superRefine(validateConditions);
export const sqliteStatisticsInputSchema = sqliteRowCountInputBase.extend({ column: page.table }).superRefine(validateConditions);
const sqliteRowCountOutputSchema = z.object({ request: sqliteRowCountInputSchema, rows: count }).strict();
export type SqliteRowCountInput = z.infer<typeof sqliteRowCountInputSchema>;
export type SqliteRowCountOutput = z.infer<typeof sqliteRowCountOutputSchema>;

/** 精确十进制计数绑定原任务与筛选，不通过 JavaScript 数字转换。 */
export function assertSqliteRowCount(raw: unknown, request: SqliteRowCountInput): SqliteRowCountOutput {
  const result = sqliteRowCountOutputSchema.parse(raw);
  if (JSON.stringify(result.request) !== JSON.stringify(sqliteRowCountInputSchema.parse(request))) throw Error('SQLite匹配行数回包与原请求不符');
  return result;
}
// 概况仅展示，不受筛选候选的32KiB BLOB选取范围限制；完整原字节仍固定64KiB。
export const sqliteStatisticsValueSchema = z.union([sqliteValueOptionSchema.shape.value, z.object({ kind: z.literal('blob'), value: z.string().max(sqliteStatisticsLimits.cellBytes * 2).regex(/^(?:[0-9a-fA-F]{2})*$/) }).strict()]);
export const sqliteStatisticsGroupSchema = z.object({ kind: z.enum(sqliteStorageKinds), count, distinct: count, min: sqliteStatisticsValueSchema, max: sqliteStatisticsValueSchema }).strict();
export const sqliteStatisticsOutputSchema = z.object({ request: sqliteStatisticsInputSchema, declaredType: z.string().max(4096), rows: count, nonNull: count, nulls: count, groups: z.array(sqliteStatisticsGroupSchema).max(5) }).strict();
export type SqliteStatisticsInput = z.infer<typeof sqliteStatisticsInputSchema>;
export type SqliteStatisticsOutput = z.infer<typeof sqliteStatisticsOutputSchema>;
export type SqliteStatisticsValue = z.infer<typeof sqliteStatisticsValueSchema>;
/** 回包整份绑定原任务；类型、数量恒等式、非空极值和预算不符时拒绝，不发布部分统计。 */
export function assertSqliteStatistics(raw: unknown, request: SqliteStatisticsInput): SqliteStatisticsOutput {
  const parsed = sqliteStatisticsOutputSchema.safeParse(raw);
  if (!parsed.success) throw Error('SQLite字段概况回包无效或超过完整展示预算');
  const value = parsed.data;
  if (JSON.stringify(value.request) !== JSON.stringify(sqliteStatisticsInputSchema.parse(request)) || new TextEncoder().encode(JSON.stringify(value)).length > sqliteStatisticsLimits.bytes) throw Error('SQLite字段概况回包与原请求不符或超过预算');
  let rows = 0n, nulls = 0n, previous = -1;
  for (const group of value.groups) {
    const order = sqliteStorageKinds.indexOf(group.kind), size = BigInt(group.count), distinct = BigInt(group.distinct);
    if (order <= previous || size < 1n || distinct > size || group.min.kind !== group.kind || group.max.kind !== group.kind || (group.kind === 'null' ? distinct !== 0n : distinct < 1n)) throw Error('SQLite字段概况类型、顺序或计数无效');
    previous = order; rows += size; if (group.kind === 'null') nulls += size;
    for (const bound of [group.min, group.max]) if ('value' in bound && (bound.kind === 'blob' ? bound.value.length / 2 : new TextEncoder().encode(bound.value).length) > sqliteStatisticsLimits.cellBytes) throw Error('SQLite字段极值超过完整展示预算');
    if (group.min.kind === 'integer' && group.max.kind === 'integer' && BigInt(group.min.value) > BigInt(group.max.value) || group.min.kind === 'real' && group.max.kind === 'real' && Number(group.min.value) > Number(group.max.value) || group.min.kind === 'blob' && group.max.kind === 'blob' && group.min.value.toLowerCase() > group.max.value.toLowerCase()) throw Error('SQLite字段概况极值顺序无效');
  }
  if (rows !== BigInt(value.rows) || nulls !== BigInt(value.nulls) || rows - nulls !== BigInt(value.nonNull)) throw Error('SQLite字段概况数量不完整');
  return value;
}
