import type { CellValue } from '../../shared/contracts';
import { postgresDataCompareLimits as limits, type PostgresDataCompareEndpoint, type PostgresDataCompareInput, type PostgresDataCompareOutput } from '../../shared/postgresDataCompare';
import { postgresIdentifier } from '../../shared/postgresSql';
import { postgresTableCondition } from '../../shared/postgresTableReadSql';
import type { PostgresConnection } from './connection';
import { readRelation } from './tableWorkspace';

interface Snapshot {
  keys: string[];
  columns: PostgresDataCompareOutput['columns'];
  rows: CellValue[][];
}

/** 比较沿用原生 wire 值。固定影响输出的会话设置，避免不同连接的时间、浮点或区间格式制造假差异。 */
export async function inPostgresCompareSnapshot<T>(connection: PostgresConnection, read: () => Promise<T>, check: () => void): Promise<T> {
  const budget = { rows: 0, bytes: 0 };
  await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', undefined, budget);
  check();
  // 对启用行级安全的非绕过角色明确报错，避免隐藏行被当作缺失。租约负责关闭失败或取消的连接。
  for (const sql of [
    'SET LOCAL search_path = pg_catalog', "SET LOCAL TIME ZONE 'UTC'", "SET LOCAL DateStyle = 'ISO, YMD'",
    "SET LOCAL IntervalStyle = 'postgres'", 'SET LOCAL extra_float_digits = 3', "SET LOCAL lc_monetary = 'C'",
    'SET LOCAL row_security = off', 'SET LOCAL statement_timeout = 60000',
  ]) {
    await connection.query(sql, undefined, budget);
    check();
  }
  const result = await read();
  check();
  const ended = await connection.query('COMMIT', undefined, budget);
  if (ended.postgresCommand !== 'COMMIT') throw Error('PostgreSQL 未确认只读快照正常结束');
  check();
  return result;
}

/** 列名和表名取自真实目录。只交付完整范围，任何截断都使本轮比较失败。 */
export async function readPostgresCompareTable(connection: PostgresConnection, endpoint: PostgresDataCompareEndpoint, filter: PostgresDataCompareInput['filter'], check: () => void): Promise<Snapshot> {
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
  const sql = 'SELECT ' + columns.map(column => postgresIdentifier(column.name)).join(', ') +
    ' FROM ' + (relation.kind === 'r' ? 'ONLY ' : '') + relation.sql + (condition ? ' WHERE ' + condition : '') + ' LIMIT $1';
  const result = await connection.query(sql, args, { rows: limits.rows, bytes: limits.bytes });
  check();
  if (result.truncated || result.rows.length > limits.rows) throw Error('PostgreSQL 比较超过每侧 10,000 行或 8 MiB，请缩小筛选范围');
  if (result.columns.length !== columns.length || result.columns.some((column, index) => column.name !== columns[index].name))
    throw Error('PostgreSQL 比较读取的字段与目录不一致');
  return { keys: relation.keys, columns, rows: result.rows.map(row => result.columns.map(column => row[column.key])) };
}

const valueEqual = (a: CellValue, b: CellValue) => a === b || (
  a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && a.base64 === b.base64
);

/** 数值主键消除无意义的小数尾零用于匹配。字段对照仍保留各侧原始精度和显示形式。 */
function keyValue(value: CellValue, type: string): CellValue {
  if (typeof value !== 'string') return value;
  if (/^numeric(?:\(|$)/.test(type) && value.includes('.')) return value.replace(/0+$/, '').replace(/\.$/, '');
  if ((type === 'real' || type === 'double precision') && value === '-0') return '0';
  return value;
}

export function comparePostgresSnapshots(left: Snapshot, right: Snapshot, sharedSnapshot: boolean): PostgresDataCompareOutput {
  if (JSON.stringify(left.columns) !== JSON.stringify(right.columns)) throw Error('两侧字段名及 PostgreSQL 声明类型须一致');
  if (JSON.stringify([...left.keys].sort()) !== JSON.stringify([...right.keys].sort())) throw Error('两侧主键字段须一致');
  const keyColumns = left.keys.map(name => left.columns.findIndex(column => column.name === name));
  const index = (rows: CellValue[][]) => {
    const result = new Map<string, { key: CellValue[]; values: CellValue[] }>();
    for (const values of rows) {
      const key = keyColumns.map(column => values[column]);
      if (key.some(value => value == null)) throw Error('PostgreSQL 比较发现空主键');
      const id = JSON.stringify(key.map((value, position) => keyValue(value, left.columns[keyColumns[position]].type)));
      if (result.has(id)) throw Error('PostgreSQL 比较发现重复的主键表示');
      result.set(id, { key, values });
    }
    return result;
  };
  const a = index(left.rows), b = index(right.rows);
  const counts = { 'source-only': 0, 'target-only': 0, different: 0 };
  const differences: PostgresDataCompareOutput['differences'] = [];
  let equal = 0;
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const source = a.get(id), target = b.get(id);
    if (!source && !target) continue;
    const kind = !target ? 'source-only' : !source ? 'target-only' : 'different';
    const cells = left.columns.flatMap((_, column) => {
      const before = source?.values[column], after = target?.values[column];
      if (before !== undefined && after !== undefined && valueEqual(before, after)) return [];
      return [{ column, ...(source ? { source: before } : {}), ...(target ? { target: after } : {}) }];
    });
    if (!cells.length) { equal++; continue; }
    counts[kind]++;
    differences.push({ kind, key: (source ?? target)!.key, cells });
  }
  if (Buffer.byteLength(JSON.stringify(differences)) > limits.bytes * 2) throw Error('PostgreSQL 差异结果超过显示预算，请缩小筛选范围');
  return { sharedSnapshot, columns: left.columns, keyColumns: left.keys, sourceRows: a.size, targetRows: b.size, equal, counts, differences };
}
