import type { ResultExportData, TableInfo } from '../shared/contracts';
import { assertResultInsertData, resultInsertApplyOutputSchema, resultInsertPreviewOutputSchema, resultInsertProgressSchema, type ResultInsertApplyOutput, type ResultInsertMapping, type ResultInsertPreviewInput, type ResultInsertPreviewOutput, type ResultInsertProgress } from '../shared/resultInsert';
import { resultInsertZh as text } from './locales/resultInsert.zh-CN';

/** 本次源是完整typed副本，不携带原SQL、会话或可重跑查询的能力。 */
export class ResultInsertSourceIntent {
  readonly data: ResultExportData;
  readonly selected: boolean;
  readonly owner: string;
  #valid = true; #guard: () => boolean; #listeners = new Set<() => void>();
  constructor(data: ResultExportData, selected: boolean, owner: string, guard: () => boolean) {
    assertResultInsertData(data); this.data = freeze(structuredClone(data)); this.selected = selected; this.owner = owner; this.#guard = guard;
  }
  current(): boolean { if (this.#valid) { let okay = false; try { okay = this.#guard() === true; } catch {} if (!okay) this.invalidate(); } return this.#valid; }
  invalidate(): void { if (!this.#valid) return; this.#valid = false; for (const listener of this.#listeners) listener(); }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
}
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }

/** 生成列即便旧目录标志不完整也不作为映射候选；真实定义仍由引擎最终核验。 */
export function resultInsertWritableColumns(info: TableInfo): string[] {
  if (info.objectKind !== 'table' || !Array.isArray(info.columns)) throw Error(text.invalid);
  return info.columns.filter(column => !column.generated && !/\b(?:VIRTUAL|STORED|PERSISTENT)\s+GENERATED\b/i.test(column.extra)).map(column => column.name);
}
/** 重名源标题没有唯一对应，不按显示名猜测内部键；建议只是可审阅的初值。 */
export function suggestResultInsertMapping(data: ResultExportData, info: TableInfo): ResultInsertMapping[] {
  const available = resultInsertWritableColumns(info), counts = new Map<string, number>();
  for (const column of data.columns) counts.set(column.name, (counts.get(column.name) ?? 0) + 1);
  return data.columns.filter(column => column.name && counts.get(column.name) === 1 && available.filter(name => name === column.name).length === 1).map(column => ({ source: column.key, target: column.name }));
}
/** 显式映射按源位置规范顺序，不容许重复目标、未知源键或生成列。 */
export function checkResultInsertMapping(data: ResultExportData, info: TableInfo, mapping: readonly ResultInsertMapping[]): ResultInsertMapping[] {
  const allowed = new Set(resultInsertWritableColumns(info)), sources = new Set(data.columns.map(column => column.key)), seen = new Set<string>(), sourceSeen = new Set<string>();
  if (!mapping.length) throw Error(text.mappingRequired);
  for (const item of mapping) { if (!sources.has(item.source) || !allowed.has(item.target) || seen.has(item.target) || sourceSeen.has(item.source)) throw Error(text.mappingRequired); seen.add(item.target); sourceSeen.add(item.source); }
  return data.columns.flatMap(column => { const item = mapping.find(value => value.source === column.key); return item ? [{ ...item }] : []; });
}
/** 预览必须逐字段回证原请求，有限SQL样本不替代准确总行数。 */
export function checkResultInsertPreview(value: unknown, input: ResultInsertPreviewInput): ResultInsertPreviewOutput {
  const result = resultInsertPreviewOutputSchema.parse(value);
  if (JSON.stringify(result.target) !== JSON.stringify({ connectionId: input.connectionId, database: input.database, table: input.table }) || result.rows !== input.data.rows.length || result.sourceTruncated !== input.data.truncated || result.timeZone !== input.timeZone || JSON.stringify(result.mapping) !== JSON.stringify(input.mapping) || result.shownRows > Math.min(result.rows, 20) || new TextEncoder().encode(result.sql).length > 4 * 1024 * 1024) throw Error(text.invalid);
  return result;
}
/** 确认提交必须属于准确原目标和原行数，不能接受其它任务的成功回执。 */
export function checkResultInsertApplied(value: unknown, preview: ResultInsertPreviewOutput): ResultInsertApplyOutput {
  const result = resultInsertApplyOutputSchema.parse(value);
  if (result.rows !== preview.rows || JSON.stringify(result.target) !== JSON.stringify(preview.target)) throw Error(text.invalid);
  return result;
}
/** 单调保留实际发送与ACK事实；迟到旧进度不能抹掉已确认提交或放开COMMIT取消。 */
export function mergeResultInsertProgress(before: ResultInsertProgress | undefined, value: unknown, expectedRows?: number): ResultInsertProgress | undefined {
  const parsed = resultInsertProgressSchema.safeParse(value); if (!parsed.success) return before;
  const next = parsed.data;
  // 真正提交ACK必须覆盖原预览的全部行；其它任务或不完整回执不能升级成成功事实。
  if (next.commitAcknowledged && expectedRows !== undefined && (next.rows !== expectedRows || next.totalRows !== expectedRows)) return before;
  const result = { ...next, dmlMayHaveBeenSent: !!before?.dmlMayHaveBeenSent || next.dmlMayHaveBeenSent, commitMayHaveBeenSent: !!before?.commitMayHaveBeenSent || next.commitMayHaveBeenSent, commitAcknowledged: !!before?.commitAcknowledged || next.commitAcknowledged, rollbackAcknowledged: !!before?.rollbackAcknowledged || next.rollbackAcknowledged, transactionProtected: !!before?.transactionProtected || next.transactionProtected };
  if (result.commitAcknowledged) result.outcome = 'committed'; else if (result.rollbackAcknowledged && result.transactionProtected) result.outcome = 'rolled-back'; else if (before?.outcome === 'unknown' || result.dmlMayHaveBeenSent && next.outcome === 'not-sent') result.outcome = 'unknown';
  return result;
}
