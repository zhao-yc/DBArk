import { randomUUID } from 'node:crypto';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import type { LocalStore } from './storage';
import { sqliteTablePresetTargetSchema, sqliteTablePresetSaveSchema, sqliteTablePresetSelectSchema, type SqliteTablePresetTarget, type SqliteTablePresetStoredSnapshot, type SqliteTablePresetSnapshot, type SqliteTablePresetQuery } from '../shared/sqliteTablePresets';

export type SqlitePresetCommand = 'list' | 'save' | 'delete' | 'read';
interface Ports {
  store: Pick<LocalStore, 'sqliteTablePresets' | 'saveSqliteTablePreset' | 'deleteSqliteTablePreset' | 'selectedSqliteTablePreset'>;
  assert(owner?: ColumnsInvocation): void;
  same(left: ColumnsInvocation, right: ColumnsInvocation): boolean;
  available(connectionId: string): void;
  shuttingDown(): boolean;
}

/** 方案仅授予本机配置读写；令牌绑定真实文档、精确目标及连接来源，不授予SQL或文件能力。 */
export class SqliteTablePresetMain {
  private readonly tokens = new Map<string, { owner: ColumnsInvocation; target: string; source: string; expires: number }>();
  private last = -Infinity;
  constructor(private readonly ports: Ports, private readonly clock = () => performance.now()) {}
  /** 单调期限回退或异常时撤销全部令牌，墙钟调整不能复活来源。 */
  private now(): number {
    const value = this.clock(); if (!Number.isFinite(value) || value < this.last) { this.invalidate(); throw Error('SQLite方案来源期限失效，请刷新'); }
    this.last = value; return value;
  }
  /** 缺少真实捕获、窗口失效、连接过渡或客户端退出时拒绝，不回退到默认有效回调。 */
  private check(owner: ColumnsInvocation | undefined, target: SqliteTablePresetTarget): asserts owner is ColumnsInvocation {
    this.ports.assert(owner); if (!owner || this.ports.shuttingDown()) throw Error('原窗口已失效或客户端正在退出'); this.ports.available(target.connectionId);
  }
  /** 成功读取/变更后签发独立来源；最多256个，不延长已签发令牌。 */
  private issue(owner: ColumnsInvocation, snapshot: SqliteTablePresetStoredSnapshot): SqliteTablePresetSnapshot {
    const now = this.now(); for (const [key, token] of this.tokens) if (token.expires <= now) this.tokens.delete(key);
    if (this.tokens.size >= 256) this.tokens.delete(this.tokens.keys().next().value!);
    const bindingToken = randomUUID(); this.tokens.set(bindingToken, { owner, target: JSON.stringify(snapshot.target), source: JSON.stringify(snapshot.source), expires: now + 600000 });
    return { ...snapshot, bindingToken };
  }
  /** 来源与文档先校验；修订CAS由真实LocalStore在同步事务内再次核对。 */
  private bound(owner: ColumnsInvocation, input: { bindingToken: string; source: unknown } & SqliteTablePresetTarget): void {
    const token = this.tokens.get(input.bindingToken), target = { connectionId: input.connectionId, database: input.database, table: input.table };
    if (!token || token.expires <= this.now() || token.target !== JSON.stringify(target) || token.source !== JSON.stringify(input.source) || !this.ports.same(token.owner, owner)) throw Error('SQLite方案来源或目标已变化，请刷新');
  }
  /** 导航、崩溃或窗口销毁撤销全部来源，旧同URL文档不得领取后继能力。 */
  invalidate(): void { this.tokens.clear(); }
  /** 全部操作同步访问本机存储；发布前再核状态，已落盘的事实不因后续撤权伪装为未保存。 */
  execute(command: SqlitePresetCommand, raw: unknown, owner?: ColumnsInvocation): { value: SqliteTablePresetSnapshot | SqliteTablePresetQuery; publish(): void } {
    const input = command === 'list' ? sqliteTablePresetTargetSchema.parse(raw) : command === 'save' ? sqliteTablePresetSaveSchema.parse(raw) : sqliteTablePresetSelectSchema.parse(raw);
    const target = sqliteTablePresetTargetSchema.parse({ connectionId: input.connectionId, database: input.database, table: input.table }); this.check(owner, target);
    let saved = false, snapshot: SqliteTablePresetStoredSnapshot;
    const assertCurrent = () => { this.check(owner, target); if (command !== 'list') this.bound(owner, input as Parameters<SqliteTablePresetMain['bound']>[1]); };
    assertCurrent();
    if (command === 'save') { snapshot = this.ports.store.saveSqliteTablePreset(input, assertCurrent); saved = true; }
    else if (command === 'delete') { snapshot = this.ports.store.deleteSqliteTablePreset(input, assertCurrent); saved = true; }
    else snapshot = this.ports.store.sqliteTablePresets(target);
    let value: SqliteTablePresetSnapshot | SqliteTablePresetQuery;
    try { value = command === 'read' ? this.ports.store.selectedSqliteTablePreset(input) : this.issue(owner, snapshot); }
    catch (reason) { if (saved) throw Error('本机SQLite方案已保存，但来源签发失败；请刷新核对，不要自动重试'); throw reason; }
    return { value, publish: () => {
      try {
        assertCurrent(); const current = this.ports.store.sqliteTablePresets(target);
        if (current.revision !== snapshot.revision || JSON.stringify(current.source) !== JSON.stringify(snapshot.source)) throw Error('SQLite方案状态已变化，请刷新');
        if (command === 'read') this.ports.store.selectedSqliteTablePreset(input);
      } catch (reason) {
        if ('bindingToken' in value) this.tokens.delete(value.bindingToken);
        if (saved) throw Error('本机SQLite方案已保存，但原页面或状态已变化；请刷新核对，不要自动重试');
        throw reason;
      }
    } };
  }
}
