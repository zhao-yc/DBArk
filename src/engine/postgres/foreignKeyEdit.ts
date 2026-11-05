import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  matchesCreatedPostgresForeign, postgresForeignPlan,
  type PostgresForeignPreviewInput, type PostgresForeignReference, type PostgresForeignTargets,
} from '../../shared/postgresForeignKeyEdit';
import { startPostgresDdl } from './createTable';
import type { PostgresConnection } from './connection';
import type { readPostgresStructureFacts } from './relationStructure';

const limit = 100;
const targetRecord = z.object({
  schema: z.string(), name: z.string(), oid: z.string().regex(/^\d+$/),
  keys: z.array(z.object({ oid: z.string().regex(/^\d+$/),
    columns: z.array(z.object({ name: z.string(), position: z.number(), type: z.string(), typmod: z.number(), collation: z.string() })).min(1).max(32),
  })).min(1).max(129),
});
type Target = z.infer<typeof targetRecord> & { stamp: string };
const targetSql = `
  SELECT pg_catalog.jsonb_build_object('schema', n.nspname, 'name', r.relname, 'oid', r.oid::text, 'keys', eligible.keys)
  FROM pg_catalog.pg_class r
  JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
  CROSS JOIN LATERAL (
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('oid', entry.oid::text, 'columns', entry.parts) ORDER BY entry.oid) AS keys
    FROM (
      SELECT x.indexrelid AS oid, k.parts
      FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class idx ON idx.oid = x.indexrelid
      JOIN pg_catalog.pg_am am ON am.oid = idx.relam
      CROSS JOIN LATERAL (
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'name', a.attname, 'position', a.attnum, 'type', a.atttypid::text, 'typmod', a.atttypmod,
          'collation', a.attcollation::text
        ) ORDER BY col.pos) AS parts,
        pg_catalog.bool_and(pg_catalog.has_column_privilege(r.oid, a.attnum, 'REFERENCES')) AS allowed,
        count(*) AS size
        FROM pg_catalog.unnest(x.indkey) WITH ORDINALITY AS col(attnum, pos)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid AND a.attnum = col.attnum AND NOT a.attisdropped
        WHERE col.pos <= x.indnkeyatts
      ) k
      WHERE x.indrelid = r.oid AND x.indisunique AND x.indisvalid AND x.indisready AND x.indimmediate
        AND x.indpred IS NULL AND x.indexprs IS NULL AND am.amname = 'btree'
        AND x.indnkeyatts BETWEEN 1 AND 32 AND k.allowed AND k.size = x.indnkeyatts
      ORDER BY x.indexrelid LIMIT 129
    ) entry
  ) eligible
  WHERE r.relkind IN ('r','p') AND r.relpersistence IN ('p','u') AND n.nspname <> 'information_schema'
    AND n.nspname !~ '^pg_' AND pg_catalog.has_schema_privilege(n.oid, 'USAGE') AND eligible.keys IS NOT NULL
    AND ($1::text = '' OR strpos(lower(n.nspname || '.' || r.relname), lower($1)) > 0)
    AND ($2::text IS NULL OR (n.nspname::text = $2 AND r.relname::text = $3))
  ORDER BY n.nspname, r.relname LIMIT $4
`;

/** 读取允许 REFERENCES 的实际唯一键，无需读取被引用表的数据行。 */
async function queryTargets(connection: PostgresConnection, search: string, exact?: PostgresForeignReference): Promise<Target[]> {
  const result = await connection.query(targetSql, [search, exact?.schema ?? null, exact?.name ?? null, exact ? 1 : limit + 1],
    { rows: limit + 1, bytes: 4 * 1024 * 1024 });
  if (result.truncated) throw Error('外键候选目录超过预算，请缩小搜索范围');
  return result.rows.map(row => {
    const raw = String(row.c0);
    return { ...targetRecord.parse(JSON.parse(raw)), stamp: createHash('sha256').update(raw).digest('hex') };
  });
}

/** 返回首批候选并明确告知截断，用户可按 schema 或关系名称继续搜索。 */
export async function readPostgresForeignTargets(connection: PostgresConnection, search: string): Promise<PostgresForeignTargets> {
  await startPostgresDdl(connection, true);
  const rows = await queryTargets(connection, search);
  const reply = await connection.query('COMMIT', undefined, { rows: 1, bytes: 8192 });
  if (reply.postgresCommand !== 'COMMIT') throw Error('外键候选读取未完成');
  return {
    truncated: rows.length > limit || rows.some(row => row.keys.length > 128),
    targets: rows.slice(0, limit).filter(row => row.keys.length <= 128).map(({ schema, name, stamp, keys }) => ({
      schema, name, stamp, keys: keys.map(key => key.columns.map(column => column.name)),
    })),
  };
}

/** 绑定被引用表及合格索引。最终以服务器实际绑定的 OID 校验，防止名称在等待期间被重用。 */
export async function preparePostgresForeignEdit({ output, foreignIds }: Awaited<ReturnType<typeof readPostgresStructureFacts>>,
  input: PostgresForeignPreviewInput, connection: PostgresConnection) {
  const { connectionId, database, table, editStamp, changes } = input;
  const plan = postgresForeignPlan(output, { connectionId, database, table, editStamp, changes });
  const prepared = new Map<string, Target>();
  const backing = new Map<(typeof plan.creations)[number], Set<string>>();
  const keyFor = (reference: PostgresForeignReference) => JSON.stringify([reference.schema, reference.name]);
  for (const creation of plan.creations) {
    const id = keyFor(creation.reference);
    const target = prepared.get(id) ?? (await queryTargets(connection, '', creation.reference))[0];
    if (!target || target.keys.length > 128 || target.stamp !== creation.reference.stamp)
      throw Error('被引用表、唯一键或权限已变化，请重新选择');
    prepared.set(id, target);
    const requested = new Set(creation.pairs.map(pair => pair.remote));
    const indexes = target.keys.filter(index => index.columns.length === requested.size &&
      index.columns.every(column => requested.has(column.name)));
    if (!indexes.length) throw Error('引用列必须完整匹配一个可用唯一键');
    backing.set(creation, new Set(indexes.map(index => index.oid)));
  }
  const originals = new Set([...foreignIds.values()].map(identity => identity.oid));
  return { ...plan,
    /** 子表锁定后再次读取引用目录，预览过期时不投递 DDL。 */
    async before(active: PostgresConnection) {
      for (const target of prepared.values()) {
        const current = (await queryTargets(active, '', target))[0];
        if (!current || current.stamp !== target.stamp) throw Error('加锁后被引用表、唯一键或权限已变化，请重新选择');
      }
    },
    /** 从同一写入事务核对被引用表、索引及约束身份。 */
    verify(final: Awaited<ReturnType<typeof readPostgresStructureFacts>>) {
      const actual = final.output.constraints.filter(constraint => constraint.kind === 'f' && !constraint.inherited);
      return actual.length === plan.keys.size && actual.every(constraint => {
        const expected = plan.keys.get(constraint.name), identity = final.foreignIds.get(constraint.name);
        if (!expected || !identity || constraint.validated !== expected.validated) return false;
        if (expected.original) {
          const original = foreignIds.get(expected.original.name);
          return original?.oid === identity.oid && original.reference === identity.reference && original.index === identity.index;
        }
        const creation = expected.created!;
        return !originals.has(identity.oid) && identity.reference === prepared.get(keyFor(creation.reference))?.oid &&
          !!backing.get(creation)?.has(identity.index) && matchesCreatedPostgresForeign(constraint, creation);
      });
    },
  };
}
