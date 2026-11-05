import { z } from 'zod';
import { postgresDdlLiteral, postgresNewIdentifier } from './postgresCreateTable';
import { assertPostgresCheckExpression, postgresIdentifier } from './postgresSql';
import { postgresStructureInputSchema, type PostgresStructureResult } from './postgresStructure';

const name = z.string().min(1).max(512).refine(value => !value.includes('\0'));
const expression = z.string().min(1).max(16384).superRefine((value, context) => {
  try { assertPostgresCheckExpression(value); }
  catch (reason) { context.addIssue({ code: 'custom', message: (reason as Error).message }); }
});
const create = z.object({
  kind: z.literal('create'), name: postgresNewIdentifier, expression, notValid: z.boolean(), noInherit: z.boolean(), notEnforced: z.boolean().optional(),
}).strict();
const change = z.discriminatedUnion('kind', [
  create,
  create.omit({ name: true }).extend({ kind: z.literal('replace'), from: name }),
  z.object({ kind: z.literal('rename'), from: name, name: postgresNewIdentifier }).strict(),
  z.object({ kind: z.literal('validate'), from: name }).strict(),
  z.object({ kind: z.literal('drop'), from: name }).strict(),
]);
export const postgresCheckPreviewSchema = postgresStructureInputSchema.extend({
  editStamp: z.string().regex(/^[a-f0-9]{64}$/), changes: z.array(change).min(1).max(16),
}).strict();
export const postgresCheckApplySchema = postgresStructureInputSchema.extend({ token: z.uuid() }).strict();
export type PostgresCheckPreviewInput = z.infer<typeof postgresCheckPreviewSchema>;
export type PostgresCheckApplyInput = z.infer<typeof postgresCheckApplySchema>;
export type PostgresCheckChange = z.infer<typeof change>;
type Constraint = PostgresStructureResult['constraints'][number];
interface CheckState { original?: Constraint; created?: z.infer<typeof create>; validated: boolean; comment: string | null }

/** 仅在支持约束强制状态的服务器开放 NOT ENFORCED。 */
export function supportsPostgresCheckNotEnforced(source: PostgresStructureResult) {
  return (source.serverVersion ?? 0) >= 180000;
}

/** 编译受限 CHECK 批次。换行保留表达式尾部注释，同时隔离生成的右括号。 */
export function postgresCheckPlan(source: PostgresStructureResult, raw: PostgresCheckPreviewInput) {
  const { editStamp, changes } = postgresCheckPreviewSchema.parse(raw);
  if (!source.editStamp || source.editStamp !== editStamp) throw Error('原表结构已变化，请重新读取后预览');
  const table = postgresIdentifier(source.schema) + '.' + postgresIdentifier(source.name);
  const alter = 'ALTER TABLE ONLY ' + table;
  const reserved = new Set(source.constraints.filter(key => key.kind !== 'c' || key.inherited).map(key => key.name));
  const checks = new Map<string, CheckState>(source.constraints.filter(key => key.kind === 'c' && !key.inherited)
    .map(original => [original.name, { original, validated: original.validated, comment: original.check?.comment ?? null }]));
  const statements: string[] = [];
  for (const change of changes) {
    if ('name' in change && (reserved.has(change.name) || checks.has(change.name))) throw Error('约束名称已存在：' + change.name);
    if (change.kind === 'create' || change.kind === 'replace') {
      if (change.notEnforced && (!supportsPostgresCheckNotEnforced(source) || change.notValid))
        throw Error('NOT ENFORCED 需要 PostgreSQL 18 或更新版本，且不能和 NOT VALID 同时设置');
      const name = change.kind === 'create' ? change.name : change.from;
      const identifier = postgresIdentifier(name);
      const comment = checks.get(name)?.comment ?? null;
      if (change.kind === 'replace') {
        if (!checks.has(name)) throw Error('原 CHECK 约束不存在或属于继承结构：' + name);
        statements.push(alter + ' DROP CONSTRAINT ' + identifier + ' RESTRICT');
      }
      statements.push(alter + ' ADD CONSTRAINT ' + identifier + ' CHECK (\n' + change.expression +
        '\n)' + (change.noInherit ? ' NO INHERIT' : '') + (change.notEnforced ? ' NOT ENFORCED' : change.notValid ? ' NOT VALID' : ''));
      if (comment !== null) statements.push('COMMENT ON CONSTRAINT ' + identifier + ' ON ' + table + ' IS ' + postgresDdlLiteral(comment));
      checks.set(name, { created: { ...change, kind: 'create', name }, validated: !change.notValid && !change.notEnforced, comment });
      continue;
    }
    const original = checks.get(change.from);
    if (!original) throw Error('原 CHECK 约束不存在或属于继承结构：' + change.from);
    const name = postgresIdentifier(change.from);
    if (change.kind === 'validate') {
      if (original.validated || original.created?.notEnforced || original.original?.check?.enforced === false)
        throw Error('该 CHECK 约束不需要或不能验证');
      statements.push(alter + ' VALIDATE CONSTRAINT ' + name);
      original.validated = true;
    } else {
      checks.delete(change.from);
      if (change.kind === 'rename') {
        statements.push(alter + ' RENAME CONSTRAINT ' + name + ' TO ' + postgresIdentifier(change.name));
        checks.set(change.name, original);
      } else statements.push(alter + ' DROP CONSTRAINT ' + name + ' RESTRICT');
    }
  }
  return { table, statements, checks };
}
