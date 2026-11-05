import { sqliteLayoutSnapshotSchema, sqliteLayoutPreferencesSchema, reconcileExactTableLayout,
  type SqliteLayoutTarget, type TableLayoutSnapshot, type TableLayoutSave, type TableLayoutInput } from '../shared/sqliteTableLayout';
import type { TablePreferences, TablePreferenceTarget } from '../shared/tablePreferences';
import { sqliteTableLayoutZh } from './locales/sqliteTableLayout.zh-CN';

export interface TableLayoutScope<T extends TablePreferenceTarget> { key: object; target: T; names: readonly string[]; current(): boolean; }
export type SqliteLayoutScope = TableLayoutScope<SqliteLayoutTarget>;
export interface SqliteLayoutView { preferences: TablePreferences; ready: boolean; pending: boolean; dirty: boolean; error: string; fromPreset?: boolean; }
interface Ports<T extends TablePreferenceTarget> {
  scope(): TableLayoutScope<T>;
  get(target: T): Promise<TableLayoutSnapshot<T>>;
  save(input: TableLayoutSave<T>): Promise<TableLayoutSnapshot<T>>;
  reset(input: TableLayoutInput<T>): Promise<TableLayoutSnapshot<T>>;
  changed(view: SqliteLayoutView): void;
  acquire(): { release(): void };
}
interface LayoutSchemas<T extends TablePreferenceTarget> {
  snapshot: { parse(raw: unknown): TableLayoutSnapshot<T> };
  preferences: { parse(raw: unknown): TablePreferences };
}
/** 每标签独立布局状态；所有异步结果绑定原路由，分页不会重置布局或行数据。 */
export class TableLayoutController<T extends TablePreferenceTarget> {
  private owner?: { key: object; valid: boolean; snapshot?: TableLayoutSnapshot<T>; busy: boolean };
  private disposed = false;
  view: SqliteLayoutView = { preferences: { version: 1, columns: [] }, ready: false, pending: false, dirty: false, error: '' };
  constructor(private ports: Ports<T>, private schemas: LayoutSchemas<T>, private text: Pick<typeof sqliteTableLayoutZh, 'stale' | 'source'>) {}
  /** 局部状态发布不发数据库请求，组件卸载后不再通知。 */
  private changeView(patch: Partial<SqliteLayoutView>): void { this.view = { ...this.view, ...patch }; if (!this.disposed) this.ports.changed(this.view); }
  /** 当前门异常或目标已换代时，旧owner永久失效。 */
  private current(owner = this.owner): boolean {
    if (!owner?.valid || this.disposed || this.owner !== owner) return false;
    try { const scope = this.ports.scope(); if (scope.key !== owner.key) { owner.valid = false; return false; } return scope.current(); } catch { owner.valid = false; return false; }
  }
  /** 接受严格回包；协议目标不匹配不授予保存CAS。 */
  private snapshot(raw: unknown, owner: NonNullable<typeof this.owner>): TableLayoutSnapshot<T> {
    const value = this.schemas.snapshot.parse(raw); if (!this.current(owner) || JSON.stringify(value.target) !== JSON.stringify(this.ports.scope().target)) throw Error(this.text.stale); return value;
  }
  /** 路由变更清来源；结构变化只按准确名称调和，不把分页视为新布局。 */
  sync(): void {
    if (this.disposed) return; const scope = this.ports.scope();
    if (!this.owner || this.owner.key !== scope.key) {
      if (this.owner) this.owner.valid = false;
      this.owner = { key: scope.key, valid: true, busy: false };
      this.changeView({ preferences: reconcileExactTableLayout(scope.names, null), ready: false, pending: false, dirty: false, error: '', fromPreset: undefined });
    }
    // 同一路由分页/刷新时暂时没有新页；这不是零字段结构，不能删除已恢复或未保存的布局。
    if (!scope.names.length) return;
    const next = reconcileExactTableLayout(scope.names, this.view.preferences);
    if (JSON.stringify(next) !== JSON.stringify(this.view.preferences)) this.changeView({ preferences: next });
    if (scope.names.length && !this.view.ready && !this.owner.busy && this.current()) void this.reload(this.view.fromPreset === true);
  }
  /** 显式重读保留失败时原布局；成功才整份恢复，不发SQL或释放编辑快照。 */
  async reload(preservePreset = false): Promise<void> {
    const owner = this.owner; if (!this.current(owner) || owner!.busy) return;
    owner!.busy = true; this.changeView({ pending: true, error: '' });
    try {
      const value = this.snapshot(await this.ports.get({ ...this.ports.scope().target }), owner!); owner!.snapshot = value;
      // 方案标签先得到首屏布局，再领取独立布局的保存修订。初次领取不覆盖方案显示。
      if (preservePreset && this.view.fromPreset) { this.changeView({ ready: true }); return; }
      const sourceChanged = !!value.preferences && value.connectionDigest !== value.source.connectionDigest;
      this.changeView({ preferences: reconcileExactTableLayout(this.ports.scope().names, sourceChanged ? null : value.preferences), ready: true, dirty: false, error: sourceChanged ? this.text.source : '', fromPreset: undefined });
    } catch (reason) { if (this.current(owner)) this.changeView({ ready: true, error: reason instanceof Error ? reason.message : String(reason) }); }
    finally { owner!.busy = false; if (this.owner === owner && !this.disposed) this.changeView({ pending: false }); }
  }
  /** 当前渲染表单整体变更，未知或缺失字段拒绝，至少保留一列。 */
  set(raw: unknown): void {
    if (!this.current() || this.owner!.busy || !this.view.ready) throw Error(this.text.stale);
    const preferences = this.schemas.preferences.parse(raw), names = this.ports.scope().names;
    if (preferences.columns.length !== names.length || preferences.columns.some(column => !names.includes(column.name))) throw Error(this.text.stale);
    this.changeView({ preferences, dirty: true, error: '' });
  }
  /** 查找命中隐藏列时显式揭示原字段；只改布局，不改变搜索定位或记录值。 */
  reveal(name: string): void {
    const column = this.view.preferences.columns.find(column => column.name === name); if (column?.hidden) this.set({ ...this.view.preferences, columns: this.view.preferences.columns.map(column => column.name === name ? { ...column, hidden: false } : column) });
  }
  /** 取消布局窗口可恢复打开时副本，不影响数据库草稿。 */
  restore(preferences: TablePreferences, dirty: boolean): void { if (!this.current() || this.owner!.busy) return; this.changeView({ preferences: reconcileExactTableLayout(this.ports.scope().names, preferences), dirty }); }
  /** 与成功读取的新表页一起应用。保留独立布局的 CAS，直到用户明确保存或重读默认。 */
  applyPreset(preferences: TablePreferences, names: readonly string[]): void {
    this.changeView({ preferences: reconcileExactTableLayout(names, preferences), dirty: false, error: '', fromPreset: true });
  }
  /** 本机持久化持有原工作区租约；旧回包不能改后继页，已落盘事实不自动重放。 */
  async persist(reset = false): Promise<void> {
    const owner = this.owner; if (!this.current(owner) || owner!.busy || !owner!.snapshot || !this.view.ready) throw Error(this.text.stale);
    const snapshot = owner!.snapshot!, input = { ...snapshot.target, expectedRevision: snapshot.revision, source: snapshot.source, bindingToken: snapshot.bindingToken }, preferences = this.schemas.preferences.parse(this.view.preferences);
    owner!.busy = true; let lease: { release(): void } | undefined;
    try {
      lease = this.ports.acquire(); this.changeView({ pending: true, error: '' });
      const value = this.snapshot(await (reset ? this.ports.reset(input) : this.ports.save({ ...input, preferences })), owner!); owner!.snapshot = value;
      this.changeView({ preferences: reconcileExactTableLayout(this.ports.scope().names, value.preferences), dirty: false, fromPreset: undefined });
    } catch (reason) { if (this.current(owner)) this.changeView({ error: reason instanceof Error ? reason.message : String(reason) }); }
    finally { owner!.busy = false; lease?.release(); if (this.owner === owner && !this.disposed) this.changeView({ pending: false }); }
  }
  /** 仅撤销回包交付权，不伪装在途持久化已撤回；原操作仍等待自己的finally。 */
  dispose(): void { this.disposed = true; if (this.owner) this.owner.valid = false; }
  /** React严格模式挂载重新准入新代，旧owner不复活。 */
  activate(): void { this.disposed = false; if (this.owner && !this.owner.valid) this.owner = undefined; this.sync(); }
}

export class SqliteTableLayoutController extends TableLayoutController<SqliteLayoutTarget> {
  constructor(ports: Ports<SqliteLayoutTarget>) {
    super(ports, { snapshot: sqliteLayoutSnapshotSchema, preferences: sqliteLayoutPreferencesSchema }, sqliteTableLayoutZh);
  }
}
