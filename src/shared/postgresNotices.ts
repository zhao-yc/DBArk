import { z } from 'zod';

export const postgresNoticeLimits = {entries: 200, message: 4096, field: 1024, bytes: 512 * 1024} as const;
export const postgresNoticeHiddenMessage = '含位置参数的服务端消息内容已隐藏';
export const postgresNoticeUnknownLevel = '未知级别';
export const postgresNoticeLevels = ['NOTICE', 'WARNING', 'INFO', 'LOG', 'DEBUG'] as const;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const range = z.object({start: integer.max(4 * 1024 * 1024), end: integer.max(4 * 1024 * 1024)}).strict().refine(value => value.start < value.end);
const message = z.string().max(postgresNoticeLimits.message), field = z.string().max(postgresNoticeLimits.field);
export const postgresNoticeEntrySchema = z.object({sequence: integer.positive(), statementOrdinal: integer.min(1).max(1000),
  severity: z.string().min(1).max(64), sqlState: z.string().regex(/^[0-9A-Z]{5}$/).optional(), message,
  detail: field.optional(), hint: field.optional(), context: field.optional(), truncated: z.boolean(), sourceRange: range.optional(),
}).strict();
export type PostgresNoticeEntry = z.infer<typeof postgresNoticeEntrySchema>;
export const postgresNoticeReportSchema = z.object({received: integer, omitted: integer, truncated: z.boolean(), redacted: z.boolean(),
  entries: z.preprocess((input, context) => {
    if (!Array.isArray(input) || input.length > postgresNoticeLimits.entries) { context.addIssue({code: 'custom', message: '服务端消息超过保留上限'}); return z.NEVER; }
    return input;
  }, z.array(postgresNoticeEntrySchema)),
}).strict().superRefine((report, context) => {
  let previous = 0;
  if (report.received !== report.entries.length + report.omitted || !report.truncated && (report.omitted > 0 || report.entries.some(entry => entry.truncated)) ||
      report.entries.some(entry => { const invalid = entry.sequence <= previous || entry.sequence > report.received; previous = entry.sequence; return invalid; }))
    context.addIssue({code: 'custom', message: '服务端消息统计或顺序无效'});
  if (new TextEncoder().encode(JSON.stringify(report)).byteLength > postgresNoticeLimits.bytes)
    context.addIssue({code: 'custom', message: '服务端消息超过总预算'});
  if (report.redacted && report.entries.some(entry => entry.message !== postgresNoticeHiddenMessage ||
      entry.severity !== postgresNoticeUnknownLevel && !postgresNoticeLevels.some(level => level === entry.severity) ||
      entry.detail !== undefined || entry.hint !== undefined || entry.context !== undefined))
    context.addIssue({code: 'custom', message: '位置参数消息不能包含原文'});
});
export type PostgresNoticeReport = z.infer<typeof postgresNoticeReportSchema>;
