import { createHash } from 'node:crypto';
import { postgresRelationName } from '../../shared/postgresSql';
import { postgresStructureResultSchema, type PostgresStructureResult } from '../../shared/postgresStructure';
import type { PostgresConnection } from './connection';
import { postgresEditableViewSql, postgresViewFactsSql, postgresViewStamp } from './viewDefinition';
import { parsePostgresMaterializedFacts, postgresMaterializedCanRefreshSql, postgresMaterializedFactsSql } from './materializedView';
import { startPostgresDdl } from './createTable';

// 单条目录查询提供一致的关系、字段、约束和索引快照；绝不读取目标关系的数据行。
const structureSql = `
WITH target AS MATERIALIZED (
  SELECT c.oid, c.relkind, c.relname, c.relispartition, c.relpartbound,
         c.relrowsecurity, c.relforcerowsecurity, n.nspname,
         CASE WHEN ${postgresEditableViewSql} THEN (${postgresViewFactsSql})::text END AS view_edit,
         CASE WHEN c.relkind = 'm' THEN (${postgresMaterializedFactsSql})::text END AS materialized,
         c.relkind = 'm' AND c.relpersistence = 'p' AND pg_catalog.pg_has_role(c.relowner, 'USAGE')
           AND pg_catalog.has_schema_privilege(n.oid, 'CREATE') AS materialized_index_edit,
         c.relkind = 'r' AND c.relpersistence IN ('p', 'u') AND NOT c.relispartition
           AND pg_catalog.pg_has_role(c.relowner, 'USAGE')
           AND NOT EXISTS (SELECT FROM pg_catalog.pg_inherits i WHERE i.inhrelid = c.oid OR i.inhparent = c.oid) AS editable
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname::text = $1 AND c.relname::text = $2
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
    AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
    AND (pg_catalog.has_table_privilege(c.oid, 'SELECT') OR pg_catalog.pg_has_role(c.relowner, 'USAGE')
      OR (c.relkind = 'm' AND ${postgresMaterializedCanRefreshSql}))
)
SELECT pg_catalog.jsonb_build_object(
  'database', pg_catalog.current_database(),
  'serverVersion', pg_catalog.current_setting('server_version_num')::int,
  'schema', t.nspname,
  'name', t.relname,
  'kind', t.relkind,
  'comment', pg_catalog.obj_description(t.oid, 'pg_class'),
  'partitionKey', CASE WHEN t.relkind = 'p' THEN pg_catalog.pg_get_partkeydef(t.oid) END,
  'partitionBound', CASE WHEN t.relispartition THEN pg_catalog.pg_get_expr(t.relpartbound, t.oid) END,
  'rowSecurity', t.relrowsecurity,
  'forceRowSecurity', t.relforcerowsecurity,
  'viewDefinition', CASE WHEN t.relkind IN ('v', 'm') THEN pg_catalog.pg_get_viewdef(t.oid, false) END,
  'columns', COALESCE((SELECT pg_catalog.jsonb_agg(field.item ORDER BY field.position) FROM (
    SELECT a.attnum AS position, pg_catalog.jsonb_build_object(
      'position', a.attnum,
      'name', a.attname,
      'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
      'nullable', NOT a.attnotnull,
      'defaultExpression', CASE WHEN a.attgenerated = '' AND a.attidentity = '' THEN pg_catalog.pg_get_expr(d.adbin, d.adrelid) END,
      'generationExpression', CASE WHEN a.attgenerated <> '' THEN pg_catalog.pg_get_expr(d.adbin, d.adrelid) END,
      'generation', a.attgenerated,
      'identity', a.attidentity,
      'collation', CASE WHEN col.oid IS NOT NULL THEN pg_catalog.format('%I.%I', ns.nspname, col.collname) END,
      'comment', pg_catalog.col_description(t.oid, a.attnum)
    ) AS item
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN pg_catalog.pg_collation col ON col.oid = a.attcollation
    LEFT JOIN pg_catalog.pg_namespace ns ON ns.oid = col.collnamespace
    WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum LIMIT 2001
  ) field), '[]'::jsonb),
  'constraints', COALESCE((SELECT pg_catalog.jsonb_agg(cn.item ORDER BY cn.name, cn.oid) FROM (
    SELECT c.conname AS name, c.oid, pg_catalog.jsonb_build_object(
      'name', c.conname,
      'kind', c.contype,
      'definition', pg_catalog.pg_get_constraintdef(c.oid, false),
      'deferrable', c.condeferrable,
      'initiallyDeferred', c.condeferred,
      'validated', c.convalidated,
      'inherited', c.conparentid <> 0 OR NOT c.conislocal,
      'keyColumns', CASE WHEN c.contype IN ('p', 'u') THEN (
        SELECT pg_catalog.jsonb_agg(a.attname ORDER BY k.pos)
        FROM pg_catalog.unnest(c.conkey) WITH ORDINALITY AS k(attnum, pos)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      ) ELSE '[]'::jsonb END,
      'check', CASE WHEN c.contype = 'c' THEN pg_catalog.jsonb_build_object(
        'expression', pg_catalog.pg_get_expr(c.conbin, c.conrelid), 'noInherit', c.connoinherit,
        'comment', pg_catalog.obj_description(c.oid, 'pg_constraint'),
        'enforced', COALESCE((pg_catalog.to_jsonb(c)->>'conenforced')::boolean, true)
      ) END,
      'foreign', CASE WHEN c.contype = 'f' THEN pg_catalog.jsonb_build_object(
        'schema', rns.nspname, 'table', ref.relname, 'match', c.confmatchtype,
        'onUpdate', c.confupdtype, 'onDelete', c.confdeltype,
        'enforced', COALESCE((pg_catalog.to_jsonb(c)->>'conenforced')::boolean, true),
        'pairs', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('local', a.attname, 'remote', b.attname) ORDER BY k.pos)
          FROM pg_catalog.unnest(c.conkey) WITH ORDINALITY AS k(attnum, pos)
          JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
          JOIN pg_catalog.pg_attribute b ON b.attrelid = c.confrelid AND b.attnum = c.confkey[k.pos::int])
      ) END
    ) AS item
    FROM pg_catalog.pg_constraint c
    LEFT JOIN pg_catalog.pg_class ref ON ref.oid = c.confrelid
    LEFT JOIN pg_catalog.pg_namespace rns ON rns.oid = ref.relnamespace
    WHERE c.conrelid = t.oid AND c.contype IN ('p', 'f', 'u', 'c', 'x', 'n')
    ORDER BY c.conname, c.oid LIMIT 2001
  ) cn), '[]'::jsonb),
  'indexes', COALESCE((SELECT pg_catalog.jsonb_agg(ix.item ORDER BY ix.name, ix.oid) FROM (
    SELECT i.relname AS name, i.oid, pg_catalog.jsonb_build_object(
      'name', i.relname,
      'method', am.amname,
      'definition', pg_catalog.pg_get_indexdef(i.oid),
      'unique', x.indisunique,
      'primary', x.indisprimary,
      'valid', x.indisvalid,
      'ready', x.indisready,
      'replicaIdentity', x.indisreplident,
      'nullsNotDistinct', COALESCE((pg_catalog.to_jsonb(x)->>'indnullsnotdistinct')::boolean, false),
      'parts', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'column', a.attname, 'key', k.pos <= x.indnkeyatts,
        'descending', (COALESCE(x.indoption[(k.pos - 1)::int], 0) & 1) <> 0,
        'nullsFirst', (COALESCE(x.indoption[(k.pos - 1)::int], 0) & 2) <> 0
      ) ORDER BY k.pos)
        FROM pg_catalog.unnest(x.indkey) WITH ORDINALITY AS k(attnum, pos)
        LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum),
      'constraint', (SELECT c.conname FROM pg_catalog.pg_constraint c WHERE c.conrelid = t.oid
        AND c.conindid = i.oid AND c.contype IN ('p', 'u', 'x') ORDER BY c.oid LIMIT 1)
    ) AS item
    FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid = i.relam
    WHERE x.indrelid = t.oid
    ORDER BY i.relname, i.oid LIMIT 2001
  ) ix), '[]'::jsonb)
), t.oid::text, t.editable,
  pg_catalog.jsonb_build_object('indexes', COALESCE((SELECT pg_catalog.jsonb_object_agg(index_name, index_oid) FROM (
    SELECT i.relname::text AS index_name, i.oid::text AS index_oid
    FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
    WHERE x.indrelid = t.oid ORDER BY i.oid LIMIT 2001
  ) index_ids), '{}'::jsonb),
    'keys', COALESCE((SELECT pg_catalog.jsonb_object_agg(key_name, key_oid) FROM (
      SELECT c.conname::text AS key_name, c.oid::text AS key_oid FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = t.oid AND c.contype IN ('p', 'u') ORDER BY c.oid LIMIT 2001
    ) key_ids), '{}'::jsonb),
    'checks', COALESCE((SELECT pg_catalog.jsonb_object_agg(check_name, check_oid) FROM (
      SELECT c.conname::text AS check_name, c.oid::text AS check_oid FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = t.oid AND c.contype = 'c' ORDER BY c.oid LIMIT 2001
    ) check_ids), '{}'::jsonb),
    'foreign', COALESCE((SELECT pg_catalog.jsonb_object_agg(conname::text,
      pg_catalog.jsonb_build_object('oid', oid::text, 'reference', confrelid::text, 'index', conindid::text)) FROM (
      SELECT c.conname, c.oid, c.confrelid, c.conindid FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = t.oid AND c.contype = 'f' ORDER BY c.oid LIMIT 2001
    ) foreign_ids), '{}'::jsonb)), t.view_edit, t.materialized, t.materialized_index_edit
FROM target t
`;

