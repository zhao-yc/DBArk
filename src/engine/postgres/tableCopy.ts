import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import type { PostgresTableCopyInput } from '../../shared/postgresTableCopy';
import type { PostgresConnection } from './connection';

const factsBudget = { rows: 1601, bytes: 512 * 1024 };
interface CopyColumn { name: string; signature: string; generated: boolean; identity: boolean; cycle: boolean; sequenceDefault: boolean; }

/** 目录原文以 OID 和目录行版本共同签名。数据提交不参与结构代次。 */
export async function readPostgresCopySource(connection: PostgresConnection, input: PostgresTableCopyInput) {
  const { schema, name } = postgresRelationName(input.source);
  const result = await connection.query(`
    SELECT c.oid::text, pg_catalog.obj_description(c.oid, 'pg_class'),
      pg_catalog.md5(pg_catalog.jsonb_build_array(c.xmin::text, n.oid::text,
        ARRAY(SELECT pg_catalog.jsonb_build_array(a.attnum, a.xmin::text, pg_catalog.col_description(c.oid, a.attnum))
          FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum),
        ARRAY(SELECT pg_catalog.jsonb_build_array(d.oid::text, d.xmin::text) FROM pg_catalog.pg_attrdef d WHERE d.adrelid = c.oid ORDER BY d.oid),
        ARRAY(SELECT pg_catalog.jsonb_build_array(k.oid::text, k.xmin::text, pg_catalog.obj_description(k.oid, 'pg_constraint'))
          FROM pg_catalog.pg_constraint k WHERE k.conrelid = c.oid ORDER BY k.oid),
        ARRAY(SELECT pg_catalog.jsonb_build_array(i.indexrelid::text, i.xmin::text, ci.xmin::text, pg_catalog.obj_description(i.indexrelid, 'pg_class'))
          FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ci ON ci.oid = i.indexrelid WHERE i.indrelid = c.oid ORDER BY i.indexrelid),
        ARRAY(SELECT pg_catalog.jsonb_build_array(s.oid::text, s.xmin::text)
          FROM pg_catalog.pg_statistic_ext s WHERE s.stxrelid = c.oid ORDER BY s.oid),
        ARRAY(SELECT pg_catalog.jsonb_build_array(q.seqrelid::text, q.xmin::text)
          FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_sequence q ON q.seqrelid = d.objid
          WHERE d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = c.oid
            AND d.classid = 'pg_catalog.pg_class'::regclass AND d.deptype = 'i' ORDER BY q.seqrelid)
      )::text), c.relrowsecurity
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname::text = $1 AND c.relname::text = $2
      AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND c.relkind = 'r' AND c.relpersistence = 'p' AND NOT c.relispartition
      AND NOT EXISTS (SELECT FROM pg_catalog.pg_inherits i WHERE i.inhrelid = c.oid OR i.inhparent = c.oid)
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
      AND pg_catalog.has_table_privilege(c.oid, 'SELECT')
  `, [schema, name], { rows: 2, bytes: 16 * 1024 });
  const row = result.rows[0];
  if (connection.database !== input.database || result.truncated || result.rows.length !== 1 ||
      typeof row?.c0 !== 'string' || typeof row.c2 !== 'string')
    throw Error('来源必须是可读取的普通 PostgreSQL 持久表，分区和继承表暂不支持');
  if (input.mode === 'data' && row.c3 !== 'f') throw Error('启用了行级安全策略的表仅支持复制结构');
  const columns = await readPostgresCopyColumns(connection, row.c0);
  if (columns.some(column => column.sequenceDefault)) throw Error('来源默认值引用序列，请先转换为独立标识列或显式移除该默认值');
  if (input.mode === 'data' && columns.some(column => column.cycle)) throw Error('循环标识序列仅支持复制结构');
  const comment = typeof row.c1 === 'string' ? row.c1 : null;
  return { oid: row.c0, comment, stamp: JSON.stringify([row.c0, row.c2, comment]), columns };
}

