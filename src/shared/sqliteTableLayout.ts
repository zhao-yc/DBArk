import { z } from 'zod';
import { sqliteTablePageSchema, sqliteTableBrowseLimits } from './sqliteTableBrowse';
import { tablePreferencesShapeFor, preferenceInput, tablePreferencesLimits, type TablePreferences } from './tablePreferences';
import { sqliteTablePresetTargetSchema, sqliteTablePresetSourceSchema } from './sqliteTablePresets';

export const sqliteLayoutTargetSchema = sqliteTablePresetTargetSchema;
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
const shape = tablePreferencesShapeFor(sqliteTablePageSchema.shape.table, sqliteTableBrowseLimits.columns);
/** 名称沿SQLite的512字符/Unicode合同；先核纯自有描述符，再读取列布局。 */
export const sqliteLayoutPreferencesSchema = z.unknown().transform((raw, context) => {
  try { const value = shape.parse(preferenceInput(raw)); if (value.columns.length && value.columns.every(column => column.hidden)) throw Error('至少保留一个可见字段'); return value; }
  catch (reason) { context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : 'SQLite列布局无效' }); return z.NEVER; }
});
export const sqliteLayoutDocumentSchema = z.object({ version: z.literal(1), target: sqliteLayoutTargetSchema, revision, preferences: sqliteLayoutPreferencesSchema.nullable(), connectionDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().superRefine((value, context) => {
  if ((value.preferences !== null) !== (value.connectionDigest !== undefined)) context.addIssue({ code: 'custom', message: 'SQLite列布局来源不完整' });
  const stored = { version: value.version, target: value.target, revision: value.revision, preferences: value.preferences, ...(value.connectionDigest === undefined ? {} : { connectionDigest: value.connectionDigest }) };
  if (new TextEncoder().encode(JSON.stringify(stored)).length > tablePreferencesLimits.entryBytes) context.addIssue({ code: 'custom', message: 'SQLite列布局超过512KiB上限' });
});
export const sqliteLayoutSnapshotSchema = sqliteLayoutDocumentSchema.safeExtend({ source: sqliteTablePresetSourceSchema, bindingToken: z.string().uuid() });
export const sqliteLayoutResetSchema = sqliteLayoutTargetSchema.extend({ expectedRevision: revision, source: sqliteTablePresetSourceSchema, bindingToken: z.string().uuid() }).strict();
export const sqliteLayoutSaveSchema = sqliteLayoutResetSchema.extend({ preferences: sqliteLayoutPreferencesSchema }).strict();
export type SqliteLayoutTarget = z.infer<typeof sqliteLayoutTargetSchema>;
export type SqliteLayoutDocument = z.infer<typeof sqliteLayoutDocumentSchema>;
export type SqliteLayoutStoredSnapshot = SqliteLayoutDocument & { source: z.infer<typeof sqliteTablePresetSourceSchema> };
export type SqliteLayoutSnapshot = z.infer<typeof sqliteLayoutSnapshotSchema>;
export type SqliteLayoutInput = z.infer<typeof sqliteLayoutResetSchema>;
export type SqliteLayoutSave = z.infer<typeof sqliteLayoutSaveSchema>;

/** 仅按精确名称调和；删除列移除，新列追加，不借Unicode折叠把另一列当成原列。 */
export function reconcileSqliteLayout(names: readonly string[], preferences: TablePreferences | null): TablePreferences {
  const available = new Set(names), used = new Set<string>();
  const columns = (preferences?.columns ?? []).filter(column => available.has(column.name) && !used.has(column.name) && !!used.add(column.name)).map(column => ({ ...column }));
  for (const name of names) if (!used.has(name)) { used.add(name); columns.push({ name, hidden: false }); }
  if (columns.length && columns.every(column => column.hidden)) columns[0].hidden = false;
  const boundary = preferences?.frozenThrough;
  return { version: 1, columns, ...(boundary !== undefined && columns.some(column => column.name === boundary && !column.hidden) ? { frozenThrough: boundary } : {}), ...(preferences?.rowHeight === undefined ? {} : { rowHeight: preferences.rowHeight }) };
}
/** 只产生显示映射，保留原物理列编号；行数据与编辑快照始终不投影或重排。 */
export function sqliteLayoutProjection(names: readonly string[], preferences: TablePreferences): { index: number; width?: number; frozen: boolean }[] {
  const value = reconcileSqliteLayout(names, preferences), visible = value.columns.filter(column => !column.hidden), boundary = visible.findIndex(column => column.name === value.frozenThrough);
  return visible.map((column, position) => ({ index: names.indexOf(column.name), ...(column.width === undefined ? {} : { width: column.width }), frozen: boundary >= 0 && position <= boundary }));
}
