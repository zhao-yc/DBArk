import { createHash } from 'node:crypto';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteTableCreateLimits as limits, type SqliteTableCreatePreviewInput } from '../shared/sqliteTableCreate';
import { readSqliteSchemaRows as read, rewriteSqliteCopyDefinition, sqliteSchemaExportLimits } from './sqliteSchemaExport';
import { quoteSqliteIdentifier as quote, readSqliteTableCatalogue, sqliteExactTextProjection, type SqliteTableBrowseControl } from './sqliteTableBrowse';

export type SqliteCopyDraft = Extract<SqliteTableCreatePreviewInput, { copy: unknown }>['copy'];
const fold = (name: string) => name.replace(/[A-Z]/g, letter => letter.toLowerCase());
const qualified = (name: string) => 'main.' + quote(name);

/** 从当前事务的原生目录生成复制计划，普通列及可访问的隐式 rowid 始终在 SQLite 内传递。 */
export async function prepareSqliteTableCopy(driver: SqliteDriverSession, copy: SqliteCopyDraft, control: SqliteTableBrowseControl) {
  const { source, name, mode } = copy;
  const info = await read(driver, "SELECT type,CAST(wr AS TEXT) FROM pragma_table_list WHERE schema='main' AND name=? COLLATE BINARY LIMIT 2", [source], 2, control);
  if (info.length !== 1 || info[0][0] !== 'table' || !['0', '1'].includes(String(info[0][1]))) throw Error('SQLite复制仅支持主库普通表');
  const catalogue = await readSqliteTableCatalogue(driver, source, control);
  const indexes = await read(driver, `SELECT ${sqliteExactTextProjection('name')},${sqliteExactTextProjection('sql')}
    FROM main.sqlite_schema WHERE tbl_name=? COLLATE BINARY AND type='index' AND sql IS NOT NULL ORDER BY name LIMIT ${limits.indexes + 1}`, [source], limits.indexes + 1, control);
  const [detail] = await read(driver, `SELECT ${sqliteExactTextProjection('sql')},CAST(rootpage AS TEXT),
    CAST((SELECT COUNT(DISTINCT id) FROM pragma_foreign_key_list(?,'main') WHERE "table"=? COLLATE NOCASE) AS TEXT),
    CAST(EXISTS(SELECT 1 FROM pragma_index_list(?,'main') WHERE origin='pk') AS TEXT)
    FROM main.sqlite_schema WHERE name=? COLLATE BINARY AND type='table' LIMIT 2`, [source, source, source, source], 2, control);
  if (catalogue.kind !== 'table' || !detail || detail[0] !== catalogue.schemaSql || typeof detail[1] !== 'string' ||
      !['0', '1'].includes(String(detail[3])) || indexes.length > limits.indexes) throw Error('SQLite表和索引定义不完整或超过复制预算');
  const table = rewriteSqliteCopyDefinition(catalogue.schemaSql, 'table', source, source, name, name);
  if (String(table.selfReferences) !== detail[2]) throw Error('SQLite自引用外键无法准确改写');
  let bytes = Buffer.byteLength(catalogue.schemaSql);
  const definitions = [table, ...indexes.map(([original, sql], index) => {
    if (typeof original !== 'string' || typeof sql !== 'string') throw Error('SQLite索引目录无效');
    bytes += Buffer.byteLength(sql);
    if (bytes > sqliteSchemaExportLimits.definitionBytes) throw Error('SQLite表和索引定义超过复制预算');
    const suffix = createHash('sha256').update(fold(name)).digest('hex').slice(0, 20) + '_' + (index + 1);
    return rewriteSqliteCopyDefinition(sql, 'index', original, source, name, 'idx_copy_' + suffix);
  })];
  const sql = definitions.map(definition => definition.sql);
  if (mode === 'data') {
    const columns = catalogue.columns.filter(column => !column.generated).map(column => column.name);
    const primary = catalogue.xinfo.filter(column => typeof column[5] === 'object' && column[5]?.type === 'integer' && column[5].value !== '0');
    const alias = primary.length === 1 && typeof primary[0][2] === 'string' && fold(primary[0][2]) === 'integer' && detail[3] === '0';
    if (info[0][1] === '0' && !alias) {
      const occupied = new Set(catalogue.columns.map(column => fold(column.name)));
      const rowid = ['rowid', '_rowid_', 'oid'].find(candidate => !occupied.has(candidate));
      if (!rowid) throw Error('SQLite来源的全部 rowid 别名已被字段覆盖，仅可复制结构');
      columns.unshift(rowid);
    }
    const fields = columns.map(quote).join(', ');
    sql.push(`INSERT OR ABORT INTO ${qualified(name)} (${fields}) SELECT ${fields} FROM ${qualified(source)}`);
  }
  return {
    sql, storedSql: definitions.map(definition => definition.stored),
    sourceKey: createHash('sha256').update(JSON.stringify([catalogue.schemaKey, detail[1], info[0][1], indexes])).digest('hex'),
  };
}

/** 复核两端行数以及本批原生写入回执，避免约束策略或异常表定义留下部分副本。 */
export async function verifySqliteTableCopy(driver: SqliteDriverSession, copy: SqliteCopyDraft, copiedRows: string | undefined, control: SqliteTableBrowseControl): Promise<void> {
  const select = (table: string) => '(SELECT CAST(count(*) AS TEXT) FROM ' + qualified(table) + ')';
  const rows = await read(driver, 'SELECT ' + select(copy.name) + (copy.mode === 'data' ? ', ' + select(copy.source) : ''), [], 1, control);
  if (rows.length !== 1 || (copy.mode === 'data' ? copiedRows === undefined || rows[0][0] !== copiedRows || rows[0][1] !== copiedRows : rows[0][0] !== '0'))
    throw Error('SQLite实际副本行数与本次复制回执不同，未提交');
}
