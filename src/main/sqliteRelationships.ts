import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteValue } from '../engine/sqlite/protocol';
import { assertSqliteRelationships, sqliteRelationshipsInputSchema, sqliteRelationshipsLimits as limits, type SqliteRelationshipsInput, type SqliteRelationshipsOutput, type SqliteRelationshipTable } from '../shared/sqliteRelationships';
import { readSqliteTableCatalogue, type SqliteTableBrowseControl } from './sqliteTableBrowse';

/** 目录整数必须是driver保留的精确整数原文；只在有界目录序号上转Number。 */
function integer(value: SqliteValue, maximum: number): number {
  if (!value || typeof value !== 'object' || value.type !== 'integer' || !/^(?:0|[1-9][0-9]*)$/.test(value.value) || BigInt(value.value) > BigInt(maximum)) throw Error('SQLite关系图目录序号无效');
  return Number(value.value);
}
/** 固定目录SQL、位置参数、有界收集，驱动截断或多语句均不能冒充完整结构。 */
async function rows(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maximum: number, control: SqliteTableBrowseControl): Promise<SqliteValue[][]> {
  control.check(); const values: SqliteValue[][] = [];
  const result = await driver.execute(sql, { parameters, maxRows: maximum, batchRows: Math.min(200, maximum), maxBytes: limits.bytes,
    onStatement: statement => { control.check(); if (statement.index !== 0) throw Error('SQLite关系图出现额外语句'); },
    onBatch: batch => { control.check(); if (batch.index !== 0 || values.length + batch.rows.length > maximum) throw Error('SQLite关系图目录超限'); values.push(...batch.rows); },
  });
  control.check(); if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== values.length) throw Error('SQLite关系图目录截断，未发布部分结构');
  return values;
}

/** 所选main物理表共享一个独立只读快照；不读取业务行、不检查全库数据、不借用用户事务。 */
export async function readSqliteRelationships(driver: SqliteDriverSession, source: SqliteRelationshipsInput, control: SqliteTableBrowseControl): Promise<SqliteRelationshipsOutput> {
  const request = sqliteRelationshipsInputSchema.parse(source);
  let value: SqliteRelationshipsOutput | undefined, failed = false, failure: unknown;
  try {
    control.check(); await driver.execute('BEGIN'); control.check();
    const version = await rows(driver, 'PRAGMA main.schema_version', [], 1, control), rawVersion = version[0]?.[0];
    if (version.length !== 1 || version[0].length !== 1 || !rawVersion || typeof rawVersion !== 'object' || rawVersion.type !== 'integer') throw Error('SQLite关系图结构版本无效');
    const tables: SqliteRelationshipTable[] = [];
    for (const name of request.tables) {
      const catalogue = await readSqliteTableCatalogue(driver, name, control);
      if (catalogue.kind !== 'table' || /^sqlite_/i.test(name)) throw Error('SQLite关系图只接受main中的用户物理表');
      if (name === request.anchor.table && catalogue.schemaKey !== request.anchor.schemaKey) throw Error('SQLite原表结构已变化，请刷新表页后重新打开关系图');
      const columns = catalogue.xinfo.map(row => ({ name: row[1] as string, type: row[2] as string, notNull: !!integer(row[3], 1), primaryKey: integer(row[5], limits.parts), hidden: integer(row[6], 3) }));
      const foreignRows = await rows(driver, 'SELECT id,seq,"table","from","to",on_update,on_delete FROM pragma_foreign_key_list(?, \'main\') ORDER BY id,seq LIMIT ?', [name, { type: 'integer', value: String(limits.foreignKeys * limits.parts + 1) }], limits.foreignKeys * limits.parts + 1, control);
      if (foreignRows.length > limits.foreignKeys * limits.parts) throw Error('SQLite关系图外键目录超限');
      const foreignKeys: SqliteRelationshipTable['foreignKeys'] = [];
      for (const row of foreignRows) {
        if (row.length !== 7 || typeof row[2] !== 'string' || typeof row[3] !== 'string' || row[4] !== null && typeof row[4] !== 'string') throw Error('SQLite关系图外键目录无效');
        const ordinal = integer(row[0], 2147483647), sequence = integer(row[1], limits.parts - 1);
        let key = foreignKeys.at(-1);
        if (!key || key.ordinal !== ordinal) { if (foreignKeys.length >= limits.foreignKeys || sequence !== 0) throw Error('SQLite关系图外键目录不完整或超限'); key = { ordinal, columns: [], referencedTable: row[2], referencedColumns: row[4] === null ? null : [], onUpdate: row[5] as SqliteRelationshipTable['foreignKeys'][number]['onUpdate'], onDelete: row[6] as SqliteRelationshipTable['foreignKeys'][number]['onDelete'] }; foreignKeys.push(key); }
        if (sequence !== key.columns.length || row[2] !== key.referencedTable || row[5] !== key.onUpdate || row[6] !== key.onDelete || (row[4] === null) !== (key.referencedColumns === null)) throw Error('SQLite关系图复合外键映射不完整');
        key.columns.push(row[3]); if (key.referencedColumns) key.referencedColumns.push(row[4] as string);
      }
      tables.push({ name, columns, foreignKeys });
      // 总预算在每张表后立即检查，后继表不继续消耗资源。
      if (tables.reduce((sum, table) => sum + table.columns.length, 0) > limits.columns || tables.reduce((sum, table) => sum + table.foreignKeys.length, 0) > limits.foreignKeys) throw Error('SQLite关系图总目录超限');
    }
    value = assertSqliteRelationships({ request, schemaVersion: rawVersion.value, tables }, request);
  } catch (reason) { failed = true; failure = reason; }
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) {
    try { await driver.execute('ROLLBACK'); }
    catch (reason) { control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite关系图失败且原只读快照回滚未确认', { cause: failure }) : reason; failed = true; }
  } else if (!driver.isClosed && driver.transaction !== false) {
    const reason = Error('SQLite关系图原读快照状态未知，须确认原driver退出'); control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], reason.message, { cause: failure }) : reason; failed = true;
  }
  if (failed) throw failure; control.check(); return value!;
}
