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
}).strict();
export type PostgresStructureResult = z.infer<typeof postgresStructureResultSchema>;
