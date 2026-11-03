import { z } from 'zod';
import { sqliteTablePageSchema } from './sqliteTableBrowse';

/** 只允许已保存连接下准确的 main 表或视图。 */
export const sqliteSchemaScriptSchema = z.object({
  connectionId: sqliteTablePageSchema.shape.connectionId,
  database: z.literal('main'),
  table: sqliteTablePageSchema.shape.table,
  kind: z.enum(['table', 'view']),
}).strict();
export type SqliteSchemaScriptInput = z.infer<typeof sqliteSchemaScriptSchema>;
export interface SqliteSchemaScriptOutput { source: SqliteSchemaScriptInput; sql: string; }
export const sqliteSchemaScriptBytes = 2 * 1024 * 1024 + 16 * 1024;
const outputSchema = z.object({ source: sqliteSchemaScriptSchema, sql: z.string().min(1).max(sqliteSchemaScriptBytes) }).strict();

/** 查询草稿只接收原对象的完整、有界脚本。 */
export function assertSqliteSchemaScript(raw: unknown, source: SqliteSchemaScriptInput): SqliteSchemaScriptOutput {
  const result = outputSchema.parse(raw);
  if (JSON.stringify(result.source) !== JSON.stringify(sqliteSchemaScriptSchema.parse(source)) || new TextEncoder().encode(result.sql).byteLength > sqliteSchemaScriptBytes || result.sql.includes('\0')) throw Error('SQLite结构脚本与原对象不符或超过预算');
  return result;
}
