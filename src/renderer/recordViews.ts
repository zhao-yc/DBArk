import type { ColumnInfo, DataRow, RowChange, TableInfo } from '../shared/contracts';
import { collectChanges, type DraftRow } from './dataChanges';
import { cellPreview, cellText, ownCell, parseCell } from './lib';
import { recordViewZh as text } from './locales/recordViews.zh-CN';

export interface RecordTarget { connectionId: string; database: string; table: string }
export interface RecordContext { target: RecordTarget; connectionVersion: number; generation: number; info: TableInfo | null; loaded: boolean; stale: boolean; busy: boolean }
export type RecordMode = 'text' | 'json' | 'binary' | 'null' | 'default';
export interface RecordInput { mode: RecordMode; text: string }
export interface RecordDraft {
  target: string; connectionVersion: number; generation: number; metadata: string;
  rowId: string; data: DataRow; original?: DataRow; inserted: boolean;
  /** 只缓存显式展开的字段；载入的整页与 original 不复制、不序列化。 */
  fields: ReadonlyMap<string, RecordInput>;
}
export const recordInputLimits = { field: 262_144, total: 2_097_152 } as const;
/** 字段错误携带精确列名，界面可聚焦对应输入而无需解析提示文本。 */
export class RecordFieldError extends Error { constructor(readonly key: string, reason: string) { super(text.invalidField.replace('{0}', key).replace('{1}', reason)); } }

/** 离开输入的同步门只保留首次意图；不负责 UI、不提交数据库，也不自动丢弃失败输入。 */
export class RecordLeaveGuard {
  private action: (() => void) | null = null;
  /** 当前存在待处理确认时，新点击不能替换首次目标。 */
  request(dirty: boolean, action: () => void): boolean { if (this.action) return false; if (dirty) { this.action = action; return false; } action(); return true; }
  /** 暂存失败保留确认；成功先清门再执行动作，避免后续操作被旧确认锁住。 */
  resolve(choice: 'stage' | 'discard' | 'stay', stage: () => boolean, discard: () => void): boolean {
    const action = this.action; if (!action) return true;
    if (choice === 'stage' && !stage()) return false;
    if (choice === 'discard') discard();
    this.action = null; if (choice !== 'stay') action(); return true;
  }
  /** 明确放弃整页后取消待处理动作，不能把旧导航重放到新页面。 */
  reset() { this.action = null; }
}

