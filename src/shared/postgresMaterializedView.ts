import { z } from 'zod';
import { postgresStructureInputSchema } from './postgresStructure';

/** 模式只接受三种固定语法，普通刷新与并发刷新都填充数据。 */
export const postgresMaterializedRefreshSchema = postgresStructureInputSchema.extend({
  stamp: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(['data', 'concurrent', 'empty']),
}).strict();
export type PostgresMaterializedRefreshInput = z.infer<typeof postgresMaterializedRefreshSchema>;
