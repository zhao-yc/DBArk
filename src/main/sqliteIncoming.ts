import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteValue, SqliteColumn } from '../engine/sqlite/protocol';
import { sqliteIncomingInputSchema, assertSqliteIncomingOutput, sqliteIncomingColumns, sqliteIncomingLimits as limits, type SqliteIncomingInput, type SqliteIncomingOutput, type SqliteIncomingReference } from '../shared/sqliteIncoming';
import { sqliteRelationshipName as fold } from '../shared/sqliteRelationships';
import { readSqliteRelationshipTable } from './sqliteRelationships';
import { readSqliteTableCatalogue, quoteSqliteIdentifier as quote, sqliteExactTextProjection, withSqliteReadSnapshot, type SqliteTableBrowseControl } from './sqliteTableBrowse';
import { sqliteWorkspaceValue } from './sqliteQuerySession';

/** 固定目录和参数化SELECT共用完整收集门；截断不冒充没有更多引用。 */
async function rows(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maximum: number, control: SqliteTableBrowseControl, header?: (columns: SqliteColumn[]) => void): Promise<SqliteValue[][]> {
  const result: SqliteValue[][] = []; control.check();
  const read = await driver.execute(sql, { parameters, maxRows: maximum, maxBytes: limits.bytes, batchRows: Math.min(200, maximum), onStatement: statement => { control.check(); if (statement.index !== 0) throw Error('SQLite子记录读取出现额外语句'); header?.(statement.columns); }, onBatch: batch => { control.check(); if (batch.index !== 0 || result.length + batch.rows.length > maximum) throw Error('SQLite子记录目录或分页超限'); result.push(...batch.rows); } });
  control.check(); if (read.statements.length !== 1 || read.statements[0].truncated || read.statements[0].rows !== result.length) throw Error('SQLite子记录目录或分页已截断，未交付部分结果'); return result;
}

/** 反向目录与所选子页都在独立只读快照；父列在比较左侧，子列去除亲和性，保留真正FK语义。 */
export async function readSqliteIncoming(driver: SqliteDriverSession, source: SqliteIncomingInput, control: SqliteTableBrowseControl): Promise<SqliteIncomingOutput> {
  const request = sqliteIncomingInputSchema.parse(source), started = performance.now();
  return withSqliteReadSnapshot(driver, control, async () => {
    const parent = await readSqliteRelationshipTable(driver, request.table, control, request.schemaKey);
    if (request.incoming === 'catalog') {
      const names = await rows(driver, "SELECT name FROM pragma_table_list WHERE schema='main' AND type='table' AND lower(substr(name,1,7))<>'sqlite_' ORDER BY name COLLATE BINARY LIMIT ?", [{ type: 'integer', value: String(limits.tables + 1) }], limits.tables + 1, control);
      if (names.length > limits.tables) throw Error('SQLite反向目录超过500张物理表，未发布部分引用');
      const references: SqliteIncomingReference[] = []; let columns = 0;
      for (const [name] of names) {
        if (typeof name !== 'string') throw Error('SQLite反向目录表名无效');
        const table = name === parent.name ? parent : await readSqliteRelationshipTable(driver, name, control); columns += table.columns.length;
        if (columns > limits.columns) throw Error('SQLite反向目录总列数超限');
        const keys = table.foreignKeys.filter(key => fold(key.referencedTable) === fold(parent.name));
        if (keys.length) { const catalogue = await readSqliteTableCatalogue(driver, name, control); for (const key of keys) references.push({ table: name, schemaKey: catalogue.schemaKey, key, referencedColumns: sqliteIncomingColumns(parent, key) }); }
        if (references.length > limits.references) throw Error('SQLite反向外键超过300条，未发布部分引用');
      }
      return assertSqliteIncomingOutput({ request, source: parent, references }, request);
    }
    const child = await readSqliteRelationshipTable(driver, request.childTable, control, request.childSchemaKey), catalogue = await readSqliteTableCatalogue(driver, request.childTable, control);
    const key = child.foreignKeys.find(key => key.ordinal === request.foreignKey);
    if (!key || fold(key.referencedTable) !== fold(parent.name)) throw Error('SQLite原反向外键已变化，请重新读取目录');
    const referencedColumns = sqliteIncomingColumns(parent, key);
    if (!referencedColumns || request.values.length !== referencedColumns.length) throw Error('SQLite反向外键父列无法解析，不猜测rowid');
    const childColumns = key.columns.map(name => child.columns.find(column => fold(column.name) === fold(name))?.name);
    if (childColumns.some(name => !name)) throw Error('SQLite反向外键子列不存在');
    const parameters: SqliteValue[] = request.values.map(value => value.kind === 'null' ? null : value.kind === 'text' ? value.value : value.kind === 'blob' ? { type: 'binary', base64: Buffer.from(value.value, 'hex').toString('base64') } : { type: value.kind, value: value.value });
    // EXISTS避免声明非唯一时重复子行。真实父列提供affinity/collation；+子列不把子列类型反向施加给父键。
    const predicates = referencedColumns.flatMap((name, i) => [quote('p') + '.' + quote(name) + ' = ?', quote('p') + '.' + quote(name) + ' = +' + quote('c') + '.' + quote(childColumns[i]!)]);
    const sql = 'SELECT ' + catalogue.columns.map(column => sqliteExactTextProjection(quote('c') + '.' + quote(column.name)) + ' AS ' + quote(column.name)).join(', ') + ' FROM "main".' + quote(child.name) + ' AS ' + quote('c')
      + ' WHERE EXISTS (SELECT 1 FROM "main".' + quote(parent.name) + ' AS ' + quote('p') + ' WHERE ' + predicates.join(' AND ') + ') LIMIT ? OFFSET ?';
    const values = await rows(driver, sql, [...parameters, { type: 'integer', value: String(request.limit + 1) }, { type: 'integer', value: String(request.offset) }], request.limit + 1, control,
      actual => { if (actual.length !== catalogue.columns.length || actual.some((column, i) => column.name !== catalogue.columns[i].name)) throw Error('SQLite子记录列目录不一致'); });
    const original = values.slice(0, request.limit), page = { target: { connectionId: request.connectionId, database: 'main' as const, table: child.name, kind: 'table' as const }, columns: catalogue.columns, schemaKey: catalogue.schemaKey, offset: request.offset, limit: request.limit, hasMore: values.length > request.limit,
      storageTypes: original.map(row => row.map(value => value === null ? 'n' : typeof value === 'string' ? 't' : value.type === 'integer' ? 'i' : value.type === 'real' ? 'r' : 'b').join('')),
      result: { columns: catalogue.columns.map((column, i) => ({ key: 'c' + i, name: column.name, type: 'SQLITE' })), rows: original.map(row => Object.fromEntries(row.map((value, i) => ['c' + i, sqliteWorkspaceValue(value)]))), statement: sql, elapsedMs: performance.now() - started, truncated: false } };
    return assertSqliteIncomingOutput({ request, source: parent, references: [{ table: child.name, schemaKey: catalogue.schemaKey, key, referencedColumns }], page }, request);
  });
}
