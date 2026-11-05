import { z } from 'zod';
import { postgresNewIdentifier } from './postgresCreateTable';
import { postgresIdentifier } from './postgresSql';
import { postgresStructureInputSchema, type PostgresStructureResult } from './postgresStructure';

const existingName = z.string().min(1).max(512).refine(value => !value.includes('\0'));
const create = z.object({
  kind: z.literal('create'), name: postgresNewIdentifier, key: z.enum(['p', 'u']),
  columns: z.array(existingName).min(1).max(32), timing: z.enum(['immediate', 'deferrable', 'deferred']),
  nullsNotDistinct: z.boolean(),
}).strict();
const change = z.discriminatedUnion('kind', [
  create,
  z.object({ kind: z.literal('rename'), from: existingName, name: postgresNewIdentifier }).strict(),
  z.object({ kind: z.literal('drop'), from: existingName }).strict(),
]);
export const postgresKeyPreviewSchema = postgresStructureInputSchema.extend({
  editStamp: z.string().regex(/^[a-f0-9]{64}$/), changes: z.array(change).min(1).max(16),
}).strict();
export const postgresKeyApplySchema = postgresStructureInputSchema.extend({ token: z.uuid() }).strict();
export type PostgresKeyPreviewInput = z.infer<typeof postgresKeyPreviewSchema>;
export type PostgresKeyApplyInput = z.infer<typeof postgresKeyApplySchema>;
export type PostgresKeyChange = z.infer<typeof change>;
type Created = z.infer<typeof create>;
type Constraint = PostgresStructureResult['constraints'][number];
type Index = PostgresStructureResult['indexes'][number];
interface KeyState { original?: Constraint; created?: Created; replicaIdentity: boolean; key: 'p' | 'u' }

/** 使用服务器版本开放 UNIQUE NULLS NOT DISTINCT，老版本仍可编辑普通唯一约束。 */
export function supportsPostgresNullsNotDistinct(source: PostgresStructureResult) {
  return (source.serverVersion ?? 0) >= 150000;
}

/** 跟踪同批内当前约束和有序列，仅编译原表上的主键与唯一约束。 */
export function postgresKeyPlan(source: PostgresStructureResult, raw: PostgresKeyPreviewInput) {
  const { editStamp, changes } = postgresKeyPreviewSchema.parse(raw);
  if (!source.editStamp || source.editStamp !== editStamp) throw Error('原表结构已变化，请重新读取后预览');
  const table = postgresIdentifier(source.schema) + '.' + postgresIdentifier(source.name);
  const alter = 'ALTER TABLE ONLY ' + table;
  const fields = new Set(source.columns.map(column => column.name));
  const reserved = new Set(source.constraints.filter(key => key.kind !== 'p' && key.kind !== 'u').map(key => key.name));
  const replicaKeys = new Set(source.indexes.filter(index => index.replicaIdentity).map(index => index.constraint));
  const keys = new Map<string, KeyState>();
  for (const original of source.constraints) {
    if (original.kind === 'p' || original.kind === 'u')
      keys.set(original.name, { original, replicaIdentity: replicaKeys.has(original.name), key: original.kind });
  }
  const statements: string[] = [];
  const requiredNotNull = new Set<string>();
  for (const change of changes) {
    if (change.kind !== 'drop' && (keys.has(change.name) || reserved.has(change.name))) throw Error('约束名称已存在：' + change.name);
    if (change.kind === 'create') {
      if (new Set(change.columns).size !== change.columns.length || change.columns.some(column => !fields.has(column)))
        throw Error('键列必须来自原表且不能重复');
      if (change.key === 'p' && [...keys.values()].some(key => key.key === 'p')) throw Error('原表已有主键，请先在批次中移除');
      if (change.nullsNotDistinct && (change.key !== 'u' || !supportsPostgresNullsNotDistinct(source)))
        throw Error('NULLS NOT DISTINCT 仅适用于 PostgreSQL 15 或更新版本的唯一约束');
      const keyType = change.key === 'p' ? 'PRIMARY KEY' : change.nullsNotDistinct ? 'UNIQUE NULLS NOT DISTINCT' : 'UNIQUE';
      const timing = change.timing === 'immediate' ? '' :
        change.timing === 'deferrable' ? ' DEFERRABLE INITIALLY IMMEDIATE' : ' DEFERRABLE INITIALLY DEFERRED';
      statements.push(alter + ' ADD CONSTRAINT ' + postgresIdentifier(change.name) + ' ' + keyType +
        ' (' + change.columns.map(postgresIdentifier).join(', ') + ')' + timing);
      keys.set(change.name, { created: change, replicaIdentity: false, key: change.key });
      if (change.key === 'p') for (const column of change.columns) requiredNotNull.add(column);
      continue;
    }
    const existing = keys.get(change.from);
    if (!existing || existing.original?.inherited) throw Error('原约束不存在或属于继承结构：' + change.from);
    if (change.kind === 'rename') {
      statements.push(alter + ' RENAME CONSTRAINT ' + postgresIdentifier(change.from) + ' TO ' + postgresIdentifier(change.name));
      keys.set(change.name, existing);
    } else {
      if (existing.replicaIdentity) throw Error('不能移除复制标识所使用的约束：' + change.from);
      statements.push(alter + ' DROP CONSTRAINT ' + postgresIdentifier(change.from) + ' RESTRICT');
    }
    keys.delete(change.from);
  }
  return { table, statements, keys, requiredNotNull };
}

/** 复核有序键列、检查时机及实际唯一索引，避免只按约束名称判断成功。 */
export function matchesCreatedPostgresKey(actual: Constraint, index: Index, expected: Created) {
  return actual.kind === expected.key && actual.validated && !actual.inherited &&
    actual.deferrable === (expected.timing !== 'immediate') && actual.initiallyDeferred === (expected.timing === 'deferred') &&
    actual.keyColumns?.length === expected.columns.length && expected.columns.every((name, i) => actual.keyColumns?.[i] === name) &&
    index.valid && index.ready && index.unique && index.primary === (expected.key === 'p') &&
    index.nullsNotDistinct === expected.nullsNotDistinct && index.method === 'btree';
}
