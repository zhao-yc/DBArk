import { z } from 'zod';
import { sqliteTablePageSchema, assertSqliteStorageTypes, type SqliteTablePage } from './sqliteTableBrowse';
import { sqliteEditValueSchema } from './sqliteTableEdit';
import { sqliteRelationshipName as fold, sqliteRelationshipTableSchema, type SqliteRelationshipTable } from './sqliteRelationships';
import { validateResultExportData } from './resultExport';
import { sqliteResultCellMatches } from './sqliteResultStorage';

/** 扫描有界目录而不扫描业务数据；超预算拒绝整份目录，不静默遗漏引用。 */
export const sqliteIncomingLimits = { active: 2, tables: 500, columns: 20000, references: 300, rows: 200, bytes: 16 * 1024 * 1024 } as const;
const name = sqliteTablePageSchema.shape.table, hash = z.string().regex(/^[a-f0-9]{64}$/);
const base = { connectionId: sqliteTablePageSchema.shape.connectionId, database: z.literal('main'), table: name, schemaKey: hash, taskId: z.string().uuid() };
export const sqliteIncomingInputSchema = z.discriminatedUnion('incoming', [
  z.object({ ...base, incoming: z.literal('catalog') }).strict(),
  z.object({ ...base, incoming: z.literal('page'), childTable: name, childSchemaKey: hash, foreignKey: z.number().int().min(0).max(2147483647),
    values: z.array(sqliteEditValueSchema).min(1).max(64), offset: sqliteTablePageSchema.shape.offset, limit: z.number().int().min(1).max(sqliteIncomingLimits.rows) }).strict(),
]);
const referenceSchema = z.object({ table: name, schemaKey: hash, key: sqliteRelationshipTableSchema.shape.foreignKeys.element,
  referencedColumns: z.array(name).min(1).max(64).nullable() }).strict();
export type SqliteIncomingInput = z.infer<typeof sqliteIncomingInputSchema>;
export type SqliteIncomingReference = z.infer<typeof referenceSchema>;
export interface SqliteIncomingOutput { request: SqliteIncomingInput; source: SqliteRelationshipTable; references: SqliteIncomingReference[]; page?: SqliteTablePage; }
const outputSchema = z.object({ request: sqliteIncomingInputSchema, source: sqliteRelationshipTableSchema, references: z.array(referenceSchema).max(sqliteIncomingLimits.references), page: z.unknown().optional() }).strict();

/** 省略父列只认完整声明主键；无效声明仍列在目录中，明确标为无法解析，不猜rowid。 */
export function sqliteIncomingColumns(parent: SqliteRelationshipTable, key: SqliteIncomingReference['key']): string[] | null {
  if (fold(parent.name) !== fold(key.referencedTable)) throw Error('SQLite反向外键目标与父表不同');
  const primary = parent.columns.filter(column => column.primaryKey).sort((a, b) => a.primaryKey - b.primaryKey);
  if (!key.referencedColumns && primary.some((column, i) => column.primaryKey !== i + 1)) return null;
  const names = key.referencedColumns ?? primary.map(column => column.name), mapped = names.map(name => parent.columns.find(column => fold(column.name) === fold(name))?.name);
  return mapped.length === key.columns.length && mapped.every(Boolean) && new Set(mapped.map(name => fold(name!))).size === mapped.length ? mapped as string[] : null;
}

/** 请求、每条声明及只读子页共同校验；错目标、旧结构、截断或错实际存储码均不交付。 */
export function assertSqliteIncomingOutput(raw: unknown, input: SqliteIncomingInput): SqliteIncomingOutput {
  const value = outputSchema.parse(raw), request = sqliteIncomingInputSchema.parse(input);
  if (JSON.stringify(value.request) !== JSON.stringify(request) || value.source.name !== request.table || new TextEncoder().encode(JSON.stringify(value)).length > sqliteIncomingLimits.bytes) throw Error('SQLite子记录回包与原请求不符或超过预算');
  const seen = new Set<string>();
  for (const entry of value.references) {
    const identity = JSON.stringify([fold(entry.table), entry.key.ordinal]);
    if (seen.has(identity) || JSON.stringify(entry.referencedColumns) !== JSON.stringify(sqliteIncomingColumns(value.source, entry.key))) throw Error('SQLite反向外键重复或父列映射不完整'); seen.add(identity);
  }
  if (request.incoming === 'catalog') { if (value.page !== undefined) throw Error('SQLite反向目录不能夹带业务行'); }
  else {
    const entry = value.references[0], page = value.page as SqliteTablePage | undefined;
    if (value.references.length !== 1 || !entry.referencedColumns || entry.table !== request.childTable || entry.schemaKey !== request.childSchemaKey || entry.key.ordinal !== request.foreignKey || request.values.length !== entry.key.columns.length
      || !page || page.edit !== undefined || page.target.connectionId !== request.connectionId || page.target.database !== 'main' || page.target.kind !== 'table' || page.target.table !== request.childTable || page.schemaKey !== request.childSchemaKey
      || page.offset !== request.offset || page.limit !== request.limit || page.result.rows.length > request.limit || page.result.truncated !== false || typeof page.hasMore !== 'boolean'
      || page.columns.length !== page.result.columns.length || page.columns.some((column, i) => column.name !== page.result.columns[i].name)) throw Error('SQLite关联子页目标、结构或分页不匹配');
    validateResultExportData({ columns: page.result.columns.map(({ key, name }) => ({ key, name })), rows: page.result.rows, truncated: page.result.truncated }); assertSqliteStorageTypes(page);
    if (!page.storageTypes || page.result.rows.some((row, i) => page.result.columns.some((column, c) => !sqliteResultCellMatches(page.storageTypes![i][c], Object.getOwnPropertyDescriptor(row, column.key)?.value)))) throw Error('SQLite子记录实际存储类型不匹配');
  }
  return value as SqliteIncomingOutput;
}
