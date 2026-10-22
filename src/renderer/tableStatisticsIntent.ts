import type { FilterGroup, FilterMode, FilterRule, TableInfo } from '../shared/contracts';

export interface TableStatisticsConditions { filters: FilterRule[]; filterMode: FilterMode; filterGroup?: FilterGroup; }
/** 统计只冻结来源与条件，不持有第二份可写父行，也不使用已加载页计算结果。 */
export class TableStatisticsIntent {
  readonly source: TableInfo; readonly conditions: TableStatisticsConditions;
  private readonly sourceIdentity: string; private readonly conditionIdentity: string; private dead = false;
  private readonly values: readonly unknown[]; private listeners = new Set<() => void>();
  constructor(source: TableInfo, conditions: TableStatisticsConditions, values: readonly unknown[], private guard: () => boolean) {
    this.source = freeze(structuredClone(source)); this.conditions = freeze(structuredClone(conditions)); this.values = [...values];
    this.sourceIdentity = JSON.stringify(this.source); this.conditionIdentity = JSON.stringify(this.conditions);
  }
  /** 原页面/行/条件曾离开一次即撤销，不允许A→B→A复活统计意图。 */
  observe(values: readonly unknown[]): void { if (values.length !== this.values.length || values.some((value, index) => !Object.is(value, this.values[index]))) this.invalidate(); }
  /** 旧DOM和异步回包都即时核身份，未知异常同样永久撤销。 */
  current(): boolean {
    if (!this.dead) { try { if (!this.guard() || JSON.stringify(this.source) !== this.sourceIdentity || JSON.stringify(this.conditions) !== this.conditionIdentity) this.invalidate(); } catch { this.invalidate(); } }
    return !this.dead;
  }
  /** 同步撤销、微任务通知，避免父组件渲染时直接更新子组件。 */
  invalidate(): void { if (this.dead) return; this.dead = true; queueMicrotask(() => { for (const listener of this.listeners) listener(); }); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}
/** 快照不允许被预览或结果组件原地改写，条件中的数组顺序原样保留。 */
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const field of Object.values(value)) freeze(field); Object.freeze(value); } return value; }
