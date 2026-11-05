import { postgresDependencySchema, type PostgresDependencies } from '../../shared/postgresDependencies';
import type { PostgresRoutineDependencyInput } from '../../shared/postgresRoutine';
import { postgresRelationName } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';
import { startPostgresDdl } from './createTable';
import { postgresStructureVisibleSql } from './relationStructure';
import { postgresSequenceVisibleSql } from './sequence';
import { readPostgresRoutineFacts } from './routine';

const relationFocus = `
  SELECT 'pg_catalog.pg_class'::regclass::oid AS classid, c.oid, c.reltoastrelid
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname::text = $1 AND c.relname::text = $2
    AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
    AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
    AND CASE WHEN c.relkind = 'S' THEN c.relpersistence IN ('p', 'u') AND ${postgresSequenceVisibleSql}
      WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN ${postgresStructureVisibleSql} ELSE false END
`;
const routineFocus = `SELECT 'pg_catalog.pg_proc'::regclass::oid AS classid, p.oid, NULL::oid AS reltoastrelid
  FROM pg_catalog.pg_proc p WHERE p.oid = $1::oid`;

// 使用完整目录地址区分 OID 相同的不同对象类型。将视图规则和字段默认值映射到用户看到的对象。
const dependenciesSql = (focus: string) => `
WITH focus AS (${focus}),
relation AS (SELECT oid FROM focus WHERE classid = 'pg_catalog.pg_class'::regclass),
components(classid, objid) AS (
  SELECT classid, oid FROM focus
  UNION ALL SELECT 'pg_catalog.pg_rewrite'::regclass::oid, r.oid FROM pg_catalog.pg_rewrite r JOIN relation f ON r.ev_class = f.oid
  UNION ALL SELECT 'pg_catalog.pg_attrdef'::regclass::oid, a.oid FROM pg_catalog.pg_attrdef a JOIN relation f ON a.adrelid = f.oid
  UNION ALL SELECT 'pg_catalog.pg_constraint'::regclass::oid, c.oid FROM pg_catalog.pg_constraint c JOIN relation f ON c.conrelid = f.oid
), edges(direction, classid, objid, subid, deptype) AS (
  SELECT 'referencedBy', d.classid, d.objid, d.objsubid, d.deptype
    FROM focus f JOIN pg_catalog.pg_depend d ON d.refclassid = f.classid AND d.refobjid = f.oid
  UNION ALL
  SELECT 'references', d.refclassid, d.refobjid, d.refobjsubid, d.deptype
    FROM components p JOIN pg_catalog.pg_depend d ON d.classid = p.classid AND d.objid = p.objid
), related AS (
  SELECT DISTINCT e.direction, addr.classid, addr.objid, addr.subid, e.deptype,
    CASE WHEN a.oid IS NOT NULL THEN CASE WHEN pg_catalog.to_jsonb(col)->>'attgenerated' <> ''
      THEN 'generated column' ELSE 'column default' END END AS field_kind
  FROM edges e CROSS JOIN focus f
  LEFT JOIN pg_catalog.pg_attrdef a ON e.classid = 'pg_catalog.pg_attrdef'::regclass AND a.oid = e.objid
  LEFT JOIN pg_catalog.pg_attribute col ON col.attrelid = a.adrelid AND col.attnum = a.adnum
  LEFT JOIN pg_catalog.pg_rewrite r ON e.classid = 'pg_catalog.pg_rewrite'::regclass AND r.oid = e.objid AND r.rulename = '_RETURN'
  CROSS JOIN LATERAL (SELECT CASE WHEN a.oid IS NOT NULL OR r.oid IS NOT NULL THEN 'pg_catalog.pg_class'::regclass::oid
    ELSE e.classid END AS classid, COALESCE(a.adrelid, r.ev_class, e.objid) AS objid,
    COALESCE(a.adnum::int, CASE WHEN r.oid IS NOT NULL THEN 0 ELSE e.subid END) AS subid) addr
  WHERE NOT (addr.classid = 'pg_catalog.pg_class'::regclass AND addr.objid = COALESCE(f.reltoastrelid, 0::oid))
    AND NOT (f.classid = 'pg_catalog.pg_class'::regclass AND addr.classid = 'pg_catalog.pg_type'::regclass AND e.deptype = 'i'
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
  LEFT JOIN pg_catalog.pg_proc proc ON r.classid = 'pg_catalog.pg_proc'::regclass AND proc.oid = r.objid
  LEFT JOIN pg_catalog.pg_class host ON host.oid = COALESCE(rw.ev_class, t.tgrelid, p.polrelid, pub.prrelid)
  -- 目录标识可能带双引号；触发器等对象则从所属关系解析 schema。
  CROSS JOIN LATERAL (SELECT ((i.schema IS NULL AND host.oid IS NULL)
    OR pg_catalog.has_schema_privilege(COALESCE(pg_catalog.to_regnamespace(i.schema)::oid, host.relnamespace), 'USAGE'))
    AND (proc.oid IS NULL OR pg_catalog.has_function_privilege(proc.oid, 'EXECUTE')
      OR pg_catalog.pg_has_role(proc.proowner, 'USAGE')) AS allowed) ns
)
SELECT v.direction, v.kind, v.identity, v.deptype FROM focus
LEFT JOIN (SELECT * FROM visible ORDER BY direction, identity NULLS LAST, kind, deptype LIMIT 201) v ON true
ORDER BY v.direction, v.identity NULLS LAST, v.kind, v.deptype`;

/** 仅读取直接目录依赖，不执行对象定义或访问业务记录。 */
async function readDependencies(connection: PostgresConnection, focus: string, values: string[]): Promise<PostgresDependencies> {
  const result = await connection.query(dependenciesSql(focus), values, { rows: 201, bytes: 1024 * 1024 });
  if (!result.rows.length) throw Error('PostgreSQL 对象不存在、已改名或没有读取依赖的权限');
  if ((await connection.query('COMMIT', undefined, { rows: 0, bytes: 1024 })).postgresCommand !== 'COMMIT') throw Error('依赖读取未完成');
  const entries = result.rows.slice(0, 200).filter(row => row.c0 !== null).map(row => postgresDependencySchema.parse({
    direction: row.c0, kind: row.c1, identity: row.c2, type: row.c3,
  }));
  return { entries, limited: result.truncated || result.rows.length > 200 };
}

export async function readPostgresDependencies(connection: PostgresConnection, table: string) {
  const { schema, name } = postgresRelationName(table);
  await startPostgresDdl(connection, true);
  return readDependencies(connection, relationFocus, [schema, name]);
}

/** 同一只读快照中核对原定义并读取对应 OID 的依赖，避免同名替换后显示新对象。 */
export async function readPostgresRoutineDependencies(connection: PostgresConnection, input: PostgresRoutineDependencyInput) {
  await startPostgresDdl(connection, true);
  await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', undefined, { rows: 0, bytes: 1024 });
  const facts = await readPostgresRoutineFacts(connection, input);
  if (facts.info.stamp !== input.stamp) throw Error('原例程已变化，请刷新定义后继续');
  return readDependencies(connection, routineFocus, [facts.oid]);
}
