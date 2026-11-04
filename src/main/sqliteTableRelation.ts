import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteTableRelation } from '../shared/sqliteTableBrowse';
import { sqliteIncomingColumns } from '../shared/sqliteIncoming';
import { sqliteRelationshipName as fold } from '../shared/sqliteRelationships';
import { readSqliteRelationshipTable } from './sqliteRelationships';
import type { SqliteTableBrowseControl } from './sqliteTableBrowse';

/** 每个读／写快照内重新核对双端目录，不能仅信任客户端给出的列名或旧schemaKey。 */
export async function verifySqliteTableRelation(driver: SqliteDriverSession, childTable: string, relation: SqliteTableRelation, control: SqliteTableBrowseControl): Promise<void> {
  const child = await readSqliteRelationshipTable(driver, childTable, control, relation.childSchemaKey), parent = await readSqliteRelationshipTable(driver, relation.parentTable, control, relation.parentSchemaKey);
  const key = child.foreignKeys.find(key => key.ordinal === relation.foreignKey);
  if (!key || fold(key.referencedTable) !== fold(parent.name)) throw Error('SQLite固定关联外键已变化，请重新从父记录打开');
  const columns = sqliteIncomingColumns(parent, key);
  if (!columns || JSON.stringify(columns) !== JSON.stringify(relation.parentColumns) || key.columns.length !== relation.childColumns.length || key.columns.some((name, i) => fold(name) !== fold(relation.childColumns[i])) || relation.childColumns.some(name => !child.columns.some(column => column.name === name))) throw Error('SQLite固定关联列映射已变化，请重新从父记录打开');
}
