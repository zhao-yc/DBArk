import { z } from 'zod';
import { postgresStructureInputSchema } from './postgresStructure';

export const postgresRoutineReadSchema = postgresStructureInputSchema.omit({ table: true }).extend({
  kind: z.enum(['function', 'procedure']),
  name: z.string().min(1).max(64 * 1024).refine(value => !value.includes('\0')),
}).strict();
export type PostgresRoutineReadInput = z.infer<typeof postgresRoutineReadSchema>;

export const postgresRoutineInfoSchema = z.object({
  name: z.string().min(1), category: z.enum(['f', 'p', 'w']), arguments: z.string(), returns: z.string().nullable(),
  language: z.string(), owner: z.string(), volatility: z.enum(['i', 's', 'v']), securityDefiner: z.boolean(),
  comment: z.string().nullable(), definition: z.string().min(1),
}).strict();
export type PostgresRoutineInfo = z.infer<typeof postgresRoutineInfoSchema>;
