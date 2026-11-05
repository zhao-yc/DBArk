import type { PostgresTargetChoices } from '../../shared/postgresOwnership';
import type { PostgresConnection } from './connection';

/** 普通用户仅能转给可切换且在原 schema 有 CREATE 权限的角色。 */
export async function postgresOwnerTargets(connection: PostgresConnection, schemaOid: string, ownerOid: string,
  search: string, key?: string): Promise<PostgresTargetChoices> {
  const result = await connection.query(`
    SELECT r.oid::text, r.rolname::text FROM pg_catalog.pg_roles r
    WHERE r.oid <> $2::oid AND ($4::text IS NULL OR r.oid::text = $4)
      AND pg_catalog.strpos(pg_catalog.lower(r.rolname::text), pg_catalog.lower($3)) > 0
      AND (EXISTS (SELECT FROM pg_catalog.pg_roles me WHERE me.rolname = current_user AND me.rolsuper)
        OR (pg_catalog.has_schema_privilege(r.oid, $1::oid, 'CREATE') AND CASE
          WHEN pg_catalog.current_setting('server_version_num')::int >= 160000 THEN pg_catalog.pg_has_role(current_user, r.oid, 'SET')
          ELSE pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER') END))
    ORDER BY r.rolname LIMIT 101`, [schemaOid, ownerOid, search, key ?? null], { rows: 101, bytes: 64 * 1024 });
  if (result.truncated) throw Error('候选角色目录回包不完整，请缩小搜索范围');
  const choices = result.rows.slice(0, 100).map(row => {
    if (typeof row.c0 !== 'string' || typeof row.c1 !== 'string') throw Error('候选角色目录回包不完整');
    return { key: row.c0, label: row.c1 };
  });
  return { choices, limited: result.rows.length > 100 };
}
