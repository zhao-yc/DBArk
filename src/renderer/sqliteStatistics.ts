import { sqliteStatisticsInputSchema, assertSqliteStatistics, sqliteRowCountInputSchema, assertSqliteRowCount, type SqliteRowCountInput, type SqliteRowCountOutput, type SqliteStatisticsInput, type SqliteStatisticsOutput } from '../shared/sqliteStatistics';
import { sqliteStatisticsZh as text } from './locales/sqliteStatistics.zh-CN';

export interface SqliteStatisticsView { busy: boolean; stopping: boolean; error: string; output?: SqliteStatisticsOutput; rowCount?: string; }
interface Lease { owns(): boolean; release(): unknown; }
interface Operation { id: string; cancelled: boolean; sent: boolean; done: Promise<void>; cancel?: Promise<void>; lease?: Lease; }
interface Ports { base: Omit<SqliteRowCountInput, 'taskId'>; current(): boolean; acquire(): Lease; read(input: SqliteStatisticsInput): Promise<SqliteStatisticsOutput>; countRows(input: SqliteRowCountInput): Promise<SqliteRowCountOutput>; cancel(id: string): Promise<unknown>; id(): string; changed(view: SqliteStatisticsView): void; cleanup(reason: unknown): void; }
/** 概况显式读取整份有界结果；原Promise与取消ACK均结算后才释放自己的占用。 */
export class SqliteStatisticsController {
  view: SqliteStatisticsView = { busy: false, stopping: false, error: '' };
  private active?: Operation; private dead = false; private disposed = false; private readonly baseKey: string;
  constructor(private ports: Ports) { this.baseKey = JSON.stringify(ports.base); }
  /** 来源撤销永久失效，A→B→A不会重新接纳旧回包。 */
  current(): boolean { if (this.dead || this.disposed) return false; try { if (JSON.stringify(this.ports.base) === this.baseKey && this.ports.current()) return true; } catch {} this.dead = true; return false; }
  private emit(patch: Partial<SqliteStatisticsView>): void { this.view = { ...this.view, ...patch }; if (!this.disposed) this.ports.changed(this.view); }
  /** 字段变更只清旧结果，不能触发读取或取消其它任务。 */
  clear(): void { if (this.active || !this.current()) return; this.emit({ output: undefined, error: '' }); }
  /** 同帧连点只接纳一次，申请租约和投递前都核原来源，回包必须绑定准确请求。 */
  async read(column: string): Promise<void> {
    if (this.active || !this.current()) return;
    let input: SqliteStatisticsInput; try { input = sqliteStatisticsInputSchema.parse({ ...this.ports.base, column, taskId: this.ports.id() }); } catch { this.emit({ error: text.unavailable }); return; }
    await this.run(input, async () => ({ output: assertSqliteStatistics(await this.ports.read(input), input) }));
  }
  /** 计数不读取所选列，使用和字段概况相同的占用与取消屏障。 */
  async countRows(): Promise<void> {
    if (this.active || !this.current()) return;
    let input: SqliteRowCountInput; try { input = sqliteRowCountInputSchema.parse({ ...this.ports.base, taskId: this.ports.id() }); } catch { this.emit({ error: text.unavailable }); return; }
    await this.run(input, async () => ({ rowCount: assertSqliteRowCount(await this.ports.countRows(input), input).rows }));
  }
  /** 同一对话框一次只拥有一个任务，回包在原来源有效时发布。 */
  private async run(input: SqliteRowCountInput, read: () => Promise<Partial<SqliteStatisticsView>>): Promise<void> {
    const operation: Operation = { id: input.taskId, cancelled: false, sent: false, done: Promise.resolve() }; this.active = operation;
    operation.done = Promise.resolve().then(async () => {
      try {
        if (!this.current() || operation.cancelled) return; operation.lease = this.ports.acquire();
        if (!this.current() || operation.cancelled || !operation.lease.owns()) return;
        operation.sent = true; const output = await read();
        if (this.current() && !operation.cancelled && this.active === operation && operation.lease.owns()) this.emit(output);
      } catch (reason) { if (this.current() && !operation.cancelled) this.emit({ error: reason instanceof Error ? reason.message : String(reason) }); }
      finally { if (operation.cancel) await operation.cancel; operation.lease?.release(); if (this.active === operation) this.active = undefined; this.emit({ busy: false, stopping: false }); }
    }); this.emit({ busy: true, stopping: false, output: undefined, rowCount: undefined, error: '' }); await operation.done;
  }
  /** 只取消所属编号，不以ACK或观察超时猜测原任务已经完成。 */
  async stop(): Promise<void> {
    const operation = this.active; if (!operation) return; operation.cancelled = true; this.emit({ stopping: true, output: undefined, rowCount: undefined });
    if (operation.sent) operation.cancel ??= Promise.resolve().then(() => this.ports.cancel(operation.id)).then(() => {}, reason => { try { this.ports.cleanup(reason); } catch { /* 通知失败不解除原终态屏障。 */ } });
    await operation.done;
  }
  /** 来源观察只撤销本任务，组件布局重挂不能复活已失效的来源。 */
  observe(): void { if (!this.current() && this.active) void this.stop(); }
  activate(): void { this.disposed = false; }
  dispose(): void { this.disposed = true; void this.stop(); }
}
