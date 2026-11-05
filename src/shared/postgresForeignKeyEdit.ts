import { z } from 'zod';
import { postgresNewIdentifier } from './postgresCreateTable';
import { postgresIdentifier } from './postgresSql';
import { postgresStructureInputSchema, type PostgresStructureResult } from './postgresStructure';

const identifier = z.string().min(1).max(512).refine(value => !value.includes('\0'));
const stamp = z.string().regex(/^[a-f0-9]{64}$/);
export const postgresForeignActions = ['a', 'r', 'c', 'n', 'd'] as const;
export const postgresForeignActionSchema = z.enum(postgresForeignActions);
const sqlActions = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' } as const;
const reference = z.object({ schema: identifier, name: identifier, stamp }).strict();
const create = z.object({
  kind: z.literal('create'), name: postgresNewIdentifier, reference,
  pairs: z.array(z.object({ local: identifier, remote: identifier }).strict()).min(1).max(32),
  match: z.enum(['s', 'f']), onUpdate: postgresForeignActionSchema, onDelete: postgresForeignActionSchema,
  timing: z.enum(['immediate', 'deferrable', 'deferred']), notValid: z.boolean(),
}).strict();
const change = z.discriminatedUnion('kind', [
  create,
  z.object({ kind: z.literal('rename'), from: identifier, name: postgresNewIdentifier }).strict(),
  z.object({ kind: z.literal('validate'), from: identifier }).strict(),
  z.object({ kind: z.literal('drop'), from: identifier }).strict(),
]);
export const postgresForeignPreviewSchema = postgresStructureInputSchema.extend({
  editStamp: stamp, changes: z.array(change).min(1).max(16),
}).strict();
export const postgresForeignApplySchema = postgresStructureInputSchema.extend({ token: z.uuid() }).strict();
export const postgresForeignTargetsSchema = postgresStructureInputSchema.pick({ connectionId: true, database: true })
  .extend({ search: z.string().max(1025).refine(value => !value.includes('\0')) }).strict();
export type PostgresForeignPreviewInput = z.infer<typeof postgresForeignPreviewSchema>;
export type PostgresForeignApplyInput = z.infer<typeof postgresForeignApplySchema>;
export type PostgresForeignTargetsInput = z.infer<typeof postgresForeignTargetsSchema>;
export type PostgresForeignChange = z.infer<typeof change>;
export type PostgresForeignReference = z.infer<typeof reference>;
export interface PostgresForeignTarget extends PostgresForeignReference { keys: string[][] }
export interface PostgresForeignTargets { targets: PostgresForeignTarget[]; truncated: boolean }

type Constraint = PostgresStructureResult['constraints'][number];
export type PostgresForeignCreation = z.infer<typeof create>;
interface ForeignState { original?: Constraint; created?: PostgresForeignCreation; validated: boolean }

/** 只编译已选目录列、限定关系名及白名单外键选项。 */
export function postgresForeignPlan(source: PostgresStructureResult, raw: PostgresForeignPreviewInput) {
  const { editStamp, changes } = postgresForeignPreviewSchema.parse(raw);
  if (!source.editStamp || source.editStamp !== editStamp) throw Error('原表结构已变化，请重新读取后预览');
  const table = postgresIdentifier(source.schema) + '.' + postgresIdentifier(source.name);
  const alter = 'ALTER TABLE ONLY ' + table;
  const columns = new Set(source.columns.map(column => column.name));
  // 引用分区父表时，PostgreSQL 会给同一子表生成内部外键目录项。
  const reserved = new Set(source.constraints.filter(key => key.kind !== 'f' || key.inherited).map(key => key.name));
  const keys = new Map<string, ForeignState>(source.constraints.filter(key => key.kind === 'f' && !key.inherited).map(original =>
    [original.name, { original, validated: original.validated }]));
  const statements: string[] = [];
  for (const change of changes) {
    if ('name' in change && (reserved.has(change.name) || keys.has(change.name))) throw Error('约束名称已存在：' + change.name);
    if (change.kind === 'create') {
      const local = change.pairs.map(pair => pair.local);
      const remote = change.pairs.map(pair => pair.remote);
      if (local.some(name => !columns.has(name)) || new Set(local).size !== local.length || new Set(remote).size !== remote.length)
        throw Error('每对外键列必须存在，且两侧列名分别不能重复');
      const target = postgresIdentifier(change.reference.schema) + '.' + postgresIdentifier(change.reference.name);
      const timing = change.timing === 'immediate' ? '' : change.timing === 'deferrable'
        ? ' DEFERRABLE INITIALLY IMMEDIATE' : ' DEFERRABLE INITIALLY DEFERRED';
      statements.push(alter + ' ADD CONSTRAINT ' + postgresIdentifier(change.name) +
        ' FOREIGN KEY (' + local.map(postgresIdentifier).join(', ') + ') REFERENCES ' + target +
        ' (' + remote.map(postgresIdentifier).join(', ') + ') MATCH ' + (change.match === 'f' ? 'FULL' : 'SIMPLE') +
        ' ON UPDATE ' + sqlActions[change.onUpdate] + ' ON DELETE ' + sqlActions[change.onDelete] +
        timing + (change.notValid ? ' NOT VALID' : ''));
      keys.set(change.name, { created: change, validated: !change.notValid });
      continue;
    }
    const original = keys.get(change.from);
    if (!original) throw Error('原外键不存在或属于继承结构：' + change.from);
    const name = postgresIdentifier(change.from);
    if (change.kind === 'validate') {
      if (original.validated || original.original?.foreign?.enforced === false) throw Error('该外键不需要或不能验证');
      statements.push(alter + ' VALIDATE CONSTRAINT ' + name);
      original.validated = true;
    } else {
      keys.delete(change.from);
      if (change.kind === 'rename') {
        statements.push(alter + ' RENAME CONSTRAINT ' + name + ' TO ' + postgresIdentifier(change.name));
        keys.set(change.name, original);
      } else statements.push(alter + ' DROP CONSTRAINT ' + name + ' RESTRICT');
    }
  }
  return { table, statements, keys, creations: changes.filter(change => change.kind === 'create') };
}

/** 复核实际映射、引用动作、匹配模式和延迟检查状态。 */
export function matchesCreatedPostgresForeign(actual: Constraint, expected: PostgresForeignCreation) {
  const fk = actual.foreign;
  return !!fk && fk.enforced && fk.schema === expected.reference.schema && fk.table === expected.reference.name &&
    fk.match === expected.match && fk.onUpdate === expected.onUpdate && fk.onDelete === expected.onDelete &&
    actual.deferrable === (expected.timing !== 'immediate') && actual.initiallyDeferred === (expected.timing === 'deferred') &&
    fk.pairs.length === expected.pairs.length &&
    fk.pairs.every((pair, i) => pair.local === expected.pairs[i].local && pair.remote === expected.pairs[i].remote);
}
