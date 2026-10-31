import type { DataRow, QueryResult } from '../shared/contracts';
import { sqliteTableBrowseLimits as limits, sqliteTablePageSchema, type SqliteTableColumn, type SqliteTableFilter, type SqliteTablePage, type SqliteTablePageInput } from '../shared/sqliteTableBrowse';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteColumn, SqliteValue } from '../engine/sqlite/protocol';
import { sqliteWorkspaceValue } from './sqliteQuerySession';

export interface SqliteTableBrowseControl {
  check(): void;
  beginCleanup(): void;
  cleanupFailed(reason: unknown): void;
}

/** 本地边界取消只中止本次只读快照，不可冒充原生强退或退出确认。 */
export class SqliteTableBrowseCancelled extends Error {
  constructor() { super('SQLite表浏览已取消，未发布分页结果'); this.name = 'SqliteTableBrowseCancelled'; }
}

/** 对已从准确快照目录取得的名称逐个转义，不接收任意SQL表达式。 */
function quote(name: string): string { return '"' + name.replaceAll('"', '""') + '"'; }

/** 类型参数先规范化成driver合同，整数不经Number，REAL负零不丢失。 */
function operand(value: NonNullable<SqliteTableFilter['value']>): SqliteValue {
  switch (value.kind) {
    case 'text': return value.value;
    case 'integer': return { type: 'integer', value: BigInt(value.value).toString() };
    case 'real': { const number = Number(value.value); return { type: 'real', value: Object.is(number, -0) ? '-0' : String(number) }; }
    case 'blob': return { type: 'binary', base64: Buffer.from(value.value, 'hex').toString('base64') };
  }
}

/** 每列都来自真实元数据白名单；运算符固定，所有筛选值及分页数字均使用typed绑定。 */
export function buildSqliteTableSelect(source: SqliteTablePageInput, columns: readonly SqliteTableColumn[]): { sql: string; parameters: SqliteValue[] } {
  const input = sqliteTablePageSchema.parse(source), names = new Set(columns.map(column => column.name));
  if (!columns.length || columns.length > limits.columns || names.size !== columns.length) throw Error('SQLite表没有可浏览列或列目录超过预算');
  const field = (name: string) => { if (!names.has(name)) throw Error('SQLite筛选或排序列已不存在，请刷新表结构'); return quote(name); };
  const parameters: SqliteValue[] = [];
  const operators = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;
  const filters = input.filters.map(filter => {
    const column = field(filter.column);
    if (filter.operator === 'isNull' || filter.operator === 'notNull') return column + (filter.operator === 'isNull' ? ' IS NULL' : ' IS NOT NULL');
    const value = filter.value!;
    parameters.push(value.kind === 'blob' ? 'blob' : value.kind, operand(value));
    const comparison = filter.operator === 'contains' ? 'instr(' + column + ', ?) > 0' : column + ' ' + operators[filter.operator] + ' ?';
    return '(typeof(' + column + ') = ? AND ' + comparison + ')';
  });
  const order = input.sort.map(sort => field(sort.column) + (sort.direction === 'asc' ? ' ASC' : ' DESC'));
  parameters.push({ type: 'integer', value: String(input.limit + 1) }, { type: 'integer', value: String(input.offset) });
  return { sql: 'SELECT ' + columns.map(column => quote(column.name)).join(', ') + ' FROM "main".' + quote(input.table)
    + (filters.length ? ' WHERE ' + filters.join(input.mode === 'and' ? ' AND ' : ' OR ') : '')
    + (order.length ? ' ORDER BY ' + order.join(', ') : '') + ' LIMIT ? OFFSET ?', parameters };
}

/** 单条查询只收完整结果；截断不能伪造目录完整、页尾或没有下一页。 */
async function rows(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maxRows: number, control: SqliteTableBrowseControl, header?: (columns: SqliteColumn[]) => void): Promise<SqliteValue[][]> {
  control.check(); const values: SqliteValue[][] = [];
  const result = await driver.execute(sql, {
    parameters, maxRows, batchRows: Math.min(200, maxRows), maxBytes: limits.resultBytes,
    onStatement: statement => { control.check(); if (statement.index !== 0) throw Error('SQLite表浏览出现了额外语句'); header?.(statement.columns); },
    onBatch: batch => { control.check(); if (batch.index !== 0 || values.length + batch.rows.length > maxRows) throw Error('SQLite表浏览结果行超出本页预算'); values.push(...batch.rows); },
  });
  control.check();
  if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== values.length) throw Error('SQLite表浏览结果或元数据超过预算，无法确认完整分页；请减少每页行数或缩小范围');
  return values;
}

