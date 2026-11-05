import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PostgresConnection } from './connection';

// PostgreSQL 17 起维护权限可委派，旧服务器沿用所有者规则。
export const postgresMaterializedCanRefreshSql = `CASE WHEN pg_catalog.current_setting('server_version_num')::int >= 170000
  THEN pg_catalog.has_table_privilege(c.oid, 'MAINTAIN')
  ELSE pg_catalog.pg_has_role(c.relowner, 'USAGE') END`;

// 目录资格与 PostgreSQL 并发刷新使用的有效、立即、全行唯一列索引保持一致。
export const postgresMaterializedFactsSql = `pg_catalog.jsonb_build_object(
  'identity', pg_catalog.jsonb_build_array(c.oid::text, c.relnamespace::text, c.relowner::text,
    pg_catalog.pg_get_viewdef(c.oid, false),
    (SELECT r.xmin::text FROM pg_catalog.pg_rewrite r WHERE r.ev_class = c.oid AND r.rulename = '_RETURN')),
  'populated', c.relispopulated,
  'uniqueIndex', EXISTS (SELECT FROM pg_catalog.pg_index i
    WHERE i.indrelid = c.oid AND i.indisunique AND i.indisvalid AND i.indimmediate AND i.indnatts > 0
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND NOT EXISTS (SELECT FROM pg_catalog.unnest(i.indkey) AS k(attnum) WHERE k.attnum <= 0)),
  'canRefresh', ${postgresMaterializedCanRefreshSql}
)`;
const oid = z.string().regex(/^\d+$/);
const factsSchema = z.object({
  identity: z.tuple([oid, oid, oid, z.string().min(1), oid]),
  populated: z.boolean(), uniqueIndex: z.boolean(), canRefresh: z.boolean(),
}).strict();

/** 结构界面只接收状态与可用操作，预览摘要包含实际关系身份和刷新资格。 */
export function parsePostgresMaterializedFacts(raw: string) {
  const { identity, populated, uniqueIndex, canRefresh } = factsSchema.parse(JSON.parse(raw));
  const state = { populated, uniqueIndex, ...(canRefresh ? { stamp: createHash('sha256').update(raw).digest('hex') } : {}) };
  return { identity: JSON.stringify(identity), state };
}

/** 独立读取可见物化视图的状态，供预览和事务内回读复用。 */
export async function readPostgresMaterializedFacts(connection: PostgresConnection, schema: string, name: string) {
  const result = await connection.query(`SELECT (${postgresMaterializedFactsSql})::text
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'm' AND n.nspname::text = $1 AND c.relname::text = $2
      AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')`, [schema, name], { rows: 2, bytes: 1024 * 1024 });
  const raw = result.rows[0]?.c0;
  if (result.truncated || result.rows.length !== 1 || typeof raw !== 'string')
    throw Error('物化视图不存在、已改名或目录回包不完整');
  return parsePostgresMaterializedFacts(raw);
}
