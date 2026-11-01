import { z } from 'zod';
import { sqliteTablePageSchema, type SqliteTablePageInput } from './sqliteTableBrowse';

export const sqliteTablePresetLimits = { name: 80, perTarget: 20, targets: 500, entries: 500, entryBytes: 1024 * 1024, totalBytes: 8 * 1024 * 1024 } as const;
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1), digest = z.string().regex(/^[a-f0-9]{64}$/);
export const sqliteTablePresetTargetSchema = z.object({ connectionId: sqliteTablePageSchema.shape.connectionId, database: z.literal('main'), table: sqliteTablePageSchema.shape.table }).strict();
/** 只保存有界条件、排序和页长；不包含偏移、SQL、文件路径、行数据或写入能力。 */
export const sqliteTablePresetQuerySchema = z.object({ limit: sqliteTablePageSchema.shape.limit, mode: sqliteTablePageSchema.shape.mode, filters: sqliteTablePageSchema.shape.filters, sort: sqliteTablePageSchema.shape.sort }).strict().superRefine((query, context) => {
  const parsed = sqliteTablePageSchema.safeParse({ ...query, connectionId: 'preset-validation', database: 'main', table: 'preset-validation', taskId: 'preset-validation', offset: 0 });
  if (!parsed.success) for (const issue of parsed.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
});
const name = sqliteTablePageSchema.shape.table.pipe(z.string().max(sqliteTablePresetLimits.name)).refine(value => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value), '方案名称不能为空或包含控制字符');
const entry = z.object({ id: z.string().uuid(), name, connectionDigest: digest, query: sqliteTablePresetQuerySchema }).strict().superRefine((value, context) => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > sqliteTablePresetLimits.entryBytes) context.addIssue({ code: 'custom', message: '单项SQLite方案超过1MiB上限' });
});
export const sqliteTablePresetDocumentSchema = z.object({ version: z.literal(1), target: sqliteTablePresetTargetSchema, revision, entries: z.array(entry).max(sqliteTablePresetLimits.perTarget) }).strict().superRefine((document, context) => {
  if (new Set(document.entries.map(value => value.id)).size !== document.entries.length || new Set(document.entries.map(value => value.name)).size !== document.entries.length) context.addIssue({ code: 'custom', message: 'SQLite方案名称或编号重复' });
});
export const sqliteTablePresetSourceSchema = z.object({ connectionRevision: revision, connectionDigest: digest }).strict();
export const sqliteTablePresetSnapshotSchema = sqliteTablePresetDocumentSchema.safeExtend({ source: sqliteTablePresetSourceSchema, bindingToken: z.string().uuid() });
const checked = sqliteTablePresetTargetSchema.extend({ expectedRevision: revision, source: sqliteTablePresetSourceSchema, bindingToken: z.string().uuid() }).strict();
export const sqliteTablePresetSaveSchema = checked.extend({ name, query: sqliteTablePresetQuerySchema, replaceId: z.string().uuid().optional() }).strict();
export const sqliteTablePresetSelectSchema = checked.extend({ id: z.string().uuid() }).strict();
export type SqliteTablePresetTarget = z.infer<typeof sqliteTablePresetTargetSchema>;
export type SqliteTablePresetQuery = Pick<SqliteTablePageInput, 'limit' | 'mode' | 'filters' | 'sort'>;
export type SqliteTablePresetDocument = z.infer<typeof sqliteTablePresetDocumentSchema>;
export type SqliteTablePresetSource = z.infer<typeof sqliteTablePresetSourceSchema>;
export type SqliteTablePresetStoredSnapshot = SqliteTablePresetDocument & { source: SqliteTablePresetSource };
export type SqliteTablePresetSnapshot = SqliteTablePresetStoredSnapshot & { bindingToken: string };
export type SqliteTablePresetSave = z.infer<typeof sqliteTablePresetSaveSchema>;
export type SqliteTablePresetSelect = z.infer<typeof sqliteTablePresetSelectSchema>;

/** 整份校验字段，包括停用条件；缺列不静默删除，也不执行元数据或数据查询。 */
export function validateSqlitePresetColumns(raw: unknown, columns: readonly string[]): SqliteTablePresetQuery {
  const query = sqliteTablePresetQuerySchema.parse(raw), names = new Set(columns);
  if (query.filters.some(filter => !names.has(filter.column)) || query.sort.some(sort => !names.has(sort.column))) throw Error('方案字段已不存在，未载入条件；请刷新结构或修改方案');
  return query;
}
