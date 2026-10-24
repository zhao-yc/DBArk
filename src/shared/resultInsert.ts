import { z } from 'zod';
import type { ResultExportData } from './contracts';
import { resultExportLimits, validateResultExportData } from './resultExport';

export const resultInsertLimits = Object.freeze({ ...resultExportLimits, previews: 8, retainedBytes: 64 * 1024 * 1024, lifetimeMs: 120000, shownRows: 20, previewSqlBytes: 4 * 1024 * 1024, definitionBytes: 2 * 1024 * 1024 });
export const resultInsertText = Object.freeze({
  invalid: '结果插入的数据、目标或映射无效', stale: '插入预览已失效、使用或连接已变化，请重新预览；未自动重放',
  budget: '结果插入预览数量或完整数据预算已达上限，请释放旧预览后重试',
  unsupported: '目标必须是能够确认完整定义和事务边界的InnoDB基本表',
  mapping: '请映射至少一列；源内部键必须存在，目标列不得重复、生成或不存在',
  required: '目标存在未映射且无默认值的不可空非自增字段',
  changed: '目标完整定义或实际服务器身份已变化，未发送插入',
  warnings: '服务器返回警告或不明确的写入状态，未继续提交；请核对事务结果',
  unknown: '插入或提交结果未知，请核对目标表；不会自动重试或重放',
  transaction: '无法证明目标事务状态，未继续插入或提交',
  triggers: '目标存在触发器或无法确认外部副作用，不能承诺整批事务回滚',
  closed: '结果插入任务正在关闭，不能新建或应用预览',
  timeZone: '请选择明确的数值时区偏移（-13:59～+14:00），服务器还会核验支持范围',
});
const unicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const name = z.string().min(1).max(64).refine(value => !value.includes('\0') && unicode(value), resultInsertText.invalid);
const connectionId = z.string().min(1).max(200), taskId = z.string().uuid();
export const resultInsertTargetSchema = z.object({ connectionId, database: name, table: name }).strict();
export type ResultInsertTarget = z.infer<typeof resultInsertTargetSchema>;
export const resultInsertMappingSchema = z.object({ source: z.string().min(1).max(256), target: name }).strict();
export type ResultInsertMapping = z.infer<typeof resultInsertMappingSchema>;
const mappings = z.array(resultInsertMappingSchema).min(1).max(resultInsertLimits.columns).refine(value => new Set(value.map(item => item.target)).size === value.length, resultInsertText.mapping);
export const resultInsertTimeZoneSchema = z.string().regex(/^[+-]\d{2}:\d{2}$/).refine(value => {
  const hours = Number(value.slice(1, 3)), minutes = Number(value.slice(4));
  return minutes < 60 && (value[0] === '-' ? hours <= 13 : hours < 14 || hours === 14 && minutes === 0);
}, resultInsertText.timeZone);

/** JSON式输入先核自有数据属性，拒绝getter/隐藏字段/循环，且不执行用户迭代器。 */
export function assertResultInsertData(value: unknown): asserts value is ResultExportData {
  let nodes = 0; const ancestors = new Set<object>();
  const visit = (item: unknown, depth: number) => {
    if (++nodes > 3_100_000 || depth > 5) throw Error(resultInsertText.invalid);
    if (typeof item === 'string') { if (!unicode(item)) throw Error(resultInsertText.invalid); return; }
    if (!item || typeof item !== 'object') return;
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw Error(resultInsertText.invalid);
    if (ancestors.has(item)) throw Error(resultInsertText.invalid); ancestors.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
    if (keys.length > 100001) throw Error(resultInsertText.invalid);
    for (const key of keys) {
      const descriptor = typeof key === 'string' ? descriptors[key] : undefined;
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable && !(Array.isArray(item) && key === 'length')) throw Error(resultInsertText.invalid);
      if (key !== 'length' || !Array.isArray(item)) visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(item) && (item.length > 100000 || keys.length !== item.length + 1)) throw Error(resultInsertText.invalid);
    ancestors.delete(item);
  };
  visit(value, 0); validateResultExportData(value);
  if (!value.rows.length) throw Error('结果插入至少需要一行已返回数据');
}
const data = z.unknown().transform((value, context): ResultExportData => {
  try { assertResultInsertData(value); return value; } catch { context.addIssue({ code: 'custom', message: resultInsertText.invalid }); return z.NEVER; }
});
export const resultInsertPreviewInputSchema = resultInsertTargetSchema.extend({ taskId, data, mapping: mappings, timeZone: resultInsertTimeZoneSchema }).strict();
export type ResultInsertPreviewInput = z.infer<typeof resultInsertPreviewInputSchema>;
export const resultInsertApplyInputSchema = z.object({ connectionId, taskId, previewToken: z.string().uuid(), confirmation: z.string().min(3).max(129), acknowledged: z.literal(true) }).strict();
export type ResultInsertApplyInput = z.infer<typeof resultInsertApplyInputSchema>;
export const resultInsertReleaseInputSchema = z.object({ connectionId, previewToken: z.string().uuid() }).strict();
export type ResultInsertReleaseInput = z.infer<typeof resultInsertReleaseInputSchema>;
export const resultInsertPreviewOutputSchema = z.object({ previewToken: z.string().uuid(), target: resultInsertTargetSchema, rows: z.number().int().min(1).max(resultInsertLimits.rows), mapping: mappings, shownRows: z.number().int().min(0).max(resultInsertLimits.shownRows), sql: z.string().max(resultInsertLimits.previewSqlBytes).refine(value => new TextEncoder().encode(value).length <= resultInsertLimits.previewSqlBytes, resultInsertText.budget), expiresAt: z.string().datetime(), definitionDigest: z.string().regex(/^[a-f0-9]{64}$/), sourceTruncated: z.boolean(), timeZone: resultInsertTimeZoneSchema, warnings: z.array(z.string().max(2000)).max(32) }).strict();
export type ResultInsertPreviewOutput = z.infer<typeof resultInsertPreviewOutputSchema>;
export const resultInsertApplyOutputSchema = z.object({ target: resultInsertTargetSchema, rows: z.number().int().min(1).max(resultInsertLimits.rows), outcome: z.literal('committed'), commitAcknowledged: z.literal(true) }).strict();
export type ResultInsertApplyOutput = z.infer<typeof resultInsertApplyOutputSchema>;
export const resultInsertProgressSchema = z.object({ phase: z.enum(['preparing', 'validating', 'inserting', 'committing', 'rolling-back', 'releasing', 'finished']), rows: z.number().int().min(0).max(resultInsertLimits.rows), totalRows: z.number().int().min(0).max(resultInsertLimits.rows), dmlMayHaveBeenSent: z.boolean(), commitMayHaveBeenSent: z.boolean(), commitAcknowledged: z.boolean(), rollbackAcknowledged: z.boolean(), transactionProtected: z.boolean(), outcome: z.enum(['not-sent', 'rolled-back', 'unknown', 'committed']) }).strict();
/** transactionProtected记录本轮曾完整证明的事务保护，不表示COMMIT/ROLLBACK后仍在事务中。 */
export type ResultInsertProgress = z.infer<typeof resultInsertProgressSchema>;
/** 确认仅比较准确库名.表名，不从确认输入构造SQL。 */
export function resultInsertConfirmation(target: ResultInsertTarget): string { return target.database + '.' + target.table; }
