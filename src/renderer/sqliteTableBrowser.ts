import { sqliteTableBrowseLimits, sqliteTablePageSchema, type SqliteTableColumn, type SqliteTableFilter, type SqliteTablePage, type SqliteTablePageInput } from '../shared/sqliteTableBrowse';
import { validateResultExportData } from '../shared/resultExport';
import { resultExportData } from './resultExport';
import { sqliteTableBrowseZh as text } from './locales/sqliteTableBrowse.zh-CN';

export type SqliteTableQuery = Pick<SqliteTablePageInput, 'limit' | 'mode' | 'filters' | 'sort'>;
export interface SqliteFilterDraft { id: string; column: string; operator: SqliteTableFilter['operator']; kind: NonNullable<SqliteTableFilter['value']>['kind']; value: string; }
export interface SqliteSortDraft { id: string; column: string; direction: 'asc' | 'desc'; }
export interface SqliteTableScope { tab: unknown; profile: unknown; connectionId: string; database?: string; table?: string; version: number; present: boolean; active: boolean; sqlite: boolean; editing?: boolean; }
interface BusyLease { owns(): boolean; release(): boolean; }
export interface SqliteTableView { busy: boolean; stopping: boolean; error: string; page?: SqliteTablePage; columns: SqliteTableColumn[]; }
interface Ports { scope(): SqliteTableScope; acquire(): BusyLease; read(input: SqliteTablePageInput): Promise<SqliteTablePage>; release?(snapshotId: string): Promise<unknown>; cancel(taskId: string): Promise<unknown>; id(): string; changed(view: SqliteTableView): void; subscribe(changed: () => void): () => void; }
interface Operation { generation: number; scope: SqliteTableScope; input: SqliteTablePageInput; done: Promise<void>; finish(): void; cancelled: boolean; sent: boolean; terminal: boolean; acquiring: boolean; lease?: BusyLease; cancel?: Promise<void>; }
/** 条件编辑只生成严格合同，NULL 不带值；不猜测列亲和性，也不执行 SQL。 */
export function sqliteTableDraft(scope: Pick<SqliteTableScope, 'connectionId' | 'database' | 'table'>, limit: number, mode: 'and' | 'or', filters: readonly SqliteFilterDraft[], sort: readonly SqliteSortDraft[]): SqliteTableQuery {
  const input = sqliteTablePageSchema.parse({ ...scope, taskId: 'sqlite-form-validation', offset: 0, limit, mode,
    filters: filters.map(filter => ({ column: filter.column, operator: filter.operator, ...(['isNull', 'notNull'].includes(filter.operator) ? {} : { value: { kind: filter.kind, value: filter.value } }) })), sort: sort.map(({ column, direction }) => ({ column, direction })) });
  return { limit: input.limit, mode: input.mode, filters: input.filters, sort: input.sort };
}
/** 回包必须对应准确目标与窗口，原值按导出合同检查，不能把错页或超限行交给网格。 */
export function assertSqliteTablePage(page: SqliteTablePage, input: SqliteTablePageInput): void {
  if (typeof page?.schemaKey !== 'string' || !/^[a-f0-9]{64}$/.test(page.schemaKey) || page.columns?.some(column => column.generated !== undefined && typeof column.generated !== 'boolean')) throw Error(text.invalidPage);
  if (!page || page.target?.connectionId !== input.connectionId || page.target.database !== input.database || page.target.table !== input.table || !['table', 'view'].includes(page.target.kind) || page.offset !== input.offset || page.limit !== input.limit || typeof page.hasMore !== 'boolean' || !Array.isArray(page.columns) || page.columns.length > sqliteTableBrowseLimits.columns || !page.result || !Array.isArray(page.result.columns) || page.columns.length !== page.result.columns.length || page.result.rows.length > input.limit || page.columns.some((column, index) => typeof column.name !== 'string' || typeof column.declaredType !== 'string' || page.result.columns[index]?.name !== column.name)) throw Error(text.invalidPage);
  validateResultExportData(resultExportData(page.result));
}
/** 请求串行持有准确 busy 租约；替换先取消旧 task 并等原 Promise 终态，绝不借取消响应猜读取已结束。 */
export class SqliteTableBrowser {
  private generation = 0; private wanted?: number; private operation?: Operation; private pageScope?: SqliteTableScope; private disposed = true; private unsubscribe?: () => void;
  private unadopted?: SqliteTablePage; private readonly released = new WeakSet<SqliteTablePage>(); private readonly adopted = new WeakSet<SqliteTablePage>();
  private view: SqliteTableView = { busy: false, stopping: false, error: '', columns: [] };
  constructor(private readonly ports: Ports) {}
  /** 严格模式恢复只重新订阅；旧请求仍保持已取消墓碑，不能重新获得交付权。 */
  activate(): void { this.disposed = false; this.unsubscribe?.(); this.unsubscribe = this.ports.subscribe(() => this.observe()); }
  /** 对象身份和修订同时验证，不能用相同名称复活旧目标。 */
  private same(scope: SqliteTableScope): boolean { const now = this.ports.scope(); return !this.disposed && now.present && now.active && now.sqlite && now.database === 'main' && now.table === scope.table && now.connectionId === scope.connectionId && now.tab === scope.tab && now.profile === scope.profile && now.version === scope.version; }
  /** busy 按真实在途操作和等待意图投影，不依赖 React 上一帧。 */
  private emit(patch: Partial<SqliteTableView> = {}): void { this.view = { ...this.view, ...patch, busy: !!this.operation || this.wanted !== undefined }; if (!this.disposed) this.ports.changed(this.view); }
  /** 只允许当前准确页用于复制与导出；别的作业接管后原读取不能释放其占用。 */
  pageCurrent(page: SqliteTablePage): boolean { return this.view.page === page && !!this.pageScope && this.same(this.pageScope) && !this.view.busy; }
  /** 编辑器构造成功后同步接管准确当前页；接管前任何失活/替换均由浏览器收尾。 */
  adopt(page: SqliteTablePage): boolean { if (this.unadopted !== page || !this.pageCurrent(page) || page.edit?.kind !== 'editable' || this.adopted.has(page) || this.released.has(page)) return false; this.unadopted = undefined; this.adopted.add(page); return true; }
  /** 只释放仍由浏览器持有的页面，构造失败或旧 effect 不能撤销已交接的草稿。 */
  releaseUnadopted(page = this.unadopted): void { if (page && this.unadopted === page) { this.unadopted = undefined; this.releaseSnapshot(page); } }
  /** 迟到及未交接页都只释放一次准确 snapshot；没有编辑能力的只读页不发送释放请求。 */
  private releaseSnapshot(page: SqliteTablePage): void {
    if (page.edit?.kind !== 'editable' || this.released.has(page) || this.adopted.has(page)) return;
    this.released.add(page);
    const report = (reason: unknown) => { if (!this.disposed) this.emit({ error: String(reason instanceof Error ? reason.message : reason) }); };
    try { void this.ports.release?.(page.edit.snapshotId).catch(report); } catch (reason) { report(reason); }
  }
  /** store 的同步通知留下永久失效墓碑，连接/标签 ABA 不会复活旧回包。 */
  observe(): void {
    const operation = this.operation;
    if (operation && (!this.same(operation.scope) || !operation.acquiring && !operation.terminal && operation.lease && !operation.lease.owns())) { this.wanted = undefined; this.generation++; void this.cancelOperation(operation); }
    if (this.pageScope && !this.same(this.pageScope)) { this.releaseUnadopted(); this.pageScope = undefined; this.emit({ page: undefined, columns: [] }); }
  }
  /** 取消仅投递准确原任务，取消失败仍保留原 Promise 的终态屏障。 */
  private async cancelOperation(operation: Operation): Promise<void> {
    operation.cancelled = true; this.emit({ stopping: !operation.terminal });
    if (!operation.sent || operation.terminal) return;
    operation.cancel ??= this.ports.cancel(operation.input.taskId).then(() => undefined, reason => { if (!this.disposed && this.operation === operation) this.emit({ error: String(reason instanceof Error ? reason.message : reason) }); });
    await operation.cancel;
  }
  /** 停止不清理其他查询会话或事务，只撤销本表原读取的交付权。 */
  async stop(): Promise<void> { this.generation++; this.wanted = undefined; const operation = this.operation; if (operation) { await this.cancelOperation(operation); await operation.done; } this.emit({ stopping: false }); }
  /** 配置先验证，准确旧任务真正结束后才取得下一次占用；读取成功后才发布当前页。 */
  async load(query: SqliteTableQuery, offset: number): Promise<void> {
    // 捕获各字段的本次值和引用；port 即使复用可变概要对象，也不能同时改写捕获侧。
    const scope = { ...this.ports.scope() };
    if (this.disposed || !scope.present || !scope.active || !scope.sqlite) return;
    let input: SqliteTablePageInput;
    try { input = sqliteTablePageSchema.parse({ connectionId: scope.connectionId, database: scope.database, table: scope.table, taskId: this.ports.id(), offset, ...query, ...(scope.editing ? { editing: true } : {}) }); }
    catch (reason) { this.emit({ error: scope.database !== 'main' ? text.unsupported : String(reason instanceof Error ? reason.message : reason) }); return; }
    const generation = ++this.generation; this.wanted = generation; this.releaseUnadopted(); this.pageScope = undefined; this.emit({ page: undefined, error: '' });
    const previous = this.operation;
    if (previous) { await this.cancelOperation(previous); await previous.done; }
    if (generation !== this.generation || !this.same(scope)) { if (this.wanted === generation) this.wanted = undefined; this.emit(); return; }
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const operation: Operation = { generation, scope, input, done, finish, cancelled: false, sent: false, terminal: false, acquiring: true }; this.operation = operation;
    try {
      operation.lease = this.ports.acquire(); operation.acquiring = false;
      if (operation.cancelled || generation !== this.generation || !this.same(scope) || !operation.lease.owns()) return;
      this.emit({ stopping: false }); operation.sent = true;
      const page = await this.ports.read(input); operation.terminal = true;
      if (!operation.cancelled && generation === this.generation && this.same(scope) && operation.lease.owns()) {
        try { assertSqliteTablePage(page, input); } catch (reason) { this.releaseSnapshot(page); throw reason; }
        this.pageScope = scope; if (page.edit?.kind === 'editable') this.unadopted = page;
        this.emit({ page, columns: page.columns, error: '' });
      } else this.releaseSnapshot(page);
    } catch (reason) { if (!operation.cancelled && generation === this.generation && this.same(scope)) this.emit({ error: String(reason instanceof Error ? reason.message : reason) }); }
    finally {
      operation.terminal = true; operation.acquiring = false;
      if (this.operation === operation) this.operation = undefined;
      operation.lease?.release(); if (this.wanted === generation) this.wanted = undefined;
      this.emit({ stopping: false, ...(operation.cancelled && this.wanted === undefined && !this.view.error ? { error: text.cancelled } : {}) }); finish();
    }
  }
  /** 卸载只取消准确旧任务；busy 等真实终态再按原租约释放，不同步清他人的作业。 */
  dispose(): void { this.disposed = true; this.unsubscribe?.(); this.unsubscribe = undefined; this.generation++; this.wanted = undefined; this.releaseUnadopted(); this.pageScope = undefined; const operation = this.operation; if (operation) void this.cancelOperation(operation); }
}
