import { createHash } from 'node:crypto';
import { postgresSequenceInfoSchema, type PostgresSequenceTargetsInput } from '../../shared/postgresSequence';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';

// pg_sequences 对目录值应用权限与未分配状态的规则，读取不会调用 nextval。
export const postgresSequenceVisibleSql = `CASE WHEN c.relkind = 'S' THEN pg_catalog.has_sequence_privilege(c.oid, 'USAGE,SELECT,UPDATE')
  OR pg_catalog.pg_has_role(c.relowner, 'USAGE') ELSE false END`;
const catalogSchema = postgresSequenceInfoSchema.omit({ stamp: true, canManage: true, owner: true });

/** 从目录读取序列的精确参数、可见分配值和所属字段。 */
export async function readPostgresSequence(connection: PostgresConnection, table: string, verifyingOid?: string) {
  const { schema, name } = postgresRelationName(table);
  const result = await connection.query(`SELECT n.oid::text, pg_catalog.jsonb_build_object(
    'schema', n.nspname, 'name', c.relname, 'dataType', pg_catalog.format_type(s.seqtypid, NULL),
    'start', s.seqstart::text, 'increment', s.seqincrement::text,
    'minimum', s.seqmin::text, 'maximum', s.seqmax::text, 'cache', s.seqcache::text, 'cycle', s.seqcycle,
    'lastValue', visible.last_value::text, 'comment', pg_catalog.obj_description(c.oid, 'pg_class'),
    'ownedBy', ownership.metadata
  )::text, c.oid::text, c.relowner::text, c.relacl::text, c.relpersistence::text,
    pg_catalog.pg_has_role(c.relowner, 'USAGE'), pg_catalog.pg_get_userbyid(c.relowner), c.xmin::text, ownership.key
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_sequence s ON s.seqrelid = c.oid
  LEFT JOIN pg_catalog.pg_sequences visible ON visible.schemaname = n.nspname AND visible.sequencename = c.relname
  LEFT JOIN LATERAL (SELECT pg_catalog.jsonb_build_object('schema', refns.nspname, 'relation', ref.relname,
      'column', a.attname, 'identity', d.deptype = 'i') AS metadata, ref.oid::text || ':' || a.attnum::text AS key
      FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class ref ON ref.oid = d.refobjid
      JOIN pg_catalog.pg_namespace refns ON refns.oid = ref.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = ref.oid AND a.attnum = d.refobjsubid
      WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.objsubid = 0
        AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.deptype IN ('a', 'i') AND d.refobjsubid > 0
  ) ownership ON true
  WHERE n.nspname::text = $1 AND c.relname::text = $2 AND c.relkind = 'S' AND c.relpersistence IN ('p','u')
    AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    AND (($3::oid IS NULL AND pg_catalog.has_schema_privilege(n.oid, 'USAGE') AND (${postgresSequenceVisibleSql})) OR c.oid = $3::oid)`,
  [schema, name, verifyingOid ?? null], { rows: 2, bytes: 128 * 1024 });
  const row = result.rows[0];
  if (result.truncated || result.rows.length !== 1 || typeof row.c0 !== 'string' || typeof row.c1 !== 'string' ||
      typeof row.c2 !== 'string' || typeof row.c3 !== 'string' || typeof row.c7 !== 'string' || typeof row.c8 !== 'string' ||
      (row.c9 !== null && typeof row.c9 !== 'string'))
    throw Error('序列不存在、不可见或目录回包不完整');
  const catalog = catalogSchema.parse(JSON.parse(row.c1));
  const { lastValue, ownedBy, ...configuration } = catalog;
  const objectIdentity = JSON.stringify([row.c0, row.c2, row.c3, row.c4, row.c5]);
  const preserved = JSON.stringify([objectIdentity, ownedBy, row.c9]);
  const canManage = row.c6 === 't';
  // 目录版本可发现锁定步骤意外改回所有者，正常取号则不会改变目录版本。
  const stamp = createHash('sha256').update(JSON.stringify([preserved, configuration, canManage, row.c7, row.c8])).digest('hex');
  return { schemaOid: row.c0, oid: row.c2, ownerOid: row.c3, ownerName: row.c7, persistence: row.c5, associationKey: row.c9,
    objectIdentity, preserved, definition: JSON.stringify(configuration), info: { ...configuration, lastValue, ownedBy, owner: row.c7, canManage, stamp } };
}