/** 目标采用有序元组编码，名称中的点号、分隔符或原型名称均没有特殊语义。 */
export function recordTargetKey(target: RecordTarget): string { return JSON.stringify([target.connectionId, target.database, target.table]); }
/** 结构签名只包含写入边界，不读取或序列化记录内容。 */
export function recordMetadataKey(info: TableInfo | null): string {
  return info ? JSON.stringify([info.database, info.name, info.objectKind, info.engine, info.editableKey, info.columns.map(column => [column.name, column.type, column.nullable, column.generated, column.extra, column.defaultValue])]) : '';
}
/** 网格、表单与单元格共用写入原因；可靠键不代表服务器已授予写权限。 */
export function recordReadonlyReason(context: RecordContext, row?: DraftRow, key?: string): string {
  if (context.stale) return text.stale;
  if (!context.loaded || !context.info) return text.notLoaded;
  if (context.busy) return text.busy;
  if (context.info.objectKind === 'view') return text.viewReadonly;
  if (context.info.objectKind !== 'table') return text.unknownObject;
  if (context.info.engine.toUpperCase() !== 'INNODB') return text.engineReadonly;
  if (!context.info.editableKey.length) return text.noKey;
  if (row?.deleted) return text.deletedReadonly;
  if (key !== undefined) { const column = context.info.columns.find(item => item.name === key); if (!column) return text.unknownField; if (column.generated) return text.generated; }
  return '';
}
/** 输入捕获本地 UUID、加载代次及不可变行引用；数据库定位始终仍使用 original。 */
export function beginRecordDraft(row: DraftRow, context: RecordContext): RecordDraft {
  return { target: recordTargetKey(context.target), connectionVersion: context.connectionVersion, generation: context.generation, metadata: recordMetadataKey(context.info), rowId: row.id, data: row.data, original: row.original, inserted: row.inserted, fields: new Map() };
}
/** 在展开大 BLOB 前先按 Base64 长度计算字节数，避免为摘要生成完整十六进制。 */
export function recordBinaryBytes(base64: string): number { return Math.max(0, base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)); }
/** 编辑预算按实际文本代码单元计量；二进制编辑为 0x 加两位 HEX，绝不先完整转换再判断。 */
export function recordFieldTooLarge(value: ReturnType<typeof ownCell>): boolean {
  return typeof value === 'string' ? value.length > recordInputLimits.field : !!value && typeof value === 'object' && recordBinaryBytes(value.base64) * 2 + 2 > recordInputLimits.field;
}
/** 摘要有界且明确区分 DEFAULT、NULL 与零字节二进制，完整值仍留在原草稿。 */
export function recordValueSummary(value: ReturnType<typeof ownCell>): string {
  if (value === undefined) return text.default;
  if (value === null) return text.null;
  if (typeof value === 'object') return `${cellPreview(value, 100)} · ${text.bytes.replace('{0}', String(recordBinaryBytes(value.base64)))}`;
  return cellPreview(value, 240);
}
/** 原始输入只在用户显式展开时生成，JSON 原文、大整数和微秒时间均不重新解释。 */
export function initialRecordInput(draft: RecordDraft, column: ColumnInfo): RecordInput {
  const value = ownCell(draft.data, column.name);
  if (recordFieldTooLarge(value)) throw new Error(text.fieldTooLarge);
  return { mode: value === undefined ? 'default' : value === null ? 'null' : typeof value === 'object' ? 'binary' : /json/i.test(column.type) ? 'json' : 'text', text: value === null || value === undefined ? '' : cellText(value) };
}
/** 稀疏缓冲按精确列名使用 Map，原型同名列不会覆盖内部成员。 */
export function editRecordInput(draft: RecordDraft, column: ColumnInfo, input?: RecordInput): RecordDraft {
  const next = input ?? draft.fields.get(column.name) ?? initialRecordInput(draft, column);
  if (next.text.length > recordInputLimits.field) throw new Error(text.fieldTooLarge);
  let total = next.text.length;
  for (const [key, value] of draft.fields) if (key !== column.name) total += value.text.length;
  if (total > recordInputLimits.total) throw new Error(text.budgetExceeded);
  return { ...draft, fields: new Map([...draft.fields, [column.name, { ...next }]]) };
}
/** 非法 JSON/HEX 也是未暂存输入；此判断只比较词法内容，不要求解析成功。 */
export function recordInputDirty(draft: RecordDraft | null, info: TableInfo | null): boolean {
  if (!draft) return false;
  for (const [key, input] of draft.fields) {
    const column = info?.columns.find(item => item.name === key);
    if (!column) return true;
    const original = initialRecordInput(draft, column);
    if (input.mode !== original.mode || input.text !== original.text) return true;
  }
  return false;
}
/** 列展示沿用可见顺序；显示隐藏字段只追加缺少的元数据列，不改持久布局。 */
export function recordFieldOrder(columns: readonly ColumnInfo[], visibleKeys: readonly string[], showHidden: boolean): string[] {
  const valid = new Set(columns.map(column => column.name)); const seen = new Set<string>();
  const keys = [...visibleKeys, ...(showHidden ? columns.map(column => column.name) : [])];
  return keys.filter(key => valid.has(key) && !seen.has(key) && !!seen.add(key));
}
/** 导航严格限当前页数组，新增与待删除行仍占各自位置，不猜测全表总量或跨页读取。 */
export function adjacentRecordId(rows: readonly DraftRow[], rowId: string | undefined, direction: -1 | 1): string | undefined {
  const index = rows.findIndex(row => row.id === rowId); return index < 0 ? undefined : rows[index + direction]?.id;
}
/** 网格回调必须来自同一页草稿引用；晚到的编辑事件不能整页覆盖刚暂存的表单或粘贴结果。 */
export function acceptGridDrafts(current: DraftRow[], captured: DraftRow[], next: DraftRow[]): DraftRow[] {
  if (current !== captured || next.length !== current.length || next.some((row, index) => row.id !== current[index].id || row.original !== current[index].original || row.inserted !== current[index].inserted || row.deleted !== current[index].deleted)) throw new Error(text.changed);
  return next;
}
/** 检查精确目标与本地修订；相同显示内容也不能替代同一行引用或加载代次。 */
export function assertRecordDraftCurrent(rows: readonly DraftRow[], draft: RecordDraft, context: RecordContext): DraftRow {
  const row = rows.find(item => item.id === draft.rowId);
  if (!row || draft.target !== recordTargetKey(context.target) || draft.connectionVersion !== context.connectionVersion || draft.generation !== context.generation || draft.metadata !== recordMetadataKey(context.info) || row.data !== draft.data || row.original !== draft.original || row.inserted !== draft.inserted || row.deleted) throw new Error(text.changed);
  return row;
}
/** 所有字段先校验再一次合并；失败不修改任何 DraftRow，成功也只更新 data。 */
export function stageRecordDraft(rows: DraftRow[], draft: RecordDraft, context: RecordContext): DraftRow[] {
  const row = assertRecordDraftCurrent(rows, draft, context); const reason = recordReadonlyReason(context, row);
  if (reason) throw new Error(reason);
  const values = new Map(Object.entries(row.data));
  for (const [key, input] of draft.fields) {
    const column = context.info!.columns.find(item => item.name === key); if (!column) throw new Error(text.unknownField);
    const baseline = initialRecordInput(draft, column); if (input.mode === baseline.mode && input.text === baseline.text) continue;
    try {
      const fieldReason = recordReadonlyReason(context, row, key); if (fieldReason) throw new Error(fieldReason);
      if (input.mode === 'default') { if (!row.inserted) throw new Error(text.defaultExisting); values.delete(key); }
      else { if (input.mode === 'null' && !column.nullable) throw new Error(text.nullForbidden); values.set(key, parseCell(input.text, input.mode)); }
    } catch (error) { throw new RecordFieldError(key, error instanceof Error ? error.message : String(error)); }
  }
  if (!recordInputDirty(draft, context.info)) return rows;
  return rows.map(item => item.id === row.id ? { ...item, data: Object.fromEntries(values) } : item);
}

