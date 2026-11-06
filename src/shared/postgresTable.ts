import { z } from 'zod';
import type { DataRow, ResultColumn, SortRule } from './contracts';
import { csvExportDelimiters } from './csvExport';
import { FILTER_LIMITS, filterGroupSchema, filterRuleSchema, sortRulesSchema, validateFilterGroup } from './filtering';
import { strictTableLayoutPreferences } from './tablePreferences';
import { postgresRelatedTabPrefix } from './postgresRelatedTab';
import { postgresHistogramBins } from './postgresTableHistogram';

export const postgresTableLimits = { page: 200, offset: 1_000_000, changes: 100, draftPages: 16, fields: 200, value: 64 * 1024, draft: 1024 * 1024 } as const;
const identity = z.string().min(1).max(200).refine(value => !value.includes('\0'));
const relation = z.string().min(1).max(512).refine(value => !value.includes('\0'));
export const postgresTableLayoutPreferencesSchema = strictTableLayoutPreferences(relation, 1022);
const token = z.uuid();
const column = z.string().regex(/^c[0-9]{1,4}$/);
export const postgresTableTargetSchema = z.object({ connectionId: identity, database: identity, table: relation, tabId: identity }).strict();
const target = postgresTableTargetSchema;
export const postgresQuickTableFilterSchema = z.object({ column: relation, text: z.string().max(4096).refine(value => !value.includes('\0')) }).strict();
export const postgresAdvancedTableFilterSchema = z.object({
  rules: z.array(filterRuleSchema).min(1).max(FILTER_LIMITS.conditions),
  mode: z.enum(['all', 'any']),
  group: filterGroupSchema.optional(),
}).strict().superRefine(({ rules, mode, group }, context) => {
  try {
    validateFilterGroup(rules, mode, group);
    if (rules.some(rule => [rule.column, rule.value ?? '', ...(rule.values ?? [])].some(value => /[\u0000\uD800-\uDFFF]/u.test(value))))
      throw Error('筛选字段和值须为有效文本且不能包含 NUL');
  } catch (reason) {
    context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : '筛选条件无效' });
  }
});
export type PostgresAdvancedTableFilter = z.infer<typeof postgresAdvancedTableFilterSchema>;
export type PostgresTableFilter = z.infer<typeof postgresQuickTableFilterSchema> | PostgresAdvancedTableFilter;

export function isPostgresTableFiltered(filter: PostgresTableFilter | undefined): boolean {
  return !!filter && ('rules' in filter ? filter.rules.some(rule => rule.enabled !== false) : !!filter.text);
}

const legacySort = z.object({ column: relation, direction: z.enum(['asc', 'desc']) }).strict();
export const postgresTableSortSchema = z.union([legacySort, sortRulesSchema.refine(rules =>
  new Set(rules.map(rule => rule.column)).size === rules.length, '排序字段不能重复')]).optional();

/** 旧版单列请求和新规则使用相同顺序，草稿作用域也以规范化规则比较。 */
export function postgresTableSortRules(sort: PostgresTablePageInput['sort']): SortRule[] {
  if (!sort || Array.isArray(sort)) return sort ?? [];
  return [{ column: sort.column, direction: sort.direction === 'asc' ? 'ASC' : 'DESC' }];
}

/** 筛选值与排序方向使用独立结构，标识符只从已读的列目录解析。 */
export const postgresTableBrowseSchema = z.object({
  offset: z.number().int().min(0).max(postgresTableLimits.offset),
  limit: z.number().int().min(1).max(postgresTableLimits.page),
  sort: postgresTableSortSchema,
  filter: z.union([postgresQuickTableFilterSchema, postgresAdvancedTableFilterSchema]).optional(),
}).strict();
export const postgresTablePageSchema = target.extend({
  ...postgresTableBrowseSchema.shape,
  checkFilterColumns: z.literal(true).optional(),
  navigation: z.enum(['count', 'last']).optional(),
  retainPageTokens: z.array(token).max(postgresTableLimits.draftPages)
    .refine(value => new Set(value).size === value.length, '保留的草稿原页不能重复').optional(),
  retainHistoryPageTokens: z.array(token).max(postgresTableLimits.draftPages).optional(),
}).strict().superRefine(({ retainPageTokens, retainHistoryPageTokens }, context) => {
  const pins = [...retainPageTokens ?? [], ...retainHistoryPageTokens ?? []];
  if (pins.length > postgresTableLimits.draftPages || new Set(pins).size !== pins.length)
    context.addIssue({ code: 'custom', message: '草稿与撤销历史的原页不能重复或超过保留上限' });
});

