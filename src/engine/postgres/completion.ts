import { postgresCompletionLimits, type PostgresCompletionInput, type PostgresCompletionItem, type PostgresCompletionResult } from '../../shared/postgresCompletion';
import type { PostgresConnection } from './connection';

const eq = 'OPERATOR(pg_catalog.=)';
const ne = 'OPERATOR(pg_catalog.<>)';
const relationKinds = "(ARRAY['r','p','v','m','f']::pg_catalog.text[])";
const relationPermission = "(pg_catalog.has_table_privilege(c.oid, 'SELECT,INSERT,UPDATE,DELETE,REFERENCES') OR pg_catalog.has_any_column_privilege(c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))";
const rowLimit = postgresCompletionLimits.items + 1;
const commandBudget = () => ({ rows: 0, bytes: 1024 });

/** 允许当前物理会话的临时 schema，绝不暴露别的会话的内部编号。 */
function namespaces(session: boolean): string {
  const temporary = session ? `n.oid ${eq} pg_catalog.pg_my_temp_schema()` : 'false';
  return `namespaces AS (
    SELECT n.oid, CASE WHEN ${temporary} THEN 'pg_temp' ELSE n.nspname::pg_catalog.text END AS schema
    FROM pg_catalog.pg_namespace n
    WHERE (${temporary} OR (n.nspname OPERATOR(pg_catalog.!~) '^pg_' AND n.nspname ${ne} 'information_schema'))
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
  )`;
}

/** 表建议携带实际 schema，临时表用 pg_temp，前缀中的百分号和下划线按文字匹配。 */
async function relations(connection: PostgresConnection, input: Extract<PostgresCompletionInput, { kind: 'relations' }>, session: boolean): Promise<PostgresCompletionResult> {
  const result = await connection.query(`
    WITH ${namespaces(session)}
    SELECT kind, schema, name FROM (
      SELECT 'schema' AS kind, n.schema, n.schema AS name, 0 AS priority
      FROM namespaces n
      WHERE $2::pg_catalog.text IS NULL
        AND pg_catalog.strpos(pg_catalog.lower(n.schema), pg_catalog.lower($1::pg_catalog.text)) ${eq} 1
      UNION ALL
      SELECT CASE WHEN c.relkind::pg_catalog.text ${eq} ANY (ARRAY['v','m']::pg_catalog.text[]) THEN 'view' ELSE 'table' END,
        n.schema, c.relname::pg_catalog.text,
        ${session ? "CASE WHEN pg_catalog.pg_table_is_visible(c.oid) THEN 1 ELSE 2 END" : '1'}
      FROM pg_catalog.pg_class c JOIN namespaces n ON n.oid ${eq} c.relnamespace
      WHERE c.relkind::pg_catalog.text ${eq} ANY ${relationKinds} AND ${relationPermission}
        AND ($2::pg_catalog.text IS NULL OR n.schema ${eq} $2)
        AND pg_catalog.strpos(pg_catalog.lower(c.relname::pg_catalog.text), pg_catalog.lower($1::pg_catalog.text)) ${eq} 1
    ) directory ORDER BY priority, name, schema LIMIT $3
  `, [input.prefix, input.schema ?? null, rowLimit], { rows: rowLimit, bytes: 256 * 1024 });
  const items: PostgresCompletionItem[] = [];
  for (const row of result.rows.slice(0, postgresCompletionLimits.items)) {
    if (typeof row.c1 !== 'string' || typeof row.c2 !== 'string') continue;
    if (row.c0 === 'schema') items.push({ kind: 'schema', name: row.c2 });
    else if (row.c0 === 'table' || row.c0 === 'view') items.push({ kind: row.c0, schema: row.c1, name: row.c2 });
  }
  return { items, incomplete: result.truncated || result.rows.length === rowLimit };
}

/** 原会话使用服务器实际可见性；独立连接继续对未限定的重名关系保持保守。 */
async function columns(connection: PostgresConnection, input: Extract<PostgresCompletionInput, { kind: 'columns' }>, session: boolean): Promise<PostgresCompletionResult> {
  const refs = JSON.stringify(input.relations.map((ref, index) => ({ ...ref, index })));
  const result = await connection.query(`
    WITH ${namespaces(session)}, refs AS (
      SELECT * FROM pg_catalog.jsonb_to_recordset($1::pg_catalog.jsonb)
        AS r(index pg_catalog.int4, schema pg_catalog.text, name pg_catalog.text)
    ), matched AS (
      SELECT r.index, c.oid
      FROM refs r JOIN pg_catalog.pg_class c ON c.relname::pg_catalog.text ${eq} r.name
      JOIN namespaces n ON n.oid ${eq} c.relnamespace
      WHERE c.relkind::pg_catalog.text ${eq} ANY ${relationKinds} AND ${relationPermission}
        AND (n.schema ${eq} r.schema OR (r.schema IS NULL AND pg_catalog.pg_table_is_visible(c.oid)
          ${session ? '' : `AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class other
            JOIN namespaces ns ON ns.oid ${eq} other.relnamespace
            WHERE other.oid ${ne} c.oid AND other.relname ${eq} c.relname
              AND other.relkind::pg_catalog.text ${eq} ANY ${relationKinds}
          )`}))
    )
    SELECT r.index, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod)
    FROM matched r JOIN pg_catalog.pg_attribute a ON a.attrelid ${eq} r.oid
    WHERE a.attnum OPERATOR(pg_catalog.>) 0 AND NOT a.attisdropped
      AND pg_catalog.has_column_privilege(r.oid, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES')
      AND pg_catalog.strpos(pg_catalog.lower(a.attname::pg_catalog.text), pg_catalog.lower($2::pg_catalog.text)) ${eq} 1
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

/** 原会话空闲时用自有只读事务限定超时，完成后以实际回滚及 ReadyForQuery 确认收尾。 */
export async function readPostgresCompletion(connection: PostgresConnection, input: PostgresCompletionInput, session = false): Promise<PostgresCompletionResult> {
  if (connection.database !== input.database) throw Error('PostgreSQL 补全目标数据库已变化');
  const query = () => input.kind === 'relations' ? relations(connection, input, session) : columns(connection, input, session);
  const control = (sql: string) => connection.query(sql, undefined, commandBudget());
  if (!session) {
    await control("SET statement_timeout = '2s'");
    await control("SET lock_timeout = '1s'");
    return query();
  }
  const original = connection.state();
  if (!original.transactionKnown || original.transactionOpen) throw Error('PostgreSQL 补全只允许空闲的原查询会话');
  try {
    await control('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
    await control("SET LOCAL statement_timeout = '2s'");
    await control("SET LOCAL lock_timeout = '1s'");
    return await query();
  } finally {
    try {
      if (connection.state().transactionOpen) await control('ROLLBACK');
      const final = connection.state();
      if (!final.transactionKnown || final.transactionOpen) throw Error('PostgreSQL 补全只读事务收尾未确认');
    } catch (reason) {
      connection.broken = true;
      throw reason;
    }
  }
}
