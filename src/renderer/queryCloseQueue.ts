import type { WorkspaceTab } from './store';
import type { QueryCloseRequest } from './queryCloseIntent';
import { queryCloseZh as text } from './locales/queryClose.zh-CN';

interface QueueState { settings: { tabs: WorkspaceTab[] }; connections: object[]; connectionVersions: Record<string, number>; }
interface QueuePorts {
  read(): QueueState;
  subscribe(changed: () => void): () => void;
  close(tab: WorkspaceTab, queue: QueryCloseQueue): boolean | QueryCloseRequest;
  changed(running: boolean): void;
}
/** 单窗口串行队列：捕获对象与顺序，只有原关闭回执才能推进；不写store或保存持久状态。 */
export class QueryCloseQueue {
  #targets: WorkspaceTab[] = []; #keep?: WorkspaceTab; #index = 0; #request?: QueryCloseRequest;
  #commit?: QueryCloseRequest; #dispatchLease?: object; #requestLease?: object;
  #closed = new Set<WorkspaceTab>(); #versions = new Map<string, number>(); #profiles = new Map<string, object | undefined>();
  #running = false; #valid = true; #unsubscribe?: () => void; #adopting?: { before: WorkspaceTab; after: WorkspaceTab };
  constructor(private readonly ports: QueuePorts) {}
  get running() { return this.#running; }
  get pending() { return !!this.#request || !!this.#commit; }
  get awaitingCommit() { return this.#commit; }
  /** 同一队列只启动一次，保留查询和全部目标必须是当前准确对象。 */
  start(keep: WorkspaceTab): void {
    if (this.#keep || !this.#valid) return;
    const state = this.ports.read(); if (keep.kind !== 'query' || !state.settings.tabs.includes(keep)) return;
    this.#keep = keep; this.#targets = state.settings.tabs.filter(tab => tab.kind === 'query' && tab !== keep);
    if (new Set(state.settings.tabs.map(tab => tab.id)).size !== state.settings.tabs.length) { this.dispose(); return; }
    for (const tab of [keep, ...this.#targets]) { this.#versions.set(tab.connectionId, state.connectionVersions[tab.connectionId] ?? 0); this.#profiles.set(tab.connectionId, state.connections.find(profile => (profile as { id?: string }).id === tab.connectionId)); }
    this.#running = true; this.ports.changed(true); this.#unsubscribe = this.ports.subscribe(() => this.#inspect()); this.#advance();
  }
  /** 任意目标被移除、同ID重建或换连接都永久停链；新增标签不在快照内。 */
  #inspect(): boolean {
    if (!this.#valid || !this.#keep) return false;
    const state = this.ports.read();
    const watching = this.#running ? [this.#keep, ...this.#targets.filter(tab => !this.#closed.has(tab))] : this.#request && !this.#closed.has(this.#targets[this.#index]) ? [this.#targets[this.#index]] : [];
    for (const tab of watching) {
      const actual = state.settings.tabs.find(item => item.id === tab.id);
      if (actual !== tab) {
        const adoption = this.#adopting;
        if (actual && adoption?.before === tab && Object.keys(actual).length === Object.keys(adoption.after).length && Object.keys(adoption.after).every(key => actual[key as keyof WorkspaceTab] === adoption.after[key as keyof WorkspaceTab])) {
          this.#targets[this.#index] = actual; this.#adopting = undefined;
        } else { this.#valid = false; this.#stop(); return false; }
      }
      if ((state.connectionVersions[tab.connectionId] ?? 0) !== this.#versions.get(tab.connectionId) || state.connections.find(profile => (profile as { id?: string }).id === tab.connectionId) !== this.#profiles.get(tab.connectionId)) { this.#valid = false; this.#stop(); return false; }
    }
    return true;
  }
  /** 保存自身的明确同步更新可以接管新对象；不开放任意SQL、ID或连接变更。 */
  hooks(tab: WorkspaceTab): Pick<QueryCloseRequest, 'mutate' | 'failed'> {
    const lease = {}; this.#dispatchLease = lease;
    return { failed: () => { if (this.#request && this.#requestLease === lease) this.#stop(); }, mutate: (before, patch, update) => {
      if (!this.#request || this.#requestLease !== lease || !this.#inspect() || this.#targets[this.#index] !== before || before.id !== tab.id || Object.keys(patch).some(key => !['title', 'sourceBinding', 'database', 'databaseContext'].includes(key))) throw Error(text.changed);
      this.#adopting = { before, after: { ...before, ...patch } };
      try { update(); if (!this.#inspect()) throw Error(text.changed); } finally { this.#adopting = undefined; }
    } };
  }
  /** 仅App已通过原守卫的关闭操作可以移除当前准确对象，订阅不把自身关闭误判为外部删除。 */
  remove(tab: WorkspaceTab, remove: () => void): boolean {
    if (!this.#inspect() || this.#targets[this.#index] !== tab) return false;
    this.#closed.add(tab); remove(); return !this.ports.read().settings.tabs.some(item => item.id === tab.id);
  }
  owns(request: QueryCloseRequest): boolean { return this.#request === request; }
  /** 原请求取消、失败或未真正关闭即停止；旧回包不能消费新请求。 */
  finish(request: QueryCloseRequest, closed: boolean): void {
    if (!this.owns(request)) return;
    this.#request = undefined; this.#requestLease = undefined;
    if (!closed) this.#stop(); else if (this.#running) {
      this.#index++;
      if (this.#index < this.#targets.length) this.#commit = request; else this.#stop();
    }
    this.#releaseIfDone();
  }
  /** App真实提交后才允许下一项；准确旧请求票据只消费一次，外部弹窗或归属变化立即停链。 */
  committed(request: QueryCloseRequest, modalClear: boolean): void {
    if (this.#commit !== request || !this.#running) return;
    this.#commit = undefined;
    if (!modalClear || !this.#inspect()) { this.#stop(); return; }
    this.#advance();
  }
  /** 空草稿的原同步关闭也逐个完成；异步请求发出后立即等待，不抢跑下一项。 */
  #advance(): void {
    while (this.#running && this.#inspect() && this.#index < this.#targets.length) {
      const tab = this.#targets[this.#index]; this.#dispatchLease = undefined;
      const result = this.ports.close(tab, this);
      if (typeof result === 'object') { this.#request = result; this.#requestLease = this.#dispatchLease; this.#dispatchLease = undefined; return; }
      if (!result || this.ports.read().settings.tabs.some(item => item.id === tab.id)) { this.#stop(); return; }
      this.#index++;
    }
    if (this.#index === this.#targets.length) this.#stop();
  }
  /** 保存失败只停止批次；当前弹窗仍可按原单次路径重试，但不能继续下一目标。 */
  #stop(): void { if (this.#running) { this.#running = false; this.ports.changed(false); } this.#releaseIfDone(); }
  #releaseIfDone(): void {
    if (!this.#running && !this.#request) {
      this.#unsubscribe?.(); this.#unsubscribe = undefined; this.#valid = false; this.#keep = undefined;
      this.#commit = undefined; this.#dispatchLease = undefined; this.#requestLease = undefined;
      this.#targets = []; this.#closed.clear(); this.#versions.clear(); this.#profiles.clear();
    }
  }
  /** 卸载永久撤销，包括已停止但仍在等待单次保存回包的租约。 */
  dispose(): void { this.#valid = false; this.#stop(); this.#unsubscribe?.(); this.#unsubscribe = undefined; }
}
