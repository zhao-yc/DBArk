import { createHash } from 'node:crypto';
import { z } from 'zod';
import { postgresIdentifier } from '../../shared/postgresSql';
import { postgresTableReferenceLimits as limits, type PostgresTableColumn, type PostgresTableReference, type PostgresTableReferenceInput, type PostgresTableReferenceResult } from '../../shared/postgresTable';
import type { PostgresConnection } from './connection';

const oid = z.string().regex(/^[1-9][0-9]{0,9}$/);
const catalogRecord = z.object({
  id: oid, target: oid, name: z.string(), schema: z.string(), table: z.string(),
  pairs: z.array(z.object({ local: z.string(), remote: z.string(), type: z.string(), localAttnum: z.number(), remoteAttnum: z.number(),
    localType: oid, remoteType: oid })).min(1).max(32),
});
const budget = { rows: limits.constraints + 1, bytes: 2 * 1024 * 1024 };

/** 按约束序号绑定两边字段，仅返回当前账号可以读取整组引用键的约束。 */
export async function readPostgresTableReferences(connection: PostgresConnection, source: string, columns: readonly PostgresTableColumn[],
  lookup: PostgresTableReferenceInput['lookup']): Promise<PostgresTableReferenceResult> {
  const catalog = await connection.query(`
    SELECT pg_catalog.jsonb_build_object('id', f.oid::text, 'target', r.oid::text, 'name', f.conname,
      'schema', n.nspname, 'table', r.relname, 'pairs', mapped.pairs)
    FROM pg_catalog.pg_constraint f
    JOIN pg_catalog.pg_class r ON r.oid = f.confrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
    CROSS JOIN LATERAL (
      SELECT count(*) AS size,
        pg_catalog.bool_and(pg_catalog.has_column_privilege(r.oid, ra.attnum, 'SELECT')) AS readable,
        pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'local', la.attname, 'remote', ra.attname, 'type', pg_catalog.format_type(ra.atttypid, ra.atttypmod),
          'localAttnum', la.attnum, 'remoteAttnum', ra.attnum, 'localType', la.atttypid::text, 'remoteType', ra.atttypid::text
        ) ORDER BY k.pos) AS pairs
      FROM pg_catalog.unnest(f.conkey) WITH ORDINALITY AS k(local_num, pos)
      JOIN pg_catalog.pg_attribute la ON la.attrelid = f.conrelid AND la.attnum = k.local_num AND NOT la.attisdropped
      JOIN pg_catalog.pg_attribute ra ON ra.attrelid = f.confrelid AND ra.attnum = f.confkey[k.pos::int] AND NOT ra.attisdropped
    ) mapped
    WHERE f.conrelid = $1::oid AND f.contype = 'f' AND r.relkind IN ('r','p')
      AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_' AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
      AND COALESCE((pg_catalog.to_jsonb(f)->>'conperiod')::boolean, false) = false
      AND mapped.readable AND mapped.size = pg_catalog.cardinality(f.conkey) AND mapped.size BETWEEN 1 AND 32
    ORDER BY f.conname, f.oid LIMIT $2
  `, [source, limits.constraints + 1], budget);
  if (catalog.truncated || catalog.rows.length > limits.constraints) throw Error('外键目录超过可浏览上限');
  const choices: PostgresTableReference[] = [];
  let selected: z.infer<typeof catalogRecord> | undefined;
  for (const row of catalog.rows) {
    const raw = String(row.c0), item = catalogRecord.parse(JSON.parse(raw));
    const pairs = item.pairs.flatMap(pair => {
      const local = columns.find(column => column.name === pair.local && !column.generated);
      return local ? [{ local: local.key, localName: local.name, remote: pair.remote, binary: local.binary }] : [];
    });
    if (pairs.length !== item.pairs.length) continue;
    const stamp = createHash('sha256').update(raw).digest('hex');
    choices.push({ id: item.id, stamp, name: item.name, schema: item.schema, table: item.table, pairs });
    if (lookup?.id === item.id && lookup.stamp === stamp) selected = item;
  }
  if (!lookup) return { choices };
  if (!selected) throw Error('原外键、引用列或读取权限已变化，请重新打开选值');

  const relation = postgresIdentifier(selected.schema) + '.' + postgresIdentifier(selected.table);
  const keyNames = selected.pairs.map(pair => pair.remote);
  const extras = await connection.query(`
    SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod)
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped
      AND NOT (a.attname::text = ANY($2::text[]))
      AND pg_catalog.has_column_privilege(a.attrelid, a.attnum, 'SELECT')
    ORDER BY a.attnum LIMIT $3
  `, [selected.target, keyNames, limits.columns], { rows: limits.columns, bytes: 128 * 1024 });
  if (extras.truncated) throw Error('引用记录字段目录超过预算');
  const keys = keyNames.map(postgresIdentifier);
  const metadata = [...selected.pairs.map(pair => ({ name: pair.remote, type: pair.type })),
    ...extras.rows.map(row => ({ name: String(row.c0), type: String(row.c1) }))];
  const expressions = metadata.map(item => postgresIdentifier(item.name));
  const projection = expressions.map((expression, index) => index < keys.length ? expression : `pg_catalog.left(${expression}::text, 400)`);
  const filter = expressions.map(expression => `pg_catalog.strpos(pg_catalog.lower(${expression}::text), pg_catalog.lower($1::text)) > 0`).join(' OR ');
  // 只允许目录产生标识符；实际名称再次解析为原 OID，避免并发改名使本次查询指向别的关系。
  const result = await connection.query(`
    SELECT ${projection.join(', ')} FROM ${relation}
    WHERE pg_catalog.to_regclass($3)::oid = $4::oid
      AND ${keys.map(key => `${key} IS NOT NULL`).join(' AND ')}
      AND ($1::text = '' OR ${filter})
    ORDER BY ${keys.join(', ')} LIMIT ${limits.page + 1} OFFSET $2
  `, [lookup.search, lookup.offset, relation, selected.target], { rows: limits.page + 1, bytes: 2 * 1024 * 1024 });
  const identity = await connection.query('SELECT pg_catalog.to_regclass($1)::oid::text', [relation], { rows: 1, bytes: 8192 });
  if (identity.rows[0]?.c0 !== selected.target) throw Error('被引用关系已变化，请重新打开选值');
  if (result.truncated) throw Error('候选记录超过显示预算，请缩小搜索范围');
  return { choices, page: {
    columns: metadata.map((column, index) => ({ ...column, key: 'c' + index })),
    rows: result.rows.slice(0, limits.page), hasNext: result.rows.length > limits.page,
  } };
}
