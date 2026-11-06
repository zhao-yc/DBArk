import type { DataRow, QueryResult } from '../shared/contracts';
import { createHash } from 'node:crypto';
import { sqliteTableBrowseLimits as limits, sqliteLastPagePosition, sqliteRowCountSchema, sqliteTablePageSchema, type SqliteTableColumn, type SqliteTableFilter, type SqliteTablePage, type SqliteTablePageInput } from '../shared/sqliteTableBrowse';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteCopySourceSchema, sqliteExportTextFunction, type SqliteColumn, type SqliteValue } from '../engine/sqlite/protocol';
import { sqliteWorkspaceValue } from './sqliteQuerySession';
import type { SqliteTableEditPage } from '../shared/sqliteTableEdit';
import { buildSqliteReadPlan, buildSqliteRelationPredicate, quoteSqliteIdentifier } from '../shared/sqliteReadSql';
export { quoteSqliteIdentifier } from '../shared/sqliteReadSql';

/** 仅供准确目录编译器生成的字段表达式使用；TEXT按源编码逐字节核对，其它存储类型原样返回。 */
export function sqliteExactTextProjection(column: string): string {
  return 'CASE WHEN typeof(' + column + ') = \'text\' THEN ' + sqliteExportTextFunction + '(' + column + ', CAST(' + column + ' AS BLOB)) ELSE ' + column + ' END';
}

export interface SqliteEditReadPlan {
  project?: (column: string) => string; extraColumn?: string;
  capture(rows: SqliteValue[][]): SqliteTableEditPage;
}

export interface SqliteTableBrowseControl {
  check(): void;
  beginCleanup(): void;
  cleanupFailed(reason: unknown): void;
  prepareEdit?(catalogue: SqliteTableCatalogue, driver: SqliteDriverSession): Promise<SqliteEditReadPlan>;
}

/** 本地边界取消只中止本次只读快照，不可冒充原生强退或退出确认。 */
export class SqliteTableBrowseCancelled extends Error {
  constructor() { super('SQLite表浏览已取消，未发布分页结果'); this.name = 'SqliteTableBrowseCancelled'; }
}

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
export function buildSqliteTableSelect(source: SqliteTablePageInput, columns: readonly SqliteTableColumn[], selected?: readonly string[], complete = false, project?: (qualifiedColumn: string) => string): { sql: string; parameters: SqliteValue[] } {
  const plan = buildSqliteReadPlan(source, columns, selected, complete, project);
  return { sql: plan.sql, parameters: plan.parameters.map(parameter => parameter.kind === 'storage-type' ? parameter.value : parameter.kind === 'count' ? { type: 'integer' as const, value: String(parameter.value) } : operand(parameter.value)) };
}

/** 编辑旧行校验复用同一固定谓词，不解析或截取已生成SQL。 */
export function buildSqliteTableRelationWhere(relation: import('../shared/sqliteTableBrowse').SqliteTableRelation): { sql: string; parameters: SqliteValue[] } {
  const parameters: SqliteValue[] = [], sql = buildSqliteRelationPredicate(relation, name => '"__dbark_source".' + quoteSqliteIdentifier(name), parameter => { if (parameter.kind !== 'operand') throw Error('SQLite关联参数类型无效'); parameters.push(operand(parameter.value)); return '?'; }); return { sql, parameters };
}

export interface SqliteTableCatalogue {
  kind: 'table' | 'view'; columns: SqliteTableColumn[]; schemaSql: string; schemaKey: string; xinfo: SqliteValue[][];
}
/** 精确SQL原文和按cid顺序的完整xinfo共同签名，包括隐藏/生成列及默认值，不能只比显示列名。 */
export function sqliteTableSchemaKey(schemaSql: string, xinfo: readonly (readonly SqliteValue[])[]): string {
  return createHash('sha256').update(JSON.stringify({ schemaSql, xinfo })).digest('hex');
}

/** 单条查询只收完整结果；截断不能伪造目录完整、页尾或没有下一页。 */
async function rows(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maxRows: number, control: SqliteTableBrowseControl, header?: (columns: SqliteColumn[]) => void, maxBytes: number = limits.resultBytes): Promise<SqliteValue[][]> {
  control.check(); const values: SqliteValue[][] = [];
  const result = await driver.execute(sql, {
    parameters, maxRows, batchRows: Math.min(200, maxRows), maxBytes,
    onStatement: statement => { control.check(); if (statement.index !== 0) throw Error('SQLite表浏览出现了额外语句'); header?.(statement.columns); },
    onBatch: batch => { control.check(); if (batch.index !== 0 || values.length + batch.rows.length > maxRows) throw Error('SQLite表浏览结果行超出本页预算'); values.push(...batch.rows); },
  });
  control.check();
  if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== values.length) throw Error('SQLite表浏览结果或元数据超过预算，无法确认完整分页；请减少每页行数或缩小范围');
  return values;
}