/** 精确计数始终以十进制字符串传输，只有已限制到浏览窗口的偏移和行数才转换为 number。 */
export function postgresCountedWindow(matchingRows: unknown, limit: number, offset: number, navigation: 'count' | 'last') {
  if (typeof matchingRows !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(matchingRows) ||
    !Number.isInteger(limit) || limit < 1 || limit > postgresTableLimits.page ||
    !Number.isSafeInteger(offset) || offset < 0 || offset > postgresTableLimits.offset)
    throw Error('PostgreSQL 计数或页位置无效');
  const count = BigInt(matchingRows), size = BigInt(limit);
  const position = navigation === 'last' || BigInt(offset) >= count
    ? count === 0n ? 0n : (count - 1n) / size * size : BigInt(offset);
  if (position > BigInt(postgresTableLimits.offset)) throw Error('末页超出 PostgreSQL 最大浏览偏移，请缩小筛选范围');
  const remaining = count - position;
  return { matchingRows, offset: Number(position), expected: Number(remaining > size ? size + 1n : remaining) };
}

/** 跳页使用已应用的页大小，避免把未提交的大小输入和正在浏览的页混用。 */
export function postgresTablePageOffset(value: string, limit: number): number {
  if (!/^[1-9]\d{0,6}$/.test(value) || !Number.isInteger(limit) || limit < 1 || limit > postgresTableLimits.page)
    throw Error('请输入有效的正整数页码');
  const offset = (Number(value) - 1) * limit;
  if (offset > postgresTableLimits.offset) throw Error('页码超出 PostgreSQL 最大浏览偏移');
  return offset;
}

export const postgresTableFieldValueSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('text'), value: z.string().max(postgresTableLimits.value).refine(value => !value.includes('\0')) }).strict(),
  z.object({ mode: z.literal('binary'), value: z.string().max(postgresTableLimits.value).regex(/^(?:[0-9a-fA-F]{2})*$/) }).strict(),
  z.object({ mode: z.literal('null') }).strict(),
  z.object({ mode: z.literal('default') }).strict(),
]);
const field = z.object({ column, value: postgresTableFieldValueSchema }).strict();
const row = z.number().int().min(0).max(postgresTableLimits.page - 1);
export const postgresTableChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('insert'), pageToken: token.optional(), fields: z.array(field).max(postgresTableLimits.fields) }).strict(),
  z.object({ kind: z.literal('update'), pageToken: token.optional(), row, fields: z.array(field).min(1).max(postgresTableLimits.fields) }).strict(),
  z.object({ kind: z.literal('delete'), pageToken: token.optional(), row }).strict(),
]);

/** 预览限制原页数量、每页原行和整批值预算，跨页重复原行由引擎按身份复核。 */
export const postgresTablePreviewSchema = target.extend({
  pageToken: token, changes: z.array(postgresTableChangeSchema).min(1).max(postgresTableLimits.changes),
}).strict().superRefine((input, context) => {
  let size = 0;
  const usedRows = new Set<string>();
  const pages = new Set<string>();
  for (const item of input.changes) {
    const source = item.pageToken ?? input.pageToken;
    pages.add(source);
    if (item.kind !== 'insert') {
      const identity = source + ':' + item.row;
      if (usedRows.has(identity)) context.addIssue({ code: 'custom', message: '同一原行只允许一个草稿动作' });
      usedRows.add(identity);
    }
    if (item.kind === 'delete') continue;
    const keys = new Set<string>();
    for (const field of item.fields) {
      if (keys.has(field.column)) context.addIssue({ code: 'custom', message: '同一记录的列不能重复' });
      keys.add(field.column);
      size += 32 + ('value' in field.value ? 4 * field.value.value.length : 0);
    }
  }
  if (pages.size > postgresTableLimits.draftPages) context.addIssue({ code: 'custom', message: '草稿最多来自 16 个原页' });
  if (size > postgresTableLimits.draft) context.addIssue({ code: 'custom', message: '编辑草稿超过大小预算' });
});
export const postgresFilteredUpdateMaxRows = 1000;
const filteredUpdateRows = z.number().int().min(1).max(postgresFilteredUpdateMaxRows);
export const postgresTableApplySchema = target.extend({ pageToken: token, previewToken: token, confirmedRows: filteredUpdateRows.optional() }).strict();
export const postgresTableReleaseSchema = target.extend({ pageToken: token }).strict();
export const postgresFilteredUpdateSchema = postgresTableReleaseSchema.extend({ fields: z.array(field).min(1).max(postgresTableLimits.fields) })
  .strict().superRefine(({ fields }, context) => {
    if (new Set(fields.map(item => item.column)).size !== fields.length)
      context.addIssue({ code: 'custom', message: '批量赋值字段不能重复' });
    if (fields.reduce((size, item) => size + 32 + ('value' in item.value ? 4 * item.value.value.length : 0), 0) > postgresTableLimits.draft)
      context.addIssue({ code: 'custom', message: '批量赋值超过大小预算' });
  });
