import { createHash, randomUUID } from 'node:crypto';
import type { FileImportConflictCounts } from '../../shared/fileImportConflict';
import { isPostgresImportUpdateColumn, type PostgresImportConflict, type PostgresImportKey, type PostgresTableColumn } from '../../shared/postgresTable';
import { postgresIdentifier as quote } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';

interface ImportRelation {
  oid: string;
  kind: string;
  fingerprint: string;
  columns: PostgresTableColumn[];
}

const budget = { rows: 257, bytes: 2 * 1024 * 1024 };
const keyTypes = ['16', '17', '20', '21', '23', '25', '26', '1042', '1043', '1082', '1083', '1114', '1184', '1186', '1266', '1700', '2950'];

/** 只公布非空、立即生效的完整唯一索引，确保临时键的比较规则与目标键一致。 */
export async function readPostgresImportKeys(connection: PostgresConnection, relation: ImportRelation): Promise<PostgresImportKey[]> {
  const catalogue = await connection.query(`
    WITH RECURSIVE targets(oid) AS (
      SELECT $1::oid
      UNION SELECT h.inhrelid FROM pg_catalog.pg_inherits h JOIN targets t ON t.oid = h.inhparent WHERE $2::boolean
    )
    SELECT i.indexrelid, index_class.relname, pg_catalog.pg_get_indexdef(i.indexrelid),
           pg_catalog.json_agg(a.attname::text ORDER BY k.position)::text
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class index_class ON index_class.oid = i.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid = index_class.relam AND am.amname = 'btree'
    CROSS JOIN LATERAL pg_catalog.unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
    JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    JOIN pg_catalog.pg_opclass op ON op.oid = i.indclass[(k.position - 1)::int]
    WHERE i.indrelid = $1::oid AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate
      AND i.indpred IS NULL AND i.indexprs IS NULL AND k.position <= i.indnkeyatts
      AND pg_catalog.has_table_privilege($1::oid, 'SELECT') AND pg_catalog.has_table_privilege($1::oid, 'UPDATE')
      AND pg_catalog.has_database_privilege(pg_catalog.current_database(), 'TEMP')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger tr JOIN targets t ON t.oid = tr.tgrelid
        WHERE NOT tr.tgisinternal AND tr.tgenabled <> 'D')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint co JOIN targets t ON t.oid = co.confrelid
        WHERE co.contype = 'f' AND co.confupdtype IN ('c','n','d'))
    GROUP BY i.indexrelid, index_class.relname, i.indisprimary, i.indnkeyatts
    HAVING count(*) = i.indnkeyatts AND count(DISTINCT a.attnum) = i.indnkeyatts
      AND pg_catalog.bool_and(a.attnotnull AND a.attgenerated = '' AND a.atttypid = ANY($3::oid[])
        AND op.opcdefault AND op.opcnamespace = 'pg_catalog'::regnamespace AND i.indcollation[(k.position - 1)::int] = a.attcollation)
    ORDER BY i.indisprimary DESC, index_class.relname LIMIT 257
  `, [relation.oid, relation.kind === 'p', keyTypes], budget);
  if (catalogue.truncated || catalogue.rows.length > 256) return [];
  const columns = new Map(relation.columns.map(column => [column.name, column.key]));
  return catalogue.rows.flatMap(row => {
    const names: unknown = JSON.parse(String(row.c3));
    if (!Array.isArray(names) || !names.length || names.some(name => typeof name !== 'string' || !columns.has(name))) return [];
    const id = createHash('sha256').update(JSON.stringify([relation.fingerprint, row.c0, row.c1, row.c2])).digest('hex');
    return [{ id, name: String(row.c1), columns: names.map(name => columns.get(name)!) }];
  });
}

/** 按列直接投影保留 PostgreSQL 类型和排序规则，COPY 的数据解释与普通导入一致。 */
export async function createPostgresImportStage(connection: PostgresConnection, target: string, columns: PostgresTableColumn[]): Promise<string> {
  const name = quote('tabrelio_import_' + randomUUID().replaceAll('-', ''));
  await connection.query(`CREATE TEMP TABLE ${name} ON COMMIT DROP AS SELECT ${columns.map(column => quote(column.name)).join(', ')} FROM ${target} WITH NO DATA`, undefined, budget);
  return 'pg_temp.' + name;
}

/** 给源键建立实际唯一约束，NULL 或数据库等价的重复键会在写目标表前失败。 */
export async function indexPostgresImportStage(connection: PostgresConnection, stage: string, keys: string[]): Promise<void> {
  await connection.query(`ALTER TABLE ${stage} ADD PRIMARY KEY (${keys.map(quote).join(', ')})`, undefined, budget);
}

/** 目标在排他写锁下不发生并发变更。匹配数与每条命令的真实回执必须一致。 */
export async function writePostgresImportConflict(connection: PostgresConnection, input: {
  target: string; insertTarget: string; stage: string; columns: PostgresTableColumn[]; key: PostgresImportKey;
  keys: string[]; mode: PostgresImportConflict['mode']; rows: number; check(): void;
}): Promise<FileImportConflictCounts> {
  const { target, insertTarget, stage, columns, key, keys, mode, rows, check } = input;
  const match = keys.map(name => `destination.${quote(name)} OPERATOR(pg_catalog.=) source.${quote(name)}`).join(' AND ');
  const found = await connection.query(`SELECT count(*) FROM ${stage} AS source JOIN ${target} AS destination ON ${match}`, undefined, budget);
  const matched = Number(found.rows[0]?.c0);
  if (!Number.isSafeInteger(matched) || matched < 0 || matched > rows) throw Error('PostgreSQL 匹配行数与源文件不一致');
  const counts = { inserted: 0, matchedUpdates: 0, skippedExisting: 0, skippedMissing: 0 };
  if (mode !== 'skip-existing' && matched) {
    const assignments = columns.filter(column => isPostgresImportUpdateColumn(column, key))
      .map(column => `${quote(column.name)} = source.${quote(column.name)}`).join(', ');
    check();
    const result = await connection.query(`UPDATE ${target} AS destination SET ${assignments} FROM ${stage} AS source WHERE ${match}`, undefined, budget);
    if (result.postgresCommand !== 'UPDATE' || result.affectedRows !== matched) throw Error('PostgreSQL 更新回执与匹配行数不一致');
    counts.matchedUpdates = matched;
  }
  if (mode !== 'update-existing' && rows > matched) {
    const projection = columns.map(column => quote(column.name));
    const identity = columns.some(column => column.identityAlways) ? ' OVERRIDING SYSTEM VALUE' : '';
    check();
    const result = await connection.query(`INSERT INTO ${insertTarget} (${projection.join(', ')})${identity}
      SELECT ${projection.map(name => 'source.' + name).join(', ')} FROM ${stage} AS source
      WHERE NOT EXISTS (SELECT 1 FROM ${target} AS destination WHERE ${match})`, undefined, budget);
    if (result.postgresCommand !== 'INSERT' || result.affectedRows !== rows - matched) throw Error('PostgreSQL 新增回执与未匹配行数不一致');
    counts.inserted = result.affectedRows;
  }
  if (mode === 'skip-existing') counts.skippedExisting = matched;
  if (mode === 'update-existing') counts.skippedMissing = rows - matched;
  return counts;
}
