import { z } from 'zod';

export const postgresCompletionLimits = { source: 64 * 1024, tokens: 4096, items: 120, relations: 8, name: 256 } as const;
const text = z.string().max(postgresCompletionLimits.name).refine(value => !value.includes('\0'));
const name = text.refine(value => value.length > 0);
const target = z.object({ connectionId: name, database: name, prefix: text, sessionId: name.optional() });
export const postgresCompletionReferenceSchema = z.object({ schema: name.optional(), name }).strict();
export type PostgresCompletionReference = z.infer<typeof postgresCompletionReferenceSchema>;

/** 只接受解析后的目录目标，绝不把编辑器 SQL 交给数据库补全入口。 */
export const postgresCompletionSchema = z.discriminatedUnion('kind', [
  target.extend({ kind: z.literal('relations'), schema: name.optional() }).strict(),
  target.extend({ kind: z.literal('columns'), relations: z.array(postgresCompletionReferenceSchema).min(1).max(postgresCompletionLimits.relations) }).strict(),
]);
export type PostgresCompletionInput = z.infer<typeof postgresCompletionSchema>;
export type PostgresCompletionItem =
  | { kind: 'schema'; name: string }
  | { kind: 'table' | 'view'; schema: string; name: string }
  | { kind: 'column'; reference: number; name: string; type: string };
export interface PostgresCompletionResult {
  items: PostgresCompletionItem[];
  incomplete: boolean;
  deferred?: 'transaction' | 'busy';
}
