import { createHash } from 'node:crypto';
import { postgresSequenceInfoSchema } from '../../shared/postgresSequence';
import { postgresRelationName } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';

// pg_sequences 对目录值应用权限与未分配状态的规则，读取不会调用 nextval。
export const postgresSequenceVisibleSql = `CASE WHEN c.relkind = 'S' THEN pg_catalog.has_sequence_privilege(c.oid, 'USAGE,SELECT,UPDATE')
  OR pg_catalog.pg_has_role(c.relowner, 'USAGE') ELSE false END`;
const catalogSchema = postgresSequenceInfoSchema.omit({ stamp: true, canManage: true });

/** 从目录读取序列的精确参数、可见分配值和所属字段。 */
export async function readPostgresSequence(connection: PostgresConnection, table: string) {
  const { schema, name } = postgresRelationName(table);
  const result = await connection.query(`SELECT n.oid::text, pg_catalog.jsonb_build_object(
    'schema', n.nspname, 'name', c.relname, 'dataType', pg_catalog.format_type(s.seqtypid, NULL),
    'start', s.seqstart::text, 'increment', s.seqincrement::text,
    'minimum', s.seqmin::text, 'maximum', s.seqmax::text, 'cache', s.seqcache::text, 'cycle', s.seqcycle,
    'lastValue', visible.last_value::text, 'comment', pg_catalog.obj_description(c.oid, 'pg_class'),
    'ownedBy', (SELECT pg_catalog.jsonb_build_object('schema', refns.nspname, 'relation', ref.relname,
      'column', a.attname, 'identity', d.deptype = 'i')
      FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class ref ON ref.oid = d.refobjid
      JOIN pg_catalog.pg_namespace refns ON refns.oid = ref.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = ref.oid AND a.attnum = d.refobjsubid
      WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.objsubid = 0
        AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.deptype IN ('a', 'i') AND d.refobjsubid > 0)
  )::text, c.oid::text, c.relowner::text, c.relacl::text, c.relpersistence::text,
    pg_catalog.pg_has_role(c.relowner, 'USAGE'), pg_catalog.pg_get_userbyid(c.relowner), c.xmin::text
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_sequence s ON s.seqrelid = c.oid
  LEFT JOIN pg_catalog.pg_sequences visible ON visible.schemaname = n.nspname AND visible.sequencename = c.relname
  WHERE n.nspname::text = $1 AND c.relname::text = $2 AND c.relkind = 'S' AND c.relpersistence IN ('p','u')
    AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    AND pg_catalog.has_schema_privilege(n.oid, 'USAGE') AND (${postgresSequenceVisibleSql})`,
  [schema, name], { rows: 2, bytes: 128 * 1024 });
  const row = result.rows[0];
  if (result.truncated || result.rows.length !== 1 || typeof row.c0 !== 'string' || typeof row.c1 !== 'string' ||
      typeof row.c2 !== 'string' || typeof row.c7 !== 'string' || typeof row.c8 !== 'string')
    throw Error('序列不存在、不可见或目录回包不完整');
  const catalog = catalogSchema.parse(JSON.parse(row.c1));
  const { lastValue, ...configuration } = catalog;
  const preserved = JSON.stringify([row.c0, row.c2, row.c3, row.c4, row.c5, configuration.ownedBy]);
  const canManage = row.c6 === 't';
  // 目录版本可发现锁定步骤意外改回所有者，正常取号则不会改变目录版本。
  const stamp = createHash('sha256').update(JSON.stringify([preserved, configuration, canManage, row.c7, row.c8])).digest('hex');
  return { schemaOid: row.c0, oid: row.c2, ownerName: row.c7, preserved, info: { ...configuration, lastValue, canManage, stamp } };
}

/** 在已有序列锁的事务中回读物理状态，区分重启值与已分配值。 */
export async function readPostgresSequenceAllocation(connection: PostgresConnection, qualified: string) {
  const result = await connection.query('SELECT last_value::text, is_called FROM ' + qualified, undefined, { rows: 2, bytes: 1024 });
  const row = result.rows[0];
  if (result.truncated || result.rows.length !== 1 || typeof row.c0 !== 'string' || (row.c1 !== 't' && row.c1 !== 'f'))
    throw Error('序列分配状态回读不完整');
  return { value: row.c0, called: row.c1 === 't' };
}
