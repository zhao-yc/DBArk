import { randomUUID } from 'node:crypto';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import type { LocalStore } from './storage';
import { sqliteLayoutTargetSchema, sqliteLayoutResetSchema, sqliteLayoutSaveSchema, type SqliteLayoutSnapshot, type SqliteLayoutInput } from '../shared/sqliteTableLayout';

interface Ports { store: Pick<LocalStore, 'sqliteTableLayout' | 'saveSqliteTableLayout'>; assert(owner?: ColumnsInvocation): void; same(a: ColumnsInvocation, b: ColumnsInvocation): boolean; available(id: string): void; shuttingDown(): boolean; }
/** 本机布局令牌只属于真实Main文档；不签发文件、SQL或数据库任务能力。 */
export class SqliteTableLayoutMain {
  private tokens = new Map<string, { owner: ColumnsInvocation; target: string; source: string; expires: number }>();
  private last = -Infinity;
  constructor(private ports: Ports, private clock = () => performance.now()) {}
  /** 文档导航或销毁立即撤销，不依赖旧渲染进程清理。 */
  invalidate(): void { this.tokens.clear(); }
  /** 单调时钟异常撤销全部来源，禁止旧期限复活。 */
  private now(): number { const value = this.clock(); if (!Number.isFinite(value) || value < this.last) { this.invalidate(); throw Error('SQLite列布局来源期限失效'); } this.last = value; return value; }
  /** 同步保存前后及原IPC发布前均核对来源；已落盘事实单独报告。 */
  execute(kind: 'get' | 'save' | 'reset', raw: unknown, owner?: ColumnsInvocation): { value: SqliteLayoutSnapshot; publish(): void } {
    const input = kind === 'get' ? sqliteLayoutTargetSchema.parse(raw) : kind === 'save' ? sqliteLayoutSaveSchema.parse(raw) : sqliteLayoutResetSchema.parse(raw);
    const target = { connectionId: input.connectionId, database: input.database, table: input.table }, key = JSON.stringify(target); let saved = false;
    const check = () => {
      this.ports.assert(owner); if (!owner || this.ports.shuttingDown()) throw Error('SQLite列布局原窗口失效'); this.ports.available(target.connectionId);
      if (kind !== 'get') { const item = input as SqliteLayoutInput, token = this.tokens.get(item.bindingToken); if (!token || token.expires <= this.now() || token.target !== key || token.source !== JSON.stringify(item.source) || !this.ports.same(token.owner, owner)) throw Error('SQLite列布局来源失效，请重新读取'); }
    };
    check(); const snapshot = kind === 'get' ? this.ports.store.sqliteTableLayout(target) : this.ports.store.saveSqliteTableLayout(input, kind === 'reset', check); saved = kind !== 'get';
    let bindingToken: string;
    try {
      const now = this.now(); for (const [id, token] of this.tokens) if (token.expires <= now) this.tokens.delete(id);
      if (this.tokens.size >= 256) this.tokens.delete(this.tokens.keys().next().value!); bindingToken = randomUUID();
      this.tokens.set(bindingToken, { owner: owner!, target: key, source: JSON.stringify(snapshot.source), expires: now + 600000 });
    } catch (reason) { if (saved) throw Error('本机SQLite列布局已保存，但来源失效；请重新读取核对，不要自动重试'); throw reason; }
    return { value: { ...snapshot, bindingToken }, publish: () => {
      try { check(); const current = this.ports.store.sqliteTableLayout(target); if (current.revision !== snapshot.revision || JSON.stringify(current.source) !== JSON.stringify(snapshot.source)) throw Error('SQLite列布局状态已变化'); }
      catch (reason) { this.tokens.delete(bindingToken); if (saved) throw Error('本机SQLite列布局已保存，但原页面或状态已变化；请重新读取核对，不要自动重试'); throw reason; }
    } };
  }
}
