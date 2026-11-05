import { z } from 'zod';
import { postgresCreateTableSchemasSchema, postgresDdlLiteral, postgresDdlText, postgresNewIdentifier } from './postgresCreateTable';
import { postgresIdentifier, splitPostgresSql } from './postgresSql';

const sqlBudget = 128 * 1024;
export const postgresCreateViewPreviewSchema = postgresCreateTableSchemasSchema.extend({
  schema: postgresNewIdentifier,
  view: postgresNewIdentifier,
  definition: z.string().min(1).max(sqlBudget).refine(value =>
    new TextEncoder().encode(value).length <= sqlBudget && !/[\u0000\uD800-\uDFFF]/u.test(value), '视图定义须为 128 KiB 内有效文本'),
  comment: postgresDdlText,
}).strict();
export type PostgresCreateViewInput = z.infer<typeof postgresCreateViewPreviewSchema>;

/** 定义只允许一条不带参数的查询，保留字符串、注释和美元引号原文。 */
export function postgresCreateViewPlan(raw: PostgresCreateViewInput) {
  const input = postgresCreateViewPreviewSchema.parse(raw);
  if (input.schema.startsWith('pg_') || input.schema === 'information_schema') throw Error('请选择普通用户 schema');
  const [query, extra] = splitPostgresSql(input.definition);
  if (!query || extra || query.parameters.length || !['SELECT', 'WITH', 'VALUES', 'TABLE'].includes(query.keyword))
    throw Error('视图定义须为单条不含位置参数的 SELECT、WITH、VALUES 或 TABLE 查询');
  const table = postgresIdentifier(input.schema) + '.' + postgresIdentifier(input.view);
  const statements = ['CREATE VIEW ' + table + ' AS\n' + query.sql.trim() + '\n'];
  if (input.comment) statements.push('COMMENT ON VIEW ' + table + ' IS ' + postgresDdlLiteral(input.comment));
  return { table, statements };
}
