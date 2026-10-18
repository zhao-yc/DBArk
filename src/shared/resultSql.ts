import { z } from 'zod';
import type { ResultExportData } from './contracts';
import { validateResultExportData } from './resultExport';
import { resultSqlZh as text } from './resultSql.zh-CN';

export const resultSqlLimits = { previews: 8, ttlMs: 120000, previewRows: 20, previewBytes: 4 * 1024 ** 2, fileBytes: 512 * 1024 ** 2 } as const;
/** 无会话模式时保守限制名称，反引号由SQL生成器双写，不允许反斜线改变词法。 */
const identifier = z.string().min(1, text.identifier).max(64, text.identifier).refine(value => !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff\\]/.test(value) && !/\s$/u.test(value), text.identifier);
export const resultSqlTargetSchema = z.object({ database: identifier, table: identifier, columns: z.array(z.object({ key: z.string().min(1).max(256), name: identifier }).strict()).min(1).max(1024) }).strict();
export type ResultSqlTarget = z.infer<typeof resultSqlTargetSchema>;
export const resultSqlSelectionSchema = z.object({ target: resultSqlTargetSchema, previewId: z.string().uuid(), confirmation: z.string().max(129), acknowledged: z.literal(true) }).strict();
export type ResultSqlSelection = z.infer<typeof resultSqlSelectionSchema>;
export interface ResultSqlPreviewInput { result: ResultExportData; target: ResultSqlTarget; encoding: 'utf8' | 'utf16le' | 'gb18030' }
export interface ResultSqlPreview { previewId: string; sql: string; shownRows: number; totalRows: number; expiresAt: string }
/** 名称不是目录事实，映射只证明用户明确指定的唯一字段，不查询目标结构或解析SQL。 */
export function assertResultSqlTarget(result: ResultExportData, target: ResultSqlTarget): void {
  if (!resultSqlTargetSchema.safeParse(target).success) throw Error(text.invalid);
  const names = new Set<string>();
  if (target.columns.length !== result.columns.length) throw Error(text.invalid);
  for (const [index, column] of target.columns.entries()) {
    const name = column.name.normalize('NFC').toLowerCase();
    if (column.key !== result.columns[index].key || names.has(name)) throw Error(text.invalid);
    names.add(name);
  }
}
/** 沿原行/列/字节预算；额外拒绝UTF-8编码或数值文本会丢失的来源，不转换精确字符串。 */
export function assertResultSqlData(result: ResultExportData, target: ResultSqlTarget): void {
  validateResultExportData(result); assertResultSqlTarget(result, target);
  for (const row of result.rows) for (const column of result.columns) {
    const cell = row[column.key];
    if (typeof cell === 'string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(cell) || typeof cell === 'number' && Object.is(cell, -0)) throw Error(text.type);
    if (cell && typeof cell === 'object' && (cell.base64.endsWith('==') ? !/[AQgw]==$/.test(cell.base64) : cell.base64.endsWith('=') && !/[AEIMQUYcgkosw048]=$/.test(cell.base64))) throw Error(text.type);
  }
}
