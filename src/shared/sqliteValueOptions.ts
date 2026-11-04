import { z } from 'zod';
import { sqliteTablePageSchema, sqliteFilterSelectionSchema, type SqliteFilterSelection } from './sqliteTableBrowse';

export const sqliteValueOptionsLimits = { groups: 500, pageSize: 50, selected: 128, bytes: 8 * 1024 * 1024, search: 256 } as const;
export const sqliteValueOptionsOrderSchema = z.enum(['value', 'count-desc', 'count-asc']);
export type SqliteValueOptionsOrder = z.infer<typeof sqliteValueOptionsOrderSchema>;
const name = sqliteTablePageSchema.shape.table;
/** 候选沿原已应用条件读取，不接受SQL、路径、写能力或用户查询会话。 */
export const sqliteValueOptionsInputSchema = z.object({
  connectionId: sqliteTablePageSchema.shape.connectionId, database: z.literal('main'), table: name, column: name,
  schemaKey: z.string().regex(/^[a-f0-9]{64}$/), taskId: sqliteTablePageSchema.shape.taskId,
  relation: sqliteTablePageSchema.shape.relation, mode: sqliteTablePageSchema.shape.mode, filters: sqliteTablePageSchema.shape.filters,
  search: z.string().max(sqliteValueOptionsLimits.search).refine(value => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)),
  order: sqliteValueOptionsOrderSchema.optional(),
}).strict().superRefine((input, context) => {
  const parsed = sqliteTablePageSchema.safeParse({ connectionId: input.connectionId, database: input.database, table: input.table, taskId: input.taskId, mode: input.mode, filters: input.filters, ...(input.relation ? { relation: input.relation } : {}), sort: [], offset: 0, limit: 1 });
  if (!parsed.success) for (const issue of parsed.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
});
/** 无穷REAL允许展示，但既有有限数值筛选不能选择；不转换成文本、NULL或有限近似。 */
export const sqliteValueOptionSchema = z.object({
  value: z.union([sqliteFilterSelectionSchema, z.object({ kind: z.literal('real'), value: z.enum(['Infinity', '-Infinity']) }).strict()]),
  count: z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n),
}).strict();
export const sqliteValueOptionsOutputSchema = z.object({ request: sqliteValueOptionsInputSchema, values: z.array(sqliteValueOptionSchema).max(sqliteValueOptionsLimits.groups), truncated: z.boolean() }).strict();
export type SqliteValueOptionsInput = z.infer<typeof sqliteValueOptionsInputSchema>;
export type SqliteValueOptionsOutput = z.infer<typeof sqliteValueOptionsOutputSchema>;
export type SqliteValueOption = z.infer<typeof sqliteValueOptionSchema>;
/** 整份回包绑定准确任务、字段、结构及条件；超限和重复代表值不发布部分候选。 */
export function assertSqliteValueOptions(raw: unknown, request: SqliteValueOptionsInput): SqliteValueOptionsOutput {
  const value = sqliteValueOptionsOutputSchema.parse(raw);
  if (JSON.stringify(value.request) !== JSON.stringify(sqliteValueOptionsInputSchema.parse(request)) || value.truncated && value.values.length !== sqliteValueOptionsLimits.groups || new TextEncoder().encode(JSON.stringify(value)).length > sqliteValueOptionsLimits.bytes) throw Error('SQLite不同值回包与原请求不符或超过预算');
  const seen = new Set<string>(), order = value.request.order;
  let previous: bigint | undefined;
  for (const option of value.values) {
    const key = JSON.stringify(option.value); if (seen.has(key)) throw Error('SQLite不同值出现重复代表值'); seen.add(key);
    // 次数保持64位整数原文；错序回包整份拒绝，不能用展示字符串或浮点近似验证。
    const count = BigInt(option.count);
    if (previous !== undefined && (order === 'count-desc' && count > previous || order === 'count-asc' && count < previous)) throw Error('SQLite不同值次数顺序与原请求不符');
    previous = count;
  }
  return value;
}
/** 只由原候选编号构造一条混合类型条件，不能以可见文本猜测类型。 */
export function sqliteValueOptionsSelection(output: SqliteValueOptionsOutput, indices: readonly number[]): SqliteFilterSelection[] {
  if (!Array.isArray(indices) || Object.getPrototypeOf(indices) !== Array.prototype || !indices.length || indices.length > sqliteValueOptionsLimits.selected || Reflect.ownKeys(indices).length !== indices.length + 1) throw Error('请选择1至128个不同值');
  const seen = new Set<number>(), values: SqliteFilterSelection[] = [];
  for (let at = 0; at < indices.length; at++) { const slot = Object.getOwnPropertyDescriptor(indices, String(at)), index = slot && 'value' in slot ? slot.value : undefined; if (!Number.isSafeInteger(index) || index < 0 || index >= output.values.length || seen.has(index)) throw Error('SQLite勾选候选已失效'); seen.add(index); values.push(sqliteFilterSelectionSchema.parse(output.values[index].value)); }
  return values;
}
