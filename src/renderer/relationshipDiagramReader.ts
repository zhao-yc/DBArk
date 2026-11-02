import type { DatabaseObject, TableInfo } from '../shared/contracts';
import { buildRelationshipDiagram, captureDiagramTable, relationshipDiagramLimits, type RelationshipDiagram } from './relationshipDiagram';
import { relationshipDiagramZh as text } from './locales/relationshipDiagram.zh-CN';

export interface RelationshipDiagramServices {
  objects(target: { connectionId: string; database: string }): Promise<DatabaseObject[]>;
  table(target: { connectionId: string; database: string; table: string; taskId: string }): Promise<TableInfo>;
  cancel(taskId: string): Promise<unknown>;
}
interface Operation { stopped: boolean; taskId?: string; cancel?: Promise<unknown>; promise: Promise<unknown>; }

/** 一轮串行读取且只保留一个元数据任务；停止／关闭等待原请求和取消ACK均终结。 */
export class RelationshipDiagramReader {
  private active?: Operation;
  private dead = false;
  private readonly target: { connectionId: string; database: string };
  constructor(target: { connectionId: string; database: string }, private readonly services: RelationshipDiagramServices, private readonly guard: () => boolean) { this.target = { ...target }; }
  get busy(): boolean { return !!this.active; }
  /** 作用域曾失效后永久撤销；恢复同名连接或同一标签也不能复活原轮。 */
  current(): boolean { if (!this.dead) { try { if (!this.guard()) this.dead = true; } catch { this.dead = true; } } return !this.dead; }
  invalidate(): void { this.dead = true; void this.stop().catch(() => undefined); }
  private check(operation: Operation): void { if (!this.current() || this.active !== operation) throw Error(text.stale); if (operation.stopped) throw Error(text.cancelled); }
  /** 先占用原owner再调用外部守卫，防止同步重入并行读取。 */
  private run<T>(read: (operation: Operation) => Promise<T>): Promise<T> {
    if (this.active) return Promise.reject(Error(text.busy));
    const operation: Operation = { stopped: false, promise: Promise.resolve() }; this.active = operation;
    const promise = (async () => { await Promise.resolve(); try { this.check(operation); const result = await read(operation); this.check(operation); return result; } finally { if (operation.cancel) await operation.cancel.catch(() => undefined); if (this.active === operation) this.active = undefined; } })();
    operation.promise = promise; return promise;
  }
  /** 目录仅用于用户选择，不把视图／例程冒充表，也不以截断列表伪造完整目录。 */
  catalog(): Promise<string[]> {
    return this.run(async operation => {
      const objects = await this.services.objects({ ...this.target }); this.check(operation);
      if (!Array.isArray(objects) || objects.length > relationshipDiagramLimits.catalog) throw Error(text.invalid);
      const names = objects.filter(object => object.kind === 'table').map(object => object.name);
      if (names.some(name => typeof name !== 'string' || !name.length || name.length > 512 || name.includes('\0')) || new Set(names).size !== names.length) throw Error(text.invalid);
      return names.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    });
  }
  /** 完整成功才发布新图；目标不相符、权限失败或取消均不拼接部分结构。 */
  read(selection: readonly string[], progress: (done: number, total: number) => void): Promise<RelationshipDiagram> {
    const names = [...selection];
    if (!names.length || names.length > relationshipDiagramLimits.tables || new Set(names).size !== names.length || names.some(name => typeof name !== 'string' || !name.length || name.length > 512 || name.includes('\0'))) return Promise.reject(Error(text.invalid));
    return this.run(async operation => {
      const tables = []; progress(0, names.length); this.check(operation);
      for (const name of names) {
        operation.taskId = crypto.randomUUID();
        const raw = await this.services.table({ ...this.target, table: name, taskId: operation.taskId });
        this.check(operation); operation.taskId = undefined;
        const table = captureDiagramTable(raw); if (table.database !== this.target.database || table.name !== name) throw Error(text.invalid);
        tables.push(table);
        if (tables.reduce((sum, value) => sum + value.columns.length, 0) > relationshipDiagramLimits.columns || tables.reduce((sum, value) => sum + value.foreignKeys.length, 0) > relationshipDiagramLimits.foreignKeys) throw Error(text.invalid);
        progress(tables.length, names.length); this.check(operation);
      }
      return buildRelationshipDiagram(tables);
    });
  }
  /** 取消准确当前任务且只投递一次；不能用界面停止状态代替原异步链终态。 */
  async stop(): Promise<void> {
    const operation = this.active; if (!operation) return;
    operation.stopped = true;
    if (operation.taskId && !operation.cancel) { const id = operation.taskId; operation.cancel = Promise.resolve().then(() => this.services.cancel(id)); }
    const settled = await Promise.allSettled([operation.promise, operation.cancel]);
    if (settled[1].status === 'rejected') throw settled[1].reason;
  }
}