export const postgresTableColumnReadSchema = postgresTableReleaseSchema.extend({ column }).strict();
export type PostgresTableColumnReadInput = z.infer<typeof postgresTableColumnReadSchema>;
export const postgresTableHistogramSchema = postgresTableColumnReadSchema.extend({ bins: postgresHistogramBins }).strict();
export type PostgresTableHistogramInput = z.infer<typeof postgresTableHistogramSchema>;
export const postgresTableValueLimits = { groups: 500, page: 50, search: 256 } as const;
export const postgresTableValuesSchema = postgresTableColumnReadSchema.extend({
  search: z.string().max(postgresTableValueLimits.search).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value)),
  order: z.enum(['value', 'count-desc', 'count-asc']).optional(),
}).strict();
export type PostgresTableValuesInput = z.infer<typeof postgresTableValuesSchema>;
export interface PostgresTableValues {
  options: { value: string | null; count: string; clipped: boolean }[];
  truncated: boolean;
}

export const postgresTableReferenceLimits = { page: 40, offset: 100_000, search: 256, constraints: 128, columns: 16 } as const;
const referenceSearch = z.string().max(postgresTableReferenceLimits.search).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
const referenceOffset = z.number().int().min(0).max(postgresTableReferenceLimits.offset);
const relatedTabId = identity.startsWith(postgresRelatedTabPrefix)
  .refine(value => token.safeParse(value.slice(postgresRelatedTabPrefix.length)).success);
export const postgresTableReferenceSchema = postgresTableReleaseSchema.extend({
  parentRow: z.number().int().min(0).max(postgresTableLimits.page - 1).optional(),
  childrenRow: z.number().int().min(0).max(postgresTableLimits.page - 1).optional(),
  lookup: z.object({
    id: z.string().regex(/^[1-9][0-9]{0,9}$/),
    stamp: z.string().regex(/^[0-9a-f]{64}$/),
    search: referenceSearch,
    offset: referenceOffset,
  }).strict().optional(),
  relatedTabId: relatedTabId.optional(),
}).strict().refine(input => input.parentRow === undefined ||
  (input.childrenRow === undefined && (!input.lookup || (input.lookup.search === '' && input.lookup.offset === 0))))
  .refine(input => input.relatedTabId === undefined || (input.relatedTabId !== input.tabId && !!input.lookup &&
    input.lookup.offset === 0 && (input.parentRow !== undefined || input.childrenRow !== undefined)));
export type PostgresTableReferenceInput = z.infer<typeof postgresTableReferenceSchema>;
export interface PostgresTableReference {
  id: string; stamp: string; name: string; schema: string; table: string;
  pairs: { local: string; localName: string; remote: string; binary: boolean }[];
}
export interface PostgresTableReferenceResult {
  choices: PostgresTableReference[];
  page?: PostgresRelatedRows;
  opened?: { tabId: string; table: string };
}
export interface PostgresRelatedRows { columns: ResultColumn[]; rows: DataRow[]; hasNext: boolean; }
const relatedTarget = target.extend({ tabId: relatedTabId });
export const postgresRelatedTableSchema = z.discriminatedUnion('operation', [
  relatedTarget.extend({ operation: z.literal('page'), offset: referenceOffset, search: referenceSearch.optional() }).strict(),
  relatedTarget.extend({ operation: z.literal('edit'), pageToken: token, row: z.number().int().min(0)
    .max(postgresTableReferenceLimits.page - 1) }).strict(),
  relatedTarget.extend({ operation: z.literal('close') }).strict(),
]);
export type PostgresRelatedTableInput = z.infer<typeof postgresRelatedTableSchema>;
export interface PostgresRelatedTablePage {
  page: PostgresRelatedRows;
  incoming: boolean;
  constraint: string;
  offset: number;
  search: string;
  editToken?: string;
}
const exportFormat = z.enum(['csv', 'json', 'xlsx', 'sql', 'copy']);

