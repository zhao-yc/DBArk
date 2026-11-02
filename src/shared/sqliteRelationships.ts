import { z } from 'zod';
import { sqliteTablePageSchema } from './sqliteTableBrowse';

/** 只读关系图的独立预算；超限整份失败，不交付缺边或缺列的图。 */
export const sqliteRelationshipsLimits = { tables: 40, columns: 2000, foreignKeys: 300, parts: 64, bytes: 8 * 1024 * 1024 } as const;
/** SQLite标识符只折叠ASCII大小写，不使用本机区域设置或Unicode大小写规则。 */
export function sqliteRelationshipName(value: string): string { return value.replace(/[A-Z]/g, character => character.toLowerCase()); }
const name = sqliteTablePageSchema.shape.table;
const names = z.array(name).max(sqliteRelationshipsLimits.parts);
export const sqliteRelationshipsInputSchema = z.object({
  connectionId: sqliteTablePageSchema.shape.connectionId, database: z.literal('main'), taskId: z.string().uuid(),
  anchor: z.object({ table: name, schemaKey: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  tables: z.array(name).min(1).max(sqliteRelationshipsLimits.tables),
}).strict().superRefine((value, context) => {
  if (new Set(value.tables.map(sqliteRelationshipName)).size !== value.tables.length || !value.tables.includes(value.anchor.table)) context.addIssue({ code: 'custom', message: '关系图须包含原表且不能重复选择表' });
});
const action = z.enum(['NO ACTION', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'CASCADE']);
const tableSchema = z.object({
  name, columns: z.array(z.object({ name, type: z.string().max(4096), notNull: z.boolean(), primaryKey: z.number().int().min(0).max(sqliteRelationshipsLimits.parts), hidden: z.number().int().min(0).max(3) }).strict()).min(1).max(sqliteRelationshipsLimits.columns),
  foreignKeys: z.array(z.object({ ordinal: z.number().int().min(0).max(2147483647), columns: names.min(1), referencedTable: name, referencedColumns: names.min(1).nullable(), onUpdate: action, onDelete: action }).strict()).max(sqliteRelationshipsLimits.foreignKeys),
}).strict();
export const sqliteRelationshipsOutputSchema = z.object({
  request: sqliteRelationshipsInputSchema, schemaVersion: z.string().regex(/^-?(?:0|[1-9][0-9]*)$/),
  tables: z.array(tableSchema).min(1).max(sqliteRelationshipsLimits.tables),
}).strict();
export type SqliteRelationshipsInput = z.infer<typeof sqliteRelationshipsInputSchema>;
export type SqliteRelationshipsOutput = z.infer<typeof sqliteRelationshipsOutputSchema>;
export type SqliteRelationshipTable = SqliteRelationshipsOutput['tables'][number];

/** 再核对准确请求、目录完整性与总预算；不把合法但未证实的父引用当成已验证约束。 */
export function assertSqliteRelationships(raw: unknown, request: SqliteRelationshipsInput): SqliteRelationshipsOutput {
  const value = sqliteRelationshipsOutputSchema.parse(raw), limits = sqliteRelationshipsLimits;
  if (JSON.stringify(value.request) !== JSON.stringify(sqliteRelationshipsInputSchema.parse(request)) || value.tables.length !== request.tables.length || value.tables.some((table, index) => table.name !== request.tables[index]) || new TextEncoder().encode(JSON.stringify(value)).length > limits.bytes || value.tables.reduce((sum, table) => sum + table.columns.length, 0) > limits.columns || value.tables.reduce((sum, table) => sum + table.foreignKeys.length, 0) > limits.foreignKeys) throw Error('SQLite关系图回包与原请求不符或超过预算');
  for (const table of value.tables) {
    const known = new Set(table.columns.map(column => sqliteRelationshipName(column.name))), primary = table.columns.map(column => column.primaryKey).filter(Boolean).sort((a, b) => a - b);
    if (known.size !== table.columns.length || primary.some((ordinal, index) => ordinal !== index + 1) || new Set(table.foreignKeys.map(key => key.ordinal)).size !== table.foreignKeys.length) throw Error('SQLite关系图列、主键或外键编号不完整');
    for (const key of table.foreignKeys) if (key.columns.some(column => !known.has(sqliteRelationshipName(column))) || key.referencedColumns !== null && key.columns.length !== key.referencedColumns.length) throw Error('SQLite关系图外键映射不完整');
  }
  return value;
}
