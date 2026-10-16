import type { FilterRule, SortRule } from '../shared/contracts';
import { rowEqual } from './lib';
import type { DraftRow } from './dataChanges';
import type { RecordTarget } from './recordViews';
import { maxTablePage } from './tableFilters';

export interface RecordPageScope { target: RecordTarget; connectionVersion: number; refreshVersion: number; pageSize: number; filters: FilterRule[]; filterMode: string; sort: SortRule[]; }
export interface RecordPageContext { scope: string; page: number; generation: number; active: boolean; formOpen: boolean; stale: boolean; }
export interface RecordPageTicket { readonly action: number; readonly scope: string; readonly fromPage: number; readonly page: number; readonly fromGeneration: number; readonly key: string; readonly direction: -1 | 1; generation?: number; rows?: DraftRow[]; }
export interface RecordPageNavigationView { previous: boolean; next: boolean; message: string; onNavigate(direction: -1 | 1): void; }
export type RecordPageBegin = { kind: 'ready'; ticket: RecordPageTicket } | { kind: 'busy' | 'dirty' | 'boundary' | 'unavailable' };

/** 条件只用于内存身份比较，不持久化或记录筛选值；页码独立绑定目标页。 */
export function recordPageScope(value: RecordPageScope): string { return JSON.stringify([value.target.connectionId, value.target.database, value.target.table, value.connectionVersion, value.refreshVersion, value.pageSize, value.filters, value.filterMode, value.sort]); }

/** 包含非当前行、新增后删除的行；任何草稿都不能在连续浏览时被隐式放弃。 */
export function recordPageHasDrafts(rows: readonly DraftRow[], inputDirty: boolean): boolean {
  return inputDirty || rows.some(row => row.inserted || row.deleted || !row.original || !rowEqual(row.original, row.data));
}

/** 一次用户跨页意图只绑定一次真实加载，完成后仅兑换一次首末行选择。 */
export class RecordPageNavigation {
  private ticket?: RecordPageTicket;
  private action = 0;
  get revision() { return this.action; }
  get pending() { return !!this.ticket; }

  /** 普通翻页、新条件、结构刷新、切换对象或卸载永久撤销旧意图，ABA 不会复活。 */
  cancel() { this.ticket = undefined; this.action++; }
  observe(context: RecordPageContext) {
    const ticket = this.ticket; if (!ticket) return;
    if (!context.active || !context.formOpen || context.stale || context.scope !== ticket.scope || (ticket.generation === undefined ? context.page !== ticket.fromPage && context.page !== ticket.page : context.page !== ticket.page || context.generation !== ticket.generation)) this.cancel();
  }

  /** 不暂存、不确认放弃、不发送请求；忙态连点保留原意图，不重复读取。 */
  begin(context: RecordPageContext, input: { rows: DraftRow[]; rowId?: string; key: string; direction: -1 | 1; hasMore: boolean; busy: boolean; inputDirty: boolean }): RecordPageBegin {
    if (this.ticket || input.busy) return { kind: 'busy' };
    if (recordPageHasDrafts(input.rows, input.inputDirty)) return { kind: 'dirty' };
    if (!context.active || !context.formOpen || context.stale || !input.key) return { kind: 'unavailable' };
    const index = input.rows.findIndex(row => row.id === input.rowId);
    if (input.rows.length && (index < 0 || index !== (input.direction === 1 ? input.rows.length - 1 : 0))) return { kind: 'unavailable' };
    if (input.direction === -1 ? context.page <= 1 : !input.hasMore || context.page >= maxTablePage || !input.rows.length) return { kind: 'boundary' };
    const ticket: RecordPageTicket = { action: ++this.action, scope: context.scope, fromPage: context.page, page: context.page + input.direction, fromGeneration: context.generation, key: input.key, direction: input.direction };
    this.ticket = ticket; return { kind: 'ready', ticket };
  }

  /** 只有跨页引起的首次目标页加载能领取；其它读取仍执行原流程，但撤销自动选行。 */
  claim(context: RecordPageContext): RecordPageTicket | undefined {
    const ticket = this.ticket;
    if (!ticket || ticket.generation !== undefined || context.scope !== ticket.scope || context.page !== ticket.page || context.generation <= ticket.fromGeneration || !context.active || !context.formOpen || context.stale) { this.cancel(); return undefined; }
    ticket.generation = context.generation; return ticket;
  }

  /** 结果必须来自该次实际读取；空页明确结束，不循环找下一页或猜测总量。 */
  complete(ticket: RecordPageTicket, context: RecordPageContext, rows: DraftRow[]): boolean {
    if (!this.current(ticket, context)) return false;
    ticket.rows = rows; if (!rows.length) this.ticket = undefined; return true;
  }
  fail(ticket: RecordPageTicket, context: RecordPageContext): boolean {
    if (!this.current(ticket, context)) return false;
    this.ticket = undefined; return true;
  }
  private current(ticket: RecordPageTicket, context: RecordPageContext) {
    // 旧请求不能撤销新请求；当前意图一旦观察到身份变化，则立即永久失效。
    if (this.ticket !== ticket || ticket.action !== this.action) return false;
    if (ticket.scope !== context.scope || context.page !== ticket.page || ticket.generation !== context.generation || !context.active || !context.formOpen || context.stale) { this.cancel(); return false; }
    return true;
  }

  /** React 提交真实新页后才兑换 UUID；草稿、快照变化或新动作均不能沿用旧选择。 */
  consume(context: RecordPageContext, rows: DraftRow[], inputDirty: boolean, busy: boolean): { rowId: string; key: string } | undefined {
    const ticket = this.ticket; if (!ticket?.rows || busy) return;
    if (!this.current(ticket, context) || ticket.rows !== rows || recordPageHasDrafts(rows, inputDirty)) { this.cancel(); return; }
    this.ticket = undefined;
    const row = ticket.direction === 1 ? rows[0] : rows.at(-1);
    return row ? { rowId: row.id, key: ticket.key } : undefined;
  }
}
