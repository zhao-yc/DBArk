import { z } from 'zod';
import { postgresCreateTableApplySchema, postgresCreateTableSchemasSchema, postgresNewIdentifier } from './postgresCreateTable';
import { postgresRelationName } from './postgresSql';

export const postgresTableCopyPreviewSchema = postgresCreateTableSchemasSchema.extend({
  source: z.string().min(1).max(512).refine(value => {
    const { schema, name } = postgresRelationName(value);
    return postgresNewIdentifier.safeParse(schema).success && postgresNewIdentifier.safeParse(name).success;
  }, '请选择准确的 PostgreSQL 来源表'),
  schema: postgresNewIdentifier.refine(value => !value.startsWith('pg_') && value !== 'information_schema', '请选择普通用户 schema'),
  name: postgresNewIdentifier,
  mode: z.enum(['structure', 'data']),
}).strict();
export const postgresTableCopyApplySchema = postgresCreateTableApplySchema.extend({ confirmed: z.literal(true) }).strict();
export type PostgresTableCopyInput = z.infer<typeof postgresTableCopyPreviewSchema>;
