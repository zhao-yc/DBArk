import { z } from 'zod';
import { csvExportDelimiters } from './csvExport';
import { queryParameterLimits, queryParameterTypes } from './queryParameters';
import { validateSqliteQueryParameters } from './sqliteQueryParameters';
import { sqliteTableExportSchema } from './sqliteTableExport';
import { sqliteInsertIdentifier, sqliteInsertIdentifierKey } from './resultSql';
import { locateSqliteStatement, sqliteLeadingKeyword } from './sqliteStatementScanner';
import { dataMarkupFormats, dataMarkupText } from './dataMarkupExport';

/** 只截取光标所在的原文。真正执行仍由独立只读进程验证语句边界及权限。 */
export function sqliteCurrentQueryExportSource(source: string, offset: number): string {
  if (source.length > queryParameterLimits.sqlBytes || new TextEncoder().encode(source).length > queryParameterLimits.sqlBytes)
    throw Error('SQLite 导出脚本超过 20 MiB');
  const selected = locateSqliteStatement(source, offset);
  if (!selected || !['SELECT', 'WITH'].includes(sqliteLeadingKeyword(selected.sql) ?? ''))
    throw Error('请将光标放在要完整导出的 SQLite SELECT 或 WITH 语句中');
  return source.slice(selected.start, selected.delimiterEnd);
}

const sql = z.string().min(1).max(queryParameterLimits.sqlBytes);
export const sqliteQueryExportSourceSchema = z.object({ sql }).strict();
const parameters = z.array(z.object({
  name: z.string().max(64), type: z.enum(queryParameterTypes), value: z.string().max(queryParameterLimits.valueBytes).optional(),
}).strict()).max(queryParameterLimits.names).superRefine((values, context) => {
  try { validateSqliteQueryParameters(values); }
  catch { context.addIssue({code: 'custom', message: 'SQLite 导出参数类型或预算无效'}); }
});
const sqliteQueryInsertColumns = z.array(sqliteInsertIdentifier).min(1).max(1024)
  .refine(names => new Set(names.map(sqliteInsertIdentifierKey)).size === names.length, 'SQLite INSERT 目标字段不能重名');
export const sqliteQueryInsertTargetSchema = z.object({
  database: sqliteInsertIdentifier, table: sqliteInsertIdentifier, columns: sqliteQueryInsertColumns.optional(),
}).strict();

/** 原生列头到达后核对位置和名称，映射错误应在打开暂存文件前拒绝。 */
export function sqliteQueryInsertColumnsForResult(target: z.infer<typeof sqliteQueryInsertTargetSchema>, source: string[]): string[] {
  const columns = target.columns ?? source;
  if (columns.length !== source.length) throw Error('SQLite INSERT 目标字段数必须与查询结果列数一致');
  if (!sqliteQueryInsertColumns.safeParse(columns).success) throw Error('SQLite INSERT 字段名无效或重复，请填写唯一的目标字段或修改查询别名');
  return columns;
}

export const sqliteQueryExportSchema = z.object({
  connectionId: sqliteTableExportSchema.shape.connectionId, taskId: sqliteTableExportSchema.shape.taskId,
  fileToken: sqliteTableExportSchema.shape.fileToken, encoding: sqliteTableExportSchema.shape.encoding,
  sql, format: z.enum(['csv', 'json', 'xlsx', 'sql', ...dataMarkupFormats]), csvDelimiter: z.enum(csvExportDelimiters).optional(),
  parameters: parameters.optional(), insertTarget: sqliteQueryInsertTargetSchema.optional(),
}).strict()
  .refine(input => input.csvDelimiter === undefined || input.format === 'csv', '分隔符仅用于 CSV 导出')
  .refine(input => input.format === 'sql' ? !!input.insertTarget : input.insertTarget === undefined, '仅 SQLite INSERT SQL 导出需要明确目标')
  .superRefine((input, context) => {
    const markup = dataMarkupText(input.format);
    if (markup && input.encoding !== 'utf8') context.addIssue({ code: 'custom', path: ['encoding'], message: markup.utf8 });
  })
  .refine(input => input.format !== 'xlsx' && input.format !== 'sql' || input.encoding === 'utf8', 'SQLite INSERT SQL 和 Excel 导出使用 UTF-8');
export type SqliteQueryExportInput = z.infer<typeof sqliteQueryExportSchema>;
