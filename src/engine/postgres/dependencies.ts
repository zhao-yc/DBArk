import { postgresDependencySchema, type PostgresDependencies } from '../../shared/postgresDependencies';
import { postgresRelationName } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';
import { startPostgresDdl } from './createTable';
import { postgresStructureVisibleSql } from './relationStructure';
import { postgresSequenceVisibleSql } from './sequence';

// 用对象地址查目录。视图的 _RETURN 和字段默认值转换成实际关系或字段，避免把内部对象当成独立引用。
const dependenciesSql = `
WITH focus AS MATERIALIZED (
  SELECT c.oid, c.reltoastrelid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname::text = $1 AND c.relname::text = $2
    AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
    AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
    AND CASE WHEN c.relkind = 'S' THEN c.relpersistence IN ('p', 'u') AND ${postgresSequenceVisibleSql}
      WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN ${postgresStructureVisibleSql} ELSE false END
), components(classid, objid) AS (
  SELECT 'pg_catalog.pg_class'::regclass::oid, oid FROM focus
  UNION ALL SELECT 'pg_catalog.pg_rewrite'::regclass::oid, r.oid FROM pg_catalog.pg_rewrite r JOIN focus f ON r.ev_class = f.oid
  UNION ALL SELECT 'pg_catalog.pg_attrdef'::regclass::oid, a.oid FROM pg_catalog.pg_attrdef a JOIN focus f ON a.adrelid = f.oid
  UNION ALL SELECT 'pg_catalog.pg_constraint'::regclass::oid, c.oid FROM pg_catalog.pg_constraint c JOIN focus f ON c.conrelid = f.oid
), edges(direction, classid, objid, subid, deptype) AS (
  SELECT 'referencedBy', d.classid, d.objid, d.objsubid, d.deptype
    FROM focus f JOIN pg_catalog.pg_depend d ON d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = f.oid
  UNION ALL
  SELECT 'references', d.refclassid, d.refobjid, d.refobjsubid, d.deptype
    FROM components p JOIN pg_catalog.pg_depend d ON d.classid = p.classid AND d.objid = p.objid
), related AS (
  SELECT DISTINCT e.direction, addr.classid, addr.objid, addr.subid, e.deptype,
    CASE WHEN a.oid IS NOT NULL THEN CASE WHEN col.attgenerated <> '' THEN 'generated column' ELSE 'column default' END END AS field_kind
  FROM edges e CROSS JOIN focus f
  LEFT JOIN pg_catalog.pg_attrdef a ON e.classid = 'pg_catalog.pg_attrdef'::regclass AND a.oid = e.objid
  LEFT JOIN pg_catalog.pg_attribute col ON col.attrelid = a.adrelid AND col.attnum = a.adnum
  LEFT JOIN pg_catalog.pg_rewrite r ON e.classid = 'pg_catalog.pg_rewrite'::regclass AND r.oid = e.objid AND r.rulename = '_RETURN'
  CROSS JOIN LATERAL (SELECT CASE WHEN a.oid IS NOT NULL OR r.oid IS NOT NULL THEN 'pg_catalog.pg_class'::regclass::oid
    ELSE e.classid END AS classid, COALESCE(a.adrelid, r.ev_class, e.objid) AS objid,
    COALESCE(a.adnum::int, CASE WHEN r.oid IS NOT NULL THEN 0 ELSE e.subid END) AS subid) addr
  WHERE NOT (addr.classid = 'pg_catalog.pg_class'::regclass AND addr.objid IN (f.oid, f.reltoastrelid))
    AND NOT (addr.classid = 'pg_catalog.pg_type'::regclass AND e.deptype = 'i'
      AND EXISTS (SELECT FROM pg_catalog.pg_type t WHERE t.oid = addr.objid AND t.typrelid = f.oid))
    AND NOT EXISTS (SELECT FROM components p WHERE p.classid = addr.classid AND p.objid = addr.objid)
), visible AS (
  SELECT DISTINCT r.direction, CASE WHEN ns.allowed THEN COALESCE(r.field_kind, i.type) END AS kind,
    CASE WHEN ns.allowed THEN i.identity END AS identity, r.deptype::text AS deptype
  FROM related r CROSS JOIN LATERAL pg_catalog.pg_identify_object(r.classid, r.objid, r.subid) i
  LEFT JOIN pg_catalog.pg_rewrite rw ON r.classid = 'pg_catalog.pg_rewrite'::regclass AND rw.oid = r.objid
  LEFT JOIN pg_catalog.pg_trigger t ON r.classid = 'pg_catalog.pg_trigger'::regclass AND t.oid = r.objid
  LEFT JOIN pg_catalog.pg_policy p ON r.classid = 'pg_catalog.pg_policy'::regclass AND p.oid = r.objid
  LEFT JOIN pg_catalog.pg_publication_rel pub ON r.classid = 'pg_catalog.pg_publication_rel'::regclass AND pub.oid = r.objid
  LEFT JOIN pg_catalog.pg_class host ON host.oid = COALESCE(rw.ev_class, t.tgrelid, p.polrelid, pub.prrelid)
  -- 目录标识可能带双引号；触发器等对象则从所属关系解析 schema。
  CROSS JOIN LATERAL (SELECT (i.schema IS NULL AND host.oid IS NULL)
    OR pg_catalog.has_schema_privilege(COALESCE(pg_catalog.to_regnamespace(i.schema)::oid, host.relnamespace), 'USAGE') AS allowed) ns
)
SELECT v.direction, v.kind, v.identity, v.deptype FROM focus
LEFT JOIN (SELECT * FROM visible ORDER BY direction, identity NULLS LAST, kind, deptype LIMIT 201) v ON true
ORDER BY v.direction, v.identity NULLS LAST, v.kind, v.deptype`;

/** 仅读取直接目录依赖，不执行对象定义或访问业务记录。 */
export async function readPostgresDependencies(connection: PostgresConnection, table: string): Promise<PostgresDependencies> {
  const { schema, name } = postgresRelationName(table);
  await startPostgresDdl(connection, true);
  const budget = { rows: 201, bytes: 1024 * 1024 };
  const result = await connection.query(dependenciesSql, [schema, name], budget);
  if (!result.rows.length) throw Error('PostgreSQL 对象不存在、已改名或没有读取依赖的权限');
  if ((await connection.query('COMMIT', undefined, budget)).postgresCommand !== 'COMMIT') throw Error('依赖读取未完成');
  const entries = result.rows.slice(0, 200).filter(row => row.c0 !== null).map(row => postgresDependencySchema.parse({
    direction: row.c0, kind: row.c1, identity: row.c2, type: row.c3,
  }));
  return { entries, limited: result.truncated || result.rows.length > 200 };
}
