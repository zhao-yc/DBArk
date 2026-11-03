import { sqliteStatisticsInputSchema, assertSqliteStatistics, sqliteStatisticsLimits as limits, sqliteRowCountInputSchema, assertSqliteRowCount, type SqliteRowCountInput, type SqliteRowCountOutput, type SqliteStatisticsInput, type SqliteStatisticsOutput, type SqliteStatisticsValue } from '../shared/sqliteStatistics';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteValue } from '../engine/sqlite/protocol';
import { readSqliteTableCatalogue, buildSqliteTableSelect, quoteSqliteIdentifier, sqliteExactTextProjection, type SqliteTableBrowseControl } from './sqliteTableBrowse';

/** 原生聚合结果按真实存储类型传输；64位整数、REAL无穷和BLOB不经显示文本猜测。 */
function typed(value: SqliteValue): SqliteStatisticsValue {
  return value === null ? { kind: 'null' } : typeof value === 'string' ? { kind: 'text', value } : value.type === 'binary' ? { kind: 'blob', value: Buffer.from(value.base64, 'base64').toString('hex') } : { kind: value.type, value: value.value };
}
/** 同一独立只读快照内对全部匹配行按存储类型聚合，最多五行，不拉取全表或借用用户事务。 */
export async function readSqliteStatistics(driver: SqliteDriverSession, raw: SqliteStatisticsInput, control: SqliteTableBrowseControl): Promise<SqliteStatisticsOutput> {
  const input = sqliteStatisticsInputSchema.parse(raw);
  return readAggregateSnapshot(driver, control, async () => {
    const catalogue = await readSqliteTableCatalogue(driver, input.table, control), field = catalogue.columns.find(column => column.name === input.column);
    if (catalogue.schemaKey !== input.schemaKey || !field) throw Error('SQLite表结构或字段已变化，请刷新后重新统计');
    const source = buildSqliteTableSelect({ connectionId: input.connectionId, database: 'main', table: input.table, taskId: input.taskId, mode: input.mode, filters: input.filters, sort: [], offset: 0, limit: 1 }, catalogue.columns, [input.column], true);
    const column = '"__dbark_statistics".' + quoteSqliteIdentifier(input.column), rows: SqliteValue[][] = [];
    const sql = 'SELECT typeof(' + column + '), count(*), count(DISTINCT ' + column + '), ' + sqliteExactTextProjection('min(' + column + ')') + ', ' + sqliteExactTextProjection('max(' + column + ')') + ' FROM (' + source.sql + ') AS "__dbark_statistics" GROUP BY typeof(' + column + ') ORDER BY typeof(' + column + ')';
    const result = await driver.execute(sql, { parameters: source.parameters, maxRows: limits.groups, batchRows: limits.groups, maxBytes: limits.bytes,
      onStatement: statement => { control.check(); if (statement.index !== 0 || statement.columns.length !== 5) throw Error('SQLite字段概况返回非预期列'); },
      onBatch: batch => { control.check(); if (batch.index !== 0 || rows.length + batch.rows.length > limits.groups) throw Error('SQLite字段概况超过存储类型上限'); rows.push(...batch.rows); },
    });
    control.check(); if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== rows.length) throw Error('SQLite字段概况未完整读取');
    const groups = rows.map(row => {
      const [kind, count, distinct, min, max] = row;
      if (row.length !== 5 || typeof kind !== 'string' || !count || typeof count !== 'object' || count.type !== 'integer' || !distinct || typeof distinct !== 'object' || distinct.type !== 'integer') throw Error('SQLite字段概况原生计数无效');
      return { kind, count: count.value, distinct: distinct.value, min: typed(min), max: typed(max) };
    });
    const total = groups.reduce((sum, group) => sum + BigInt(group.count), 0n), nulls = BigInt(groups.find(group => group.kind === 'null')?.count ?? '0');
    return assertSqliteStatistics({ request: input, declaredType: field.declaredType, rows: total.toString(), nulls: nulls.toString(), nonNull: (total - nulls).toString(), groups }, input);
  });
}

/** 只聚合行数，投影为常量，避免解码无关列的大文本或 BLOB。 */
export async function readSqliteRowCount(driver: SqliteDriverSession, raw: SqliteRowCountInput, control: SqliteTableBrowseControl): Promise<SqliteRowCountOutput> {
  const input = sqliteRowCountInputSchema.parse(raw);
  return readAggregateSnapshot(driver, control, async () => {
    const catalogue = await readSqliteTableCatalogue(driver, input.table, control);
    if (catalogue.schemaKey !== input.schemaKey) throw Error('SQLite表结构已变化，请刷新后重新统计');
    const source = buildSqliteTableSelect({ connectionId: input.connectionId, database: input.database, table: input.table, taskId: input.taskId, mode: input.mode, filters: input.filters, sort: [], offset: 0, limit: 1 }, catalogue.columns, [catalogue.columns[0].name], true, () => '1');
    const rows: SqliteValue[][] = [];
    control.check();
    const result = await driver.execute('SELECT count(*) FROM (' + source.sql + ') AS "__dbark_count"', { parameters: source.parameters, maxRows: 1, batchRows: 1, maxBytes: 1024,
      onStatement: statement => { control.check(); if (statement.index !== 0 || statement.columns.length !== 1) throw Error('SQLite匹配行数返回非预期列'); },
      onBatch: batch => { control.check(); if (batch.index !== 0 || rows.length + batch.rows.length > 1) throw Error('SQLite匹配行数返回非预期行'); rows.push(...batch.rows); },
    });
    control.check();
    const value = rows[0]?.[0];
    if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== 1 || rows.length !== 1 || rows[0].length !== 1 || !value || typeof value !== 'object' || value.type !== 'integer') throw Error('SQLite匹配行数返回不完整');
    return assertSqliteRowCount({ request: input, rows: value.value }, input);
  });
}

/** 目录与聚合使用同一快照，回滚完成前不交付结果。 */
async function readAggregateSnapshot<T>(driver: SqliteDriverSession, control: SqliteTableBrowseControl, read: () => Promise<T>): Promise<T> {
  let output: T | undefined, failed = false, failure: unknown;
  try {
    control.check(); await driver.execute('BEGIN'); control.check();
    output = await read();
  } catch (reason) { failed = true; failure = reason; }
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); } catch (reason) { control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite统计失败且回滚未确认', { cause: failure }) : reason; failed = true; }
  else if (!driver.isClosed && driver.transaction !== false) { const reason = Error('SQLite统计原只读快照状态未知'); control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite统计与收尾失败', { cause: failure }) : reason; failed = true; }
  if (failed) throw failure; control.check(); return output!;
}
