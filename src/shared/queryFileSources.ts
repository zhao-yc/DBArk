import { z } from 'zod';
import type { QueryFileEncoding } from './contracts';

export const queryFileSourceLimits = { bytes: 20 * 1024 * 1024, sqlUnits: 20_000_000, sources: 100, recents: 20 } as const;
const id = z.string().uuid();
export const queryFileSourceRefSchema = z.object({ id, revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict();
/** 文件权限仅由主进程保存；标签持有不可解释的来源及单调修订。 */
export type QueryFileSourceRef = z.infer<typeof queryFileSourceRefSchema>;
export type QueryFileBom = 'none' | 'utf8' | 'utf16le';
export type QueryFileEol = 'none' | 'lf' | 'crlf' | 'cr' | 'mixed';
export type QueryFileEolPolicy = 'preserve' | 'lf' | 'crlf' | 'cr';
export interface QueryFileSourceProgress {
  tabId: string; operation: 'open' | 'save' | 'saveAs' | 'check' | 'reload'; phase: 'choosing' | 'reading' | 'checking' | 'staging' | 'replacing' | 'verifying' | 'recording' | 'terminal';
  bytesProcessed: number; totalBytes?: number; wrote: 'no' | 'yes' | 'unknown'; cancellable: boolean;
}
/** displayPath 仅供展示，任何请求均不得将其用作授权路径。 */
export interface QueryFileSourceView {
  ref: QueryFileSourceRef; name: string; displayPath: string; encoding: QueryFileEncoding;
  bom: QueryFileBom; eol: QueryFileEol; savedSqlDigest: string;
}
export type QueryFileSourceReason = 'not-bound' | 'stale-source' | 'document-changed' | 'external-change' | 'missing' | 'identity-changed' | 'busy' | 'mixed-eol' | 'encoding' | 'permission' | 'io' | 'storage' | 'uncertain';
/** wrote 区分未写、文件已写和无法确认；失败绝不能自动重试写入。 */
export interface QueryFileSourceBlocked { state: 'blocked'; reason: QueryFileSourceReason; message: string; wrote: 'no' | 'yes' | 'unknown'; }
export interface QueryFileSourceOpened { state: 'opened'; binding: QueryFileSourceView; sql: string; }
export interface QueryFileSourceSaved { state: 'saved'; binding: QueryFileSourceView; savedSqlDigest: string; unchanged: boolean; }
export type QueryFileSourceOpenResult = QueryFileSourceOpened | QueryFileSourceBlocked | { state: 'cancelled' };
export type QueryFileSourceSaveResult = QueryFileSourceSaved | QueryFileSourceBlocked | { state: 'cancelled' };
export type QueryFileSourceStatus = { state: 'bound'; binding: QueryFileSourceView } | { state: 'unbound' } | QueryFileSourceBlocked;

const tabId = z.string().min(1).max(200), encoding = z.enum(['utf8', 'utf16le', 'gb18030']);
const taskId = z.string().uuid();
const sql = z.string().max(queryFileSourceLimits.sqlUnits).refine(value => { try { assertQueryFileSourceSql(value); return true; } catch { return false; } }, 'SQL正文包含NUL或非法Unicode'), eol = z.enum(['preserve', 'lf', 'crlf', 'cr']);
/** 无source/recentId才弹原生框；source为明确重读，recentId为明确选择Main历史，启动和status不访问文件。 */
export const queryFileSourceOpenSchema = z.object({ tabId, taskId, encoding, source: queryFileSourceRefSchema.optional(), recentId: id.optional() }).strict().refine(value => !(value.source && value.recentId), '重读来源与最近文件不能同时选择');
/** 最近条目只返回显示信息和Main生成的ID，打开时不接收展示路径。 */
export interface QueryRecentFileView { id: string; name: string; displayPath: string; encoding: QueryFileEncoding; }
export const queryRecentFilesSchema = z.object({ tabId }).strict();
export const queryRecentFileForgetSchema = z.object({ tabId, recentId: id }).strict();
export const queryFileSourceSaveSchema = z.object({ tabId, taskId, source: queryFileSourceRefSchema, sql, eol: eol.optional() }).strict();
/** 另存同样由原生选择授权，不能接收 renderer 路径；source 存在时必须精确匹配当前关联。 */
export const queryFileSourceSaveAsSchema = z.object({ tabId, taskId, source: queryFileSourceRefSchema.optional(), sql, encoding, bom: z.enum(['none', 'utf8', 'utf16le']), eol }).strict().refine(value => value.bom === 'none' || value.bom === value.encoding, 'BOM与编码不匹配');
export const queryFileSourceStatusSchema = z.object({ tabId, source: queryFileSourceRefSchema.optional() }).strict();
export const queryFileSourceReleaseSchema = z.object({ tabId, source: queryFileSourceRefSchema }).strict();
export const queryFileSourceCancelSchema = z.object({ tabId, taskId }).strict();
export type QueryFileSourceOpenInput = z.infer<typeof queryFileSourceOpenSchema>;
export type QueryFileSourceSaveInput = z.infer<typeof queryFileSourceSaveSchema>;
export type QueryFileSourceSaveAsInput = z.infer<typeof queryFileSourceSaveAsSchema>;
export type QueryFileSourceStatusInput = z.infer<typeof queryFileSourceStatusSchema>;
export type QueryFileSourceReleaseInput = z.infer<typeof queryFileSourceReleaseSchema>;
export type QueryFileSourceCancelInput = z.infer<typeof queryFileSourceCancelSchema>;

/** 原始设置门在Zod解析前检查，防止table标签、继承字段或显式undefined变成合法缺项。 */
export function assertQueryFileSourceSettings(value: { tabs?: unknown }): void {
  if (!Array.isArray(value.tabs)) return;
  for (const tab of value.tabs) {
    if (!tab || typeof tab !== 'object' || !('fileSourceBinding' in tab)) continue;
    if (!Object.hasOwn(tab, 'fileSourceBinding') || tab.kind !== 'query' || !queryFileSourceRefSchema.safeParse(tab.fileSourceBinding).success) throw Error('文件来源只允许查询标签持有有效的不透明引用');
    if ('sourceBinding' in tab && tab.sourceBinding !== undefined) throw Error('文件来源与本地保存查询不能同时作为主来源');
  }
}

/** 引用只比较明确字段，不比较renderer展示元数据或对象地址。 */
export function sameQueryFileSource(left: QueryFileSourceRef | undefined, right: QueryFileSourceRef | undefined): boolean {
  return left === undefined ? right === undefined : right !== undefined && left.id === right.id && left.revision === right.revision;
}

/** 摘要前先拒绝非法代理项，否则TextEncoder会把孤立代理项替换成U+FFFD而误判相同。 */
export function assertQueryFileSourceSql(sql: string): void {
  if (typeof sql !== 'string' || sql.length > queryFileSourceLimits.sqlUnits) throw Error('SQL正文超过2000万字符');
  for (let index = 0; index < sql.length; index++) {
    const code = sql.charCodeAt(index); if (code === 0) throw Error('SQL正文不能包含NUL');
    if (code >= 0xd800 && code <= 0xdbff) { const next = sql.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) throw Error('SQL正文包含非法Unicode'); }
    else if (code >= 0xdc00 && code <= 0xdfff) throw Error('SQL正文包含非法Unicode');
  }
}
/** 前后端共用的摘要payload：完整合法SQL的UTF-8，不增删BOM字符、不归一化任何行尾。 */
export function queryFileSourceDigestPayload(sql: string): Uint8Array<ArrayBuffer> { assertQueryFileSourceSql(sql); return new TextEncoder().encode(sql); }
/** renderer可直接使用；Main也使用同一payload计算SHA-256小写hex。 */
export async function queryFileSourceSqlDigest(sql: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', queryFileSourceDigestPayload(sql));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
/** Dirty包含显式格式变化；SQL摘要相同不能吞掉用户改变的编码、BOM或EOL。 */
export async function queryFileSourceHasChanges(sql: string, baseline: QueryFileSourceView, format: { encoding?: QueryFileEncoding; bom?: QueryFileBom; eol?: QueryFileEolPolicy } = {}): Promise<boolean> {
  assertQueryFileSourceSql(sql);
  return !!(format.encoding && format.encoding !== baseline.encoding || format.bom && format.bom !== baseline.bom || format.eol && format.eol !== 'preserve' && format.eol !== baseline.eol) || await queryFileSourceSqlDigest(sql) !== baseline.savedSqlDigest;
}
