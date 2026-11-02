import { assertSqliteRelationships, sqliteRelationshipName as fold, type SqliteRelationshipsInput } from '../shared/sqliteRelationships';
import { buildRelationshipDiagram, type DiagramTable, type RelationshipDiagram } from './relationshipDiagram';
import { sqliteRelationshipsZh as text } from './locales/sqliteRelationships.zh-CN';

/** 原声明只转换为显示模型；没有读取的父表、不存在的列和隐式主键均不伪造为已验证。 */
export function captureSqliteRelationshipDiagram(raw: unknown, request: SqliteRelationshipsInput): RelationshipDiagram {
  const value = assertSqliteRelationships(raw, request), byName = new Map(value.tables.map(table => [fold(table.name), table]));
  const tables: DiagramTable[] = value.tables.map(table => ({
    sqlite: true, database: 'main', name: table.name,
    columns: table.columns.map(column => ({ name: column.name, type: column.type, nullable: !column.notNull, notNullDeclared: column.notNull })),
    primaryKey: table.columns.filter(column => column.primaryKey).sort((a, b) => a.primaryKey - b.primaryKey).map(column => column.name),
    foreignKeys: table.foreignKeys.map(key => {
      const parent = byName.get(fold(key.referencedTable)), implicit = key.referencedColumns === null;
      let warning: string | undefined;
      const declared = implicit ? parent?.columns.filter(column => column.primaryKey).sort((a, b) => a.primaryKey - b.primaryKey).map(column => column.name) ?? [] : key.referencedColumns!;
      const columns = key.columns.map(name => table.columns.find(column => fold(column.name) === fold(name))!.name);
      let referencedColumns = declared.map(name => parent?.columns.find(column => fold(column.name) === fold(name))?.name ?? name);
      if (implicit && !parent) warning = text.parentUnread;
      else if (implicit && declared.length !== columns.length) { warning = text.primaryMismatch; referencedColumns = []; }
      else if (parent && referencedColumns.some(name => !parent.columns.some(column => column.name === name))) warning = text.columnMissing;
      return { name: text.foreignKey(key.ordinal), columns, referencedDatabase: 'main', referencedTable: parent?.name ?? key.referencedTable, referencedColumns, onUpdate: key.onUpdate, onDelete: key.onDelete, ...(implicit ? { implicit: true } : {}), ...(warning ? { warning } : {}) };
    }),
  }));
  return buildRelationshipDiagram(tables);
}