/** 关联范围必须在同一物理事务中核目录；无关联的既有读取不增加目录IO。 */
export async function verifySqliteTableScope(driver: SqliteDriverSession, input: { table: string; relation?: import('../shared/sqliteTableBrowse').SqliteTableRelation }, control: SqliteTableBrowseControl): Promise<void> {
  if (input.relation) { const { verifySqliteTableRelation } = await import('./sqliteTableRelation'); await verifySqliteTableRelation(driver, input.table, input.relation, control); }
}

/** 在调用方已打开的快照中计数，只投影常量，不解码无关列的原值。 */
export async function countSqliteMatchingRows(driver: SqliteDriverSession, input: Pick<SqliteTablePageInput, 'connectionId' | 'database' | 'table' | 'taskId' | 'mode' | 'filters' | 'relation'>, columns: readonly SqliteTableColumn[], control: SqliteTableBrowseControl): Promise<string> {
  await verifySqliteTableScope(driver, input, control);
  const { connectionId, database, table, taskId, mode, filters, relation } = input;
  const source = buildSqliteTableSelect({ connectionId, database, table, taskId, mode, filters, ...(relation ? { relation } : {}), sort: [], offset: 0, limit: 1 }, columns, [columns[0].name], true, () => '1');
  const result = await rows(driver, 'SELECT count(*) FROM (' + source.sql + ') AS "__dbark_count"', source.parameters, 1, control, columns => {
    if (columns.length !== 1) throw Error('SQLite匹配行数返回非预期列');
  }, 1024);
  const value = result[0]?.[0];
  if (result.length !== 1 || result[0].length !== 1 || !value || typeof value !== 'object' || value.type !== 'integer') throw Error('SQLite匹配行数返回不完整');
  return sqliteRowCountSchema.parse(value.value);
}

/** 调用方已BEGIN；精确目录和完整xinfo属于同一物理读快照，导出和分页共享来源指纹。 */
export async function readSqliteTableCatalogue(driver: SqliteDriverSession, table: string, control: SqliteTableBrowseControl, schema: 'main' | typeof sqliteCopySourceSchema = 'main'): Promise<SqliteTableCatalogue> {
  const actualSchema = schema === sqliteCopySourceSchema ? sqliteCopySourceSchema : 'main';
  const objects = await rows(driver, `SELECT name,type,sql FROM ${actualSchema}.sqlite_schema WHERE name = ? COLLATE BINARY AND type IN ('table','view') LIMIT 2`, [table], 2, control);
  if (objects.length !== 1 || objects[0][0] !== table || !['table', 'view'].includes(String(objects[0][1])) || typeof objects[0][2] !== 'string') throw Error('SQLite目标表或视图已不存在，请刷新对象目录');
  const catalogue = await rows(driver, `SELECT cid,name,type,"notnull",dflt_value,pk,hidden FROM pragma_table_xinfo(?, '${actualSchema}') ORDER BY cid LIMIT ?`, [table, { type: 'integer', value: String(limits.columns + 1) }], limits.columns + 1, control);
  if (!catalogue.length || catalogue.length > limits.columns) throw Error('SQLite表没有可浏览列或列目录超过预算');
  const columns: SqliteTableColumn[] = [];
  for (const row of catalogue) {
    const hidden = row[6] && typeof row[6] === 'object' && row[6].type === 'integer' ? row[6].value : undefined;
    if (row.length !== 7 || typeof row[1] !== 'string' || !row[1] || row[1].includes('\0') || typeof row[2] !== 'string' || !['0', '1', '2', '3'].includes(hidden ?? '')) throw Error('SQLite真实列目录无效，请刷新表结构');
    if (hidden !== '1') columns.push({ name: row[1], declaredType: row[2], ...(['2', '3'].includes(hidden!) ? { generated: true } : {}) });
  }
  if (!columns.length) throw Error('SQLite表没有可浏览列或列目录超过预算');
  return { kind: objects[0][1] as 'table' | 'view', columns, schemaSql: objects[0][2], schemaKey: sqliteTableSchemaKey(objects[0][2], catalogue), xinfo: catalogue };
}

