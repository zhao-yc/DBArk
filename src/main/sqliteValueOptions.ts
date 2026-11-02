import { sqliteValueOptionsInputSchema, assertSqliteValueOptions, sqliteValueOptionsLimits as limits, type SqliteValueOptionsInput, type SqliteValueOptionsOutput } from '../shared/sqliteValueOptions';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteValue } from '../engine/sqlite/protocol';
import { readSqliteTableCatalogue, buildSqliteTableSelect, quoteSqliteIdentifier, sqliteExactTextProjection, type SqliteTableBrowseControl } from './sqliteTableBrowse';

/** 一个只读事务内先核准确结构，再对完整匹配集分组；500+1用于判断截断，不COUNT整表或循环分页。 */
export async function readSqliteValueOptions(driver: SqliteDriverSession, raw: SqliteValueOptionsInput, control: SqliteTableBrowseControl): Promise<SqliteValueOptionsOutput> {
  const input = sqliteValueOptionsInputSchema.parse(raw); let output: SqliteValueOptionsOutput | undefined, failed = false, failure: unknown;
  try {
    control.check(); await driver.execute('BEGIN'); control.check();
    const catalogue = await readSqliteTableCatalogue(driver, input.table, control);
    if (catalogue.schemaKey !== input.schemaKey || !catalogue.columns.some(column => column.name === input.column)) throw Error('SQLite表结构或字段已变化，请刷新后重新读取不同值');
    const source = buildSqliteTableSelect({ connectionId: input.connectionId, database: 'main', table: input.table, taskId: input.taskId, offset: 0, limit: 1, mode: input.mode, filters: input.filters, sort: [] }, catalogue.columns, [input.column], true);
    const column = '"__dbark_values".' + quoteSqliteIdentifier(input.column), parameters = [...source.parameters];
    // 搜索在分组和500组上限之前作用于全部匹配记录；计数为搜索后记录数，二进制使用十六进制原文。
    const search = input.search ? ' WHERE CASE typeof(' + column + ') WHEN \'blob\' THEN instr(lower(hex(' + column + ')), lower(?)) > 0 ELSE typeof(' + column + ') <> \'null\' AND instr(CAST(' + column + ' AS TEXT), ?) > 0 END' : '';
    if (input.search) parameters.push(input.search, input.search);
    // 代表TEXT须逐字节核对源编码；不能把驱动替换的坏字节当成真实U+FFFD再用于筛选。
    const projected = sqliteExactTextProjection(column);
    // 在数据库完整分组后按数值次数排序，再取500+1；同次数沿原类型／列序，不重排已返回的500组。
    const countOrder = input.order === 'count-desc' ? 'count(*) DESC, ' : input.order === 'count-asc' ? 'count(*) ASC, ' : '';
    const sql = 'SELECT typeof(' + column + '), ' + projected + ', count(*) FROM (' + source.sql + ') AS "__dbark_values"' + search + ' GROUP BY typeof(' + column + '), ' + column + ' ORDER BY ' + countOrder + 'typeof(' + column + '), ' + column + ' LIMIT ' + (limits.groups + 1), rows: SqliteValue[][] = [];
    const result = await driver.execute(sql, { parameters, maxRows: limits.groups + 1, batchRows: 100, maxBytes: limits.bytes,
      onStatement: statement => { control.check(); if (statement.index !== 0 || statement.columns.length !== 3) throw Error('SQLite不同值返回了非预期列'); },
      onBatch: batch => { control.check(); if (batch.index !== 0 || rows.length + batch.rows.length > limits.groups + 1) throw Error('SQLite不同值超过候选上限'); rows.push(...batch.rows); },
    });
    control.check(); if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== rows.length) throw Error('SQLite不同值结果超出完整读取预算，请缩小搜索范围');
    const values = rows.slice(0, limits.groups).map(row => {
      const [kind, value, count] = row; if (row.length !== 3 || !count || typeof count !== 'object' || count.type !== 'integer') throw Error('SQLite不同值计数无效');
      const item = value === null ? { kind: 'null' as const } : typeof value === 'string' ? { kind: 'text' as const, value } : value.type === 'integer' ? { kind: 'integer' as const, value: value.value } : value.type === 'real' ? { kind: 'real' as const, value: value.value } : { kind: 'blob' as const, value: Buffer.from(value.base64, 'base64').toString('hex') };
      if (kind !== item.kind) throw Error('SQLite不同值存储类型不一致'); return { value: item, count: count.value };
    });
    output = assertSqliteValueOptions({ request: input, values, truncated: rows.length > limits.groups }, input);
  } catch (reason) { failed = true; failure = reason; }
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); } catch (reason) { control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite不同值失败且回滚未确认', { cause: failure }) : reason; failed = true; }
  else if (!driver.isClosed && driver.transaction !== false) { const reason = Error('SQLite不同值原只读快照状态未知'); control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite不同值与收尾失败', { cause: failure }) : reason; failed = true; }
  if (failed) throw failure; control.check(); return output!;
}
