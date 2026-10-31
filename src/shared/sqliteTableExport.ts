import { z } from 'zod';
import { sqliteTablePageSchema, sqliteTableBrowseLimits } from './sqliteTableBrowse';
import { csvExportDelimiters } from './csvExport';

/** 完整导出沿原已应用的typed筛选和排序；路径、任意SQL及凭据均不进入公共合同。 */
export const sqliteTableExportSchema = z.object({
  connectionId: sqliteTablePageSchema.shape.connectionId, database: z.literal('main'), table: sqliteTablePageSchema.shape.table,
  taskId: sqliteTablePageSchema.shape.taskId, fileToken: z.string().min(1).max(200), schemaKey: z.string().regex(/^[a-f0-9]{64}$/),
  mode: sqliteTablePageSchema.shape.mode, filters: sqliteTablePageSchema.shape.filters, sort: sqliteTablePageSchema.shape.sort,
  columns: z.array(sqliteTablePageSchema.shape.table).min(1).max(sqliteTableBrowseLimits.columns),
  format: z.enum(['csv', 'json', 'sql', 'xlsx']), encoding: z.enum(['utf8', 'utf16le', 'gb18030']), csvDelimiter: z.enum(csvExportDelimiters).optional(),
}).strict().superRefine((input, context) => {
  const page = sqliteTablePageSchema.safeParse({ connectionId: input.connectionId, database: input.database, table: input.table, taskId: input.taskId, offset: 0, limit: 1, mode: input.mode, filters: input.filters, sort: input.sort });
  if (!page.success) for (const issue of page.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  if (new Set(input.columns).size !== input.columns.length) context.addIssue({ code: 'custom', message: 'SQLite导出列不能重复' });
  if (Object.hasOwn(input, 'csvDelimiter') && (input.format !== 'csv' || input.csvDelimiter === undefined)) context.addIssue({ code: 'custom', message: '只有CSV可指定逗号、分号或Tab分隔符' });
  if (input.format === 'xlsx' && input.encoding !== 'utf8') context.addIssue({ code: 'custom', message: 'Excel导出只使用UTF-8内部编码' });
});
export type SqliteTableExportInput = z.infer<typeof sqliteTableExportSchema>;
/** 仅真实文件原子提交完成可返回true；取消或失败不能伪造成功。 */
export interface SqliteTableExportOutput { rows: number; fileCommitted: true; }
/** 任务持久概要不得包含条件、实际行值、路径或驱动原始错误。 */
export const sqliteTableExportMessages = {
  running: '正在流式导出SQLite全部筛选行；条件、原值和路径仅留在原窗口。',
  completed: 'SQLite全部筛选行文件已保存；条件、原值、路径及错误原文未保存到概要。',
  failed: 'SQLite全部筛选行导出未正常完成；请核对所选文件，条件、原值、路径及错误原文未保存到概要。',
} as const;
