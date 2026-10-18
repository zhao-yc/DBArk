import type { TaskEvent, TaskRecord } from '../shared/contracts';
import { sameQueryFileSource, type QueryFileSourceProgress } from '../shared/queryFileSources';
import type { WorkspaceTab } from './store';
import { queryFilesZh as text } from './locales/queryFiles.zh-CN';

export interface QueryFileTaskState extends QueryFileSourceProgress {
  taskId: string; running: boolean; committed: boolean; cancelState: 'idle' | 'pending' | 'confirmed' | 'denied' | 'unknown';
  status: TaskRecord['status']; progress: number; message: string; startedAt: string;
}
interface Ports {
  read(): WorkspaceTab | undefined; ownsView(): boolean;
  subscribeDocument(changed: () => void): () => void;
  subscribeTask(changed: (event: TaskEvent) => void): () => void;
  cancel(input: { tabId: string; taskId: string }): Promise<{ cancelled: boolean }>;
  publish(state: QueryFileTaskState): void;
}
const owners = new Map<string, QueryFileTaskOperation>();
const context = (tab: WorkspaceTab) => JSON.stringify([tab.database ?? null, tab.databaseContext?.state ?? 'legacy', tab.databaseContext?.state === 'known' ? tab.databaseContext.database : null]);
const writeFact = (before: QueryFileTaskState['wrote'], after: QueryFileTaskState['wrote']) => before === 'yes' || after === 'yes' ? 'yes' : before === 'unknown' || after === 'unknown' ? 'unknown' : 'no';

/** 每项任务绑定一个真实文档世代；正文编辑可继续，关闭、换源、换连接/库或卸载会精确取消旧任务。 */
export class QueryFileTaskOperation {
  #state: QueryFileTaskState;
  #valid = true; #settled = false; #cancel?: Promise<void>; #unsubscribes: Array<() => void> = [];
  constructor(readonly snapshot: Readonly<WorkspaceTab>, taskId: string, operation: QueryFileSourceProgress['operation'], private readonly ports: Ports) {
    this.#state = { taskId, tabId: snapshot.id, operation, phase: 'choosing', bytesProcessed: 0, wrote: 'no', cancellable: false, running: true, committed: false, cancelState: 'idle', status: 'running', progress: 0, message: text.taskWaiting, startedAt: new Date().toISOString() };
    if (!this.documentCurrent()) throw Error(text.changed);
    if (owners.has(taskId)) throw Error(text.changed);
    owners.set(taskId, this);
    try {
      // 订阅先于调用方invoke；不把尚未收到可信阶段的任务直接当成可取消。
      this.#unsubscribes.push(ports.subscribeTask(event => this.#event(event)), ports.subscribeDocument(() => { if (!this.documentCurrent()) void this.cancel(true); }));
      this.#publish();
    } catch (reason) { this.dispose(); throw reason; }
  }
  /** 文档取消永久生效；旧taskId不能因同ID标签重建或来源ABA而恢复权限。 */
  documentCurrent(): boolean {
    const current = this.ports.read(), before = this.snapshot;
    if (!this.ports.ownsView() || !current || current.id !== before.id || current.kind !== 'query' || current.connectionId !== before.connectionId || current.sourceBinding !== before.sourceBinding || !sameQueryFileSource(current.fileSourceBinding, before.fileSourceBinding) || context(current) !== context(before)) this.#valid = false;
    return this.#valid;
  }
  /** 点击时检查当前阶段，而不是使用旧React闭包里的cancellable。 */
  canCancel(): boolean { return !this.#settled && this.#state.running && this.#valid && !this.#state.committed && this.#state.cancellable && this.#state.cancelState === 'idle'; }
  /** 真实文档失效也发送精确取消；提交点后Main可返回false，不能据此声明已撤销文件。 */
  cancel(documentInvalidated = false): Promise<void> {
    if (this.#settled || this.#cancel || this.#state.cancelState !== 'idle' || !documentInvalidated && !this.canCancel()) return this.#cancel ?? Promise.resolve();
    this.#state = { ...this.#state, cancelState: 'pending', cancellable: false }; this.#publish();
    this.#cancel = this.ports.cancel({ tabId: this.snapshot.id, taskId: this.#state.taskId }).then(result => {
      if (!this.#settled) { this.#state = { ...this.#state, cancelState: result.cancelled ? 'confirmed' : 'denied' }; this.#publish(); }
    }).catch(() => { if (!this.#settled) { this.#state = { ...this.#state, cancelState: 'unknown' }; this.#publish(); } });
    return this.#cancel;
  }
  /** 任务事件只接收准确编号、tab与操作；写入事实及提交点不可被迟到旧阶段降级。 */
  #event(event: TaskEvent): void {
    const value = event.queryFileSource;
    if (this.#settled || event.taskId !== this.#state.taskId || !value || value.tabId !== this.snapshot.id || value.operation !== this.#state.operation) return;
    if (!this.#state.running && event.status === 'running') return;
    const committed = this.#state.committed || ['replacing', 'verifying', 'recording'].includes(value.phase) || value.wrote !== 'no';
    this.#state = { ...this.#state, phase: value.phase, bytesProcessed: value.bytesProcessed, ...(value.totalBytes === undefined ? {} : { totalBytes: value.totalBytes }), wrote: writeFact(this.#state.wrote, value.wrote), committed, running: event.status === 'running', status: event.status, progress: event.progress, message: text.taskPhases[value.phase], cancellable: !committed && event.status === 'running' && value.cancellable && this.#state.cancelState === 'idle' };
    this.#publish();
  }
  /** RPC实际结果决定终态；即便请求过取消，saved仍是已写/已确认，不能改报未写。 */
  finish(result: { state: 'saved'; unchanged?: boolean } | { state: 'opened' | 'cancelled' } | { state: 'blocked'; message: string; wrote: QueryFileTaskState['wrote'] }): QueryFileTaskState['wrote'] {
    if (this.#settled) return this.#state.wrote;
    this.#settled = true;
    const wrote = writeFact(this.#state.wrote, result.state === 'saved' && !result.unchanged ? 'yes' : result.state === 'blocked' ? result.wrote : 'no');
    const cancelled = result.state === 'cancelled' && wrote === 'no';
    this.#state = { ...this.#state, wrote, phase: 'terminal', running: false, cancellable: false, progress: 100,
      status: result.state === 'saved' || result.state === 'opened' ? 'completed' : cancelled ? 'cancelled' : 'failed',
      message: result.state === 'saved' ? text.taskSaved : result.state === 'opened' ? text.taskOpened : cancelled ? text.taskCancelled : result.state === 'blocked' ? result.message : wrote === 'yes' ? text.wroteYes : text.wroteUnknown };
    this.#publish(); this.dispose(); return wrote;
  }
  /** 发布字段严格来自进度合同与固定中文；不含路径、SQL或系统异常。 */
  #publish(): void { this.ports.publish({ ...this.#state }); }
  /** 收尾只释放本项订阅和注册；不会借旧任务删除来源或清除其它作业。 */
  dispose(): void { for (const off of this.#unsubscribes.splice(0)) off(); if (owners.get(this.#state.taskId) === this) owners.delete(this.#state.taskId); }
}
/** 任务中心只控制当前窗口仍持有的准确任务，不走普通SQL取消命令。 */
export function canCancelQueryFileTask(taskId: string): boolean { return owners.get(taskId)?.canCancel() === true; }
/** Main确认前不把任务标成cancelled，提交点后的结果仍由原RPC及事件结算。 */
export async function cancelQueryFileTask(taskId: string): Promise<void> { await owners.get(taskId)?.cancel(); }