/** 比较字段类型、修饰、排序规则、空值约束、标识和生成方式。 */
export async function readPostgresCopyColumns(connection: PostgresConnection, oid: string): Promise<CopyColumn[]> {
  const result = await connection.query(`
    SELECT a.attname,
      pg_catalog.jsonb_build_array(a.attname, a.atttypid::text, a.atttypmod, a.attcollation::text,
        a.attnotnull, a.attidentity, a.attgenerated)::text,
      a.attgenerated <> '', a.attidentity <> '',
      COALESCE(q.seqcycle, false),
      COALESCE(a.attgenerated = '' AND (pg_catalog.pg_get_expr(f.adbin, f.adrelid) ~* '\\mnextval\\M'
        OR EXISTS (SELECT FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class seq ON seq.oid = d.refobjid AND seq.relkind = 'S'
          WHERE d.classid = 'pg_catalog.pg_attrdef'::regclass AND d.objid = f.oid AND d.refclassid = 'pg_catalog.pg_class'::regclass)), false)
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef f ON f.adrelid = a.attrelid AND f.adnum = a.attnum
    LEFT JOIN pg_catalog.pg_sequence q ON q.seqrelid = CASE WHEN a.attidentity <> '' THEN
      pg_catalog.pg_get_serial_sequence(a.attrelid::regclass::text, a.attname)::regclass END
    WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  `, [oid], factsBudget);
  if (result.truncated || !result.rows.length || result.rows.length > 1600 ||
      result.rows.some(row => typeof row.c0 !== 'string' || typeof row.c1 !== 'string'))
    throw Error('来源字段回包不完整或超过复制预算');
  return result.rows.map(row => ({
    name: String(row.c0), signature: String(row.c1), generated: row.c2 === 't', identity: row.c3 === 't',
    cycle: row.c4 === 't', sequenceDefault: row.c5 === 't',
  }));
}

/** 新序列按实际副本极值推进，方向与步长不变，使用 numeric 避免 int64 中间运算溢出。 */
function advanceIdentity(target: string, column: string): string {
  const name = postgresIdentifier(column);
  return `WITH seq AS (SELECT pg_catalog.pg_get_serial_sequence(${postgresDdlLiteral(target)}, ${postgresDdlLiteral(column)})::regclass AS oid),
extreme AS (SELECT pg_catalog.max(${name})::numeric AS hi, pg_catalog.min(${name})::numeric AS lo FROM ONLY ${target}),
settings AS (
  SELECT seq.oid, pg_catalog.sign(q.seqincrement::numeric) AS dir, pg_catalog.abs(q.seqincrement::numeric) AS step,
    CASE WHEN q.seqincrement > 0 THEN extreme.hi ELSE -extreme.lo END AS edge,
    CASE WHEN q.seqincrement > 0 THEN q.seqstart::numeric ELSE -q.seqstart::numeric END AS first,
    CASE WHEN q.seqincrement > 0 THEN q.seqmax::numeric ELSE -q.seqmin::numeric END AS bound
  FROM seq JOIN pg_catalog.pg_sequence q ON q.seqrelid = seq.oid CROSS JOIN extreme
), next AS (
  SELECT *, CASE WHEN edge >= first THEN first + (pg_catalog.div(edge - first, step) + 1) * step ELSE first END AS candidate
  FROM settings
)
SELECT pg_catalog.setval(oid, (LEAST(candidate, bound) * dir)::bigint, candidate > bound) FROM next`;
}

/** SQL 只使用目录字段、受限标识符和固定运算，生成列由目标表计算。 */
export function postgresTableCopySql(input: PostgresTableCopyInput, columns: CopyColumn[], comment: string | null) {
  const original = postgresRelationName(input.source);
  const source = postgresIdentifier(original.schema) + '.' + postgresIdentifier(original.name);
  const target = postgresIdentifier(input.schema) + '.' + postgresIdentifier(input.name);
  const lock = 'LOCK TABLE ONLY ' + source + ' IN ACCESS SHARE MODE';
  const statements = ['CREATE TABLE ' + target + ' (LIKE ' + source + ' INCLUDING ALL)'];
  if (comment !== null) statements.push('COMMENT ON TABLE ' + target + ' IS ' + postgresDdlLiteral(comment));
  if (input.mode === 'data') {
    const writable = columns.filter(column => !column.generated).map(column => postgresIdentifier(column.name));
    if (!writable.length) throw Error('来源没有可复制的基础字段');
    statements.push('SET LOCAL row_security = off',
      'INSERT INTO ' + target + ' (' + writable.join(', ') + ')' +
      (columns.some(column => column.identity) ? ' OVERRIDING SYSTEM VALUE' : '') +
      ' SELECT ' + writable.join(', ') + ' FROM ONLY ' + source);
    statements.push(...columns.filter(column => column.identity).map(column => advanceIdentity(target, column.name)));
  }
  return { table: target, lock, statements };
}
