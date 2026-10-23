import { historyDeleteLimits, historyDeletePreviewInputSchema, historyDeleteApplyInputSchema, type HistoryDeletePreviewInput, type HistoryDeletePreviewOutput, type HistoryDeleteApplyOutput, type HistoryDeleteReference } from '../shared/historyDelete';
import type { HistoryPageEntry } from '../shared/historyPages';
import { historyDeleteZh as text } from './locales/historyDelete.zh-CN';

/** 原摘要跨批次保留；整批超额时不部分加入，避免“全选”暗中只选一部分。 */
export function selectHistoryDeleteRecords(current: readonly HistoryDeleteReference[], batch: readonly Pick<HistoryPageEntry, 'entry' | 'digest'>[]): HistoryDeleteReference[] {
  const records = new Map(current.map(record => [record.id, { ...record }]));
  for (const item of batch) {
    const before = records.get(item.entry.id);
    if (before && before.digest !== item.digest) throw Error(text.stale);
    records.set(item.entry.id, { id: item.entry.id, digest: item.digest });
  }
  if (records.size > historyDeleteLimits.selected) throw Error(text.limit);
  if (records.size) historyDeletePreviewInputSchema.shape.scope.parse({ kind: 'selected', records: [...records.values()] });
  return [...records.values()];
}

/** 删除来源只有不可恢复的租约；ABA不能让原确认按钮重新取得授权。 */
export class HistoryDeleteIntent {
  readonly scope: HistoryDeletePreviewInput['scope'];
  #valid = true;
  #guard: () => boolean;
  #listeners = new Set<() => void>();
  constructor(scope: HistoryDeletePreviewInput['scope'], guard: () => boolean) {
    const parsed = historyDeletePreviewInputSchema.shape.scope.parse(scope);
    this.scope = freeze(structuredClone(parsed)); this.#guard = guard;
  }
  /** 深快照不保留父筛选或选择数组的可变引用。 */
  input(taskId: string): HistoryDeletePreviewInput {
    if (!this.current()) throw Error(text.stale);
    return historyDeletePreviewInputSchema.parse({ taskId, scope: this.scope });
  }
  current(): boolean { if (this.#valid && !this.#guard()) this.invalidate(); return this.#valid; }
  invalidate(): void { if (!this.#valid) return; this.#valid = false; for (const listener of this.#listeners) listener(); }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
}

/** 仅接受完整有限概要；核验失败的令牌仍由调用方原样释放，不能作为删除许可。 */
export function checkHistoryDeletePreview(value: HistoryDeletePreviewOutput, kind: HistoryDeletePreviewOutput['kind']): HistoryDeletePreviewOutput {
  if (!value || typeof value !== 'object' || !historyDeleteApplyInputSchema.safeParse({ previewToken: value.previewToken }).success || value.kind !== kind || !Number.isSafeInteger(value.count) || value.count < 0 || value.count > historyDeleteLimits.retained || !Number.isSafeInteger(value.scanned) || value.scanned < value.count || value.scanned > historyDeleteLimits.retained || !Array.isArray(value.samples) || value.samples.length > historyDeleteLimits.samples || value.samples.length !== Math.min(value.count, historyDeleteLimits.samples) || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) throw Error(text.invalid);
  const ids = new Set<string>();
  for (const sample of value.samples) {
    if (!sample || !sample.entry || typeof sample.entry.id !== 'string' || !sample.entry.id || ids.has(sample.entry.id) || typeof sample.entry.startedAt !== 'string' || typeof sample.sqlPreview !== 'string' || sample.sqlPreview.length > 512 || !Number.isSafeInteger(sample.sqlUnits) || sample.sqlUnits < sample.sqlPreview.length || typeof sample.previewTruncated !== 'boolean') throw Error(text.invalid);
    ids.add(sample.entry.id);
  }
  return value;
}

/** 合同仅含普通数组和字段，递归冻结后父组件不能静默改写确认范围。 */
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }

/** 已提交结果是事实；晚到取消或来源失效不能把真实删除改称未执行。 */
export function checkHistoryDeleteApply(value: HistoryDeleteApplyOutput): HistoryDeleteApplyOutput {
  if (!value || value.applied !== true || !Number.isSafeInteger(value.deleted) || value.deleted < 0 || value.deleted > historyDeleteLimits.retained) throw Error(text.invalid);
  return value;
}
