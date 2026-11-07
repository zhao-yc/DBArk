import { z } from 'zod';
import { csvExportDelimiters } from './csvExport';
import { queryParameterLimits, queryParameterTypes } from './queryParameters';
import { validateSqliteQueryParameters } from './sqliteQueryParameters';
import { sqliteTableExportSchema } from './sqliteTableExport';

const sql = z.string().min(1).max(queryParameterLimits.sqlBytes);
export const sqliteQueryExportSourceSchema = z.object({ sql }).strict();
const parameters = z.array(z.object({
  name: z.string().max(64), type: z.enum(queryParameterTypes), value: z.string().max(queryParameterLimits.valueBytes).optional(),
}).strict()).max(queryParameterLimits.names).superRefine((values, context) => {
  try { validateSqliteQueryParameters(values); }
  catch { context.addIssue({code: 'custom', message: 'SQLite 导出参数类型或预算无效'}); }
});
export const sqliteQueryExportSchema = z.object({
  connectionId: sqliteTableExportSchema.shape.connectionId, taskId: sqliteTableExportSchema.shape.taskId,
  fileToken: sqliteTableExportSchema.shape.fileToken, encoding: sqliteTableExportSchema.shape.encoding,
  sql, format: z.enum(['csv', 'json', 'xlsx']), csvDelimiter: z.enum(csvExportDelimiters).optional(), parameters: parameters.optional(),
}).strict()
  .refine(input => input.csvDelimiter === undefined || input.format === 'csv', '分隔符仅用于 CSV 导出')
  .refine(input => input.format !== 'xlsx' || input.encoding === 'utf8', 'Excel 导出仅使用 UTF-8 内部编码');
export type SqliteQueryExportInput = z.infer<typeof sqliteQueryExportSchema>;
