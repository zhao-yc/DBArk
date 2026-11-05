import { postgresRelationName } from '../../shared/postgresSql';
import { postgresStructureResultSchema, type PostgresStructureResult } from '../../shared/postgresStructure';
import type { PostgresConnection } from './connection';

// 单条目录查询提供一致的关系、字段、约束和索引快照；绝不读取目标关系的数据行。
const structureSql = `
WITH target AS MATERIALIZED (
  SELECT c.oid, c.relkind, c.relname, c.relispartition, c.relpartbound,
         c.relrowsecurity, c.relforcerowsecurity, n.nspname
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname::text = $1 AND c.relname::text = $2
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
    AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
    AND (pg_catalog.has_table_privilege(c.oid, 'SELECT') OR pg_catalog.pg_has_role(c.relowner, 'USAGE'))
)
SELECT pg_catalog.jsonb_build_object(
  'database', pg_catalog.current_database(),
  'schema', t.nspname,
  'name', t.relname,
  'kind', t.relkind,
  'comment', pg_catalog.obj_description(t.oid, 'pg_class'),
  'partitionKey', CASE WHEN t.relkind = 'p' THEN pg_catalog.pg_get_partkeydef(t.oid) END,
  'partitionBound', CASE WHEN t.relispartition THEN pg_catalog.pg_get_expr(t.relpartbound, t.oid) END,
  'rowSecurity', t.relrowsecurity,
  'forceRowSecurity', t.relforcerowsecurity,
  'viewDefinition', CASE WHEN t.relkind IN ('v', 'm') THEN pg_catalog.pg_get_viewdef(t.oid, false) END,
  'columns', COALESCE((SELECT pg_catalog.jsonb_agg(field.item ORDER BY field.position) FROM (
    SELECT a.attnum AS position, pg_catalog.jsonb_build_object(
      'position', a.attnum,
      'name', a.attname,
      'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
      'nullable', NOT a.attnotnull,
      'defaultExpression', CASE WHEN a.attgenerated = '' AND a.attidentity = '' THEN pg_catalog.pg_get_expr(d.adbin, d.adrelid) END,
      'generationExpression', CASE WHEN a.attgenerated <> '' THEN pg_catalog.pg_get_expr(d.adbin, d.adrelid) END,
      'generation', a.attgenerated,
      'identity', a.attidentity,
      'collation', CASE WHEN col.oid IS NOT NULL THEN pg_catalog.format('%I.%I', ns.nspname, col.collname) END,
      'comment', pg_catalog.col_description(t.oid, a.attnum)
    ) AS item
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN pg_catalog.pg_collation col ON col.oid = a.attcollation
    LEFT JOIN pg_catalog.pg_namespace ns ON ns.oid = col.collnamespace
    WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum LIMIT 2001
  ) field), '[]'::jsonb),
  'constraints', COALESCE((SELECT pg_catalog.jsonb_agg(cn.item ORDER BY cn.name, cn.oid) FROM (
    SELECT c.conname AS name, c.oid, pg_catalog.jsonb_build_object(
      'name', c.conname,
      'kind', c.contype,
      'definition', pg_catalog.pg_get_constraintdef(c.oid, false),
      'deferrable', c.condeferrable,
      'initiallyDeferred', c.condeferred,
      'validated', c.convalidated,
      'inherited', c.conparentid <> 0 OR NOT c.conislocal
    ) AS item
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = t.oid AND c.contype IN ('p', 'f', 'u', 'c', 'x', 'n')
    ORDER BY c.conname, c.oid LIMIT 2001
  ) cn), '[]'::jsonb),
  'indexes', COALESCE((SELECT pg_catalog.jsonb_agg(ix.item ORDER BY ix.name, ix.oid) FROM (
    SELECT i.relname AS name, i.oid, pg_catalog.jsonb_build_object(
      'name', i.relname,
      'method', am.amname,
      'definition', pg_catalog.pg_get_indexdef(i.oid),
      'unique', x.indisunique,
      'primary', x.indisprimary,
      'valid', x.indisvalid,
      'ready', x.indisready,
      'constraint', (SELECT c.conname FROM pg_catalog.pg_constraint c WHERE c.conrelid = t.oid
        AND c.conindid = i.oid AND c.contype IN ('p', 'u', 'x') ORDER BY c.oid LIMIT 1)
    ) AS item
    FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid = i.relam
    WHERE x.indrelid = t.oid
    ORDER BY i.relname, i.oid LIMIT 2001
  ) ix), '[]'::jsonb)
)
FROM target t
`;

/** 用独立只读会话加载目录，服务端反编译文本保留实际表达式及必要的 schema 限定。 */
export async function readPostgresStructure(connection: PostgresConnection, table: string): Promise<PostgresStructureResult> {
  const { schema, name } = postgresRelationName(table);
  const small = { rows: 2, bytes: 8192 };
  await connection.query('BEGIN READ ONLY', undefined, { ...small });
  await connection.query("SET LOCAL statement_timeout = '15s'", undefined, { ...small });
  await connection.query("SET LOCAL lock_timeout = '5s'", undefined, { ...small });
  await connection.query("SET LOCAL idle_in_transaction_session_timeout = '20s'", undefined, { ...small });
  await connection.query('SET LOCAL search_path = pg_catalog', undefined, { ...small });
  const result = await connection.query(structureSql, [schema, name], { rows: 2, bytes: 4 * 1024 * 1024 });
  if (result.truncated) throw Error('PostgreSQL结构超过显示预算，无法完整读取');
  if (result.rows.length !== 1 || typeof result.rows[0].c0 !== 'string') {
    throw Error('PostgreSQL关系不存在、已改名或没有读取结构的权限');
  }
  const parsed = postgresStructureResultSchema.safeParse(JSON.parse(result.rows[0].c0));
  if (!parsed.success || parsed.data.database !== connection.database || parsed.data.schema !== schema || parsed.data.name !== name) {
    throw Error('PostgreSQL结构回包不完整或目标已经变化');
  }
  const committed = await connection.query('COMMIT', undefined, { ...small });
  if (committed.postgresCommand !== 'COMMIT') throw Error('PostgreSQL结构读取事务未完成');
  return parsed.data;
}
