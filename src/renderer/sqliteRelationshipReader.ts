import type { DatabaseObject } from '../shared/contracts';
import { sqliteRelationshipName, sqliteRelationshipsInputSchema, type SqliteRelationshipsInput, type SqliteRelationshipsOutput } from '../shared/sqliteRelationships';
import { captureSqliteRelationshipDiagram } from './sqliteRelationshipDiagram';
import { relationshipDiagramLimits, type RelationshipDiagram } from './relationshipDiagram';
import { relationshipDiagramZh as text } from './locales/relationshipDiagram.zh-CN';

export interface SqliteRelationshipServices {
  objects(target: { connectionId: string; database: 'main' }): Promise<DatabaseObject[]>;
  read(input: SqliteRelationshipsInput): Promise<SqliteRelationshipsOutput>;
  cancel(taskId: string): Promise<unknown>;
}
interface Operation { promise: Promise<unknown>; stopped: boolean; taskId?: string; cancel?: Promise<unknown>; }
/** 一轮整图快照，停止和关闭均等原读取及取消ACK；永久失效不因恢复同名目标而复活。 */
export class SqliteRelationshipReader {
  private operation?: Operation;
  private dead = false;
  private readonly target: Pick<SqliteRelationshipsInput, 'connectionId' | 'database' | 'anchor'>;
  constructor(target: Pick<SqliteRelationshipsInput, 'connectionId' | 'database' | 'anchor'>, private readonly services: SqliteRelationshipServices, private readonly guard: () => boolean) { this.target = structuredClone(target); }
  get busy(): boolean { return !!this.operation; }
  current(): boolean { if (!this.dead) { try { if (!this.guard()) this.dead = true; } catch { this.dead = true; } } return !this.dead; }
  invalidate(): void { this.dead = true; void this.stop().catch(() => undefined); }
  private check(operation: Operation): void { if (!this.current() || this.operation !== operation) throw Error(text.stale); if (operation.stopped) throw Error(text.cancelled); }
  /** 先占位再异步调用外部边界，重入不能生成第二个任务。 */
  private run<T>(action: (operation: Operation) => Promise<T>): Promise<T> {
    if (this.operation) return Promise.reject(Error(text.busy));
    const operation: Operation = { stopped: false, promise: Promise.resolve() }; this.operation = operation;
    const promise = (async () => { await Promise.resolve(); try { this.check(operation); const result = await action(operation); this.check(operation); return result; } finally { if (operation.cancel) await operation.cancel.catch(() => undefined); if (this.operation === operation) this.operation = undefined; } })();
    operation.promise = promise; return promise;
  }
  /** 表目录只供选择；不自动读取结构或把视图、触发器当物理表。 */
  catalog(): Promise<string[]> {
    return this.run(async operation => {
      const objects = await this.services.objects({ connectionId: this.target.connectionId, database: 'main' }); this.check(operation);
      if (!Array.isArray(objects) || objects.length > 10000) throw Error(text.invalid);
      const names = objects.filter(object => object.kind === 'table').map(object => object.name);
      if (names.some(name => typeof name !== 'string' || !name || name.length > 512 || name.includes('\0')) || new Set(names.map(sqliteRelationshipName)).size !== names.length || !names.includes(this.target.anchor.table)) throw Error(text.invalid);
      return names.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    });
  }
  /** 每次只有一个taskId、一个完整只读快照，源页指纹随准确请求交给Main再次核验。 */
  read(tables: readonly string[]): Promise<RelationshipDiagram> {
    let request: SqliteRelationshipsInput;
    try { request = sqliteRelationshipsInputSchema.parse({ ...this.target, tables: [...tables], taskId: crypto.randomUUID() }); } catch { return Promise.reject(Error(text.invalid)); }
    return this.run(async operation => {
      operation.taskId = request.taskId;
      const value = await this.services.read(request); this.check(operation); operation.taskId = undefined;
      if (value.tables.length > relationshipDiagramLimits.tables) throw Error(text.invalid);
      return captureSqliteRelationshipDiagram(value, request);
    });
  }
  /** 未获原取消ACK和读取终态时仍保持busy，不将界面消失当作资源退出。 */
  async stop(): Promise<void> {
    const operation = this.operation; if (!operation) return; operation.stopped = true;
    if (operation.taskId && !operation.cancel) { const id = operation.taskId; operation.cancel = Promise.resolve().then(() => this.services.cancel(id)); }
    const settled = await Promise.allSettled([operation.promise, operation.cancel]);
    if (settled[1].status === 'rejected') throw settled[1].reason;
  }
}
