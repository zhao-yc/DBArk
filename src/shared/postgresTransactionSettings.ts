import { z } from 'zod';

export const postgresTransactionIsolations = ['READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'] as const;
export const postgresTransactionDefaultsSchema = z.object({isolation: z.enum(postgresTransactionIsolations), readOnly: z.boolean(), deferrable: z.boolean()}).strict();
export type PostgresTransactionDefaults = z.infer<typeof postgresTransactionDefaultsSchema>;
export const postgresTransactionSnapshotSchema = postgresTransactionDefaultsSchema.extend({
  processId: z.number().int().positive().max(2147483647), backendStart: z.string().min(1).max(40).regex(/^\d+(?:\.\d+)?$/),
  database: z.string().min(1).max(256), transactionOpen: z.boolean(), transactionFailed: z.boolean(),
}).strict().refine(value => !value.transactionFailed || value.transactionOpen, '失败事务须处于事务内');
export type PostgresTransactionSnapshot = z.infer<typeof postgresTransactionSnapshotSchema>;
const ids = {sessionId: z.string().min(1).max(200), taskId: z.string().min(1).max(200)};
export const postgresTransactionReadSchema = z.object(ids).strict();
export const postgresTransactionApplySchema = z.object({...ids, expected: postgresTransactionSnapshotSchema, defaults: postgresTransactionDefaultsSchema}).strict();
export type PostgresTransactionApplyInput = z.infer<typeof postgresTransactionApplySchema>;

/** 仅三个白名单事务属性组成固定语句，不接收任意 SQL、GLOBAL 或当前事务设置。 */
export function postgresTransactionDefaultsSql(input: PostgresTransactionDefaults): string {
  const value = postgresTransactionDefaultsSchema.parse(input);
  return `SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL ${value.isolation}, READ ${value.readOnly ? 'ONLY' : 'WRITE'}, ${value.deferrable ? '' : 'NOT '}DEFERRABLE`;
}
