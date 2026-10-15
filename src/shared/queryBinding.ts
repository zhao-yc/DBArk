import { z } from 'zod';
import { savedQueryContextSchema, savedQuerySearchLimits } from './savedQuerySearch';
import type { QueryDatabaseContext } from './queryContext';

const id = z.string().min(1).max(200), name = z.string().min(1).max(256), digest = z.string().regex(/^[a-f0-9]{64}$/);
/** 遗留记录与显式已知库、无库、未知保持区分，不借用当前连接默认库重写来源。 */
export const savedQueryOriginContextSchema = z.union([savedQueryContextSchema, z.object({ state: z.literal('legacy'), database: name.optional() }).strict()]);
export type SavedQueryOriginContext = z.infer<typeof savedQueryOriginContextSchema>;
export const querySourceBindingSchema = z.object({ id, digest, connectionId: id.optional(), connectionDigest: digest.optional(), context: savedQueryOriginContextSchema }).strict();
export type QuerySourceBinding = z.infer<typeof querySourceBindingSchema>;
export const querySaveContentSchema = z.object({ name, connectionId: id.optional(), context: savedQueryOriginContextSchema, sql: z.string().max(savedQuerySearchLimits.sqlUnits) }).strict();
export const queryUpdateSourceSchema = z.object({ source: querySourceBindingSchema, content: querySaveContentSchema }).strict();
export type QuerySaveContent = z.infer<typeof querySaveContentSchema>;
export interface QuerySaveResult { source: QuerySourceBinding; name: string; }

/** 按所见字段保留四类上下文，不能把遗留省略值转换成已知空库。 */
export function savedQueryOriginContext(database?: string, context?: QueryDatabaseContext): SavedQueryOriginContext {
  return context ? { ...context } : { state: 'legacy', ...(database === undefined ? {} : { database }) };
}
/** 比较语义明确的字段，忽略对象属性顺序；遗留和显式上下文永不混为一谈。 */
export function sameSavedQueryContext(left: SavedQueryOriginContext, right: SavedQueryOriginContext): boolean {
  return left.state === right.state && (left.state === 'unknown' || ('database' in left ? left.database : undefined) === ('database' in right ? right.database : undefined));
}
