import { z } from 'zod';

export const postgresSearchPathLimit = 4096;
export const postgresSearchPathCandidates = 200;
const path = z.string().max(postgresSearchPathLimit).refine(value => !value.includes('\0'), '搜索路径不能包含空字符');
const name = z.string().min(1).max(256);
export const postgresSearchPathSnapshotSchema = z.object({
  processId: z.number().int().positive().max(2147483647),
  backendStart: z.string().min(1).max(40).regex(/^\d+(?:\.\d+)?$/),
  database: name,
  role: name,
  path,
  effective: z.array(name).max(512),
  candidates: z.array(name).max(postgresSearchPathCandidates),
  candidatesTruncated: z.boolean(),
}).strict();
export type PostgresSearchPathSnapshot = z.infer<typeof postgresSearchPathSnapshotSchema>;
export const postgresSearchPathChangeSchema = z.discriminatedUnion('mode', [
  z.object({mode: z.literal('set'), path}).strict(),
  z.object({mode: z.literal('reset')}).strict(),
]);
export type PostgresSearchPathChange = z.infer<typeof postgresSearchPathChangeSchema>;
export const postgresSearchPathReadSchema = z.object({
  sessionId: z.string().min(1).max(200), taskId: z.string().min(1).max(200),
}).strict();
export const postgresSearchPathApplySchema = postgresSearchPathReadSchema.extend({
  expected: postgresSearchPathSnapshotSchema, change: postgresSearchPathChangeSchema,
});
export type PostgresSearchPathApplyInput = z.infer<typeof postgresSearchPathApplySchema>;
