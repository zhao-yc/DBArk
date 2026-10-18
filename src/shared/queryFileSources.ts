import { z } from 'zod';
import type { QueryFileEncoding } from './contracts';

export const queryFileSourceLimits = { bytes: 20 * 1024 * 1024, sqlUnits: 20_000_000, sources: 100 } as const;
const id = z.string().uuid();
export const queryFileSourceRefSchema = z.object({ id, revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict();
/** 文件权限仅由主进程保存；标签持有不可解释的来源及单调修订。 */
export type QueryFileSourceRef = z.infer<typeof queryFileSourceRefSchema>;
export type QueryFileBom = 'none' | 'utf8' | 'utf16le';
export type QueryFileEol = 'none' | 'lf' | 'crlf' | 'cr' | 'mixed';
export type QueryFileEolPolicy = 'preserve' | 'lf' | 'crlf' | 'cr';
/** displayPath 仅供展示，任何请求均不得将其用作授权路径。 */
export interface QueryFileSourceView {
  ref: QueryFileSourceRef; name: string; displayPath: string; encoding: QueryFileEncoding;
  bom: QueryFileBom; eol: QueryFileEol; savedSqlDigest: string;
}
export type QueryFileSourceReason = 'not-bound' | 'stale-source' | 'document-changed' | 'external-change' | 'missing' | 'identity-changed' | 'busy' | 'mixed-eol' | 'encoding' | 'io' | 'storage' | 'uncertain';
/** wrote 区分未写、文件已写和无法确认；失败绝不能自动重试写入。 */
export interface QueryFileSourceBlocked { state: 'blocked'; reason: QueryFileSourceReason; message: string; wrote: 'no' | 'yes' | 'unknown'; }
export interface QueryFileSourceOpened { state: 'opened'; binding: QueryFileSourceView; sql: string; }
export interface QueryFileSourceSaved { state: 'saved'; binding: QueryFileSourceView; savedSqlDigest: string; unchanged: boolean; }
export type QueryFileSourceOpenResult = QueryFileSourceOpened | QueryFileSourceBlocked | { state: 'cancelled' };
export type QueryFileSourceSaveResult = QueryFileSourceSaved | QueryFileSourceBlocked | { state: 'cancelled' };
export type QueryFileSourceStatus = { state: 'bound'; binding: QueryFileSourceView } | { state: 'unbound' } | QueryFileSourceBlocked;

const tabId = z.string().min(1).max(200), encoding = z.enum(['utf8', 'utf16le', 'gb18030']);
const sql = z.string().max(queryFileSourceLimits.sqlUnits), eol = z.enum(['preserve', 'lf', 'crlf', 'cr']);
/** 无 source 弹原生打开框；有 source 表示用户明确重读原文件，不在启动或 status 时访问文件。 */
export const queryFileSourceOpenSchema = z.object({ tabId, encoding, source: queryFileSourceRefSchema.optional() }).strict();
export const queryFileSourceSaveSchema = z.object({ tabId, source: queryFileSourceRefSchema, sql, eol: eol.optional() }).strict();
/** 另存同样由原生选择授权，不能接收 renderer 路径；source 存在时必须精确匹配当前关联。 */
export const queryFileSourceSaveAsSchema = z.object({ tabId, source: queryFileSourceRefSchema.optional(), sql, encoding, bom: z.enum(['none', 'utf8', 'utf16le']), eol }).strict().refine(value => value.bom === 'none' || value.bom === value.encoding, 'BOM与编码不匹配');
export const queryFileSourceStatusSchema = z.object({ tabId, source: queryFileSourceRefSchema.optional() }).strict();
export const queryFileSourceReleaseSchema = z.object({ tabId, source: queryFileSourceRefSchema }).strict();
export type QueryFileSourceOpenInput = z.infer<typeof queryFileSourceOpenSchema>;
export type QueryFileSourceSaveInput = z.infer<typeof queryFileSourceSaveSchema>;
export type QueryFileSourceSaveAsInput = z.infer<typeof queryFileSourceSaveAsSchema>;
export type QueryFileSourceStatusInput = z.infer<typeof queryFileSourceStatusSchema>;
export type QueryFileSourceReleaseInput = z.infer<typeof queryFileSourceReleaseSchema>;

/** 原始设置门在Zod解析前检查，防止table标签、继承字段或显式undefined变成合法缺项。 */
export function assertQueryFileSourceSettings(value: { tabs?: unknown }): void {
  if (!Array.isArray(value.tabs)) return;
  for (const tab of value.tabs) {
    if (!tab || typeof tab !== 'object' || !('fileSourceBinding' in tab)) continue;
    if (!Object.hasOwn(tab, 'fileSourceBinding') || tab.kind !== 'query' || !queryFileSourceRefSchema.safeParse(tab.fileSourceBinding).success) throw Error('文件来源只允许查询标签持有有效的不透明引用');
  }
}

/** 引用只比较明确字段，不比较renderer展示元数据或对象地址。 */
export function sameQueryFileSource(left: QueryFileSourceRef | undefined, right: QueryFileSourceRef | undefined): boolean {
  return left === undefined ? right === undefined : right !== undefined && left.id === right.id && left.revision === right.revision;
}
