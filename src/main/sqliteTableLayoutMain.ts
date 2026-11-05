import { randomUUID } from 'node:crypto';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import type { LocalStore } from './storage';
import { sqliteLayoutTargetSchema, sqliteLayoutResetSchema, sqliteLayoutSaveSchema, type SqliteLayoutTarget, type TableLayoutSnapshot, type TableLayoutInput } from '../shared/sqliteTableLayout';
import type { TablePreferenceTarget } from '../shared/tablePreferences';

type Schema<T> = { parse(raw: unknown): T };
interface LayoutStore<T extends TablePreferenceTarget> {
  get(target: T): Omit<TableLayoutSnapshot<T>, 'bindingToken'>;
  save(input: unknown, reset: boolean, assertCurrent: () => void): Omit<TableLayoutSnapshot<T>, 'bindingToken'>;
}
interface LayoutSchemas<T extends TablePreferenceTarget> {
  target: Schema<T>;
  reset: Schema<TableLayoutInput<T>>;
  save: Schema<TableLayoutInput<T>>;
}

interface Ports { store: Pick<LocalStore, 'sqliteTableLayout' | 'saveSqliteTableLayout'>; assert(owner?: ColumnsInvocation): void; same(a: ColumnsInvocation, b: ColumnsInvocation): boolean; available(id: string): void; shuttingDown(): boolean; }
/** 本机布局令牌只属于真实Main文档；不签发文件、SQL或数据库任务能力。 */
export class TableLayoutMain<T extends TablePreferenceTarget> {
  private tokens = new Map<string, { owner: ColumnsInvocation; target: string; source: string; expires: number }>();
  private last = -Infinity;
  constructor(private ports: Omit<Ports, 'store'>, private store: LayoutStore<T>, private schemas: LayoutSchemas<T>,
    private driver: string, private clock = () => performance.now()) {}
  /** 文档导航或销毁立即撤销，不依赖旧渲染进程清理。 */
  invalidate(): void { this.tokens.clear(); }
  /** 单调时钟异常撤销全部来源，禁止旧期限复活。 */
  private now(): number { const value = this.clock(); if (!Number.isFinite(value) || value < this.last) { this.invalidate(); throw Error(`${this.driver}列布局来源期限失效`); } this.last = value; return value; }
  /** 同步保存前后及原IPC发布前均核对来源；已落盘事实单独报告。 */
  execute(kind: 'get' | 'save' | 'reset', raw: unknown, owner?: ColumnsInvocation): { value: TableLayoutSnapshot<T>; publish(): void } {
    const input = kind === 'get' ? this.schemas.target.parse(raw) : kind === 'save' ? this.schemas.save.parse(raw) : this.schemas.reset.parse(raw);
    const target = this.schemas.target.parse({ connectionId: input.connectionId, database: input.database, table: input.table }), key = JSON.stringify(target); let saved = false;
    const check = () => {
      this.ports.assert(owner); if (!owner || this.ports.shuttingDown()) throw Error(`${this.driver}列布局原窗口失效`); this.ports.available(target.connectionId);
      if (kind !== 'get') { const item = input as TableLayoutInput<T>, token = this.tokens.get(item.bindingToken); if (!token || token.expires <= this.now() || token.target !== key || token.source !== JSON.stringify(item.source) || !this.ports.same(token.owner, owner)) throw Error(`${this.driver}列布局来源失效，请重新读取`); }
    };
    check(); const snapshot = kind === 'get' ? this.store.get(target) : this.store.save(input, kind === 'reset', check); saved = kind !== 'get';
    let bindingToken: string;
    try {
      const now = this.now(); for (const [id, token] of this.tokens) if (token.expires <= now) this.tokens.delete(id);
      if (this.tokens.size >= 256) this.tokens.delete(this.tokens.keys().next().value!); bindingToken = randomUUID();
      this.tokens.set(bindingToken, { owner: owner!, target: key, source: JSON.stringify(snapshot.source), expires: now + 600000 });
    } catch (reason) { if (saved) throw Error(`本机${this.driver}列布局已保存，但来源失效；请重新读取核对，不要自动重试`); throw reason; }
    return { value: { ...snapshot, bindingToken }, publish: () => {
      try { check(); const current = this.store.get(target); if (current.revision !== snapshot.revision || JSON.stringify(current.source) !== JSON.stringify(snapshot.source)) throw Error(`${this.driver}列布局状态已变化`); }
      catch (reason) { this.tokens.delete(bindingToken); if (saved) throw Error(`本机${this.driver}列布局已保存，但原页面或状态已变化；请重新读取核对，不要自动重试`); throw reason; }
    } };
  }
}

/** 保留 SQLite 入口及严格 main 目标，PostgreSQL 使用独立的令牌空间。 */
export class SqliteTableLayoutMain extends TableLayoutMain<SqliteLayoutTarget> {
  constructor(ports: Ports, clock?: () => number) {
    super(ports, {
      get: target => ports.store.sqliteTableLayout(target),
      save: (input, reset, check) => ports.store.saveSqliteTableLayout(input, reset, check),
    }, { target: sqliteLayoutTargetSchema, reset: sqliteLayoutResetSchema, save: sqliteLayoutSaveSchema }, 'SQLite', clock);
  }
}
