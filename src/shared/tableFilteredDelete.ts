import { z } from 'zod';
import { FILTER_LIMITS, filterGroupSchema, filterRuleSchema, sortRulesSchema, validateFilterGroup } from './filtering';
import { assertTableFilteredUpdateData, tableFilteredUpdateLimits } from './tableFilteredUpdate';

// 删除能力使用独立命令、令牌及预算；只复用已验的字段／行／快照大小上限。
export const tableFilteredDeleteLimits = Object.freeze({ ...tableFilteredUpdateLimits });
export const tableFilteredDeleteText = Object.freeze({
  invalid: '全部筛选行删除的目标、条件或回执无效',
  stale: '删除预览已过期、使用或来源变化，请重新预览；不会自动重放',
  unsupported: '仅支持具有可靠非空完整唯一键且定义可确认的 InnoDB 基本表',
  version: '当前数据库版本尚不能保证跨页删除期间的外键结构隔离，已禁止全部筛选行删除；可使用当前页删除或 SQL 工作区。',
  budget: '完整删除快照超过字段8MiB、行16MiB或同类预览合计10GiB限制，或已有两份预览；未截断数据',
  changed: '删除目标的完整定义、外键依赖、实际服务器或原会话时区已变化，未继续删除',
  dependencies: '无法证明完整外键目录，或存在 ON DELETE CASCADE／SET NULL 等越出删除快照的行为',
  triggers: '目标存在触发器或无法证明副作用及目录完整性，不能保证删除范围与整批回滚',
  warnings: '服务器警告、并发修改或删除状态不明确，未继续提交',
  transaction: '无法确认原删除事务保护，未继续提交',
  unknown: '删除或提交结果未知，请核对准确目标；不会自动重试或重放',
  spool: '完整删除快照被修改、替换或未能严格关闭，未继续删除',
  timestamp: '无法取得原 TIMESTAMP 的完整绝对时间，不能证明精确旧值定位',
  omitted: 'SQL 仅展示有界样本；实际删除以完整冻结快照为准',
});
const text = tableFilteredDeleteText, limits = tableFilteredDeleteLimits;
/** 只开放已核验父表外键DDL隔离的版本；旧版普通写MDL和显式表锁都不能覆盖外部关闭外键检查的路径。 */
export function tableFilteredDeleteVersionSupported(dialect: string, version: string): boolean {
  return dialect === 'mysql' && ['8.0.46', '8.4.11'].includes(version.match(/^\d+\.\d+\.\d+(?=$|[- ])/u)?.[0] ?? '');
}
const unicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const bytes = (value: string) => new TextEncoder().encode(value).length;
const name = z.string().min(1).max(64).refine(value => !value.includes('\0') && unicode(value), text.invalid);
const connectionId = z.string().min(1).max(200), taskId = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);

/** 共享纯数据结构守卫，拒绝访问器、循环、隐藏字段和非标准原型；错误使用删除用途文案。 */
function guarded<S extends z.ZodType>(schema: S) {
  return z.unknown().transform((input, context): z.output<S> => {
    try { assertTableFilteredUpdateData(input); return schema.parse(input); }
    catch { context.addIssue({ code: 'custom', message: text.invalid }); return z.NEVER; }
  });
}
export const tableFilteredDeleteTargetSchema = z.object({ connectionId, database: name, table: name }).strict();
export type TableFilteredDeleteTarget = z.infer<typeof tableFilteredDeleteTargetSchema>;
export const tableFilteredDeletePreviewInputSchema = guarded(tableFilteredDeleteTargetSchema.extend({
  taskId, metadataKey: z.string().min(1).refine(value => unicode(value) && bytes(value) <= limits.definitionBytes, text.budget),
  filters: z.array(filterRuleSchema).max(FILTER_LIMITS.conditions), filterMode: z.enum(['all', 'any']).optional(), filterGroup: filterGroupSchema.optional(), sort: sortRulesSchema,
}).strict().superRefine((input, context) => {
  try { validateFilterGroup(input.filters, input.filterMode, input.filterGroup); }
  catch { context.addIssue({ code: 'custom', message: text.invalid }); }
  if (new Set(input.sort.map(rule => rule.column)).size !== input.sort.length) context.addIssue({ code: 'custom', message: text.invalid });
}));
export type TableFilteredDeletePreviewInput = z.infer<typeof tableFilteredDeletePreviewInputSchema>;
export const tableFilteredDeleteApplyInputSchema = guarded(z.object({ connectionId, taskId, previewToken: taskId, confirmation: z.string().min(1).max(300), acknowledged: z.literal(true) }).strict());
export type TableFilteredDeleteApplyInput = z.infer<typeof tableFilteredDeleteApplyInputSchema>;
export const tableFilteredDeleteReleaseInputSchema = guarded(z.object({ connectionId, previewToken: taskId }).strict());
export type TableFilteredDeleteReleaseInput = z.infer<typeof tableFilteredDeleteReleaseInputSchema>;
const rows = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const tableFilteredDeletePreviewOutputSchema = guarded(z.object({
  operation: z.literal('delete'), previewToken: taskId, target: tableFilteredDeleteTargetSchema, rows,
  shownRows: z.number().int().min(0).max(limits.shownRows), sql: z.string().refine(value => unicode(value) && bytes(value) <= limits.previewSqlBytes, text.budget),
  sampleOmitted: z.boolean(), expiresAt: z.string().datetime(), definitionDigest: digest, scopeDigest: digest,
  timeZone: z.string().min(1).max(100), warnings: z.array(z.string().max(2000)).max(32),
}).strict());
export type TableFilteredDeletePreviewOutput = z.infer<typeof tableFilteredDeletePreviewOutputSchema>;
export const tableFilteredDeleteApplyOutputSchema = guarded(z.object({ operation: z.literal('delete'), target: tableFilteredDeleteTargetSchema, rows, outcome: z.literal('committed'), commitAcknowledged: z.literal(true) }).strict());
export type TableFilteredDeleteApplyOutput = z.infer<typeof tableFilteredDeleteApplyOutputSchema>;
export const tableFilteredDeleteProgressSchema = guarded(z.object({
  phase: z.enum(['preparing', 'snapshotting', 'validating', 'deleting', 'committing', 'rolling-back', 'releasing', 'finished']),
  rows, totalRows: rows, snapshotBytes: z.number().int().min(0).max(limits.spoolBytes),
  dmlMayHaveBeenSent: z.boolean(), commitMayHaveBeenSent: z.boolean(), commitAcknowledged: z.boolean(), rollbackAcknowledged: z.boolean(), transactionProtected: z.boolean(),
  outcome: z.enum(['not-sent', 'rolled-back', 'unknown', 'committed']),
}).strict());
export type TableFilteredDeleteProgress = z.infer<typeof tableFilteredDeleteProgressSchema>;

/** 原筛选、分组、停用项与排序全部进入用途摘要；不接受任意 SQL 或当前页行值。 */
export function tableFilteredDeleteScopeIdentity(input: TableFilteredDeletePreviewInput): string {
  return JSON.stringify([input.metadataKey, input.filters, input.filterMode ?? 'all', input.filterGroup ?? null, input.sort]);
}
/** 原文确认不参与 SQL 构造，明确这是删除及准确总行数。 */
export function tableFilteredDeleteConfirmation(input: { target: TableFilteredDeleteTarget; rows: number }): string {
  return `${input.target.database}.${input.target.table} / 删除 / ${input.rows}`;
}
