import { z } from 'zod';
import { truncateQueryScriptMessage } from './queryContinueOnError';

/** 文件位置基于所选编码解码且移除BOM后的UTF-16字符，不能解释为原文件字节偏移。 */
const point = z.object({ offset: z.number().int().safe().nonnegative(), line: z.number().int().safe().positive(), column: z.number().int().safe().positive() }).strict();
export const sqlFileImportLocationSchema = z.object({ start: point, end: point }).strict().refine(value => value.end.offset >= value.start.offset && value.end.line >= value.start.line && (value.end.line !== value.start.line || value.end.column >= value.start.column && value.end.offset - value.start.offset === value.end.column - value.start.column), '文件位置范围无效');
export type SqlFileImportLocation = z.infer<typeof sqlFileImportLocationSchema>;
export const sqlFileImportPhases = ['initial-mode', 'read', 'parse', 'execute', 'mode-refresh', 'finalize', 'rollback'] as const;
const encoder = new TextEncoder();
const message = z.string().max(4096).refine(value => encoder.encode(value).byteLength <= 4096 && encoder.encode(JSON.stringify(value)).byteLength - 2 <= 4096, 'SQL导入摘要超过传输预算');
export const sqlFileImportReceiptSchema = z.object({
  version: z.literal(1), taskId: z.string().min(1).max(128), encoding: z.enum(['utf8', 'utf16le', 'gb18030']),
  positionBasis: z.literal('decoded-utf16'), termination: z.enum(['completed', 'failed', 'cancelled']),
  completedStatements: z.number().int().safe().nonnegative(),
  // 仅相加完整返回语句的服务器affectedRows，不称为实际保留／提交行数。
  serverReportedAffectedRows: z.number().int().safe().nonnegative().nullable(),
  failure: z.object({ phase: z.enum(sqlFileImportPhases), message, statement: z.object({ ordinal: z.number().int().safe().positive(), location: sqlFileImportLocationSchema.optional() }).strict().optional() }).strict().optional(),
  rollback: z.object({ state: z.enum(['not-needed', 'confirmed', 'unconfirmed']), message: message.optional() }).strict(),
  transaction: z.enum(['closed', 'open', 'unknown']),
  cleanupWarning: message.optional(),
}).strict().superRefine((value, context) => {
  /** 回执中的完成、语句编号与事务事实必须彼此一致，坏回包不能变成成功提示。 */
  const invalid = (text: string) => context.addIssue({ code: 'custom', message: text });
  if (value.termination === 'completed' && (value.failure || value.rollback.state !== 'not-needed' || value.transaction !== 'closed')) invalid('SQL导入完成事实不一致');
  if (value.termination !== 'completed' && !value.failure) invalid('SQL导入未完成但缺少停止阶段');
  if (value.rollback.state === 'confirmed' && value.transaction !== 'closed') invalid('回滚确认缺少已关闭事务状态');
  const failure = value.failure;
  if (failure?.phase === 'execute' && failure.statement?.ordinal !== value.completedStatements + 1) invalid('失败语句编号不对应已完整完成前缀');
  if (failure?.phase === 'mode-refresh' && (!value.completedStatements || failure.statement?.ordinal !== value.completedStatements)) invalid('模式刷新必须关联已完成的原语句');
  if (failure?.statement && !['execute', 'mode-refresh'].includes(failure.phase)) invalid('非语句阶段不能虚构执行语句');
});
export type SqlFileImportReceipt = z.infer<typeof sqlFileImportReceiptSchema>;
export interface FileImportResult {
  /** CSV／JSON保持原行数；SQL兼容字段不能替代sql回执的服务器影响计数或提交事实。 */
  rows: number;
  errors: string[];
  sql?: SqlFileImportReceipt;
}

/** 同时限制字符、UTF-8和JSON转义预算；截断说明也计入4096字节预算。 */
export function sqlFileImportMessage(value: string): string {
  const text = truncateQueryScriptMessage(value, 4050, 4050);
  return text === value ? text : text + '［内容已截断］';
}
