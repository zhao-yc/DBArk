import { z } from 'zod';
import type { QueryFailureSourceRange } from './queryFailure';

/** 单项来自原会话SHOW诊断；有类型参数只保留级别和代码，不携带展开后的消息。 */
export interface QueryWarningCondition {
  level: string;
  code: number;
  message?: string;
  messageHidden?: true;
  messageTruncated?: true;
}

/** 状态描述原SQL是否完成，采集不可用或数量未知不能被补写为零警告。 */
export interface QueryStatementWarnings {
  statementOrdinal: number;
  sourceRange?: QueryFailureSourceRange;
  status: 'completed' | 'failed';
  warningCount?: number;
  conditions: QueryWarningCondition[];
  truncated: boolean;
  unavailable?: string;
}

/** 只在用户显式开启时返回；采集限额不构成停止用户脚本的执行预算。 */
export interface QueryWarningsReport {
  collection: 'explicit';
  statements: QueryStatementWarnings[];
  omittedStatements: number;
  truncated: boolean;
}

export const queryWarningsLimits = Object.freeze({ statements: 200, conditions: 100, messageBytes: 4096, totalBytes: 512 * 1024 });
const encoder = new TextEncoder();
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
// UTF8字节上限比UTF16长度更严格，先核长度避免对任意长消息创建同等大的编码副本。
const message = z.string().max(queryWarningsLimits.messageBytes).refine(value => value.length <= queryWarningsLimits.messageBytes && encoder.encode(value).byteLength <= queryWarningsLimits.messageBytes, '查询警告消息超过4096字节');
const range = z.object({ start: count, end: count }).strict().refine(value => value.end >= value.start, '查询警告语句范围无效');
const condition = z.object({
  level: z.string().min(1).max(32), code: z.number().int().min(0).max(65535), message: message.optional(),
  messageHidden: z.literal(true).optional(), messageTruncated: z.literal(true).optional(),
}).strict().superRefine((value, context) => {
  if (value.messageHidden && (value.message !== undefined || value.messageTruncated !== undefined)) context.addIssue({ code: 'custom', message: '参数警告消息隐藏时不能携带原文或截断原文' });
  if (value.messageTruncated && value.message === undefined) context.addIssue({ code: 'custom', message: '消息截断标记必须有对应的有界消息' });
});

/** 固定数组在Zod逐项处理之前先核容量，超限不遍历所有服务器条件。 */
function limitedArray<T extends z.ZodType>(schema: T, limit: number) {
  return z.preprocess((value, context) => {
    if (!Array.isArray(value) || value.length > limit) { context.addIssue({ code: 'custom', message: '查询警告记录超过采集数量上限' }); return z.NEVER; }
    return value;
  }, z.array(schema).max(limit));
}

const statement = z.object({
  statementOrdinal: count.refine(value => value > 0, '查询警告语句序号必须为正整数'), sourceRange: range.optional(),
  status: z.enum(['completed', 'failed']), warningCount: count.optional(), conditions: limitedArray(condition, queryWarningsLimits.conditions),
  truncated: z.boolean(), unavailable: message.refine(value => value.length > 0, '采集不可用原因不能为空').optional(),
}).strict();

/** 只验证有界可展示事实，不将缺失warningCount、失败或采集中断推断为零。 */
export const queryWarningsReportSchema = z.object({
  collection: z.literal('explicit'), statements: limitedArray(statement, queryWarningsLimits.statements), omittedStatements: count, truncated: z.boolean(),
}).strict().superRefine((report, context) => {
  let previous = 0;
  for (const value of report.statements) {
    if (value.statementOrdinal <= previous) context.addIssue({ code: 'custom', message: '查询警告语句序号必须按原脚本递增且不重复' });
    previous = value.statementOrdinal;
    // 长度检查已记录错误，不再为超量原消息序列化巨大副本。
    if ((value.unavailable?.length ?? 0) > queryWarningsLimits.messageBytes || value.conditions.some(item => (item.message?.length ?? 0) > queryWarningsLimits.messageBytes)) return;
  }
  if (encoder.encode(JSON.stringify(report)).byteLength > queryWarningsLimits.totalBytes) context.addIssue({ code: 'custom', message: '查询警告报告超过512 KiB总预算' });
});
