import { postgresCompletionLimits, type PostgresCompletionInput, type PostgresCompletionItem, type PostgresCompletionResult } from '../../shared/postgresCompletion';
import type { PostgresConnection } from './connection';

const relationKinds = "('r','p','v','m','f')";
const visibleNamespace = "n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')";
const relationPermission = "(pg_catalog.has_table_privilege(c.oid, 'SELECT,INSERT,UPDATE,DELETE,REFERENCES') OR pg_catalog.has_any_column_privilege(c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))";
const rowLimit = postgresCompletionLimits.items + 1;

/** 表建议始终携带实际 schema，前缀按文字比较，不把百分号和下划线当通配符。 */
async function relations(connection: PostgresConnection, input: Extract<PostgresCompletionInput, { kind: 'relations' }>): Promise<PostgresCompletionResult> {
  const result = await connection.query(`
    SELECT kind, schema, name FROM (
      SELECT 'schema' AS kind, n.nspname::text AS schema, n.nspname::text AS name
      FROM pg_catalog.pg_namespace n
      WHERE $2::text IS NULL AND ${visibleNamespace}
        AND pg_catalog.strpos(pg_catalog.lower(n.nspname::text), pg_catalog.lower($1::text)) = 1
      UNION ALL
      SELECT CASE WHEN c.relkind IN ('v','m') THEN 'view' ELSE 'table' END, n.nspname::text, c.relname::text
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ${relationKinds} AND ${visibleNamespace} AND ${relationPermission}
        AND ($2::text IS NULL OR n.nspname::text = $2)
        AND pg_catalog.strpos(pg_catalog.lower(c.relname::text), pg_catalog.lower($1::text)) = 1
    ) directory ORDER BY (kind <> 'schema'), name, schema LIMIT $3
  `, [input.prefix, input.schema ?? null, rowLimit], { rows: rowLimit, bytes: 256 * 1024 });
  const items: PostgresCompletionItem[] = [];
  for (const row of result.rows.slice(0, postgresCompletionLimits.items)) {
    if (typeof row.c1 !== 'string' || typeof row.c2 !== 'string') continue;
    if (row.c0 === 'schema') items.push({ kind: 'schema', name: row.c2 });
    else if (row.c0 === 'table' || row.c0 === 'view') items.push({ kind: row.c0, schema: row.c1, name: row.c2 });
  }
  return { items, incomplete: result.truncated || result.rows.length === rowLimit };
}

/** 明确 schema 精确匹配；未限定名称沿独立连接的服务器可见性，并拒绝存在同名用户关系的猜测。 */
async function columns(connection: PostgresConnection, input: Extract<PostgresCompletionInput, { kind: 'columns' }>): Promise<PostgresCompletionResult> {
  const refs = JSON.stringify(input.relations.map((ref, index) => ({ ...ref, index })));
  const result = await connection.query(`
    WITH refs AS (
      SELECT * FROM pg_catalog.jsonb_to_recordset($1::jsonb) AS r(index int, schema text, name text)
    ), matched AS (
      SELECT r.index, c.oid
      FROM refs r JOIN pg_catalog.pg_class c ON c.relname::text = r.name
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ${relationKinds} AND ${visibleNamespace} AND ${relationPermission}
        AND (n.nspname::text = r.schema OR (r.schema IS NULL AND pg_catalog.pg_table_is_visible(c.oid)
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class other
            JOIN pg_catalog.pg_namespace ns ON ns.oid = other.relnamespace
            WHERE other.oid <> c.oid AND other.relname = c.relname AND other.relkind IN ${relationKinds}
              AND ns.nspname !~ '^pg_' AND ns.nspname <> 'information_schema'
              AND pg_catalog.has_schema_privilege(ns.oid, 'USAGE')
          )))
    )
    SELECT r.index, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod)
    FROM matched r JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid
    WHERE a.attnum > 0 AND NOT a.attisdropped
      AND pg_catalog.has_column_privilege(r.oid, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES')
      AND pg_catalog.strpos(pg_catalog.lower(a.attname::text), pg_catalog.lower($2::text)) = 1
    ORDER BY a.attname, r.index LIMIT $3
  `, [refs, input.prefix, rowLimit], { rows: rowLimit, bytes: 256 * 1024 });
  const items: PostgresCompletionItem[] = [];
  for (const row of result.rows.slice(0, postgresCompletionLimits.items)) {
    const reference = Number(row.c0);
    if (Number.isInteger(reference) && reference >= 0 && reference < input.relations.length && typeof row.c1 === 'string' && typeof row.c2 === 'string') {
      items.push({ kind: 'column', reference, name: row.c1, type: row.c2 });
    }
  }
  return { items, incomplete: result.truncated || result.rows.length === rowLimit };
}

/** 只在独立连接读取目录，并设置服务端时间预算，不借用原查询事务或临时对象。 */
export async function readPostgresCompletion(connection: PostgresConnection, input: PostgresCompletionInput): Promise<PostgresCompletionResult> {
  if (connection.database !== input.database) throw Error('PostgreSQL 补全目标数据库已变化');
  await connection.query("SET statement_timeout = '2s'", undefined, { rows: 1, bytes: 1024 });
  await connection.query("SET lock_timeout = '1s'", undefined, { rows: 1, bytes: 1024 });
  return input.kind === 'relations' ? relations(connection, input) : columns(connection, input);
}