/** 搜索合格目标或回读指定 OID。绑定仅提供同 schema、同所有者的非标识列。 */
export async function postgresSequenceTargets(connection: PostgresConnection, original: Awaited<ReturnType<typeof readPostgresSequence>>,
  kind: PostgresSequenceTargetsInput['kind'], search = '', key?: string) {
  if (!original.info.canManage) throw Error('当前角色没有序列管理权限');
  if (kind === 'role' && original.info.ownedBy) throw Error('已绑定字段的序列须先解除绑定或随所属关系更改所有者');
  if (kind === 'column' && original.info.ownedBy?.identity) throw Error('标识列序列须随所属字段管理');
  const result = await connection.query(kind === 'role' ? `
    SELECT r.oid::text, r.rolname::text FROM pg_catalog.pg_roles r
    WHERE r.oid <> $2::oid AND ($4::text IS NULL OR r.oid::text = $4)
      AND pg_catalog.strpos(pg_catalog.lower(r.rolname::text), pg_catalog.lower($3)) > 0
      AND (EXISTS (SELECT FROM pg_catalog.pg_roles me WHERE me.rolname = current_user AND me.rolsuper)
        OR (pg_catalog.has_schema_privilege(r.oid, $1::oid, 'CREATE') AND CASE
          WHEN pg_catalog.current_setting('server_version_num')::int >= 160000 THEN pg_catalog.pg_has_role(current_user, r.oid, 'SET')
          ELSE pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER') END))
    ORDER BY r.rolname LIMIT 101` : `
    SELECT c.oid::text || ':' || a.attnum::text, c.relname::text, a.attname::text
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    WHERE c.relnamespace = $1::oid AND c.relowner = $2::oid AND c.relkind IN ('r', 'p', 'f', 'v')
      AND c.relpersistence <> 't' AND a.attnum > 0 AND NOT a.attisdropped AND a.attidentity = ''
      AND ($4::text IS NULL OR c.oid::text || ':' || a.attnum::text = $4)
      AND pg_catalog.strpos(pg_catalog.lower(c.relname::text || '.' || a.attname::text), pg_catalog.lower($3)) > 0
    ORDER BY c.relname, a.attnum LIMIT 101`, [original.schemaOid, original.ownerOid, search, key ?? null], { rows: 101, bytes: 64 * 1024 });
  if (result.truncated) throw Error('候选对象目录回包不完整，请缩小搜索范围');
  const choices = result.rows.slice(0, 100).map(row => {
    if (typeof row.c0 !== 'string' || typeof row.c1 !== 'string' || (kind === 'column' && typeof row.c2 !== 'string'))
      throw Error('候选对象目录回包不完整');
    return { key: row.c0, label: kind === 'role' ? row.c1 : [original.info.schema, row.c1, String(row.c2)].map(postgresIdentifier).join('.') };
  });
  return { choices, limited: result.rows.length > 100 };
}

/** 在已有序列锁的事务中回读物理状态，区分重启值与已分配值。 */
export async function readPostgresSequenceAllocation(connection: PostgresConnection, qualified: string) {
  const result = await connection.query('SELECT last_value::text, is_called FROM ' + qualified, undefined, { rows: 2, bytes: 1024 });
  const row = result.rows[0];
  if (result.truncated || result.rows.length !== 1 || typeof row.c0 !== 'string' || (row.c1 !== 't' && row.c1 !== 'f'))
    throw Error('序列分配状态回读不完整');
  return { value: row.c0, called: row.c1 === 't' };
}
