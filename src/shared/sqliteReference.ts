import { z } from 'zod';
import { sqliteTablePageSchema, assertSqliteStorageTypes, type SqliteTablePage } from './sqliteTableBrowse';
import { sqliteEditValueSchema } from './sqliteTableEdit';
import { sqliteRelationshipName as fold, sqliteRelationshipTableSchema, type SqliteRelationshipTable } from './sqliteRelationships';
import { validateResultExportData } from './resultExport';
import { sqliteResultCellMatches } from './sqliteResultStorage';

export const sqliteReferenceLimits = { active: 2, rows: 200, parts: 64, bytes: 16 * 1024 * 1024 } as const;
const base = { connectionId: sqliteTablePageSchema.shape.connectionId, database: z.literal('main'), table: sqliteTablePageSchema.shape.table,
  schemaKey: z.string().regex(/^[a-f0-9]{64}$/), taskId: z.string().uuid() };
export const sqliteReferenceSearchSchema = z.object({ column: sqliteTablePageSchema.shape.table, text: z.string().min(1).max(256).refine(value => !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) }).strict();
export type SqliteReferenceSearch = z.infer<typeof sqliteReferenceSearchSchema>;
const paging = { foreignKey: z.number().int().min(0).max(2147483647), offset: sqliteTablePageSchema.shape.offset,
  limit: z.number().int().min(1).max(sqliteReferenceLimits.rows), parentSchemaKey: z.string().regex(/^[a-f0-9]{64}$/).optional() };
export const sqliteReferenceInputSchema = z.discriminatedUnion('reference', [
  z.object({ ...base, reference: z.literal('catalog') }).strict(),
  z.object({ ...base, ...paging, reference: z.literal('page'), values: z.array(sqliteEditValueSchema).min(1).max(sqliteReferenceLimits.parts) }).strict(),
  z.object({ ...base, ...paging, reference: z.literal('candidates'), search: sqliteReferenceSearchSchema.optional() }).strict(),
]);
export type SqliteReferenceInput = z.infer<typeof sqliteReferenceInputSchema>;
export interface SqliteReferenceOutput { request: SqliteReferenceInput; source: SqliteRelationshipTable; parent?: SqliteRelationshipTable; referencedColumns?: string[]; page?: SqliteTablePage; }
const outputSchema = z.object({ request: sqliteReferenceInputSchema, source: sqliteRelationshipTableSchema,
  parent: sqliteRelationshipTableSchema.optional(), referencedColumns: z.array(sqliteTablePageSchema.shape.table).min(1).max(sqliteReferenceLimits.parts).optional(), page: z.unknown().optional() }).strict();

/** 目录和行页严格绑定本次请求；原值按完整结果及存储类型合同核对，不信任显示字符串。 */
export function assertSqliteReferenceOutput(raw: unknown, input: SqliteReferenceInput): SqliteReferenceOutput {
  const value = outputSchema.parse(raw), request = sqliteReferenceInputSchema.parse(input);
  if (JSON.stringify(value.request) !== JSON.stringify(request) || value.source.name !== request.table || new TextEncoder().encode(JSON.stringify(value)).length > sqliteReferenceLimits.bytes) throw Error('SQLite外键浏览回包与原请求不符或超过预算');
  if (request.reference === 'catalog') {
    if (value.page !== undefined || value.parent || value.referencedColumns) throw Error('SQLite外键目录不能夹带父记录');
  } else {
    const page = value.page as SqliteTablePage | undefined, key = value.source.foreignKeys.find(key => key.ordinal === request.foreignKey);
    if (!key || request.reference === 'page' && request.values.length !== key.columns.length || !value.parent || !value.referencedColumns || value.referencedColumns.length !== key.columns.length || !page || page.edit !== undefined
      || page.target.connectionId !== request.connectionId || page.target.database !== 'main' || page.target.kind !== 'table' || page.target.table !== value.parent.name
      || page.offset !== request.offset || page.limit !== request.limit || page.result.rows.length > request.limit || page.result.truncated !== false || typeof page.hasMore !== 'boolean'
      || !/^[a-f0-9]{64}$/.test(page.schemaKey) || request.parentSchemaKey !== undefined && page.schemaKey !== request.parentSchemaKey
      || page.columns.length !== page.result.columns.length || page.columns.some((column, i) => column.name !== page.result.columns[i].name)) throw Error('SQLite父记录分页或映射回包无效');
    const mapped = key.referencedColumns ?? value.parent.columns.filter(column => column.primaryKey).sort((a, b) => a.primaryKey - b.primaryKey).map(column => column.name);
    if (fold(value.parent.name) !== fold(key.referencedTable) || mapped.length !== value.referencedColumns.length || mapped.some((name, i) => fold(name) !== fold(value.referencedColumns![i]))) throw Error('SQLite父引用映射与原声明不同');
    validateResultExportData({ columns: page.result.columns.map(({ key, name }) => ({ key, name })), rows: page.result.rows, truncated: page.result.truncated });
    assertSqliteStorageTypes(page);
    if (!page.storageTypes || page.result.rows.some((row, i) => page.result.columns.some((column, c) => !sqliteResultCellMatches(page.storageTypes![i][c], Object.getOwnPropertyDescriptor(row, column.key)?.value)))) throw Error('SQLite父记录实际存储类型不匹配');
  }
  return value as SqliteReferenceOutput;
}
