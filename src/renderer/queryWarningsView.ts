import type { QueryOutcome } from '../shared/contracts';

export interface QueryWarningsViewScope {
  tabId: string; connectionId: string; connectionVersion: number; connection: unknown;
  sessionId: string; taskId: string; outcome: QueryOutcome | null;
  present: boolean; active: boolean; closing: boolean; busy: boolean; pinned: boolean;
}

/** 执行收据不随切换结果或编辑正文改变，但连接、会话、执行代次与关闭不可替换。 */
export function sameQueryWarningsExecution(before: QueryWarningsViewScope, now: QueryWarningsViewScope): boolean {
  return now.present && !now.closing && !!now.connection && now.tabId === before.tabId && now.connectionId === before.connectionId && now.connectionVersion === before.connectionVersion && now.connection === before.connection && (!before.sessionId || now.sessionId === before.sessionId) && now.taskId === before.taskId;
}

/** 已返回报告独立于草稿和结果排序；只绑定本次执行来源，离开再回来不能复活旧窗口。 */
export class QueryWarningsViewIntent {
  readonly report: NonNullable<QueryOutcome['warnings']>;
  private readonly origin: QueryWarningsViewScope;
  private valid = true;
  private unsubscribe: () => void;

  /** 打开时消费原执行收据并订阅来源变化，不查询数据库。 */
  constructor(private readonly read: () => QueryWarningsViewScope, subscribe: (changed: () => void) => () => void, private readonly invalidated: () => void, expected?: QueryWarningsViewScope) {
    this.origin = { ...(expected ?? read()) };
    if (!this.origin.outcome?.warnings) throw Error('本次执行没有警告报告');
    this.report = this.origin.outcome.warnings;
    this.unsubscribe = subscribe(() => { this.current(); });
    if (!this.current()) { this.dispose(); throw Error('警告报告来源已失效'); }
  }

  /** 任一身份或可操作状态变化即永久失效，来源恢复也不能复活旧窗口。 */
  current(): boolean {
    if (!this.valid) return false;
    const now = this.read(), before = this.origin;
    if (!now.present || !now.active || now.closing || now.busy || now.pinned || !now.connection || now.tabId !== before.tabId || now.connectionId !== before.connectionId || now.connectionVersion !== before.connectionVersion || now.connection !== before.connection || now.sessionId !== before.sessionId || now.taskId !== before.taskId || now.outcome !== before.outcome || now.outcome?.warnings !== this.report) {
      this.valid = false; this.unsubscribe?.(); this.invalidated();
    }
    return this.valid;
  }

  /** 关闭仅释放本窗口监听，不改变原会话、结果及诊断信息。 */
  dispose(): void { this.valid = false; this.unsubscribe?.(); }
}
