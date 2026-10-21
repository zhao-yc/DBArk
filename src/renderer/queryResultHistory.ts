import type { QueryResult, ResultColumn } from '../shared/contracts';
import type { QueryResultOrganization } from '../shared/queryResultPresets';
export type { QueryResultOrganization } from '../shared/queryResultPresets';
import { QueryResultFilter } from './queryResultFilter';
import { QueryResultSort } from './queryResultSort';
import { queryResultHistoryZh as text } from './locales/queryResultHistory.zh-CN';

interface Snapshot { readonly configuration: QueryResultOrganization; readonly key: string; }
export interface QueryResultHistoryBinding { readonly source: QueryResult; readonly visible: readonly ResultColumn[]; readonly context: readonly unknown[]; }
interface Ticket { readonly binding: QueryResultHistoryBinding; readonly revision: number; readonly index: number; readonly configuration: QueryResultOrganization; }
export const queryResultHistoryLimits = { steps: 20, entryUnits: 128 * 1024, totalUnits: 512 * 1024 } as const;

/** 仅复制已由正式控制器准入的配置；不复制行、SQL或额外结果快照。 */
function snapshot(configuration: QueryResultOrganization): Snapshot | undefined {
  const key = JSON.stringify(configuration);
  if (key.length > queryResultHistoryLimits.entryUnits) return;
  const copy = JSON.parse(key) as QueryResultOrganization;
  /** 深冻结独立副本，草稿修改和旧票据不能改写历史。 */
  function freeze(value: object): void { for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); Object.freeze(value); }
  freeze(copy); return { configuration: copy, key };
}

/** 历史属于一个准确返回结果及可见列；ABA撤销后不会复活旧票据。 */
export class QueryResultHistory {
  private binding?: QueryResultHistoryBinding; private owner?: unknown; private items: Snapshot[] = []; private cursor = 0; private revision = 0;
  limited = false;
  /** 撤销整个来源，不修改已有筛选、排序或任何服务器数据。 */
  invalidate(): void { this.binding = undefined; this.owner = undefined; this.items = []; this.cursor = 0; this.revision++; this.limited = false; }
  /** 只在来源改变时保存初始配置；普通重绘不复制配置或清空重做分支。 */
  bind(source: QueryResult | undefined, visible: readonly ResultColumn[], context: readonly unknown[], configuration: QueryResultOrganization | undefined, owner: unknown = source): QueryResultHistoryBinding | undefined {
    if (!source || !configuration) { this.invalidate(); return; }
    const old = this.binding;
    if (old?.source === source && this.owner === owner && old.visible === visible && old.context.length === context.length && context.every((value, index) => Object.is(value, old.context[index]))) return old;
    this.invalidate(); const binding = { source, visible, context: [...context] }; this.binding = binding; this.owner = owner;
    const initial = snapshot(configuration); if (initial) this.items = [initial]; else this.limited = true;
    return binding;
  }
  /** 只在原操作成功后记一整步；原样应用保留重做，超额不截断条件或改变当前视图。 */
  record(binding: QueryResultHistoryBinding | undefined, configuration: QueryResultOrganization, owner: unknown = this.owner): void {
    if (!binding || binding !== this.binding) throw Error(text.stale);
    const next = snapshot(configuration);
    // 原子应用新控制器后沿用同一历史；所有旧控制器票据同时失活。
    if (this.owner !== owner) { this.owner = owner; this.revision++; }
    if (!next) { this.items = []; this.cursor = 0; this.revision++; this.limited = true; return; }
    if (this.items[this.cursor]?.key === next.key) return;
    this.items = this.items.slice(0, this.cursor + 1); this.items.push(next);
    let units = this.items.reduce((sum, item) => sum + item.key.length, 0);
    while (this.items.length > queryResultHistoryLimits.steps + 1 || units > queryResultHistoryLimits.totalUnits) units -= this.items.shift()!.key.length;
    this.cursor = this.items.length - 1; this.revision++; this.limited = false;
  }
  /** 票据只预览目标；恢复验证失败时游标、原视图和重做记录均不移动。 */
  target(binding: QueryResultHistoryBinding | undefined, direction: -1 | 1): Ticket | undefined {
    if (!binding || binding !== this.binding || direction !== -1 && direction !== 1) return;
    const index = this.cursor + direction, item = this.items[index];
    if (item) return { binding, revision: this.revision, index, configuration: item.configuration };
  }
  /** 只有相同来源、游标代次和原目标副本可提交，不接收拼接或迟到票据。 */
  commit(ticket: Ticket, owner: unknown = this.owner): void {
    if (ticket.binding !== this.binding || ticket.revision !== this.revision || Math.abs(ticket.index - this.cursor) !== 1 || this.items[ticket.index]?.configuration !== ticket.configuration) throw Error(text.stale);
    this.cursor = ticket.index; this.revision++; this.owner = owner;
  }
}

/** 新控制器完整验证筛选再排序；原控制器在全部成功前保持原样，空结果也不回退全集。 */
export function prepareQueryResultOrganization(source: QueryResult, context: readonly unknown[], visible: ResultColumn[], configuration: QueryResultOrganization) {
  const filter = new QueryResultFilter(), sorter = new QueryResultSort(), binding = filter.bind(source, context, visible);
  if (!binding) throw Error(text.stale);
  const view = filter.applyExpression(binding, filter.view(binding)!, configuration.expression), sorted = sorter.bind(view.result, context, visible);
  if (!sorted) throw Error(text.stale);
  sorter.apply(sorted, sorter.view(sorted)!, configuration.sort);
  return { filter, sorter, filterBinding: binding, sortBinding: sorted };
}
