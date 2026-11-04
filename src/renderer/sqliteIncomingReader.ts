import { assertSqliteIncomingOutput, type SqliteIncomingInput, type SqliteIncomingOutput, type SqliteIncomingReference } from '../shared/sqliteIncoming';
import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { sqliteRelationshipName as fold } from '../shared/sqliteRelationships';
import { sqliteEditValueSchema, type SqliteOriginalValue } from '../shared/sqliteTableEdit';

export interface SqliteIncomingServices { read(input: SqliteIncomingInput): Promise<SqliteIncomingOutput>; cancel(taskId: string): Promise<unknown>; id(): string; }
interface Operation { id: string; sent: boolean; stopped: boolean; done: Promise<unknown>; cancel?: Promise<unknown>; }
/** 单任务占位与准确取消ACK共同持有原来源租约；旧页和迟到回复不得交接到新窗口。 */
export class SqliteIncomingReader {
  private dead = false;
  private operation?: Operation;
  constructor(readonly source: SqliteTablePage, private readonly values: readonly (SqliteOriginalValue | undefined)[], private readonly guard: () => boolean, private readonly services: SqliteIncomingServices) {}
  get busy(): boolean { return !!this.operation; }
  /** 来源一旦失效保留墓碑，不借相同标签或数据恢复。 */
  current(): boolean { if (!this.dead) try { if (!this.guard()) this.dead = true; } catch { this.dead = true; } return !this.dead; }
  invalidate(): void { this.dead = true; void this.stop().catch(() => undefined); }
  /** 同步登记读取，再微任务发送；未发送即停止时不取消不存在的后台任务。 */
  private run(request: SqliteIncomingInput): Promise<SqliteIncomingOutput> {
    if (!this.current() || this.operation) return Promise.reject(Error('原SQLite子记录来源已失效或仍在读取'));
    const op: Operation = { id: request.taskId, sent: false, stopped: false, done: Promise.resolve() }; this.operation = op;
    const work = (async () => {
      await Promise.resolve();
      try {
        if (!this.current() || op.stopped) throw Error('SQLite子记录读取已停止或来源变化');
        op.sent = true; const output = await this.services.read(request);
        if (!this.current() || op.stopped || this.operation !== op) throw Error('SQLite子记录读取已停止或来源变化');
        return assertSqliteIncomingOutput(output, request);
      } finally { await op.cancel?.catch(() => undefined); if (this.operation === op) this.operation = undefined; }
    })(); op.done = work; return work;
  }
  /** 目录不发送父键；只扫描main用户物理表的外键声明，不扫描业务行。 */
  catalog(): Promise<SqliteIncomingOutput> { return this.run({ connectionId: this.source.target.connectionId, database: 'main', table: this.source.target.table, schemaKey: this.source.schemaKey, taskId: this.services.id(), incoming: 'catalog' }); }
  /** 父键取原已保存行的typed值；新页强绑目录里的准确子表hash和外键编号。 */
  page(entry: SqliteIncomingReference, offset: number, limit = 50): Promise<SqliteIncomingOutput> {
    if (this.busy || !this.current()) return Promise.reject(Error('原子记录读取未结束或已失效'));
    if (!entry.referencedColumns) return Promise.reject(Error('外键父列无法解析，请核对原声明'));
    const values = entry.referencedColumns.map(name => {
      const index = this.source.columns.findIndex(column => fold(column.name) === fold(name)), value = this.values[index];
      if (index < 0 || value === undefined) throw Error('父键原值无法完整读取，不使用显示片段或默认值猜关联'); return sqliteEditValueSchema.parse(value);
    });
    return this.run({ connectionId: this.source.target.connectionId, database: 'main', table: this.source.target.table, schemaKey: this.source.schemaKey, taskId: this.services.id(), incoming: 'page', childTable: entry.table, childSchemaKey: entry.schemaKey, foreignKey: entry.key.ordinal, values, offset, limit });
  }
  /** 原读和准确取消响应都结束后才释放，不把取消ACK当作业务读取已完成。 */
  async stop(): Promise<void> {
    const op = this.operation; if (!op) return; op.stopped = true;
    if (op.sent) op.cancel ??= Promise.resolve().then(() => this.services.cancel(op.id));
    const settled = await Promise.allSettled([op.done, op.cancel]); if (settled[1].status === 'rejected') throw settled[1].reason;
  }
}
