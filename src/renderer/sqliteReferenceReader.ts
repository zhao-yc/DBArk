import { assertSqliteReferenceOutput, type SqliteReferenceInput, type SqliteReferenceOutput } from '../shared/sqliteReference';
import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { sqliteRelationshipName as fold, type SqliteRelationshipTable } from '../shared/sqliteRelationships';
import { sqliteEditValueSchema, type SqliteOriginalValue } from '../shared/sqliteTableEdit';

export interface SqliteReferenceServices { read(input: SqliteReferenceInput): Promise<SqliteReferenceOutput>; cancel(taskId: string): Promise<unknown>; id(): string; }
interface Operation { id: string; sent: boolean; stopped: boolean; done: Promise<unknown>; cancel?: Promise<unknown>; }
/** 仅一份独立读取；原Promise和取消ACK都终态前不放开父标签租约。 */
export class SqliteReferenceReader {
  private dead = false;
  private operation?: Operation;
  private parentKey?: string;
  private selected?: number;
  constructor(readonly source: SqliteTablePage, private readonly values: readonly (SqliteOriginalValue | undefined)[], private readonly guard: () => boolean, private readonly services: SqliteReferenceServices) {}
  get busy(): boolean { return !!this.operation; }
  /** 源失效留下永久墓碑，不借相同标签或配置恢复读取权。 */
  current(): boolean { if (!this.dead) try { if (!this.guard()) this.dead = true; } catch { this.dead = true; } return !this.dead; }
  invalidate(): void { this.dead = true; void this.stop().catch(() => undefined); }
  /** 在调用外部读端口前同步登记占用；后继读取、重入及迟到回包不能混用。 */
  private run(request: SqliteReferenceInput): Promise<SqliteReferenceOutput> {
    if (!this.current() || this.operation) return Promise.reject(Error('原SQLite外键来源已失效或仍在读取'));
    const op: Operation = { id: request.taskId, sent: false, stopped: false, done: Promise.resolve() }; this.operation = op;
    const work = (async () => {
      await Promise.resolve();
      try {
        if (!this.current() || op.stopped) throw Error('SQLite外键读取已停止或来源变化');
        op.sent = true; const output = await this.services.read(request);
        if (!this.current() || op.stopped || this.operation !== op) throw Error('SQLite外键读取已停止或来源变化');
        const value = assertSqliteReferenceOutput(output, request);
        if (request.reference === 'page') this.parentKey = value.page!.schemaKey;
        return value;
      } finally { await op.cancel?.catch(() => undefined); if (this.operation === op) this.operation = undefined; }
    })(); op.done = work; return work;
  }
  /** 目录读取不发送记录值；返回真实源表外键后才允许明确选择。 */
  catalog(): Promise<SqliteReferenceOutput> { if (this.busy || !this.current()) return Promise.reject(Error('原外键读取未结束或已失效')); this.parentKey = undefined; this.selected = undefined; return this.run({ connectionId: this.source.target.connectionId, database: 'main', table: this.source.target.table, schemaKey: this.source.schemaKey, taskId: this.services.id(), reference: 'catalog' }); }
  /** 只传所选映射的真实typed值，不从格式化网格或字段亲和性猜转换。 */
  page(key: SqliteRelationshipTable['foreignKeys'][number], offset: number, limit = 50): Promise<SqliteReferenceOutput> {
    if (this.busy || !this.current()) return Promise.reject(Error('原外键读取未结束或已失效'));
    if (this.selected !== key.ordinal) { this.parentKey = undefined; this.selected = key.ordinal; }
    const values = key.columns.map(name => {
      const index = this.source.columns.findIndex(column => fold(column.name) === fold(name)), value = this.values[index];
      if (index < 0 || value === undefined) throw Error('外键字段尚未填写或映射已变化，不使用数据库默认值猜父记录');
      return sqliteEditValueSchema.parse(value);
    });
    return this.run({ connectionId: this.source.target.connectionId, database: 'main', table: this.source.target.table, schemaKey: this.source.schemaKey, taskId: this.services.id(), reference: 'page', foreignKey: key.ordinal, values, offset, limit, ...(this.parentKey ? { parentSchemaKey: this.parentKey } : {}) });
  }
  /** 只取消准确原任务；不把取消响应当作业务读取已结束。 */
  async stop(): Promise<void> {
    const op = this.operation; if (!op) return; op.stopped = true;
    if (op.sent) op.cancel ??= Promise.resolve().then(() => this.services.cancel(op.id));
    const settled = await Promise.allSettled([op.done, op.cancel]); if (settled[1].status === 'rejected') throw settled[1].reason;
  }
}
