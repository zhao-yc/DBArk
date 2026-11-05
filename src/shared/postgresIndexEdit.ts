import { z } from 'zod';
import { postgresNewIdentifier } from './postgresCreateTable';
import { postgresIdentifier } from './postgresSql';
import { postgresStructureInputSchema, type PostgresStructureResult } from './postgresStructure';

const existingName = z.string().min(1).max(512).refine(value => !value.includes('\0'));
export const postgresIndexMethods = ['btree', 'hash', 'gin', 'gist', 'spgist', 'brin'] as const;
export const postgresIndexMethod = z.enum(postgresIndexMethods);
export type PostgresIndexMethod = z.infer<typeof postgresIndexMethod>;
const key = z.object({
  column: existingName, direction: z.enum(['asc', 'desc']), nulls: z.enum(['default', 'first', 'last']),
}).strict();
const create = z.object({
  kind: z.literal('create'), name: postgresNewIdentifier, method: postgresIndexMethod, unique: z.boolean(),
  keys: z.array(key).min(1).max(32), include: z.array(existingName).max(31),
}).strict();
const change = z.discriminatedUnion('kind', [
  create,
  z.object({ kind: z.literal('rename'), from: existingName, name: postgresNewIdentifier }).strict(),
  z.object({ kind: z.literal('drop'), from: existingName }).strict(),
]);
export const postgresIndexPreviewSchema = postgresStructureInputSchema.extend({
  editStamp: z.string().regex(/^[a-f0-9]{64}$/), changes: z.array(change).min(1).max(16),
}).strict();
export const postgresIndexApplySchema = postgresStructureInputSchema.extend({ token: z.uuid() }).strict();
export type PostgresIndexPreviewInput = z.infer<typeof postgresIndexPreviewSchema>;
export type PostgresIndexApplyInput = z.infer<typeof postgresIndexApplySchema>;
export type PostgresIndexChange = z.infer<typeof change>;
type ObservedIndex = PostgresStructureResult['indexes'][number];
type CreatedIndex = z.infer<typeof create>;

/** PostgreSQL 内置索引方法的列能力，表单和编译器使用同一组限制。 */
export function postgresIndexCapabilities(method: PostgresIndexMethod) {
  return {
    ordering: method === 'btree',
    multi: method !== 'hash' && method !== 'spgist',
    include: method === 'btree' || method === 'gist' || method === 'spgist',
  };
}

/** 约束和复制标识关联索引由各自的管理入口处理。 */
export function canEditPostgresIndex(index: ObservedIndex) {
  return !index.primary && index.constraint === null && !index.replicaIdentity;
}

/** 编译列索引和限定名，记录保留的原索引及新增索引的预期目录定义。 */
export function postgresIndexPlan(source: PostgresStructureResult, raw: PostgresIndexPreviewInput) {
  const { editStamp, changes } = postgresIndexPreviewSchema.parse(raw);
  if (!source.editStamp || source.editStamp !== editStamp) throw Error('原表结构已变化，请重新读取后预览');
  const schema = postgresIdentifier(source.schema);
  const table = schema + '.' + postgresIdentifier(source.name);
  const columns = new Set(source.columns.map(column => column.name));
  const indexes = new Map<string, { original?: ObservedIndex; created?: CreatedIndex }>(
    source.indexes.map(index => [index.name, { original: index }]));
  const statements: string[] = [];
  for (const change of changes) {
    if (change.kind !== 'drop' && indexes.has(change.name)) throw Error('索引名称已存在：' + change.name);
    if (change.kind === 'create') {
      const { ordering, multi, include } = postgresIndexCapabilities(change.method);
      const fields = [...change.keys.map(key => key.column), ...change.include];
      if (fields.length > 32 || new Set(fields).size !== fields.length || fields.some(field => !columns.has(field)))
        throw Error('索引字段必须来自原表、不得重复，且合计最多 32 列');
      if (!multi && change.keys.length > 1) throw Error('所选方法只支持单键列');
      if (!include && change.include.length) throw Error('所选方法不支持包含列');
      if (!ordering && (change.unique || change.keys.some(key => key.direction !== 'asc' || key.nulls !== 'default')))
        throw Error('只有 B-tree 索引支持唯一性和排序选项');
      const keys = change.keys.map(key => postgresIdentifier(key.column) + (ordering
        ? (key.direction === 'desc' ? ' DESC' : ' ASC') +
          (key.nulls === 'default' ? '' : key.nulls === 'first' ? ' NULLS FIRST' : ' NULLS LAST')
        : ''));
      statements.push('CREATE ' + (change.unique ? 'UNIQUE ' : '') + 'INDEX ' + postgresIdentifier(change.name) +
        ' ON ONLY ' + table + ' USING ' + change.method + ' (' + keys.join(', ') + ')' +
        (change.include.length ? ' INCLUDE (' + change.include.map(postgresIdentifier).join(', ') + ')' : ''));
      indexes.set(change.name, { created: change });
      continue;
    }
    const existing = indexes.get(change.from);
    if (!existing || existing.original && !canEditPostgresIndex(existing.original))
      throw Error('原索引不存在或受约束、复制标识保护：' + change.from);
    const identifier = schema + '.' + postgresIdentifier(change.from);
    if (change.kind === 'rename') {
      statements.push('ALTER INDEX ' + identifier + ' RENAME TO ' + postgresIdentifier(change.name));
      indexes.set(change.name, existing);
    } else statements.push('DROP INDEX ' + identifier + ' RESTRICT');
    indexes.delete(change.from);
  }
  return { table, statements, indexes };
}

/** 核对真实索引目录中的键顺序、包含列、唯一性、有效状态和排序标志。 */
export function matchesCreatedPostgresIndex(actual: ObservedIndex, expected: CreatedIndex) {
  if (!actual.parts || !actual.ready || !actual.valid || actual.unique !== expected.unique || actual.method !== expected.method ||
      actual.parts.length !== expected.keys.length + expected.include.length) return false;
  return actual.parts.every((part, index) => {
    const key = expected.keys[index];
    return key ? part.key && part.column === key.column && part.descending === (key.direction === 'desc') &&
      part.nullsFirst === (key.nulls === 'first' || key.nulls === 'default' && key.direction === 'desc')
      : !part.key && part.column === expected.include[index - expected.keys.length];
  });
}
