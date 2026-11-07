import { z } from 'zod';

export const postgresTimeoutMaxMs = 2147483647;
const ms = z.number().int().min(0).max(postgresTimeoutMaxMs);
export const postgresQueryTimeoutValues = z.object({statementMs: ms, lockMs: ms}).strict();
export const postgresQueryTimeoutSnapshot = postgresQueryTimeoutValues.extend({
  processId: z.number().int().positive().max(2147483647),
  backendStart: z.string().min(1).max(40).regex(/^\d+(?:\.\d+)?$/),
  database: z.string().min(1).max(256),
  defaults: postgresQueryTimeoutValues,
});
export const postgresQueryTimeoutChange = z.discriminatedUnion('mode', [
  z.object({mode: z.literal('set'), values: postgresQueryTimeoutValues}).strict(),
  z.object({mode: z.literal('reset')}).strict(),
]);
export const postgresQueryTimeoutRead = z.object({
  sessionId: z.string().min(1).max(200), taskId: z.string().min(1).max(200),
}).strict();
export const postgresQueryTimeoutApply = postgresQueryTimeoutRead.extend({
  expected: postgresQueryTimeoutSnapshot, change: postgresQueryTimeoutChange,
});
export type PostgresQueryTimeoutSnapshot = z.infer<typeof postgresQueryTimeoutSnapshot>;
export type PostgresQueryTimeoutChange = z.infer<typeof postgresQueryTimeoutChange>;
export type PostgresQueryTimeoutApply = z.infer<typeof postgresQueryTimeoutApply>;
