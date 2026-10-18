import { sameQueryFileSource } from '../shared/queryFileSources';
import type { WorkspaceTab } from './store';

/** 保存回包只获得推进原来源基线的权限；正文和标题允许继续编辑，来源离开后永久失效。 */
export class QuerySourceLease {
  #valid = true;
  #titleUnchanged = true;
  #unsubscribe: () => void;
  constructor(readonly snapshot: Readonly<WorkspaceTab>, private readonly read: () => WorkspaceTab | undefined, subscribe: (changed: () => void) => () => void, private readonly ownsView: () => boolean) {
    this.#unsubscribe = subscribe(() => { if (!this.#matches()) this.#valid = false; if (read()?.title !== snapshot.title) this.#titleUnchanged = false; });
  }
  /** 比较文件修订与查询库来源；不因保存期间的新正文覆盖或恢复旧SQL。 */
  #matches(): boolean {
    const current = this.read(), before = this.snapshot;
    return !!current && current.kind === 'query' && current.id === before.id && current.connectionId === before.connectionId && current.sourceBinding === before.sourceBinding && sameQueryFileSource(current.fileSourceBinding, before.fileSourceBinding);
  }
  /** 来源离开或视图卸载即永久失效，恢复同值不重新授予权限。 */
  current(): boolean { if (!this.ownsView() || !this.#matches()) this.#valid = false; return this.#valid; }
  /** 标题编辑不阻止推进文件基线，但旧文件名不能覆盖曾经改动的标题。 */
  titleUnchanged(): boolean { if (this.read()?.title !== this.snapshot.title) this.#titleUnchanged = false; return this.#titleUnchanged; }
  /** 回包消费一次；应用者只能提交来源基线和仍未改动的标题，不提交旧正文。 */
  apply(update: (current: WorkspaceTab, adoptTitle: boolean) => void): boolean {
    if (!this.current()) return false;
    const current = this.read()!, title = this.titleUnchanged(); this.dispose(); update(current, title); return true;
  }
  /** 终态释放store订阅；重复清理不会重新激活旧意图。 */
  dispose(): void { this.#valid = false; this.#unsubscribe(); }
}

/** 切换主来源时真正移除另一字段，避免strict设置合同将显式undefined误作有效绑定。 */
export function querySourceTab(tab: WorkspaceTab, patch: Partial<WorkspaceTab>, source: 'file' | 'library'): WorkspaceTab {
  const next = { ...tab, ...patch };
  if (source === 'file') delete next.sourceBinding; else delete next.fileSourceBinding;
  return next;
}
