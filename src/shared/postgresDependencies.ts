import { z } from 'zod';

export const postgresDependencySchema = z.object({
  direction: z.enum(['referencedBy', 'references']),
  kind: z.string().min(1).nullable(),
  identity: z.string().min(1).nullable(),
  type: z.string().length(1),
}).strict();

export type PostgresDependency = z.infer<typeof postgresDependencySchema>;
export type PostgresDependencies = { entries: PostgresDependency[]; limited: boolean };