/** 原生 COPY 使用 CSV 扩展名，文件能力仍按具体导出格式绑定。 */
export function postgresTableExportExtension(format: PostgresTableExportInput['format']) {
  return format === 'copy' ? 'csv' : format;
}
/** 文件能力只由主进程签发，筛选和排序只从原服务端表页读取。 */
export const postgresTableExportChooseSchema = z.object({
  format: exportFormat, suggestedName: z.string().min(1).max(240).refine(value => !/[\/\\\u0000-\u001f]/.test(value)),
}).strict();
export const postgresTableExportSchema = target.extend({
  exportToken: token, taskId: identity, fileToken: token, format: exportFormat,
  encoding: z.enum(['utf8', 'utf16le', 'gb18030']),
  columns: z.array(column).min(1).max(1022), csvDelimiter: z.enum(csvExportDelimiters).optional(),
}).strict().superRefine((input, context) => {
  if (new Set(input.columns).size !== input.columns.length) context.addIssue({ code: 'custom', message: '导出列不能重复' });
  if (input.csvDelimiter !== undefined && postgresTableExportExtension(input.format) !== 'csv')
    context.addIssue({ code: 'custom', message: '只有 CSV 可指定分隔符' });
  if (input.format === 'xlsx' && input.encoding !== 'utf8') context.addIssue({ code: 'custom', message: 'XLSX 使用固定内部编码' });
  if (input.format === 'sql' && input.encoding !== 'utf8') context.addIssue({ code: 'custom', message: 'PostgreSQL SQL 脚本使用 UTF-8' });
  if (input.format === 'copy' && input.encoding !== 'utf8') context.addIssue({ code: 'custom', message: 'PostgreSQL COPY CSV 使用 UTF-8' });
});
export type PostgresTableExportInput = z.infer<typeof postgresTableExportSchema>;
export type PostgresTableExportChooseInput = z.infer<typeof postgresTableExportChooseSchema>;
export interface PostgresTableExportOutput { rows: number; fileCommitted: true }
/** 预览绑定原表页，提交只认一次性来源和按 CSV 顺序排列的目标列。 */
export const postgresTableImportChooseSchema = target.extend({
  pageToken: token, csvDelimiter: z.enum(csvExportDelimiters), csvHasHeader: z.boolean().optional(),
}).strict();
export const postgresTableImportSchema = target.extend({
  pageToken: token, taskId: identity, fileToken: token,
  columns: z.array(column).min(1).max(1022).refine(value => new Set(value).size === value.length, '导入目标列不能重复'),
}).strict();
export type PostgresTableImportChooseInput = z.infer<typeof postgresTableImportChooseSchema>;
export type PostgresTableImportInput = z.infer<typeof postgresTableImportSchema>;
export interface PostgresTableImportChoice {
  token: string;
  name: string;
  header: string[];
  bytes: number;
  sample: (string | null)[][];
  sampleLimited: boolean;
}
export type PostgresTableTarget = z.infer<typeof target>;
export type PostgresTablePageInput = z.infer<typeof postgresTablePageSchema>;
export type PostgresTableChange = z.infer<typeof postgresTableChangeSchema>;
export type PostgresTableField = z.infer<typeof field>;
export type PostgresTablePreviewInput = z.infer<typeof postgresTablePreviewSchema>;
export type PostgresFilteredUpdateInput = z.infer<typeof postgresFilteredUpdateSchema>;
export type PostgresTableApplyInput = z.infer<typeof postgresTableApplySchema>;
export type PostgresTableReleaseInput = z.infer<typeof postgresTableReleaseSchema>;
export interface PostgresTableColumn extends ResultColumn {
  valueOptions?: true;
  nullable: boolean;
  defaultValue: boolean;
  generated: boolean;
  identityAlways?: boolean;
  sequenceDefault?: true;
  primary: boolean;
  binary: boolean;
}
export interface PostgresTablePage {
  pageToken?: string;
  exportToken?: string;
  retainedHistoryPageTokens?: string[];
  canImport?: true;
  canBrowseReferences?: true;
  columns: PostgresTableColumn[];
  primaryKey?: string[];
  rows: DataRow[];
  rowKeys?: string[];
  capabilities: { insert: boolean; update: boolean; delete: boolean };
  hasNext: boolean;
  truncated: boolean;
  counted?: { matchingRows: string; offset: number };
  order: 'primary' | 'physical' | 'unstable';
  relationKind: 'r' | 'p' | 'v' | 'm' | 'f';
}
export interface PostgresTablePreview {
  previewToken: string;
  statements: string[];
  counts: { insert: number; update: number; delete: number };
  filteredUpdate?: { fields: PostgresTableField[]; condition: string; parameters: string[] };
}

/** 批量赋值保留主键，生成列仍由数据库维护。 */
export function isPostgresFilteredUpdateColumn(column: PostgresTableColumn): boolean {
  return !column.primary && !column.generated;
}
export interface PostgresTableOutcome {
  outcome: 'committed' | 'rolledBack' | 'notSent' | 'unknown';
  affected: number;
  message: string;
  draftsRetained?: true;
}

/** 标识列可以显式保留原值，计算生成列由恢复目标重新计算。 */
export function isPostgresSqlExportColumn(column: PostgresTableColumn) {
  return !column.generated || column.identityAlways === true;
}

/** SQL 数据脚本写入同名普通表或分区表。 */
export function isPostgresSqlExportRelation(kind: PostgresTablePage['relationKind']) {
  return kind === 'r' || kind === 'p';
}