export interface RecordPagePreview { target: string; connectionVersion: number; generation: number; metadata: string; rows: DraftRow[]; changes: RowChange[]; attempted: boolean }
/** SQL 预览捕获同一页不可变草稿，不做额外整页克隆，也不能在最终确认时换成新 changes。 */
export function captureRecordPagePreview(rows: DraftRow[], context: RecordContext): RecordPagePreview {
  const reason = recordReadonlyReason(context); if (reason) throw new Error(reason);
  return { target: recordTargetKey(context.target), connectionVersion: context.connectionVersion, generation: context.generation, metadata: recordMetadataKey(context.info), rows, changes: collectChanges(rows), attempted: false };
}
/** 最终确认同步消耗一次投递机会；未知结果、异常及取消都不恢复重试按钮。 */
export function consumeRecordPagePreview(preview: RecordPagePreview, rows: DraftRow[], context: RecordContext): RowChange[] {
  if (preview.attempted) throw new Error(text.applyAttempted);
  if (preview.rows !== rows || preview.target !== recordTargetKey(context.target) || preview.connectionVersion !== context.connectionVersion || preview.generation !== context.generation || preview.metadata !== recordMetadataKey(context.info) || context.stale || !context.loaded) throw new Error(text.previewChanged);
  preview.attempted = true; return preview.changes;
}
