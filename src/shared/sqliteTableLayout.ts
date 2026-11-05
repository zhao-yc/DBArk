import { z } from 'zod';
import { sqliteTablePageSchema, sqliteTableBrowseLimits } from './sqliteTableBrowse';
import { strictTableLayoutPreferences, tablePreferencesLimits, type TablePreferences, type TablePreferenceTarget } from './tablePreferences';
import { sqliteTablePresetTargetSchema, sqliteTablePresetSourceSchema } from './sqliteTablePresets';
import { postgresTablePresetListSchema } from './tablePresets';
import { postgresTableLayoutPreferencesSchema } from './postgresTable';

const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);

/** 两个驱动使用各自的目标及名称限制，复用显示设置、CAS 和持久化预算。 */
function layoutSchemas<T extends TablePreferenceTarget>(
  target: z.ZodType<T>, preferences: ReturnType<typeof strictTableLayoutPreferences>,
) {
  const document = z.object({ version: z.literal(1), target, revision, preferences: preferences.nullable(), connectionDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().superRefine((value, context) => {
    if ((value.preferences !== null) !== (value.connectionDigest !== undefined)) context.addIssue({ code: 'custom', message: '列布局来源不完整' });
    const stored = { version: value.version, target: value.target, revision: value.revision, preferences: value.preferences, connectionDigest: value.connectionDigest };
    if (new TextEncoder().encode(JSON.stringify(stored)).length > tablePreferencesLimits.entryBytes) context.addIssue({ code: 'custom', message: '列布局超过512KiB上限' });
  });
  const snapshot = document.safeExtend({ source: sqliteTablePresetSourceSchema, bindingToken: z.string().uuid() });
  return { target, preferences, document, snapshot };
}
export const sqliteLayoutTargetSchema = sqliteTablePresetTargetSchema;
const sqliteSchemas = layoutSchemas(sqliteLayoutTargetSchema, strictTableLayoutPreferences(sqliteTablePageSchema.shape.table, sqliteTableBrowseLimits.columns));
export const { preferences: sqliteLayoutPreferencesSchema, document: sqliteLayoutDocumentSchema, snapshot: sqliteLayoutSnapshotSchema } = sqliteSchemas;
const checked = { expectedRevision: revision, source: sqliteTablePresetSourceSchema, bindingToken: z.string().uuid() };
export const sqliteLayoutResetSchema = sqliteLayoutTargetSchema.extend(checked).strict();
export const sqliteLayoutSaveSchema = sqliteLayoutResetSchema.extend({ preferences: sqliteLayoutPreferencesSchema }).strict();

const postgresLayout = layoutSchemas(postgresTablePresetListSchema, postgresTableLayoutPreferencesSchema);
const postgresReset = postgresTablePresetListSchema.extend(checked).strict();
export const postgresLayoutSchemas = { ...postgresLayout, reset: postgresReset, save: postgresReset.extend({ preferences: postgresLayout.preferences }).strict() };
export type PostgresLayoutTarget = z.infer<typeof postgresLayoutSchemas.target>;
export type PostgresLayoutDocument = z.infer<typeof postgresLayoutSchemas.document>;
export type PostgresLayoutStoredSnapshot = PostgresLayoutDocument & { source: z.infer<typeof sqliteTablePresetSourceSchema> };
export type PostgresLayoutSnapshot = z.infer<typeof postgresLayoutSchemas.snapshot>;
export type PostgresLayoutInput = z.infer<typeof postgresLayoutSchemas.reset>;
export type PostgresLayoutSave = z.infer<typeof postgresLayoutSchemas.save>;
export type SqliteLayoutTarget = z.infer<typeof sqliteLayoutTargetSchema>;
export type SqliteLayoutDocument = z.infer<typeof sqliteLayoutDocumentSchema>;
export type SqliteLayoutStoredSnapshot = SqliteLayoutDocument & { source: z.infer<typeof sqliteTablePresetSourceSchema> };
export type SqliteLayoutSnapshot = z.infer<typeof sqliteLayoutSnapshotSchema>;
export type SqliteLayoutInput = z.infer<typeof sqliteLayoutResetSchema>;
export type SqliteLayoutSave = z.infer<typeof sqliteLayoutSaveSchema>;
export type TableLayoutSnapshot<T extends TablePreferenceTarget> = Omit<PostgresLayoutSnapshot, 'target'> & { target: T };
export type TableLayoutInput<T extends TablePreferenceTarget> = Omit<PostgresLayoutInput, keyof TablePreferenceTarget> & T;
export type TableLayoutSave<T extends TablePreferenceTarget> = TableLayoutInput<T> & { preferences: TablePreferences };

/** 仅按精确名称调和；删除列移除，新列追加，不借Unicode折叠把另一列当成原列。 */
export function reconcileExactTableLayout(names: readonly string[], preferences: TablePreferences | null): TablePreferences {
  const available = new Set(names), used = new Set<string>();
  const columns = (preferences?.columns ?? []).filter(column => available.has(column.name) && !used.has(column.name) && !!used.add(column.name)).map(column => ({ ...column }));
  for (const name of names) if (!used.has(name)) { used.add(name); columns.push({ name, hidden: false }); }
  if (columns.length && columns.every(column => column.hidden)) columns[0].hidden = false;
  const boundary = preferences?.frozenThrough;
  return { version: 1, columns, ...(boundary !== undefined && columns.some(column => column.name === boundary && !column.hidden) ? { frozenThrough: boundary } : {}), ...(preferences?.rowHeight === undefined ? {} : { rowHeight: preferences.rowHeight }) };
}
/** 只产生显示映射，保留原物理列编号；行数据与编辑快照始终不投影或重排。 */
export function exactTableLayoutProjection(names: readonly string[], preferences: TablePreferences): { index: number; width?: number; frozen: boolean }[] {
  const value = reconcileExactTableLayout(names, preferences), visible = value.columns.filter(column => !column.hidden), boundary = visible.findIndex(column => column.name === value.frozenThrough);
  return visible.map((column, position) => ({ index: names.indexOf(column.name), ...(column.width === undefined ? {} : { width: column.width }), frozen: boundary >= 0 && position <= boundary }));
}

export { reconcileExactTableLayout as reconcileSqliteLayout, exactTableLayoutProjection as sqliteLayoutProjection };
