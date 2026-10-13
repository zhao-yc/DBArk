import type { DatabaseObject, ForeignKeyInfo, IndexInfo, ObjectKind, TableInfo } from '../shared/contracts';
import { execute, type ManagedConnection } from './connection';
import { mariaDefault, qualified, temporalDefault } from './sql';

/** 从服务器获取用户可访问的数据库，不在客户端猜测权限。 */
export async function databases(connection: ManagedConnection): Promise<string[]> {
  const { rows } = await execute<Record<string, string>[]>(connection, 'SHOW DATABASES');
  return rows.map(row => Object.values(row)[0]);
}

/** 分别查询表、例程、触发器和事件；information_schema 自身按数据库权限过滤。 */
export async function objects(connection: ManagedConnection, database: string): Promise<DatabaseObject[]> {
  const result: DatabaseObject[] = [];
  const tables = await execute<{ name: string; type: string }[]>(connection, 'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [database]);
  result.push(...tables.rows.map(row => ({ name: row.name, kind: row.type === 'VIEW' ? 'view' as const : 'table' as const })));
  const routines = await execute<{ name: string; type: string }[]>(connection, 'SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_NAME', [database]);
  result.push(...routines.rows.map(row => ({ name: row.name, kind: row.type === 'PROCEDURE' ? 'procedure' as const : 'function' as const })));
  const triggers = await execute<{ name: string }[]>(connection, 'SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME', [database]);
  result.push(...triggers.rows.map(row => ({ name: row.name, kind: 'trigger' as const })));
  const events = await execute<{ name: string }[]>(connection, 'SELECT EVENT_NAME AS name FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME', [database]);
  result.push(...events.rows.map(row => ({ name: row.name, kind: 'event' as const })));
  return result;
}

/** SHOW CREATE 的对象类型来自固定映射，名称独立引用。 */
export async function objectDdl(connection: ManagedConnection, database: string, name: string, kind: ObjectKind): Promise<string> {
  const types: Record<ObjectKind, string> = { table: 'TABLE', view: 'VIEW', procedure: 'PROCEDURE', function: 'FUNCTION', trigger: 'TRIGGER', event: 'EVENT' };
  if (!Object.hasOwn(types, kind)) throw new Error('不支持的数据库对象类型');
  const { rows } = await execute<Record<string, unknown>[]>(connection, `SHOW CREATE ${types[kind]} ${qualified(database, name)}`);
  const row = rows[0];
  if (!row) throw new Error('找不到数据库对象');
  const key = Object.keys(row).find(key => /^Create /i.test(key) || key === 'SQL Original Statement');
  if (!key || !row[key]) throw new Error('服务器未返回对象定义，请检查 SHOW CREATE 权限');
  return String(row[key]);
}

/** 只有不含 NULL 的唯一键才能作为可编辑行标识；函数索引不作为定位键。 */
export async function tableInfo(connection: ManagedConnection, database: string, table: string): Promise<TableInfo> {
  const columns = await execute<{ name: string; type: string; nullable: string; defaultValue: string | null; extra: string; comment: string }[]>(connection,
    'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [database, table]);
  if (!columns.rows.length) throw new Error('表不存在或当前用户无权查看');
  const stats = await execute<{ name: string; nonUnique: number; columnName: string | null; subPart: number | null; indexType: string; sortDirection: string | null }[]>(connection,
    'SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType, COLLATION AS sortDirection FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX', [database, table]);
  const indexMap = new Map<string, IndexInfo>();
  const unusableIndexes = new Set<string>();
  const unsupportedIndexes = new Set<string>();
  for (const row of stats.rows) {
    let index = indexMap.get(row.name);
    if (!index) { index = { name: row.name, unique: Number(row.nonUnique) === 0, columns: [] }; indexMap.set(row.name, index); }
    if (row.columnName) index.columns.push(row.columnName); else unusableIndexes.add(row.name);
    if (row.subPart !== null || row.indexType !== 'BTREE' || row.sortDirection === 'D') unsupportedIndexes.add(row.name);
  }
  const keys = await execute<{ name: string; columnName: string; referencedDatabase: string; referencedTable: string; referencedColumn: string; onUpdate: string; onDelete: string }[]>(connection,
    'SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_SCHEMA AS referencedDatabase, k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn, r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION', [database, table]);
  const keyMap = new Map<string, ForeignKeyInfo>();
  for (const row of keys.rows) {
    let key = keyMap.get(row.name);
    if (!key) { key = { name: row.name, columns: [], referencedDatabase: row.referencedDatabase, referencedTable: row.referencedTable, referencedColumns: [], onUpdate: row.onUpdate, onDelete: row.onDelete }; keyMap.set(row.name, key); }
    key.columns.push(row.columnName); key.referencedColumns.push(row.referencedColumn);
  }
  const tableResult = await execute<{ engine: string | null; tableType: string; charset: string | null; collation: string | null; comment: string }[]>(connection,
    'SELECT t.ENGINE AS engine, t.TABLE_TYPE AS tableType, t.TABLE_COLLATION AS collation, t.TABLE_COMMENT AS comment, c.CHARACTER_SET_NAME AS charset FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = ?', [database, table]);
  const maria = connection.status.dialect === 'mariadb';
  const modes = maria ? (await execute<{ mode: string }[]>(connection, 'SELECT @@SESSION.sql_mode AS mode')).rows[0].mode.split(',') : [];
  const mappedColumns = columns.rows.map(column => ({ ...column, defaultValue: maria ? mariaDefault(column.defaultValue, modes.includes('NO_BACKSLASH_ESCAPES')) : column.defaultValue, nullable: column.nullable === 'YES', generated: /(?:VIRTUAL|STORED|PERSISTENT) GENERATED/i.test(column.extra) }));
  const indexes = [...indexMap.values()];
  const candidate = indexes.find(index => index.name === 'PRIMARY') ?? indexes.find(index => index.unique && !unusableIndexes.has(index.name) && index.columns.length && index.columns.every(name => mappedColumns.some(column => column.name === name && !column.nullable)));
  const result: TableInfo = { database, name: table, columns: mappedColumns, indexes, foreignKeys: [...keyMap.values()], primaryKey: indexMap.get('PRIMARY')?.columns ?? [], editableKey: candidate && !unusableIndexes.has(candidate.name) ? candidate.columns : [], engine: tableResult.rows[0]?.engine ?? '', charset: tableResult.rows[0]?.charset ?? undefined, collation: tableResult.rows[0]?.collation ?? undefined, comment: tableResult.rows[0]?.comment ?? '', ddl: await objectDdl(connection, database, table, tableResult.rows[0]?.tableType === 'VIEW' ? 'view' : 'table') };
  // 内部标记防止普通设计器意外覆盖函数索引、前缀索引、全文索引等额外属性。
  const unsupportedDefaults = columns.rows.some(column => column.defaultValue !== null && !temporalDefault(column.defaultValue) && (maria ? !(column.defaultValue === 'NULL' || column.defaultValue.startsWith("'") || /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(column.defaultValue)) : /DEFAULT_GENERATED/i.test(column.extra)));
  Object.defineProperty(result, 'unsupportedDesign', { value: unsupportedIndexes.size > 0 || unusableIndexes.size > 0 || unsupportedDefaults || /\bINVISIBLE\b/i.test(result.ddl), enumerable: false });
  return result;
}
