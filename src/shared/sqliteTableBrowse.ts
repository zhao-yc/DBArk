import { z } from 'zod';
import type { QueryResult } from './contracts';

/** 表浏览始终有界；不通过完整COUNT或一次性读取全表来计算页数。 */
export const sqliteTableBrowseLimits = { pageSize: 1000, offset: 1000000000, filters: 32, sorts: 8, columns: 1024, resultBytes: 16 * 1024 * 1024, valueUnits: 65536 } as const;
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
export const sqliteTableFilterSchema = z.object({
  column: name, operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'isNull', 'notNull']), value: operand.optional(),
}).strict().superRefine((filter, context) => {
  const nullCheck = filter.operator === 'isNull' || filter.operator === 'notNull';
  if (nullCheck ? filter.value !== undefined : filter.value === undefined) context.addIssue({ code: 'custom', message: 'NULL条件不带值，其余条件必须明确类型和值' });
  if (filter.operator === 'contains' && filter.value?.kind !== 'text') context.addIssue({ code: 'custom', message: '包含条件只接受文本原文' });
  if (filter.value?.kind === 'blob' && !['eq', 'ne'].includes(filter.operator)) context.addIssue({ code: 'custom', message: '二进制条件目前只支持等于与不等于' });
});
export const sqliteTablePageSchema = z.object({
  connectionId: z.string().min(1).max(200), database: z.literal('main'), table: name, taskId: z.string().min(1).max(200),
  offset: z.number().int().min(0).max(sqliteTableBrowseLimits.offset), limit: z.number().int().min(1).max(sqliteTableBrowseLimits.pageSize),
  mode: z.enum(['and', 'or']), filters: z.array(sqliteTableFilterSchema).max(sqliteTableBrowseLimits.filters), editing: z.boolean().optional(),
  sort: z.array(z.object({ column: name, direction: z.enum(['asc', 'desc']) }).strict()).max(sqliteTableBrowseLimits.sorts),
}).strict().superRefine((input, context) => {
  if (new Set(input.sort.map(sort => sort.column)).size !== input.sort.length) context.addIssue({ code: 'custom', message: '排序列不能重复' });
  if (input.filters.reduce((size, filter) => size + (filter.value?.value.length ?? 0), 0) > 131072) context.addIssue({ code: 'custom', message: 'SQLite筛选值总量超过预算' });
});
export type SqliteTableFilter = z.infer<typeof sqliteTableFilterSchema>;
export type SqliteTablePageInput = z.infer<typeof sqliteTablePageSchema>;
export interface SqliteTableColumn { name: string; declaredType: string; generated?: boolean; }
export interface SqliteTablePage {
  /** 仅显式可编辑页请求签发，任意SQL结果和原只读页不获得写入能力。 */
  edit?: import('./sqliteTableEdit').SqliteTableEditPage;
  /** 原目录定义及完整列事实摘要，导出前须在准确只读快照重新核对。 */
  schemaKey: string;
  target: { connectionId: string; database: 'main'; table: string; kind: 'table' | 'view' };
  columns: SqliteTableColumn[];
  result: QueryResult;
  offset: number;
  limit: number;
  hasMore: boolean;
}
