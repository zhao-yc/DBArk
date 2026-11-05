import { createHash } from 'node:crypto';
import { z } from 'zod';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';

// 读取结构和事务复核使用同一目录表达式，包含定义版本及需保留的原属性。
export const postgresViewFactsSql = `pg_catalog.jsonb_build_object(
  'oid', c.oid::text, 'namespace', c.relnamespace::text, 'owner', c.relowner::text,
  'acl', c.relacl::text, 'comment', pg_catalog.obj_description(c.oid, 'pg_class'),
  'options', COALESCE(c.reloptions, ARRAY[]::text[]),
  'definition', pg_catalog.pg_get_viewdef(c.oid, false),
  'revision', (SELECT r.xmin::text FROM pg_catalog.pg_rewrite r WHERE r.ev_class = c.oid AND r.rulename = '_RETURN')
)`;
export const postgresEditableViewSql = `c.relkind = 'v' AND c.relpersistence = 'p'
  AND pg_catalog.pg_has_role(c.relowner, 'USAGE')
  AND pg_catalog.has_schema_privilege(n.oid, 'CREATE')`;

const oid = z.string().regex(/^\d+$/);
const factsSchema = z.object({
  oid, namespace: oid, owner: oid, acl: z.string().nullable(), comment: z.string().nullable(),
  options: z.array(z.string().regex(/^[a-z_][a-z_0-9]*=.+$/)).max(32), definition: z.string().min(1), revision: oid,
}).strict();

/** 摘要绑定原视图的 OID、规则版本、定义和属性。 */
export function postgresViewStamp(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** 读取永久普通视图的真实身份、定义及必须保留的属性。 */
export async function readPostgresViewFacts(connection: PostgresConnection, schema: string, name: string) {
  const result = await connection.query(`SELECT (${postgresViewFactsSql})::text
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname::text = $1 AND c.relname::text = $2
      AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE') AND ${postgresEditableViewSql}`,
  [schema, name], { rows: 2, bytes: 1024 * 1024 });
  const raw = result.rows[0]?.c0;
  if (result.truncated || result.rows.length !== 1 || typeof raw !== 'string')
    throw Error('视图不存在、权限已变化或目录超出预算');
  const { definition, revision, options, ...identity } = factsSchema.parse(JSON.parse(raw));
  return { oid: identity.oid, namespace: identity.namespace, revision, stamp: postgresViewStamp(raw), preserved: JSON.stringify({ ...identity, options: [...options].sort() }), options };
}

/** 把原服务器选项逐项转义，避免替换定义时 PostgreSQL 重置选项。 */
export function postgresViewOptionsSql(options: string[]): string {
  if (!options.length) return '';
  return ' WITH (' + options.map(option => {
    const delimiter = option.indexOf('=');
    return postgresIdentifier(option.slice(0, delimiter)) + ' = ' + postgresDdlLiteral(option.slice(delimiter + 1));
  }).join(', ') + ')';
}
