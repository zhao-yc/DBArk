import { z } from 'zod';

const identifier = z.string().min(1).max(512).refine(value => !value.includes('\0'));
const optionalText = z.string().nullable();

/** 独立结构入口只接受已保存连接和指定关系，SQL定义从服务器读取。 */
export const postgresStructureInputSchema = z.object({
  connectionId: identifier, database: identifier, table: identifier,
}).strict();
export type PostgresStructureInput = z.infer<typeof postgresStructureInputSchema>;

export const postgresStructureKind = z.enum(['r', 'p', 'v', 'm', 'f']);
const structureColumn = z.object({
  position: z.number().int().positive(),
  name: identifier,
  type: z.string().min(1),
  nullable: z.boolean(),
  defaultExpression: optionalText,
  generationExpression: optionalText,
  generation: z.enum(['', 's', 'v']),
  identity: z.enum(['', 'a', 'd']),
  collation: optionalText,
  comment: optionalText,
}).strict();
const structureConstraint = z.object({
  name: identifier,
  kind: z.enum(['p', 'f', 'u', 'c', 'x', 'n']),
  definition: z.string().min(1),
  deferrable: z.boolean(),
  initiallyDeferred: z.boolean(),
  validated: z.boolean(),
  inherited: z.boolean(),
  keyColumns: z.array(identifier).max(128).optional(),
  check: z.object({ expression: z.string().min(1), noInherit: z.boolean(), enforced: z.boolean(), comment: optionalText.optional() }).strict().nullable().optional(),
  foreign: z.object({
    schema: identifier, table: identifier, enforced: z.boolean(),
    match: z.enum(['s', 'f', 'p']), onUpdate: z.enum(['a', 'r', 'c', 'n', 'd']), onDelete: z.enum(['a', 'r', 'c', 'n', 'd']),
    pairs: z.array(z.object({ local: identifier, remote: identifier }).strict()).max(128),
  }).strict().nullable().optional(),
}).strict();
const structureIndex = z.object({
  name: identifier,
  method: identifier,
  definition: z.string().min(1),
  unique: z.boolean(),
  primary: z.boolean(),
  valid: z.boolean(),
  ready: z.boolean(),
  constraint: optionalText,
  replicaIdentity: z.boolean().optional(),
  nullsNotDistinct: z.boolean().optional(),
  parts: z.array(z.object({
    column: optionalText, key: z.boolean(), descending: z.boolean(), nullsFirst: z.boolean(),
  }).strict()).max(128).optional(),
}).strict();

/** 大型关系的结构必须完整交付；超过目录预算时整体拒绝。 */
export const postgresStructureResultSchema = z.object({
  database: identifier,
  schema: identifier,
  name: identifier,
  kind: postgresStructureKind,
  comment: optionalText,
  partitionKey: optionalText,
  partitionBound: optionalText,
  rowSecurity: z.boolean(),
  forceRowSecurity: z.boolean(),
  viewDefinition: optionalText,
  columns: z.array(structureColumn).max(2000),
  constraints: z.array(structureConstraint).max(2000),
  indexes: z.array(structureIndex).max(2000),
  serverVersion: z.number().int().positive().optional(),
  editStamp: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type PostgresStructureResult = z.infer<typeof postgresStructureResultSchema>;
