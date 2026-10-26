import type { FilterGroup, FilterMode, FilterRule, SortRule, TableInfo } from '../shared/contracts';
import { copyFilterRules, validateFilterGroup } from '../shared/filtering';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import { tableFilteredDeletePreviewInputSchema, tableFilteredDeletePreviewOutputSchema, tableFilteredDeleteApplyOutputSchema, tableFilteredDeleteProgressSchema, type TableFilteredDeletePreviewInput, type TableFilteredDeletePreviewOutput, type TableFilteredDeleteApplyOutput, type TableFilteredDeleteProgress, type TableFilteredDeleteTarget } from '../shared/tableFilteredDelete';
import { validateTableSort } from './tableSort';
import { tableFilteredDeleteZh as text } from './locales/tableFilteredDelete.zh-CN';

export interface TableFilteredDeleteScope { filters: readonly FilterRule[]; filterMode: FilterMode; filterGroup?: FilterGroup; sort: readonly SortRule[]; }
/** 这里只决定是否开放读取入口；真实目录、外键及可靠键资格仍由服务器完整核验。 */
export function tableFilteredDeleteAvailable(info: TableInfo): boolean {
  return info.objectKind === 'table' && info.engine?.toLowerCase() === 'innodb' && info.editableKey.length > 0 && new Set(info.editableKey).size === info.editableKey.length && info.editableKey.every(name => info.columns.some(column => column.name === name && !column.nullable));
}

/** 冻结完整已应用范围，不携带当前页、勾选行、赋值或任意 SQL。 */
export class TableFilteredDeleteIntent {
  readonly source: TableInfo; readonly target: TableFilteredDeleteTarget; readonly scope: TableFilteredDeleteScope; readonly metadataKey: string;
  private dead = false; private checking = false; private readonly values: readonly unknown[]; private readonly listeners = new Set<() => void>();
  constructor(target: TableFilteredDeleteTarget, source: TableInfo, scope: TableFilteredDeleteScope, values: readonly unknown[], private readonly guard: () => boolean) {
    if (!target.connectionId || target.database !== source.database || target.table !== source.name || !tableFilteredDeleteAvailable(source)) throw Error(text.unavailable);
    const filters = copyFilterRules(scope.filters), group = validateFilterGroup(filters, scope.filterMode, scope.filterGroup);
    if (filters.some(rule => !source.columns.some(column => column.name === rule.column))) throw Error(text.invalid);
    this.source = freeze(structuredClone(source)); this.target = freeze({ ...target });
    this.scope = freeze({ filters, filterMode: scope.filterMode, ...(group ? { filterGroup: group } : {}), sort: validateTableSort(scope.sort, source.columns.map(column => column.name)) });
    this.metadataKey = tableCopyMetadataKey(this.source); this.values = [...values];
  }
  /** 原页面身份观察到变化即永久撤销，A→B→A 不能复活旧删除能力。 */
  observe(values: readonly unknown[]): void { if (values.length !== this.values.length || values.some((value, index) => !Object.is(value, this.values[index]))) this.invalidate(); }
  current(): boolean { if (this.dead || this.checking) return false; this.checking = true; try { if (this.guard() !== true) this.invalidate(); } catch { this.invalidate(); } finally { this.checking = false; } return !this.dead; }
  invalidate(): void { if (this.dead) return; this.dead = true; queueMicrotask(() => { for (const listener of this.listeners) listener(); }); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** 发送前同步复核原来源，再复制完整条件，绝不拼接显示中的 SQL 样本。 */
  input(taskId: string): TableFilteredDeletePreviewInput {
    if (!this.current()) throw Error(text.stale);
    return tableFilteredDeletePreviewInputSchema.parse({ ...this.target, taskId, metadataKey: this.metadataKey, filters: structuredClone(this.scope.filters), filterMode: this.scope.filterMode, ...(this.scope.filterGroup ? { filterGroup: structuredClone(this.scope.filterGroup) } : {}), sort: structuredClone(this.scope.sort) });
  }
}
/** IPC 已由主进程核对范围摘要，渲染层另外核对准确目标、用途、总数及完整样本关系。 */
export function checkTableFilteredDeletePreview(value: unknown, input: TableFilteredDeletePreviewInput): TableFilteredDeletePreviewOutput {
  const output = tableFilteredDeletePreviewOutputSchema.parse(value);
  if (output.target.connectionId !== input.connectionId || output.target.database !== input.database || output.target.table !== input.table || output.shownRows > Math.min(output.rows, 10) || output.rows === 0 && (output.shownRows !== 0 || !!output.sql) || output.sampleOmitted !== (output.shownRows < output.rows)) throw Error(text.invalid);
  return output;
}
/** 只接受原删除预览的准确目标和全量行数，更新用途不能冒充删除 ACK。 */
export function checkTableFilteredDeleteApplied(value: unknown, preview: TableFilteredDeletePreviewOutput): TableFilteredDeleteApplyOutput {
  const output = tableFilteredDeleteApplyOutputSchema.parse(value);
  if (output.rows !== preview.rows || output.target.connectionId !== preview.target.connectionId || output.target.database !== preview.target.database || output.target.table !== preview.target.table) throw Error(text.invalid);
  return output;
}
/** 已发送及 ACK 事实只累积，原 COMMIT 成功不受迟到失败、旧进度或取消覆盖。 */
export function mergeTableFilteredDeleteProgress(before: TableFilteredDeleteProgress | undefined, value: unknown, expectedRows?: number): TableFilteredDeleteProgress | undefined {
  const parsed = tableFilteredDeleteProgressSchema.safeParse(value); if (!parsed.success) return before; const next = parsed.data;
  // Main可能已记账失保护，但真实COMMIT ACK仍优先；准确发送/用途/全量行数门继续成立。
  if (next.commitAcknowledged && (!next.commitMayHaveBeenSent || next.outcome !== 'committed' || expectedRows === undefined || next.rows !== expectedRows || next.totalRows !== expectedRows)) return before;
  // 发送DML后失去事务保护永久保持；初始或迟到prepare未发送DML的false不抹掉真实保护。
  const protectionLost = !!before?.dmlMayHaveBeenSent && !before.transactionProtected || next.dmlMayHaveBeenSent && !next.transactionProtected;
  const output = { ...next, dmlMayHaveBeenSent: !!before?.dmlMayHaveBeenSent || next.dmlMayHaveBeenSent, commitMayHaveBeenSent: !!before?.commitMayHaveBeenSent || next.commitMayHaveBeenSent, commitAcknowledged: !!before?.commitAcknowledged || next.commitAcknowledged, rollbackAcknowledged: !!before?.rollbackAcknowledged || next.rollbackAcknowledged, transactionProtected: !protectionLost && (!!before?.transactionProtected || next.transactionProtected) };
  if (output.commitAcknowledged) { output.outcome = 'committed'; if (before?.commitAcknowledged) { output.rows = before.rows; output.totalRows = before.totalRows; } }
  else if (output.dmlMayHaveBeenSent && !output.transactionProtected) output.outcome = 'unknown';
  else if (output.rollbackAcknowledged && output.transactionProtected && !output.commitMayHaveBeenSent) output.outcome = 'rolled-back';
  else if (before?.outcome === 'unknown' || output.dmlMayHaveBeenSent && next.outcome === 'not-sent') output.outcome = 'unknown';
  return output;
}
/** 范围快照递归冻结，子组件不能原地改变已预览的删除对象。 */
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
