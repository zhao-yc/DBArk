import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteValue } from '../engine/sqlite/protocol';
import { sqliteDataCompareLimits as limits, type SqliteDataCompareInput, type SqliteDataCompareOutput, type SqliteDataCompareRow, type SqliteDataCompareEndpoint } from '../shared/sqliteDataCompare';
import { buildSqliteTableSelect, readSqliteTableCatalogue, readSqliteTableRows, sqliteExactTextProjection, type SqliteTableBrowseControl } from './sqliteTableBrowse';

function integer(value: SqliteValue): number {
  if (!value || typeof value !== 'object' || value.type !== 'integer') throw Error('SQLite 主键目录无效');
  return Number(value.value);
}

/** 普通表与主键身份由同一个读事务中的真实目录证明。 */
async function describe(driver: SqliteDriverSession, table: string, control: SqliteTableBrowseControl) {
  const type = await readSqliteTableRows(driver, "SELECT type FROM pragma_table_list WHERE schema='main' AND name=? COLLATE BINARY LIMIT 2", [table], 2, control);
  if (type.length !== 1 || type[0][0] !== 'table' || /^sqlite_/i.test(table)) throw Error('数据比较仅支持主库普通表');
  const catalogue = await readSqliteTableCatalogue(driver, table, control);
  const key = catalogue.xinfo.map(row => ({ name: row[1] as string, order: integer(row[5]) }))
    .filter(column => column.order > 0).sort((left, right) => left.order - right.order);
  if (!key.length || key.some((column, index) => column.order !== index + 1)) throw Error('两侧普通表均须有完整的显式主键');
  return { columns: catalogue.columns, key: key.map(column => column.name) };
}

/** 主键和值按原生存储类型比较。文本、二进制和64位整数不经隐式数值转换。 */
function sameValue(left: SqliteValue, right: SqliteValue): boolean {
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return left === right;
  if (left.type === 'binary') return right.type === 'binary' && left.base64 === right.base64;
  return right.type !== 'binary' && left.type === right.type && left.value === right.value;
}

async function data(driver: SqliteDriverSession, target: SqliteDataCompareEndpoint, catalogue: Awaited<ReturnType<typeof describe>>,
  columns: string[], keyColumns: string[], input: SqliteDataCompareInput, control: SqliteTableBrowseControl) {
  const query = buildSqliteTableSelect({ ...target, taskId: input.taskId, filters: input.filters, mode: input.mode, sort: [], offset: 0, limit: 1 },
    catalogue.columns, columns, true, sqliteExactTextProjection);
  const rows = await readSqliteTableRows(driver, query.sql + ' LIMIT ' + (limits.rows + 1), query.parameters, limits.rows + 1, control, actual => {
    if (actual.length !== columns.length || actual.some((column, index) => column.name !== columns[index])) throw Error('SQLite 比较结果与当前字段目录不同');
  }, limits.bytes);
  if (rows.length > limits.rows) throw Error('SQLite 比较每侧最多 10,000 行，请缩小筛选范围');
  const indexes = keyColumns.map(name => columns.indexOf(name));
  const indexed = new Map<string, { key: SqliteValue[]; values: SqliteValue[] }>();
  for (const values of rows) {
    if (values.length !== columns.length) throw Error('SQLite 比较结果行不完整');
    const key = indexes.map(index => values[index]);
    if (key.some(value => value === null || value === undefined)) throw Error('匹配范围含 NULL 主键，无法逐行匹配');
    const id = JSON.stringify(key);
    if (indexed.has(id)) throw Error('匹配范围含重复主键，无法逐行匹配');
    indexed.set(id, { key, values });
  }
  return indexed;
}

/** 左右目录先固定快照，再读取各自完整范围。收尾由原 SqliteRuntime 关闭准确驱动。 */
export async function compareSqliteTables(left: SqliteDriverSession, right: SqliteDriverSession, input: SqliteDataCompareInput, check: () => void): Promise<SqliteDataCompareOutput> {
  const control = { check, beginCleanup() {}, cleanupFailed() {} };
  const oneFile = left === right;
  if (oneFile && input.source.table === input.target.table) throw Error('请选择两张不同的表');
  check();
  await left.execute('BEGIN'); check();
  const source = await describe(left, input.source.table, control);
  if (!oneFile) { await right.execute('BEGIN'); check(); }
  const target = await describe(right, input.target.table, control);
  const columns = source.columns.map(column => column.name), targetNames = new Set(target.columns.map(column => column.name));
  if (columns.length !== targetNames.size || columns.some(name => !targetNames.has(name))) throw Error('两侧字段名集合不同，请先进行结构比较');
  if (source.key.length !== target.key.length || source.key.some(name => !target.key.includes(name))) throw Error('两侧主键字段不同，无法逐行匹配');

  const a = await data(left, input.source, source, columns, source.key, input, control);
  const b = await data(right, input.target, target, columns, source.key, input, control);
  const differences: SqliteDataCompareRow[] = [];
  const counts = { 'source-only': 0, 'target-only': 0, different: 0 };
  let equal = 0, bytes = 0;
  const add = (row: SqliteDataCompareRow) => {
    bytes += Buffer.byteLength(JSON.stringify(row));
    if (bytes > limits.bytes) throw Error('SQLite 比较差异超过 8 MiB，请缩小筛选范围');
    differences.push(row); counts[row.kind]++;
  };
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const before = a.get(id), after = b.get(id);
    if (!before && after) add({ kind: 'target-only', key: after.key, cells: after.values.map((target, column) => ({ column, target })) });
    else if (before && !after) add({ kind: 'source-only', key: before.key, cells: before.values.map((source, column) => ({ column, source })) });
    else if (before && after) {
      const cells = before.values.flatMap((source, column) => sameValue(source, after.values[column]) ? [] : [{ column, source, target: after.values[column] }]);
      if (cells.length) add({ kind: 'different', key: before.key, cells }); else equal++;
    }
  }
  return { snapshot: oneFile ? 'one-file' : 'two-files', columns, keyColumns: source.key, sourceRows: a.size, targetRows: b.size, equal, counts, differences };
}