/** BEGIN后的首个目录读取固定本页快照；元数据、筛选排序和行读取全部使用同一个只读物理连接。 */
export async function readSqliteTablePage(driver: SqliteDriverSession, source: SqliteTablePageInput, control: SqliteTableBrowseControl): Promise<SqliteTablePage> {
  const input = sqliteTablePageSchema.parse(source), started = performance.now();
  let page: SqliteTablePage | undefined, failed = false, failure: unknown;
  try {
    control.check(); await driver.execute('BEGIN'); control.check();
    const objects = await rows(driver, "SELECT name,type FROM main.sqlite_schema WHERE name = ? COLLATE BINARY AND type IN ('table','view') LIMIT 2", [input.table], 2, control);
    if (objects.length !== 1 || objects[0][0] !== input.table || !['table', 'view'].includes(String(objects[0][1]))) throw Error('SQLite目标表或视图已不存在，请刷新对象目录');
    const kind = objects[0][1] as 'table' | 'view';
    const catalogue = await rows(driver, "SELECT name,type,hidden FROM pragma_table_xinfo(?, 'main') WHERE hidden IN (0,2,3) ORDER BY cid LIMIT ?", [input.table, { type: 'integer', value: String(limits.columns + 1) }], limits.columns + 1, control);
    if (!catalogue.length || catalogue.length > limits.columns) throw Error('SQLite表没有可浏览列或列目录超过预算');
    const columns = catalogue.map(row => {
      const hidden = row[2] && typeof row[2] === 'object' && row[2].type === 'integer' ? row[2].value : undefined;
      if (row.length !== 3 || typeof row[0] !== 'string' || !row[0] || row[0].includes('\0') || typeof row[1] !== 'string' || !['0', '2', '3'].includes(hidden ?? '')) throw Error('SQLite真实列目录无效，请刷新表结构');
      return { name: row[0], declaredType: row[1] };
    });
    const request = buildSqliteTableSelect(input, columns);
    const values = await rows(driver, request.sql, request.parameters, input.limit + 1, control, actual => {
      if (actual.length !== columns.length || actual.some((column, index) => column.name !== columns[index].name)) throw Error('SQLite实际结果列与本页快照目录不一致');
    });
    const result: QueryResult = {
      columns: columns.map((column, index) => ({ key: 'c' + index, name: column.name, type: 'SQLITE' })),
      rows: values.slice(0, input.limit).map(row => {
        if (row.length !== columns.length) throw Error('SQLite实际结果行与本页列目录不一致');
        return Object.fromEntries(row.map((value, index) => ['c' + index, sqliteWorkspaceValue(value)])) as DataRow;
      }), truncated: false, elapsedMs: 0, statement: request.sql,
    };
    page = { target: { connectionId: input.connectionId, database: 'main', table: input.table, kind }, columns, result, offset: input.offset, limit: input.limit, hasMore: values.length > input.limit };
  } catch (reason) { failed = true; failure = reason; }
  // 即使边界取消也只回滚本次独立只读快照，绝不借用户查询标签的事务。
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) {
    try { await driver.execute('ROLLBACK'); }
    catch (reason) { control.cleanupFailed(reason); if (failed) failure = new AggregateError([failure, reason], 'SQLite表浏览失败且原读快照回滚未确认', { cause: failure }); else { failed = true; failure = reason; } }
  } else if (!driver.isClosed && driver.transaction !== false) {
    const reason = Error('SQLite表浏览原读快照事务状态未知，须确认原driver关闭'); control.cleanupFailed(reason);
    if (failed) failure = new AggregateError([failure, reason], 'SQLite表浏览失败且读快照状态未知', { cause: failure }); else { failed = true; failure = reason; }
  }
  if (failed) throw failure;
  control.check(); page!.result.elapsedMs = performance.now() - started;
  if (Buffer.byteLength(JSON.stringify(page!.result)) > limits.resultBytes) throw Error('SQLite表浏览结果对象超过16MiB预算，请减少每页行数或缩小范围');
  return page!;
}
