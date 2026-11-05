import { z } from 'zod';
import { postgresColumnDefinition, postgresCreateColumnSchema, postgresDdlLiteral, postgresNewIdentifier } from './postgresCreateTable';
import { postgresIdentifier } from './postgresSql';
import { postgresStructureInputSchema, type PostgresStructureResult } from './postgresStructure';

const changes = z.array(z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), field: postgresCreateColumnSchema.refine(field => !field.primary, '请在主键管理中修改主键') }).strict(),
  z.object({ kind: z.literal('rename'), from: z.string().min(1).max(512).refine(value => !value.includes('\0')), name: postgresNewIdentifier }).strict(),
])).min(1).max(16);

export const postgresColumnPreviewSchema = postgresStructureInputSchema.extend({
  editStamp: z.string().regex(/^[a-f0-9]{64}$/), changes,
}).strict();
export const postgresColumnApplySchema = postgresStructureInputSchema.extend({ token: z.uuid() }).strict();
export type PostgresColumnPreviewInput = z.infer<typeof postgresColumnPreviewSchema>;
export type PostgresColumnApplyInput = z.infer<typeof postgresColumnApplySchema>;
export type PostgresColumnChange = PostgresColumnPreviewInput['changes'][number];

/** 根据已读原列顺序编译受限 ALTER，禁止覆盖现有列名。 */
export function postgresColumnPlan(source: PostgresStructureResult, input: PostgresColumnPreviewInput) {
  const { changes, editStamp } = postgresColumnPreviewSchema.parse(input);
  if (!source.editStamp || source.editStamp !== editStamp) throw Error('原表结构已变化，请重新读取后预览');
  const table = postgresIdentifier(source.schema) + '.' + postgresIdentifier(source.name);
  const columns = source.columns.map(field => ({ name: field.name, position: field.position as number | undefined }));
  const statements: string[] = [];
  const checks: NonNullable<ReturnType<typeof postgresColumnDefinition>['check']>[] = [];
  for (const change of changes) {
    const name = change.kind === 'add' ? change.field.name : change.name;
    if (columns.some(field => field.name === name)) throw Error('字段名称已存在：' + name);
    if (change.kind === 'rename') {
      const old = columns.find(field => field.name === change.from);
      if (!old) throw Error('原字段不存在：' + change.from);
      statements.push('ALTER TABLE ONLY ' + table + ' RENAME COLUMN ' + postgresIdentifier(change.from) + ' TO ' + postgresIdentifier(name));
      old.name = name;
    } else {
      const { sql, check } = postgresColumnDefinition(change.field);
      statements.push('ALTER TABLE ONLY ' + table + ' ADD COLUMN ' + sql);
      if (change.field.comment)
        statements.push('COMMENT ON COLUMN ' + table + '.' + postgresIdentifier(name) + ' IS ' + postgresDdlLiteral(change.field.comment));
      if (check) checks.push(check);
      columns.push({ name, position: undefined });
    }
  }
  return { table, columns, statements, checks };
}
