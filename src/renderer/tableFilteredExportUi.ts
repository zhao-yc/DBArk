import type { FilterGroup, FilterMode, FilterRule, SortRule, TableInfo } from '../shared/contracts';
import { tableFilteredExportLimits, type TableFilteredExportInput, type TableFilteredExportOutput } from '../shared/tableFilteredExport';
import { copyFilterRules, validateFilterGroup } from '../shared/filtering';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import { validateTableSort } from './tableSort';
import { tableFilteredExportZh as text } from './locales/tableFilteredExport.zh-CN';

export interface TableFilteredExportConditions { filters: readonly FilterRule[]; filterMode: FilterMode; filterGroup?: FilterGroup; }
export type TableFilteredExportTarget = Pick<TableFilteredExportInput, 'connectionId' | 'database' | 'table'>;
export type TableFilteredExportOptions = Pick<TableFilteredExportInput, 'format' | 'encoding' | 'csvDelimiter'>;
/** 快照递归冻结，导出只使用服务器条件，绝不复制父表行作为文件数据。 */
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }

/** 固定来源、已应用完整条件和排序；观察过一次漂移就永久撤销，不能A→B→A复活。 */
export class TableFilteredExportIntent {
  readonly source: TableInfo; readonly target: TableFilteredExportTarget; readonly conditions: TableFilteredExportConditions; readonly sort: readonly SortRule[]; readonly metadataKey: string;
  private readonly values: readonly unknown[]; private readonly sourceIdentity: string; private readonly configurationIdentity: string; private dead = false; private checking = false; private listeners = new Set<() => void>();
  constructor(target: TableFilteredExportTarget, source: TableInfo, conditions: TableFilteredExportConditions, sort: readonly SortRule[], values: readonly unknown[], private readonly guard: () => boolean) {
    if (!target.connectionId || target.database !== source.database || target.table !== source.name || !['table', 'view'].includes(source.objectKind ?? '')) throw Error(text.invalid);
    const filters = copyFilterRules(conditions.filters), group = validateFilterGroup(filters, conditions.filterMode, conditions.filterGroup);
    if (filters.some(rule => !source.columns.some(column => column.name === rule.column))) throw Error(text.invalid);
    this.source = freeze(structuredClone(source)); this.target = freeze({ ...target });
    this.conditions = freeze({ filters, filterMode: conditions.filterMode, ...(group ? { filterGroup: group } : {}) });
    this.sort = freeze(validateTableSort(sort, source.columns.map(column => column.name)));
    this.metadataKey = tableCopyMetadataKey(this.source);
    if (new TextEncoder().encode(this.metadataKey).length > tableFilteredExportLimits.metadataBytes) throw Error(text.invalid);
    this.sourceIdentity = JSON.stringify(this.source); this.configurationIdentity = JSON.stringify([this.target, this.conditions, this.sort]); this.values = [...values];
  }
  /** 父工作区每个渲染核原引用和代次，不把最终值相等视为中途没有变化。 */
  observe(values: readonly unknown[]): void { if (values.length !== this.values.length || values.some((value, index) => !Object.is(value, this.values[index]))) this.invalidate(); }
  /** 防止父守卫同步重入；守卫异常与已冻结来源被破坏均按失效处理。 */
  current(): boolean {
    if (this.dead || this.checking) return false;
    this.checking = true;
    try { if (this.guard() !== true || JSON.stringify(this.source) !== this.sourceIdentity || JSON.stringify([this.target, this.conditions, this.sort]) !== this.configurationIdentity) this.invalidate(); } catch { this.invalidate(); } finally { this.checking = false; }
    return !this.dead;
  }
  /** 微任务通知避免父渲染期间更新子组件；活动任务由对话框发送一次取消并等原终态。 */
  invalidate(): void { if (this.dead) return; this.dead = true; queueMicrotask(() => { for (const listener of this.listeners) listener(); }); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** 构造参数时再核原来源，CSV私有配置不夹带到其它格式，XLSX明确固定UTF-8。 */
  input(options: TableFilteredExportOptions, fileToken: string, taskId: string): TableFilteredExportInput {
    if (!this.current() || !fileToken || !taskId || !['csv', 'json', 'sql', 'xlsx'].includes(options.format) || !['utf8', 'utf16le', 'gb18030'].includes(options.encoding) || options.format !== 'csv' && options.csvDelimiter !== undefined || options.csvDelimiter !== undefined && ![',', ';', '\t'].includes(options.csvDelimiter)) throw Error(text.invalid);
    if (options.format === 'sql' && this.source.objectKind !== 'table') throw Error(text.viewSql);
    if (options.format === 'sql' && !this.source.columns.some(column => !column.generated)) throw Error(text.noSqlFields);
    return { ...this.target, metadataKey: this.metadataKey, filters: structuredClone(this.conditions.filters) as FilterRule[], filterMode: this.conditions.filterMode, ...(this.conditions.filterGroup ? { filterGroup: structuredClone(this.conditions.filterGroup) } : {}), sort: structuredClone(this.sort) as SortRule[], format: options.format, encoding: options.format === 'xlsx' ? 'utf8' : options.encoding, ...(options.format === 'csv' && options.csvDelimiter !== undefined ? { csvDelimiter: options.csvDelimiter } : {}), fileToken, taskId };
  }
}
/** 完整落盘事实只来自原IPC回执；运行进度和完成事件不能代替此回执。 */
export function checkTableFilteredExportOutput(value: unknown): TableFilteredExportOutput {
  if (!value || typeof value !== 'object' || Reflect.ownKeys(value).length !== 2) throw Error(text.invalid);
  const rows = Object.getOwnPropertyDescriptor(value, 'rows'), committed = Object.getOwnPropertyDescriptor(value, 'fileCommitted');
  if (!rows || !('value' in rows) || !Number.isSafeInteger(rows.value) || rows.value < 0 || !committed || !('value' in committed) || committed.value !== true) throw Error(text.invalid);
  return { rows: rows.value as number, fileCommitted: true };
}
