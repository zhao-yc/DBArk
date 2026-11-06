import type { CellValue } from '../../shared/contracts';
import { postgresDataCompareLimits as limits, type PostgresDataCompareEndpoint, type PostgresDataCompareInput, type PostgresDataCompareOutput } from '../../shared/postgresDataCompare';
import { postgresIdentifier } from '../../shared/postgresSql';
import { postgresTableCondition } from '../../shared/postgresTableReadSql';
import type { PostgresConnection } from './connection';
import { readRelation } from './tableWorkspace';
import { compareTableData, type TableDataSnapshot } from '../tableDataDifferences';

export interface PostgresCompareVersion { tid: string; version: string; tableOid: string; }
export interface PostgresSyncRow { before?: CellValue[]; after?: CellValue[]; version?: PostgresCompareVersion; }
export interface PostgresSyncEvidence {
  relation: Awaited<ReturnType<typeof readRelation>>;
  columns: string[];
  rows: PostgresSyncRow[];
}
interface Snapshot extends TableDataSnapshot {
  sync?: { relation: PostgresSyncEvidence['relation']; versions: PostgresCompareVersion[] };
}

/** 读、写及写后核对使用相同的无损输出设置，防止会话默认值制造冲突。 */
export async function configurePostgresCompare(connection: PostgresConnection, check: () => void) {
  for (const sql of [
    'SET LOCAL search_path = pg_catalog', "SET LOCAL TIME ZONE 'UTC'", "SET LOCAL DateStyle = 'ISO, YMD'",
    "SET LOCAL IntervalStyle = 'postgres'", 'SET LOCAL extra_float_digits = 3', "SET LOCAL lc_monetary = 'C'",
    'SET LOCAL row_security = off',
  ]) {
    await connection.query(sql, undefined, { rows: 0, bytes: 0 });
    check();
  }
}

export async function inPostgresCompareSnapshot<T>(connection: PostgresConnection, read: () => Promise<T>, check: () => void): Promise<T> {
  const budget = { rows: 0, bytes: 0 };
  await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', undefined, budget);
  check();
  await connection.query('SET LOCAL statement_timeout = 60000', undefined, budget);
  await configurePostgresCompare(connection, check);
  const result = await read();
  check();
  const ended = await connection.query('COMMIT', undefined, budget);
  if (ended.postgresCommand !== 'COMMIT') throw Error('PostgreSQL 未确认只读快照正常结束');
  check();
  return result;
}

/** 列名和表名取自真实目录。只交付完整范围，任何截断都使本轮比较失败。 */
export async function readPostgresCompareTable(connection: PostgresConnection, endpoint: PostgresDataCompareEndpoint, filter: PostgresDataCompareInput['filter'], check: () => void, capture = false): Promise<Snapshot> {
  check();
  const relation = await readRelation(connection, endpoint.table);
  check();
  if (!['r', 'p'].includes(relation.kind) || !relation.keys.length) throw Error('两侧须选择有主键的 PostgreSQL 普通表或分区表');
  if (relation.kind === 'p') {
    const remote = await connection.query(`
      WITH RECURSIVE members(oid) AS (
        SELECT $1::oid UNION ALL
        SELECT i.inhrelid FROM pg_catalog.pg_inherits i JOIN members m ON i.inhparent = m.oid
      )
      SELECT EXISTS (SELECT 1 FROM members m JOIN pg_catalog.pg_class c USING (oid) WHERE c.relkind = 'f')
    `, [relation.oid], { rows: 1, bytes: 1024 });
    check();
    if (remote.rows[0]?.c0 !== 'f') throw Error('含外部表的分区无法保证 PostgreSQL 本地比较快照');
  }
  const columns = relation.columns.map(({ name, type }) => ({ name, type })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const args: unknown[] = [limits.rows + 1];
  const condition = postgresTableCondition(filter, name => {
    if (!columns.some(column => column.name === name)) throw Error('两侧表均须存在筛选列');
    return postgresIdentifier(name);
  }, value => '$' + args.push(value));
  const withVersion = capture && !filter?.text && relation.syncCompatible;
  const versionSql = withVersion ? ', pg_catalog.json_build_array(ctid::text, xmin::text, tableoid::oid::text)::text' : '';
  const sql = 'SELECT ' + columns.map(column => postgresIdentifier(column.name)).join(', ') + versionSql +
    ' FROM ' + (relation.kind === 'r' ? 'ONLY ' : '') + relation.sql + (condition ? ' WHERE ' + condition : '') + ' LIMIT $1';
  const result = await connection.query(sql, args, { rows: limits.rows, bytes: limits.bytes });
  check();
  if (result.truncated || result.rows.length > limits.rows) throw Error('PostgreSQL 比较超过每侧 10,000 行或 8 MiB，请缩小筛选范围');
  if (result.columns.length !== columns.length + Number(withVersion) || result.columns.slice(0, columns.length).some((column, index) => column.name !== columns[index].name))
    throw Error('PostgreSQL 比较读取的字段与目录不一致');
  const values = result.columns.slice(0, columns.length);
  const rows = result.rows.map(row => values.map(column => row[column.key]));
  if (!withVersion) return { keys: relation.keys, columns, rows };
  const versions = result.rows.map(row => {
    const [tid, version, tableOid] = JSON.parse(String(row['c' + columns.length]));
    if (typeof tid !== 'string' || !/^\(\d+,\d+\)$/.test(tid) || typeof version !== 'string' || !/^\d+$/.test(version) || tableOid !== relation.oid)
      throw Error('PostgreSQL 比较无法确认右侧原行版本');
    return { tid, version, tableOid };
  });
  return { keys: relation.keys, columns, rows, sync: { relation, versions } };
}

export function comparePostgresSnapshots(left: Snapshot, right: Snapshot, sharedSnapshot: boolean, capture?: (evidence: PostgresSyncEvidence) => void): PostgresDataCompareOutput {
  const sync = right.sync, rows: PostgresSyncRow[] = [];
  const result = compareTableData(left, right, sharedSnapshot, 'PostgreSQL', capture && sync ? (after, before, position) => {
    rows.push({ before, after, version: position === undefined ? undefined : sync.versions[position] });
  } : undefined);
  if (sync && rows.length) capture?.({ relation: sync.relation, columns: right.columns.map(column => column.name), rows });
  return result;
}
