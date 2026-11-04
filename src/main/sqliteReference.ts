import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteValue, SqliteColumn } from '../engine/sqlite/protocol';
import { sqliteReferenceInputSchema, assertSqliteReferenceOutput, sqliteReferenceLimits as limits, type SqliteReferenceInput, type SqliteReferenceOutput } from '../shared/sqliteReference';
import { sqliteRelationshipName as fold } from '../shared/sqliteRelationships';
import { readSqliteRelationshipTable } from './sqliteRelationships';
import { readSqliteTableCatalogue, quoteSqliteIdentifier as quote, sqliteExactTextProjection, withSqliteReadSnapshot, type SqliteTableBrowseControl } from './sqliteTableBrowse';
import { sqliteWorkspaceValue } from './sqliteQuerySession';

/** 固定目录或由真实外键编译的SELECT；截断、额外语句及超限都不发布部分结果。 */
async function rows(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maximum: number, control: SqliteTableBrowseControl, header?: (columns: SqliteColumn[]) => void): Promise<SqliteValue[][]> {
  const result: SqliteValue[][] = []; control.check();
  const read = await driver.execute(sql, { parameters, maxRows: maximum, maxBytes: limits.bytes, batchRows: Math.min(200, maximum), onStatement: statement => { control.check(); if (statement.index !== 0) throw Error('SQLite父记录读取出现额外语句'); header?.(statement.columns); }, onBatch: batch => { control.check(); if (batch.index !== 0 || result.length + batch.rows.length > maximum) throw Error('SQLite父记录超出分页预算'); result.push(...batch.rows); } });
  control.check(); if (read.statements.length !== 1 || read.statements[0].truncated || read.statements[0].rows !== result.length) throw Error('SQLite父记录或目录已截断，未交付部分结果');
  return result;
}

/** 目录、父键解析与业务行共享独立只读快照；只按父列原亲和性／collation比较，不套typed筛选的typeof。 */
export async function readSqliteReference(driver: SqliteDriverSession, source: SqliteReferenceInput, control: SqliteTableBrowseControl): Promise<SqliteReferenceOutput> {
  const request = sqliteReferenceInputSchema.parse(source), started = performance.now();
  return withSqliteReadSnapshot(driver, control, async () => {
    const child = await readSqliteRelationshipTable(driver, request.table, control, request.schemaKey);
    if (request.reference === 'catalog') return assertSqliteReferenceOutput({ request, source: child }, request);
    const key = child.foreignKeys.find(key => key.ordinal === request.foreignKey);
    if (!key || request.values.length !== key.columns.length) throw Error('SQLite原外键或值映射已经变化，请重新读取');
    const candidates = await rows(driver, "SELECT name FROM main.sqlite_schema WHERE name=? COLLATE NOCASE AND type='table' LIMIT 2", [key.referencedTable], 2, control);
    const parentName = candidates[0]?.[0]; if (candidates.length !== 1 || typeof parentName !== 'string') throw Error('SQLite外键父表不存在或不是可浏览的物理表');
    const parent = await readSqliteRelationshipTable(driver, parentName, control), catalogue = await readSqliteTableCatalogue(driver, parentName, control);
    if (request.parentSchemaKey && request.parentSchemaKey !== catalogue.schemaKey) throw Error('SQLite父表结构已变化，请重新打开外键浏览');
    const declared = key.referencedColumns ?? parent.columns.filter(column => column.primaryKey).sort((a, b) => a.primaryKey - b.primaryKey).map(column => column.name);
    const names = declared.map(name => catalogue.columns.find(column => fold(column.name) === fold(name))?.name);
    if (names.length !== key.columns.length || names.some(name => !name)) throw Error('SQLite父表引用列或隐式主键映射不完整，不猜测rowid');
    const referencedColumns = names as string[], parameters: SqliteValue[] = request.values.map(value => value.kind === 'null' ? null : value.kind === 'text' ? value.value : value.kind === 'blob' ? { type: 'binary', base64: Buffer.from(value.value, 'hex').toString('base64') } : { type: value.kind, value: value.value });
    const sql = 'SELECT ' + catalogue.columns.map(column => sqliteExactTextProjection(quote(parentName) + '.' + quote(column.name)) + ' AS ' + quote(column.name)).join(', ') + ' FROM "main".' + quote(parentName)
      + ' WHERE ' + referencedColumns.map(name => quote(parentName) + '.' + quote(name) + ' = ?').join(' AND ') + ' LIMIT ? OFFSET ?';
    const values = await rows(driver, sql, [...parameters, { type: 'integer', value: String(request.limit + 1) }, { type: 'integer', value: String(request.offset) }], request.limit + 1, control,
      actual => { if (actual.length !== catalogue.columns.length || actual.some((column, i) => column.name !== catalogue.columns[i].name)) throw Error('SQLite父记录列目录不一致'); });
    const original = values.slice(0, request.limit);
    const page = { target: { connectionId: request.connectionId, database: 'main' as const, table: parentName, kind: 'table' as const }, columns: catalogue.columns, schemaKey: catalogue.schemaKey, offset: request.offset, limit: request.limit, hasMore: values.length > request.limit,
      storageTypes: original.map(row => row.map(value => value === null ? 'n' : typeof value === 'string' ? 't' : value.type === 'integer' ? 'i' : value.type === 'real' ? 'r' : 'b').join('')),
      result: { columns: catalogue.columns.map((column, i) => ({ key: 'c' + i, name: column.name, type: 'SQLITE' })), rows: original.map(row => Object.fromEntries(row.map((value, i) => ['c' + i, sqliteWorkspaceValue(value)]))), statement: sql, elapsedMs: performance.now() - started, truncated: false } };
    return assertSqliteReferenceOutput({ request, source: child, parent, referencedColumns, page }, request);
  });
}
