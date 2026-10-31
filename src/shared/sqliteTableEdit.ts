import { z } from 'zod';
import { sqliteTablePageSchema, sqliteTableFilterSchema } from './sqliteTableBrowse';

const id = z.string().min(1).max(200), name = sqliteTablePageSchema.shape.table;
const filterValue = sqliteTableFilterSchema.shape.value.unwrap();
/** 编辑只接收显式动态类型；新增字段省略代表数据库默认值，不等同于NULL。 */
export const sqliteEditValueSchema = z.union([z.object({ kind: z.literal('null') }).strict(), filterValue]);
export type SqliteEditValue = z.infer<typeof sqliteEditValueSchema>;
/** 原页值可含SQLite原生非有限REAL；只有用户新输入的REAL才要求有限。 */
export type SqliteOriginalValue = { kind: 'null' } | { kind: 'text' | 'integer' | 'real' | 'blob'; value: string };
export const sqliteTableEditLimits = { changes: 500, cells: 10000, valueUnits: 65536, inputUnits: 2 * 1024 * 1024, snapshots: 64, snapshotBytes: 64 * 1024 * 1024, snapshotLifetimeMs: 30 * 60 * 1000, previewLifetimeMs: 5 * 60 * 1000 } as const;
const fields = z.array(z.object({ column: name, value: sqliteEditValueSchema }).strict()).max(1024).refine(values => new Set(values.map(value => value.column)).size === values.length, '修改字段不能重复');
export const sqliteTableChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('insert'), values: fields }).strict(),
  z.object({ kind: z.literal('update'), row: z.number().int().min(0).max(999), values: fields.refine(values => values.length > 0, '更新至少需要一个字段') }).strict(),
  z.object({ kind: z.literal('delete'), row: z.number().int().min(0).max(999) }).strict(),
]);
export type SqliteTableChange = z.infer<typeof sqliteTableChangeSchema>;
const previewShape = z.object({ snapshotId: id, taskId: id, changes: z.array(sqliteTableChangeSchema).min(1).max(sqliteTableEditLimits.changes) }).strict().superRefine((input, context) => {
  const rows = input.changes.filter(change => change.kind !== 'insert').map(change => change.row);
  if (new Set(rows).size !== rows.length) context.addIssue({ code: 'custom', message: '同一原记录只能修改一次' });
  const values = input.changes.flatMap(change => change.kind === 'delete' ? [] : change.values);
  if (values.length > sqliteTableEditLimits.cells || values.reduce((size, value) => size + value.column.length + ('value' in value.value ? value.value.value.length : 0), 0) > sqliteTableEditLimits.inputUnits) context.addIssue({ code: 'custom', message: 'SQLite整批修改超过字段或文本预算' });
});
/** 先按原始数组长度计整批预算，避免为必定超限的整组值深解析并复制几十万个单元格。 */
export const sqliteTableEditPreviewSchema = z.unknown().superRefine((value, context) => {
  const changes = value && typeof value === 'object' && 'changes' in value ? value.changes : undefined;
  if (!Array.isArray(changes) || changes.length > sqliteTableEditLimits.changes) { context.addIssue({ code: 'custom', message: 'SQLite整批修改行数超限或格式无效' }); return; }
  let cells = 0, units = 0;
  const groups = changes.map(change => change && typeof change === 'object' && Array.isArray(change.values) ? change.values : []);
  for (const fields of groups) {
    cells += fields.length;
    if (cells > sqliteTableEditLimits.cells) { context.addIssue({ code: 'custom', message: 'SQLite整批修改超过字段预算' }); return; }
  }
  for (const fields of groups) {
    for (const field of fields) {
      if (typeof field?.column === 'string') units += field.column.length;
      if (typeof field?.value?.value === 'string') units += field.value.value.length;
      if (units > sqliteTableEditLimits.inputUnits) { context.addIssue({ code: 'custom', message: 'SQLite整批修改超过文本预算' }); return; }
    }
  }
}).pipe(previewShape);
export const sqliteTableEditApplySchema = z.object({ previewId: id, taskId: id, confirmation: z.string().min(1).max(1024) }).strict();
export const sqliteTableEditReleaseSchema = z.object({ snapshotId: id.optional(), previewId: id.optional() }).strict().refine(value => !!value.snapshotId || !!value.previewId, '缺少要释放的编辑来源');
export type SqliteTableEditPreviewInput = z.infer<typeof sqliteTableEditPreviewSchema>;
export type SqliteTableEditApplyInput = z.infer<typeof sqliteTableEditApplySchema>;
export type SqliteTableEditReleaseInput = z.infer<typeof sqliteTableEditReleaseSchema>;
export interface SqliteEditTarget { connectionId: string; database: 'main'; table: string; }
export interface SqliteEditColumn { name: string; declaredType: string; generated: boolean; nullable: boolean; hasDefault: boolean; }
export type SqliteTableEditPage = { kind: 'readonly'; reason: string } | { kind: 'editable'; snapshotId: string; expiresAt: string; columns: SqliteEditColumn[]; rows: SqliteOriginalValue[][]; locator: { kind: 'rowid' | 'primary-key' | 'unique-key'; columns: string[] } };
export interface SqliteTableEditCounts { insert: number; update: number; delete: number; }
export interface SqliteTableEditPreview { previewId: string; snapshotId: string; target: SqliteEditTarget; schemaKey: string; expiresAt: string; confirmation: string; sql: string[]; counts: SqliteTableEditCounts; }
export type SqliteWritePhase = 'not-sent' | 'writing' | 'commit-pending' | 'committed' | 'rolled-back' | 'unknown';
/** 提交事实只记录目标、数量和ACK，禁止原值、SQL及文件路径进入任务持久记录。 */
export interface SqliteWriteFact { operationId: string; target: SqliteEditTarget; phase: SqliteWritePhase; requestedRows: number; appliedRows: number; commitMayHaveBeenSent: boolean; commitAcknowledged: boolean; rollbackAcknowledged: boolean; }
export interface SqliteTableEditOutcome { operationId: string; target: SqliteEditTarget; outcome: 'committed' | 'rolled-back' | 'not-sent' | 'unknown'; counts: SqliteTableEditCounts; fact: SqliteWriteFact; message: string; cleanupWarning?: boolean; }
export const sqliteTableEditMessages = {
  stale: 'SQLite原页、连接或预览已失效，请重新读取；不会自动重放修改。',
  readonly: '当前SQLite对象没有可靠定位条件或连接为只读，不能通过表格修改。',
  committed: 'SQLite修改事务已确认提交；原值及SQL不保存到任务概要。',
  unknown: 'SQLite提交结果未知，请核对原数据库；禁止重复执行原批次，原值及SQL未保存。',
  rolledBack: 'SQLite修改已确认整批回滚；草稿保留，未自动重试。',
  running: '正在提交SQLite表格草稿；原值、SQL及文件路径不保存到任务概要。',
} as const;
