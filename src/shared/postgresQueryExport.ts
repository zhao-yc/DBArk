import { z } from 'zod';
import { csvExportDelimiters } from './csvExport';

export const postgresQueryExportSchema = z.object({
  connectionId: z.string().min(1).max(200), database: z.string().min(1).max(256),
  taskId: z.string().min(1).max(200), fileToken: z.string().min(1).max(200),
  sql: z.string().min(1).max(4 * 1024 * 1024), format: z.enum(['csv', 'json']),
  encoding: z.enum(['utf8', 'utf16le', 'gb18030']), csvDelimiter: z.enum(csvExportDelimiters).optional(),
}).strict().refine(input => input.csvDelimiter === undefined || input.format === 'csv', '分隔符仅用于 CSV 导出');

export type PostgresQueryExportInput = z.infer<typeof postgresQueryExportSchema>;
export interface PostgresQueryExportOutput { rows: number; fileCommitted: true; }
