import { z } from 'zod';
import type { SqlSnippet } from './contracts';

export const SNIPPET_LIMITS = { count: 500, sql: 65_536, totalSql: 4_194_304, name: 100, group: 100, description: 2000 } as const;
/** 不修剪 SQL 正文：注释、引号、美元符号及换行都是原文的一部分。 */
export const snippetSchema = z.object({ id: z.string().min(1).max(200), name: z.string().trim().min(1).max(SNIPPET_LIMITS.name), group: z.string().trim().max(SNIPPET_LIMITS.group), description: z.string().max(SNIPPET_LIMITS.description), sql: z.string().min(1).max(SNIPPET_LIMITS.sql).refine(sql => sql.trim().length > 0, 'SQL 正文不能为空'), updatedAt: z.string().max(100) }).strict();
/** 更新按主键替换后计算预算，失败前不改变数据库或磁盘。 */
export function validateSnippetBudget(existing: SqlSnippet[], snippet: SqlSnippet): SqlSnippet {
  const parsed = snippetSchema.parse(snippet);
  const others = existing.filter(item => item.id !== parsed.id);
  if (others.length >= SNIPPET_LIMITS.count) throw new Error('SQL 片段最多保存 500 条');
  const encoder = new TextEncoder();
  if (others.reduce((size, item) => size + encoder.encode(item.sql).byteLength, encoder.encode(parsed.sql).byteLength) > SNIPPET_LIMITS.totalSql) throw new Error('SQL 片段正文总量超过 4 MiB UTF-8 字节，请删除不用的片段');
  return parsed;
}