/** 用独立只读会话加载目录，服务端反编译文本保留实际表达式及必要的 schema 限定。 */
export async function readPostgresStructure(connection: PostgresConnection, table: string): Promise<PostgresStructureResult> {
  const small = { rows: 2, bytes: 8192 };
  await startPostgresDdl(connection, true);
  const { output } = await readPostgresStructureFacts(connection, table);
  const committed = await connection.query('COMMIT', undefined, { ...small });
  if (committed.postgresCommand !== 'COMMIT') throw Error('PostgreSQL结构读取事务未完成');
  return output;
}

/** 在调用者的原事务读取完整目录和关系 OID，生成可复核的结构摘要。 */
export async function readPostgresStructureFacts(connection: PostgresConnection, table: string) {
  const { schema, name } = postgresRelationName(table);
  const result = await connection.query(structureSql, [schema, name], { rows: 2, bytes: 4 * 1024 * 1024 });
  if (result.truncated) throw Error('PostgreSQL结构超过显示预算，无法完整读取');
  if (result.rows.length !== 1 || typeof result.rows[0].c0 !== 'string' || typeof result.rows[0].c1 !== 'string') {
    throw Error('PostgreSQL关系不存在、已改名或没有读取结构的权限');
  }
  const parsed = postgresStructureResultSchema.safeParse(JSON.parse(result.rows[0].c0));
  if (!parsed.success || parsed.data.database !== connection.database || parsed.data.schema !== schema || parsed.data.name !== name) {
    throw Error('PostgreSQL结构回包不完整或目标已经变化');
  }
  const { c0: raw, c1: oid, c2: editable, c3: ids, c4: viewEdit, c5: materialized, c6: indexEditable } = result.rows[0] as { c0: string; c1: string; c2: string; c3: string; c4: string | null; c5: string | null; c6: string };
  const identity = JSON.parse(ids);
  const indexIds = catalogIds(identity.indexes, parsed.data.indexes);
  const keyIds = catalogIds(identity.keys, parsed.data.constraints.filter(key => key.kind === 'p' || key.kind === 'u'));
  const checkIds = catalogIds(identity.checks, parsed.data.constraints.filter(key => key.kind === 'c'));
  const foreignIds = new Map<string, { oid: string; reference: string; index: string }>(Object.entries(identity.foreign));
  const foreign = parsed.data.constraints.filter(key => key.kind === 'f');
  if (foreignIds.size !== foreign.length || foreign.some(key => {
    const value = foreignIds.get(key.name);
    return !value || ![value.oid, value.reference, value.index].every(oid => typeof oid === 'string' && /^\d+$/.test(oid));
  })) throw Error('PostgreSQL 外键身份回包不完整');
  const output: PostgresStructureResult = { ...parsed.data, ...(editable === 't' ?
    { editStamp: createHash('sha256').update(oid + '\0' + raw + '\0' + ids).digest('hex') } : {}),
    ...(indexEditable === 't' && materialized ?
      { indexEditStamp: createHash('sha256').update(oid + '\0' + raw + '\0' + ids + '\0' + materialized).digest('hex') } : {}),
    ...(viewEdit ? { viewEditStamp: postgresViewStamp(viewEdit) } : {}),
    ...(materialized ? { materialized: parsePostgresMaterializedFacts(materialized).state } : {}) };
  return { output, oid, indexIds, keyIds, foreignIds, checkIds };
}

/** 目录身份只接受与同一快照中的名称一一对应的 OID。 */
function catalogIds(raw: Record<string, string>, expected: { name: string }[]) {
  const ids = new Map(Object.entries(raw));
  if (ids.size !== expected.length || expected.some(entry => !/^\d+$/.test(ids.get(entry.name) ?? '')))
    throw Error('PostgreSQL 目录身份回包不完整');
  return ids;
}
