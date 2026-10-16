import type * as monaco from 'monaco-editor';
import type { QueryDatabaseContext } from '../shared/queryContext';
import { queryDatabasePatch } from '../shared/queryContext';
import { queryCloseZh as text } from './locales/queryClose.zh-CN';

export interface QueryCloseRequest { readonly tabId: string; }
/** 请求只存在窗口内存中，以对象身份区分同标签的不同关闭操作。 */
export class QueryCloseRequests {
  private current?: QueryCloseRequest;
  /** 有请求未终结时拒绝第二次申请。 */
  begin(tabId: string): QueryCloseRequest | undefined { if (this.current) return; return this.current = { tabId }; }
  /** 只有原请求对象可消费完成结果，旧返回不能关闭新标签。 */
  finish(request: QueryCloseRequest): boolean { if (this.current !== request) return false; this.current = undefined; return true; }
}
export interface QueryCloseScope {
  present: boolean; connection?: object; blocked?: boolean; connectionId: string; connectionVersion: number; sessionId: string;
  draft?: string; database?: string; databaseContext?: QueryDatabaseContext;
}
/** 同时保留旧database字段与显式类别，避免遗留/无库/未知互相等同。 */
const contextKey = (scope: Pick<QueryCloseScope, 'database' | 'databaseContext'>) => JSON.stringify([scope.database ?? null, scope.databaseContext?.state ?? 'legacy', scope.databaseContext?.state === 'known' ? scope.databaseContext.database : null]);

/** 一次保存后关闭的租约；任何正文或上下文变化永久失效，撤销回原文也不能复活。 */
export class QuerySaveCloseIntent {
  private valid = true;
  private readonly model: monaco.editor.ITextModel;
  private readonly version: number;
  private readonly sql: string;
  private readonly scope: QueryCloseScope;
  private context: string;
  private subscriptions: Array<{ dispose(): void }> = [];
  constructor(private readonly editor: monaco.editor.IStandaloneCodeEditor, private readonly readScope: () => QueryCloseScope, subscribe: (listener: () => void) => () => void, readonly ownsView: () => boolean, private readonly requestCurrent: () => boolean) {
    const model = editor.getModel(); if (!model || model.isDisposed()) throw Error(text.unavailable);
    this.model = model; this.version = model.getVersionId(); this.sql = model.getValue(); this.scope = readScope(); this.context = contextKey(this.scope);
    try {
      const invalidate = () => { this.valid = false; };
      this.subscriptions.push(model.onDidChangeContent(invalidate), model.onWillDispose(invalidate), editor.onDidChangeModel(invalidate), editor.onDidDispose(invalidate));
      this.subscriptions.push({ dispose: subscribe(() => { if (!this.matchesScope()) invalidate(); }) });
      this.assertCurrent();
    } catch (reason) { this.dispose(); throw reason; }
  }
  /** 库状态和路由只接受点击快照或保存自身明确采纳的状态。 */
  private matchesScope(): boolean {
    const current = this.readScope();
    return current.present && current.connection === this.scope.connection && !current.blocked && current.connectionId === this.scope.connectionId && current.connectionVersion === this.scope.connectionVersion && current.sessionId === this.scope.sessionId && current.draft === this.scope.draft && contextKey(current) === this.context;
  }
  /** 保存自身记下已核对的库类别是允许的；其它上下文变化不能借此重新授权。 */
  adoptContext(context: QueryDatabaseContext): void { this.assertCurrent(); this.context = contextKey(queryDatabasePatch(context)); }
  /** 每个await后重新读取；失败后永久撤销本次关闭权限。 */
  assertCurrent(): void {
    try { if (!this.valid || !this.ownsView() || !this.requestCurrent() || !this.matchesScope() || this.editor.getModel() !== this.model || this.model.isDisposed() || this.model.getVersionId() !== this.version || this.model.getValue() !== this.sql) throw Error(text.changed); }
    catch { this.valid = false; throw Error(text.changed); }
  }
  /** 成功写入也不等于仍可关闭，必须独立核对租约。 */
  isCurrent(): boolean { try { this.assertCurrent(); return true; } catch { return false; } }
  /** 终态释放模型和store监听，不把正文租约持久化。 */
  dispose(): void { this.valid = false; for (const item of this.subscriptions.splice(0)) item.dispose(); }
}
