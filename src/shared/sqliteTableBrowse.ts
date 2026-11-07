import { z } from 'zod';
import type { QueryResult } from './contracts';

/** 表浏览始终有界；不通过完整COUNT或一次性读取全表来计算页数。 */
export const sqliteTableBrowseLimits = { pageSize: 1000, offset: 1000000000, filters: 32, listValues: 128, parameters: 1024, sorts: 8, columns: 1024, resultBytes: 16 * 1024 * 1024, valueUnits: 65536 } as const;
export const sqliteRowCountSchema = z.string().regex(/^(?:0|[1-9][0-9]{0,18})$/).refine(value => /^(?:0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n);

/** 精确计算末页偏移与行数，整页边界不能跳到额外空页。 */
export function sqliteLastPagePosition(count: string, limit: number): { offset: number; rows: number } {
  const total = BigInt(sqliteRowCountSchema.parse(count));
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > sqliteTableBrowseLimits.pageSize) throw Error('SQLite末页页长无效');
  const size = BigInt(limit), offset = total > 0n ? (total - 1n) / size * size : 0n;
  if (offset > BigInt(sqliteTableBrowseLimits.offset)) throw Error('SQLite末页超出可浏览的偏移范围，请缩小筛选范围');
  return { offset: Number(offset), rows: Number(total - offset) };
}
export const sqliteTextFilterOperators = ['contains', 'notContains', 'startsWith', 'notStartsWith', 'endsWith', 'notEndsWith'] as const;
/** 表单和合同共用文本运算符集合，不能将数值或二进制隐式转成文本。 */
export function isSqliteTextFilter(operator: string): operator is typeof sqliteTextFilterOperators[number] { return sqliteTextFilterOperators.some(value => value === operator); }
/** 名称及文本拒绝孤立代理项，避免跨进程UTF8编码静默改成另一个字符。 */
function validUnicode(value: string): boolean { return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value); }
const name = z.string().min(1).max(512).refine(value => !value.includes('\0') && validUnicode(value), 'SQLite名称不能包含空字符或无效Unicode');
const integer = z.string().regex(/^-?(?:0|[1-9][0-9]*)$/).max(20).refine(value => { if (value.length > 20) return false; try { const n = BigInt(value); return n >= -9223372036854775808n && n <= 9223372036854775807n; } catch { return false; } }, 'SQLite整数必须在有符号64位范围内');
const real = z.string().min(1).max(64).regex(/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/).refine(value => value.length <= 64 && Number.isFinite(Number(value)), 'SQLite实数必须为有限数值');
const operand = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string().max(sqliteTableBrowseLimits.valueUnits).refine(validUnicode, '筛选文本包含无效Unicode') }).strict(),
  z.object({ kind: z.literal('integer'), value: integer }).strict(),
  z.object({ kind: z.literal('real'), value: real }).strict(),
  z.object({ kind: z.literal('blob'), value: z.string().max(sqliteTableBrowseLimits.valueUnits).regex(/^(?:[0-9a-fA-F]{2})*$/, '二进制条件填写完整十六进制字节') }).strict(),
]);
export const sqliteFilterSelectionSchema = z.union([operand, z.object({ kind: z.literal('null') }).strict()]);
export type SqliteFilterSelection = z.infer<typeof sqliteFilterSelectionSchema>;
/** 不同类型勾选先核纯自有值与预算；NULL不能夹带被忽略的value。 */
const selectedOperands = z.unknown().transform((raw, context) => {
  const invalid = () => { context.addIssue({ code: 'custom', message: '勾选筛选需1至128个原类型值，并符合累计原值上限' }); return z.NEVER; };
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length < 1 || raw.length > sqliteTableBrowseLimits.listValues || Reflect.ownKeys(raw).length !== raw.length + 1) return invalid();
  const output: SqliteFilterSelection[] = []; let units = 0;
  for (let index = 0; index < raw.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(raw, String(index)), item = slot && 'value' in slot ? slot.value : undefined;
    if (!item || typeof item !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) return invalid();
    const keys = Reflect.ownKeys(item), copy: Record<string, unknown> = {};
    if (keys.length > 2 || keys.some(key => key !== 'kind' && key !== 'value')) return invalid();
    for (const key of keys) { const field = Object.getOwnPropertyDescriptor(item, key); if (!field?.enumerable || !('value' in field)) return invalid(); copy[key as string] = field.value; }
    if (typeof copy.value === 'string') units += copy.value.length; if (units > 131072) return invalid();
    const parsed = sqliteFilterSelectionSchema.safeParse(copy); if (!parsed.success) return invalid(); output.push(parsed.data);
  }
  return output;
});
/** 列表先界定数量和累计原值大小，再解析各项，避免先复制超大数组或执行访问器。 */
const listOperands = z.unknown().transform((raw, context) => {
  const invalid = () => { context.addIssue({ code: 'custom', message: '列表需1至128个同类型值，且须符合原值格式与总量上限' }); return z.NEVER; };
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length < 1 || raw.length > sqliteTableBrowseLimits.listValues || Reflect.ownKeys(raw).length !== raw.length + 1) return invalid();
  const values: z.infer<typeof operand>[] = []; let units = 0;
  for (let index = 0; index < raw.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(raw, String(index)), item = slot && 'value' in slot ? slot.value : undefined;
    if (!item || typeof item !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(item)) || Reflect.ownKeys(item).length !== 2) return invalid();
    const kind = Object.getOwnPropertyDescriptor(item, 'kind'), value = Object.getOwnPropertyDescriptor(item, 'value');
    if (!kind || !value || !('value' in kind) || !('value' in value) || typeof value.value !== 'string') return invalid();
    units += value.value.length; if (units > 131072) return invalid();
    const parsed = operand.safeParse({ kind: kind.value, value: value.value }); if (!parsed.success || values[0] && parsed.data.kind !== values[0].kind) return invalid();
    values.push(parsed.data);
  }
  return values;
});
export const sqliteTableFilterSchema = z.object({
  column: name, operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', ...sqliteTextFilterOperators, 'isNull', 'notNull', 'between', 'notBetween', 'in', 'notIn', 'oneOf', 'notOneOf']), value: operand.optional(), secondValue: operand.optional(), values: listOperands.optional(), selectedValues: selectedOperands.optional(), enabled: z.boolean().optional(),
}).strict().superRefine((filter, context) => {
  const nullCheck = filter.operator === 'isNull' || filter.operator === 'notNull', list = filter.operator === 'in' || filter.operator === 'notIn', selected = filter.operator === 'oneOf' || filter.operator === 'notOneOf';
  if (nullCheck || list || selected ? filter.value !== undefined : filter.value === undefined) context.addIssue({ code: 'custom', message: 'NULL或列表条件不带单值，其余条件必须明确类型和值' });
  if (list ? !filter.values : filter.values !== undefined) context.addIssue({ code: 'custom', message: '只有列表条件可填写列表值，且列表不能留空' });
  if (selected ? !filter.selectedValues : filter.selectedValues !== undefined) context.addIssue({ code: 'custom', message: '只有勾选值条件可填写原类型集合，且集合不能为空' });
  if (isSqliteTextFilter(filter.operator) && filter.value?.kind !== 'text') context.addIssue({ code: 'custom', message: '文本匹配条件只接受文本原文' });
  if (filter.value?.kind === 'blob' && !['eq', 'ne'].includes(filter.operator)) context.addIssue({ code: 'custom', message: '二进制条件目前只支持等于与不等于' });
  // 范围两个边界须明确且同型；其他比较不能夹带被静默忽略的第二个值。
  const range = filter.operator === 'between' || filter.operator === 'notBetween';
  if (range ? !filter.secondValue || filter.secondValue.kind !== filter.value?.kind || filter.secondValue.kind === 'blob' : filter.secondValue !== undefined) context.addIssue({ code: 'custom', message: '范围条件必须填写同类型的两个边界，且不支持二进制；其它条件不带第二个值' });
});
/** 关联范围独立于用户筛选，Main每次核对真实外键及两端结构；值只留在当前会话。 */
export const sqliteTableRelationSchema = z.object({
  parentTable: name, parentSchemaKey: z.string().regex(/^[a-f0-9]{64}$/), childSchemaKey: z.string().regex(/^[a-f0-9]{64}$/), foreignKey: z.number().int().min(0).max(2147483647),
  parentColumns: z.array(name).min(1).max(64), childColumns: z.array(name).min(1).max(64), values: z.array(sqliteFilterSelectionSchema).min(1).max(64),
}).strict().superRefine((value, context) => {
  const fold = (name: string) => name.replace(/[A-Z]/g, character => character.toLowerCase());
  if (value.parentColumns.length !== value.childColumns.length || value.values.length !== value.childColumns.length || new Set(value.parentColumns.map(fold)).size !== value.parentColumns.length || new Set(value.childColumns.map(fold)).size !== value.childColumns.length || value.values.reduce((sum, item) => sum + (item.kind === 'null' ? 0 : item.value.length), 0) > 131072) context.addIssue({ code: 'custom', message: 'SQLite关联元组映射不完整、重复或超过预算' });
});
export type SqliteTableRelation = z.infer<typeof sqliteTableRelationSchema>;
export const sqliteTablePageSchema = z.object({
  connectionId: z.string().min(1).max(200), database: z.literal('main'), table: name, taskId: z.string().min(1).max(200),
  offset: z.number().int().min(0).max(sqliteTableBrowseLimits.offset), limit: z.number().int().min(1).max(sqliteTableBrowseLimits.pageSize),
  lastPage: z.literal(true).optional(), relation: sqliteTableRelationSchema.optional(), searchRecordRef: z.string().uuid().optional(),
  mode: z.enum(['and', 'or']), filters: z.array(sqliteTableFilterSchema).max(sqliteTableBrowseLimits.filters), editing: z.boolean().optional(),
  sort: z.array(z.object({ column: name, direction: z.enum(['asc', 'desc']) }).strict()).max(sqliteTableBrowseLimits.sorts),
}).strict().superRefine((input, context) => {
  if (input.searchRecordRef && (!input.editing || input.offset !== 0 || input.limit !== 1 || input.lastPage || input.relation ||
      input.filters.length || input.sort.length || input.mode !== 'and'))
    context.addIssue({ code: 'custom', message: '搜索命中编辑只允许读取原来的一条记录' });
  if (input.lastPage && input.offset !== 0) context.addIssue({ code: 'custom', path: ['offset'], message: 'SQLite末页请求不能指定偏移' });
  if (new Set(input.sort.map(sort => sort.column)).size !== input.sort.length) context.addIssue({ code: 'custom', message: '排序列不能重复' });
  if (input.filters.reduce((size, filter) => size + (filter.value?.value.length ?? 0) + (filter.secondValue?.value.length ?? 0) + (filter.values?.reduce((total, value) => total + value.value.length, 0) ?? 0) + (filter.selectedValues?.reduce((total, value) => total + (value.kind === 'null' ? 0 : value.value.length), 0) ?? 0), 0) > 131072) context.addIssue({ code: 'custom', message: 'SQLite筛选值总量超过预算' });
  // 保留utility原1024个位置绑定保护，预留分页两个；完整导出与生成查询沿同一准入。
  const parameters = input.filters.reduce((total, filter) => total + (filter.enabled === false || ['isNull', 'notNull'].includes(filter.operator) ? 0 : ['oneOf', 'notOneOf'].includes(filter.operator) ? (filter.selectedValues?.filter(value => value.kind !== 'null').length ?? 0) * 2 : ['in', 'notIn'].includes(filter.operator) ? 1 + (filter.values?.length ?? 0) : ['between', 'notBetween', 'endsWith', 'notEndsWith'].includes(filter.operator) ? 3 : 2), 2);
  if (parameters + (input.relation?.values.length ?? 0) > sqliteTableBrowseLimits.parameters) context.addIssue({ code: 'custom', message: '当前启用的筛选条件过多，请减少列表值或条件数量' });
});
export type SqliteTableFilter = z.infer<typeof sqliteTableFilterSchema>;
export type SqliteTablePageInput = z.infer<typeof sqliteTablePageSchema>;
export interface SqliteTableColumn { name: string; declaredType: string; generated?: boolean; }
export interface SqliteTablePage {
  /** 已核验的固定关联范围，派生读取不能丢失，也不能由普通OR筛选扩大。 */
  relation?: SqliteTableRelation;
  /** 与原页行列一一对应：n=NULL、t=TEXT、i=INTEGER、r=REAL、b=BLOB；不由声明亲和性猜类型。 */
  storageTypes?: string[];
  /** 仅显式可编辑页请求签发，任意SQL结果和原只读页不获得写入能力。 */
  edit?: import('./sqliteTableEdit').SqliteTableEditPage;
  /** 原目录定义及完整列事实摘要，导出前须在准确只读快照重新核对。 */
  schemaKey: string;
  target: { connectionId: string; database: 'main'; table: string; kind: 'table' | 'view' };
  columns: SqliteTableColumn[];
  result: QueryResult;
  offset: number;
  /** 仅显式末页读取返回同一快照中的匹配总数。 */
  matchingRows?: string;
  limit: number;
  hasMore: boolean;
}

/** 旧页可省略存储类型；新事实必须完整对应有界结果，不接受稀疏行或未知编码。 */
export function assertSqliteStorageTypes(page: SqliteTablePage): void {
  if (page.storageTypes === undefined) return;
  if (!Array.isArray(page.storageTypes) || page.storageTypes.length !== page.result.rows.length || page.storageTypes.length > sqliteTableBrowseLimits.pageSize) throw Error('SQLite单元格存储类型与原页不匹配');
  for (const row of page.storageTypes) if (typeof row !== 'string' || row.length !== page.columns.length || !/^[ntirb]*$/.test(row)) throw Error('SQLite单元格存储类型与原列不匹配');
}