/** BEGIN后的首个目录读取固定本页快照；元数据、筛选排序和行读取全部使用同一个只读物理连接。 */
export async function readSqliteTablePage(driver: SqliteDriverSession, source: SqliteTablePageInput, control: SqliteTableBrowseControl): Promise<SqliteTablePage> {
  const requested = sqliteTablePageSchema.parse(source), started = performance.now();
  let page: SqliteTablePage | undefined, failed = false, failure: unknown, editPlan: SqliteEditReadPlan | undefined, originalRows: SqliteValue[][] = [];
  try {
    control.check(); await driver.execute('BEGIN'); control.check();
    const catalogue = await readSqliteTableCatalogue(driver, requested.table, control), { kind, columns, schemaKey } = catalogue;
    await verifySqliteTableScope(driver, requested, control);
    const matchingRows = requested.lastPage ? await countSqliteMatchingRows(driver, requested, columns, control) : undefined;
    const last = matchingRows === undefined ? undefined : sqliteLastPagePosition(matchingRows, requested.limit);
    const input = last ? { ...requested, lastPage: undefined, offset: last.offset } : requested;
    editPlan = input.editing && control.prepareEdit ? await control.prepareEdit(catalogue, driver) : undefined;
    // 无编辑快照的只读页也必须核对原TEXT字节，不能将驱动替代字符作为真实数据交给网格。
    const request = buildSqliteTableSelect(input, columns, undefined, false, editPlan?.project ?? sqliteExactTextProjection), extra = editPlan?.extraColumn ? 1 : 0;
    if (editPlan?.extraColumn) request.sql = 'SELECT ' + editPlan.extraColumn + ' AS "__dbark_edit_locator", ' + request.sql.slice(7);
    const values = await rows(driver, request.sql, request.parameters, input.limit + 1, control, actual => {
      if (actual.length !== columns.length + extra || actual.slice(extra).some((column, index) => column.name !== columns[index].name)) throw Error('SQLite实际结果列与本页快照目录不一致');
    });
    if (last && values.length !== last.rows) throw Error('SQLite末页行数与同一快照内的计数不一致，请重试');
    originalRows = values.slice(0, input.limit);
    const result: QueryResult = {
      columns: columns.map((column, index) => ({ key: 'c' + index, name: column.name, type: 'SQLITE' })),
      rows: originalRows.map(original => { const row = original.slice(extra);
        if (row.length !== columns.length) throw Error('SQLite实际结果行与本页列目录不一致');
        return Object.fromEntries(row.map((value, index) => ['c' + index, sqliteWorkspaceValue(value)])) as DataRow;
      }), truncated: false, elapsedMs: 0, statement: request.sql,
    };
    // 每格一个协议类型码，不新增SQL；与去掉编辑定位列后的本页原值一一对应。
    const storageTypes = originalRows.map(row => row.slice(extra).map(value => value === null ? 'n' : typeof value === 'string' ? 't' : value.type === 'integer' ? 'i' : value.type === 'real' ? 'r' : 'b').join(''));
    page = { target: { connectionId: input.connectionId, database: 'main', table: input.table, kind }, columns, schemaKey, result, storageTypes, offset: input.offset, limit: input.limit, hasMore: values.length > input.limit, ...(matchingRows === undefined ? {} : { matchingRows }), ...(input.relation ? { relation: input.relation } : {}) };
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
  if (Buffer.byteLength(JSON.stringify({ result: page!.result, storageTypes: page!.storageTypes })) > limits.resultBytes) throw Error('SQLite表浏览结果对象超过16MiB预算，请减少每页行数或缩小范围');
  if (editPlan) page!.edit = editPlan.capture(originalRows);
  return page!;
}

/** 目录及派生读取使用同一快照，回滚完成前不交付结果。 */
export async function withSqliteReadSnapshot<T>(driver: SqliteDriverSession, control: SqliteTableBrowseControl, read: () => Promise<T>): Promise<T> {
  let output: T | undefined, failed = false, failure: unknown;
  try {
    control.check(); await driver.execute('BEGIN'); control.check();
    output = await read();
  } catch (reason) { failed = true; failure = reason; }
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); } catch (reason) { control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite只读操作失败且回滚未确认', { cause: failure }) : reason; failed = true; }
  else if (!driver.isClosed && driver.transaction !== false) { const reason = Error('SQLite只读操作原只读快照状态未知'); control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite只读操作与收尾失败', { cause: failure }) : reason; failed = true; }
  if (failed) throw failure; control.check(); return output!;
}
