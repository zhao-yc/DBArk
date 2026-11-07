import { z } from 'zod';
import type { ResultExportData } from './contracts';
import { validateResultExportData } from './resultExport';
import { resultSqlZh as text } from './resultSql.zh-CN';
import { postgresNewIdentifier } from './postgresCreateTable';
import { copySqliteResultStorage, sqliteResultStorageLimits, type SqliteResultStorage } from './sqliteResultStorage';

export const resultSqlLimits = { previews: 8, ttlMs: 120000, previewRows: 20, previewBytes: 4 * 1024 ** 2, fileBytes: 512 * 1024 ** 2 } as const;
/** 无会话模式时保守限制名称，反引号由SQL生成器双写，不允许反斜线改变词法。 */
const identifier = z.string().min(1, text.identifier).max(64, text.identifier).refine(value => !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff\\]/.test(value) && !/\s$/u.test(value), text.identifier);
export const sqliteInsertIdentifier = z.string().min(1).max(256).refine(value => !!value.trim() &&
  !/[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value), text.sqliteIdentifier);
export function sqliteInsertIdentifierKey(name: string): string {
  return name.replace(/[A-Z]/g, character => character.toLowerCase());
}
export const resultSqlTargetSchema = z.object({
  dialect: z.enum(['postgresql', 'sqlite']).optional(),
  database: z.string().max(256), table: z.string().max(256),
  columns: z.array(z.object({ key: z.string().min(1).max(256), name: z.string().max(256) }).strict()).min(1).max(1024),
}).strict().superRefine((value, context) => {
  const schema = value.dialect === 'sqlite' ? sqliteInsertIdentifier : value.dialect === 'postgresql' ? postgresNewIdentifier : identifier;
  const message = value.dialect === 'sqlite' ? text.sqliteIdentifier : value.dialect === 'postgresql' ? text.postgresIdentifier : text.identifier;
  for (const [path, name] of [['database', value.database], ['table', value.table]] as const)
    if (!schema.safeParse(name).success) context.addIssue({code: 'custom', path: [path], message});
  value.columns.forEach((column, index) => {
    if (!schema.safeParse(column.name).success) context.addIssue({code: 'custom', path: ['columns', index, 'name'], message});
  });
});
export type ResultSqlTarget = z.infer<typeof resultSqlTargetSchema>;
export const resultSqlStorageSchema = z.object({
  version: z.literal(1),
  rows: z.array(z.string().max(1024).regex(/^[irtbn]+$/)).max(sqliteResultStorageLimits.rows),
}).strict();
export const resultSqlSelectionSchema = z.object({
  target: resultSqlTargetSchema, previewId: z.string().uuid(), confirmation: z.string().max(513),
  acknowledged: z.literal(true), sqliteStorage: resultSqlStorageSchema.optional(),
}).strict();
export type ResultSqlSelection = z.infer<typeof resultSqlSelectionSchema>;
export interface ResultSqlPreviewInput { result: ResultExportData; target: ResultSqlTarget; encoding: 'utf8' | 'utf16le' | 'gb18030'; sqliteStorage?: SqliteResultStorage }
export interface ResultSqlPreview { previewId: string; sql: string; shownRows: number; totalRows: number; expiresAt: string }
/** 名称不是目录事实，映射只证明用户明确指定的唯一字段，不查询目标结构或解析SQL。 */
export function assertResultSqlTarget(result: ResultExportData, target: ResultSqlTarget): void {
  if (!resultSqlTargetSchema.safeParse(target).success) throw Error(text.invalid);
  const names = new Set<string>();
  if (target.columns.length !== result.columns.length) throw Error(text.invalid);
  for (const [index, column] of target.columns.entries()) {
    const name = target.dialect === 'sqlite' ? sqliteInsertIdentifierKey(column.name)
      : target.dialect === 'postgresql' ? column.name : column.name.normalize('NFC').toLowerCase();
    if (column.key !== result.columns[index].key || names.has(name)) throw Error(text.invalid);
    names.add(name);
  }
}
/** 沿原行/列/字节预算；额外拒绝UTF-8编码或数值文本会丢失的来源，不转换精确字符串。 */
export function assertResultSqlData(result: ResultExportData, target: ResultSqlTarget, sqliteStorage?: SqliteResultStorage): void {
  validateResultExportData(result); assertResultSqlTarget(result, target);
  if (target.dialect === 'sqlite') {
    if (!sqliteStorage) throw Error(text.sqliteStorage);
    copySqliteResultStorage(sqliteStorage, result.columns.map(column => ({...column, type: 'SQLITE'})), result.rows);
    return;
  }
  if (sqliteStorage !== undefined) throw Error(text.invalid);
  for (const row of result.rows) for (const column of result.columns) {
    const cell = row[column.key];
    if (target.dialect === 'postgresql' && typeof cell === 'string' && cell.includes('\0')) throw Error(text.postgresNul);
    if (typeof cell === 'string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(cell) || typeof cell === 'number' && Object.is(cell, -0)) throw Error(text.type);
    if (cell && typeof cell === 'object' && (cell.base64.endsWith('==') ? !/[AQgw]==$/.test(cell.base64) : cell.base64.endsWith('=') && !/[AEIMQUYcgkosw048]=$/.test(cell.base64))) throw Error(text.type);
  }
}

/** PostgreSQL 文件固定 UTF-8，不能让不可表示的字符经其它编码替换后写入。 */
export function assertResultSqlEncoding(target: ResultSqlTarget, encoding: string): void {
  if (target.dialect === 'sqlite' && encoding !== 'utf8') throw Error(text.sqliteUtf8);
  if (target.dialect === 'postgresql' && encoding !== 'utf8') throw Error(text.postgresUtf8);
}

export function resultSqlHeader(target: ResultSqlTarget): string {
  return target.dialect === 'sqlite' ? text.sqliteHeader : target.dialect === 'postgresql' ? text.postgresHeader : text.header;
}
