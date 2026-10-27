import { z } from 'zod';
import { truncateQueryScriptMessage } from './queryContinueOnError';

export const fileImportConflictModes = ['skip-existing', 'upsert', 'update-existing'] as const;
const name = z.string().min(1).max(64).refine(value => !value.includes('\0'));
const columns = z.array(name).min(1).max(64).refine(value => new Set(value).size === value.length, '匹配键列不能重复');
export const fileImportConflictSelectionSchema = z.object({ mode: z.enum(fileImportConflictModes), schemaHash: z.string().regex(/^[a-f0-9]{64}$/), key: z.object({ name, columns }).strict() }).strict();
export type FileImportConflictSelection = z.infer<typeof fileImportConflictSelectionSchema>;
export const fileImportKeyCatalogSchema = z.object({
  connectionId: z.string().min(1).max(128), database: name, table: name,
  schemaHash: z.string().regex(/^[a-f0-9]{64}$/),
  keys: z.array(z.object({ name, columns: z.array(name).max(64), reliable: z.boolean(), reason: z.string().max(1024).optional() }).strict().refine(value => value.reliable ? value.columns.length > 0 && new Set(value.columns).size === value.columns.length : !!value.reason, '匹配键证据不完整')).max(1024),
}).strict().refine(value => new Set(value.keys.map(key => key.name)).size === value.keys.length, '匹配键名称不能重复');
export type FileImportKeyCatalog = z.infer<typeof fileImportKeyCatalogSchema>;
const count = z.number().int().safe().nonnegative();
export const fileImportConflictCountsSchema = z.object({ inserted: count, matchedUpdates: count, skippedExisting: count, skippedMissing: count }).strict();
export type FileImportConflictCounts = z.infer<typeof fileImportConflictCountsSchema>;
export const fileImportConflictReportSchema = z.object({
  version: z.literal(1), taskId: z.string().min(1).max(128), mode: z.enum(fileImportConflictModes), termination: z.enum(['completed', 'failed', 'cancelled']),
  /** 已读取的记录包含当前失败记录；两个计数组仅在完整处理成功后递增。 */
  readRecords: count, acknowledged: fileImportConflictCountsSchema, committed: fileImportConflictCountsSchema,
  currentBatch: z.enum(['none', 'pending', 'rolled-back', 'rollback-unconfirmed', 'commit-unknown']),
  failure: z.object({ stage: z.enum(['prepare-batch', 'read', 'record', 'match', 'insert', 'update', 'commit', 'rollback', 'cleanup']), message: z.string().max(4096), record: count.positive().optional() }).strict().optional(),
  cleanupWarning: z.string().max(4096).optional(),
}).strict().superRefine((value, context) => {
  const keys = ['inserted', 'matchedUpdates', 'skippedExisting', 'skippedMissing'] as const;
  if (keys.some(key => value.committed[key] > value.acknowledged[key])) context.addIssue({ code: 'custom', message: '提交计数超过已确认处理计数' });
  const sum = keys.reduce((total, key) => total + value.acknowledged[key], 0);
  if (!Number.isSafeInteger(sum) || sum > value.readRecords) context.addIssue({ code: 'custom', message: '处理计数超过已读取记录' });
  if (value.termination === 'completed' && sum !== value.readRecords) context.addIssue({ code: 'custom', message: '完成导入仍有读取记录未归入处理事实' });
  if (value.mode === 'skip-existing' && (value.acknowledged.matchedUpdates || value.acknowledged.skippedMissing) || value.mode === 'update-existing' && (value.acknowledged.inserted || value.acknowledged.skippedExisting) || value.mode === 'upsert' && (value.acknowledged.skippedExisting || value.acknowledged.skippedMissing)) context.addIssue({ code: 'custom', message: '导入策略与处理分类不一致' });
  if (value.termination === 'completed' && (value.failure || value.currentBatch !== 'none' || keys.some(key => value.committed[key] !== value.acknowledged[key]))) context.addIssue({ code: 'custom', message: '导入完成但提交事实不完整' });
  if (value.termination !== 'completed' && !value.failure) context.addIssue({ code: 'custom', message: '导入停止但缺少失败阶段' });
  if (value.failure?.record && value.failure.record > value.readRecords) context.addIssue({ code: 'custom', message: '失败记录尚未读取' });
});
export type FileImportConflictReport = z.infer<typeof fileImportConflictReportSchema>;
export const fileImportConflictText = {
  invalid: '冲突处理仅适用于CSV／JSON，必须明确选择有效策略及完整匹配键',
  stale: '目标结构或匹配键已变化，未继续当前批；此前提交保留，请重新核对',
  noKey: '未选择可确认的完整非空主键或唯一键',
  nullable: '匹配键列不能缺失或为NULL',
  noUpdate: '没有可更新的已映射非匹配键列',
} as const;

/** 嵌套配置仅消费自有可枚举数据属性，不执行调用方getter或沿原型领取策略。 */
function ownRecord(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error(fileImportConflictText.invalid);
  if (Reflect.ownKeys(value).length !== keys.length) throw Error(fileImportConflictText.invalid);
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error(fileImportConflictText.invalid); output[key] = descriptor.value; }
  return output;
}

/** 省略保持原仅新增路径；SQL／Excel及显式undefined不能借可选字段绕过适用范围。 */
export function fileImportConflict(format: string, input: object): FileImportConflictSelection | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(input, 'conflict');
  if (!descriptor) { if ('conflict' in input) throw Error(fileImportConflictText.invalid); return; }
  if (!['csv', 'json'].includes(format) || !('value' in descriptor) || !descriptor.enumerable) throw Error(fileImportConflictText.invalid);
  const value = ownRecord(descriptor.value, ['mode', 'schemaHash', 'key']);
  const key = ownRecord(value.key, ['name', 'columns']), raw = key.columns;
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length < 1 || raw.length > 64 || Reflect.ownKeys(raw).length !== raw.length + 1) throw Error(fileImportConflictText.invalid);
  key.columns = Array.from({ length: raw.length }, (_, index) => { const item = Object.getOwnPropertyDescriptor(raw, String(index)); if (!item || !('value' in item) || !item.enumerable) throw Error(fileImportConflictText.invalid); return item.value; });
  value.key = key; return fileImportConflictSelectionSchema.parse(value);
}

/** 错误同时限制UTF16、UTF8及JSON转义预算，不在回执中附整份源文件。 */
export const fileImportConflictMessage = (value: string): string => truncateQueryScriptMessage(value);
