import { sqliteValueOptionsInputSchema, assertSqliteValueOptions, sqliteValueOptionsSelection, type SqliteValueOptionsInput, type SqliteValueOptionsOutput } from '../shared/sqliteValueOptions';
import { sqliteValueOptionsZh as text } from './locales/sqliteValueOptions.zh-CN';

export interface SqliteValuesView { busy: boolean; stopping: boolean; error: string; output?: SqliteValueOptionsOutput; }
interface Lease { owns(): boolean; release(): unknown; }
interface Operation { id: string; cancelled: boolean; sent: boolean; done: Promise<void>; cancel?: Promise<void>; lease?: Lease; }
interface Ports { base: Omit<SqliteValueOptionsInput, 'column' | 'search' | 'taskId'>; current(): boolean; acquire(): Lease; read(input: SqliteValueOptionsInput): Promise<SqliteValueOptionsOutput>; cancel(id: string): Promise<unknown>; id(): string; changed(view: SqliteValuesView): void; cleanup(reason: unknown): void; }
/** 候选读取的原Promise和取消ACK均结算后才释放自己的租约；旧页面不会接管后继请求。 */
export class SqliteValueOptionsController {
  view: SqliteValuesView = { busy: false, stopping: false, error: '' };
  private active?: Operation; private dead = false; private disposed = false;
  private readonly baseKey: string;
  constructor(private ports: Ports) { this.baseKey = JSON.stringify(ports.base); }
  /** 来源失败留下墓碑，A→B→A不复活旧回包。 */
  current(): boolean { if (this.dead || this.disposed) return false; try { if (JSON.stringify(this.ports.base) === this.baseKey && this.ports.current()) return true; } catch {} this.dead = true; return false; }
  private emit(patch: Partial<SqliteValuesView>): void { this.view = { ...this.view, ...patch }; if (!this.disposed) this.ports.changed(this.view); }
  /** 输入改变只清本机候选，不发送数据库请求。 */
  clear(): void { if (this.active || !this.current()) throw Error(text.unavailable); this.emit({ output: undefined, error: '' }); }
  /** 显式读取完整匹配集，严格回包必须对应原任务；关闭中迟到结果不再发布。 */
  async read(column: string, search: string): Promise<void> {
    if (this.active || !this.current()) return;
    let input: SqliteValueOptionsInput; try { input = sqliteValueOptionsInputSchema.parse({ ...this.ports.base, column, search, taskId: this.ports.id() }); } catch (reason) { this.emit({ error: reason instanceof Error ? reason.message : String(reason) }); return; }
    const operation: Operation = { id: input.taskId, cancelled: false, sent: false, done: Promise.resolve() }; this.active = operation;
    operation.done = Promise.resolve().then(async () => {
      try {
        if (!this.current() || operation.cancelled) return; operation.lease = this.ports.acquire();
        if (!this.current() || operation.cancelled || !operation.lease.owns()) return;
        operation.sent = true; const output = await this.ports.read(input);
        if (this.current() && !operation.cancelled && this.active === operation && operation.lease.owns()) this.emit({ output: assertSqliteValueOptions(output, input) });
      } catch (reason) { if (this.current() && !operation.cancelled) this.emit({ error: reason instanceof Error ? reason.message : String(reason) }); }
      finally {
        if (operation.cancel) await operation.cancel;
        operation.lease?.release(); if (this.active === operation) this.active = undefined; this.emit({ busy: false, stopping: false });
      }
    }); this.emit({ busy: true, stopping: false, output: undefined, error: '' }); await operation.done;
  }
  /** 取消不猜原读取已完成，原租约保留至两侧终态；异常仍向原窗口报告。 */
  async stop(): Promise<void> {
    const operation = this.active; if (!operation) return;
    operation.cancelled = true; this.emit({ stopping: true, output: undefined });
    if (operation.sent) operation.cancel ??= Promise.resolve().then(() => this.ports.cancel(operation.id)).then(() => {}, reason => { try { this.ports.cleanup(reason); } catch { /* 通知失败不解除原任务的终态屏障。 */ } });
    await operation.done;
  }
  /** 来源变化同步撤销交付，取消仅投递准确旧任务。 */
  observe(): void { if (!this.current() && this.active) void this.stop(); }
  /** 应用只返回原候选的完整typed集合；类型和128项预算再次检查。 */
  selection(indices: readonly number[]) { if (!this.current() || this.active || !this.view.output) throw Error(text.unavailable); return sqliteValueOptionsSelection(this.view.output, indices); }
  activate(): void { this.disposed = false; }
  dispose(): void { this.disposed = true; void this.stop(); }
}
