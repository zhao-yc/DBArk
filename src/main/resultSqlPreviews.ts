import { createHash, randomUUID } from 'node:crypto';
import type { ResultExportOptions } from '../shared/contracts';
import { assertResultSqlData, resultSqlLimits, type ResultSqlPreview, type ResultSqlPreviewInput } from '../shared/resultSql';
import { resultSqlZh as text } from '../shared/resultSql.zh-CN';
import { previewResultSql } from '../engine/resultSql';
import type { SelectedFile } from './fileTokens';

/** 摘要逐单元格更新，不复制整份结果或构造完整SQL；绑定列顺序、类型值、截断事实及编码。 */
function fingerprint(input: ResultSqlPreviewInput): string {
  const hash = createHash('sha256').update(JSON.stringify([input.target, input.encoding, input.result.columns, input.result.truncated, input.result.rows.length]));
  for (const row of input.result.rows) { hash.update('['); for (const column of input.result.columns) hash.update(JSON.stringify(row[column.key])).update(','); hash.update(']'); }
  return hash.digest('hex');
}
interface Preview { owner: object; digest: string; expires: number; files: Set<string> }
/** 只保留有界摘要和本主文档授权，不缓存全结果；文件授权与预览一次消费，失败也不自动重用。 */
export class ResultSqlPreviews {
  private readonly previews = new Map<string, Preview>();
  /** 文件表由Main持有，仅注入时钟便于验证过期边界，不访问磁盘。 */
  constructor(private readonly files: Map<string, SelectedFile>, private readonly now = () => Date.now()) {}
  /** 过期同时撤销该预览签发的文件，不遗留可写权限。 */
  private prune(): void { for (const [id, value] of this.previews) if (value.expires <= this.now()) this.remove(id, value); }
  /** 精确移除一个预览及其文件，其他窗口内导出对话框不受影响。 */
  private remove(id: string, value: Preview): void { this.previews.delete(id); for (const token of value.files) this.files.delete(token); }
  /** 归属已在Main真实事件捕获，旧文档或其他窗口不能使用同一字符串令牌。 */
  assert(id: string, owner: object): Preview { this.prune(); const value = this.previews.get(id); if (!value || value.owner !== owner) throw Error(text.stale); return value; }
  /** 新主文档撤销旧文档能力；只保存摘要，样例返回后不在Main缓存正文。 */
  issue(input: ResultSqlPreviewInput, owner: object): ResultSqlPreview {
    for (const [id, value] of this.previews) if (value.owner !== owner) this.remove(id, value);
    this.prune(); if (this.previews.size >= resultSqlLimits.previews) throw Error(text.capacity);
    const sample = previewResultSql(input.result, input.target), id = randomUUID(), expires = this.now() + resultSqlLimits.ttlMs;
    this.previews.set(id, { owner, digest: fingerprint(input), expires, files: new Set() });
    return { ...sample, previewId: id, expiresAt: new Date(expires).toISOString() };
  }
  /** 开始重新选择即撤销旧文件，等待原生对话框时也不能提交旧目标。 */
  beginChoice(id: string, owner: object): void { const value = this.assert(id, owner); for (const token of value.files) this.files.delete(token); value.files.clear(); }
  /** 原生选择返回后重新核租约；本用途令牌不能被通用表导出借用。 */
  bindFile(id: string, owner: object, token: string): void {
    const value = this.assert(id, owner), file = this.files.get(token);
    if (!file || file.purpose !== 'export' || file.format !== 'sql') throw Error(text.stale);
    for (const previous of value.files) this.files.delete(previous); value.files.clear();
    this.files.set(token, { ...file, purpose: 'result-sql-export' }); value.files.add(token);
  }
  /** 同步消费发生在路径等待之前；数据/映射/编码变更、错误确认或重复提交均不能写文件。 */
  consume(input: ResultExportOptions, owner: object): string {
    const selection = input.sql; if (input.format !== 'sql' || !selection) throw Error(text.stale);
    const value = this.assert(selection.previewId, owner), file = this.files.get(input.fileToken);
    this.previews.delete(selection.previewId);
    const authorized = value.files.has(input.fileToken) && file?.purpose === 'result-sql-export' && file.format === 'sql';
    for (const token of value.files) this.files.delete(token);
    assertResultSqlData(input.result, selection.target);
    if (!authorized || selection.acknowledged !== true || selection.confirmation !== `${selection.target.database}.${selection.target.table}` || value.digest !== fingerprint({ result: input.result, target: selection.target, encoding: input.encoding })) throw Error(text.stale);
    return file!.path;
  }
  /** 只释放本owner的预览与其文件，迟到旧释放不会撤销新预览。 */
  release(id: string, owner: object): void { const value = this.previews.get(id); if (value?.owner === owner) this.remove(id, value); }
  /** 窗口关闭撤销全部本地能力，不保留跨会话文件选择。 */
  clear(): void { for (const [id, value] of this.previews) this.remove(id, value); }
}
