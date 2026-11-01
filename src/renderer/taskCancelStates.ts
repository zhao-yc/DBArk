import { sqliteObjectsFactSchema, type SqliteObjectsFact } from '../shared/sqliteObjects';
import { sqliteTableMaintenanceFactSchema, type SqliteTableMaintenanceFact } from '../shared/sqliteTableMaintenance';
import { sqliteTableRenameFactSchema, type SqliteTableRenameFact } from '../shared/sqliteTableRename';
import { sqliteColumnsFactSchema, type SqliteColumnsFact } from '../shared/sqliteColumns';
import type { TaskEvent } from '../shared/contracts';
import type { SqliteWriteFact } from '../shared/sqliteTableEdit';
import { sqliteImportWriteFactSchema } from '../shared/sqliteTableImport';
import { sqliteWriteFactSchema } from '../shared/sqliteWriteFact';
import { taskCancelSnapshotSchema, type TaskCancelState } from '../shared/taskCancelState';
import { sqliteTableCreateFactSchema, type SqliteTableCreateFact } from '../shared/sqliteTableCreate';
import { sqliteIndexesFactSchema, type SqliteIndexesFact } from '../shared/sqliteIndexes';

/** 视图/触发器修改使用自己的严格ACK，提交边界及未知结果不授予取消。 */
export function sqliteObjectsCancelLocked(fact?: SqliteObjectsFact): boolean {
  const parsed = sqliteObjectsFactSchema.safeParse(fact);
  return parsed.success && (parsed.data.commitMayHaveBeenSent || parsed.data.phase === 'commit-pending' || parsed.data.phase === 'unknown');
}

/** 清空／删除表采用自己的严格事务事实，COMMIT边界及未知结果不再授权取消。 */
export function sqliteTableMaintenanceCancelLocked(fact?: SqliteTableMaintenanceFact): boolean {
  const parsed = sqliteTableMaintenanceFactSchema.safeParse(fact);
  return parsed.success && (parsed.data.commitMayHaveBeenSent || parsed.data.phase === 'commit-pending' || parsed.data.phase === 'unknown');
}

/** 表重命名沿原DDL事务回执判定取消边界，不能从进度推断可取消。 */
export function sqliteTableRenameCancelLocked(fact?: SqliteTableRenameFact): boolean {
  const parsed = sqliteTableRenameFactSchema.safeParse(fact);
  return parsed.success && (parsed.data.commitMayHaveBeenSent || parsed.data.phase === 'commit-pending' || parsed.data.phase === 'unknown');
}

/** 字段DDL使用独立严格事实；COMMIT可能发送或未知时不再授予取消。 */
export function sqliteColumnsCancelLocked(fact?: SqliteColumnsFact): boolean {
  const parsed = sqliteColumnsFactSchema.safeParse(fact);
  return parsed.success && (parsed.data.commitMayHaveBeenSent || parsed.data.phase === 'commit-pending' || parsed.data.phase === 'unknown');
}

/** 索引DDL使用独立严格事实；COMMIT可能发送或未知时不再授予取消。 */
export function sqliteIndexesCancelLocked(fact?: SqliteIndexesFact): boolean {
  const parsed = sqliteIndexesFactSchema.safeParse(fact);
  return parsed.success && (parsed.data.commitMayHaveBeenSent || parsed.data.phase === 'commit-pending' || parsed.data.phase === 'unknown');
}

/** COMMIT可能已投递或结果未知时取消无法保证撤销；只认可严格最小建表事实。 */
export function sqliteTableCreateCancelLocked(fact?: SqliteTableCreateFact): boolean {
  const parsed = sqliteTableCreateFactSchema.safeParse(fact);
  return parsed.success && (parsed.data.commitMayHaveBeenSent || parsed.data.phase === 'commit-pending' || parsed.data.phase === 'unknown');
}

/** 导入沿独立大文件预算核验；未知或COMMIT可能发送时不再授权取消。 */
export function sqliteWriteCancelLocked(fact?: SqliteWriteFact, importing = false): boolean {
  const parsed = (importing ? sqliteImportWriteFactSchema : sqliteWriteFactSchema).safeParse(fact);
  return parsed.success && (parsed.data.commitMayHaveBeenSent || parsed.data.phase === 'commit-pending' || parsed.data.phase === 'unknown');
}

interface Entry { state: TaskCancelState; version: number; locked: boolean; }
interface Ports {
  subscribe(listener: (event: TaskEvent) => void): () => void;
  read(taskIds: string[]): Promise<unknown>;
  changed(states: ReadonlyMap<string, TaskCancelState>): void;
}

/** 先订阅再读取；每项版本隔离事件、旧响应及移除后重加，终态锁不能被快照撤销。 */
export class TaskCancelStates {
  private entries = new Map<string, Entry>();
  private clock = 0;
  private active = false;
  private busy = false;
  private dirty = false;
  private unsubscribe?: () => void;
  constructor(private readonly ports: Ports) {}

  /** 一个实例只对应一次挂载；卸载后的实例不会复用。 */
  start(ids: string[]): void {
    this.active = true;
    this.replace(ids);
    this.unsubscribe = this.ports.subscribe(event => this.event(event));
    this.refresh();
  }
  /** 列表变化仅调整编号，不反复建立订阅。 */
  setIds(ids: string[]): void { if (this.active && this.replace(ids)) this.refresh(); }
  /** 点击时读取最新内存状态，阻止旧渲染闭包在COMMIT事件后发送取消。 */
  canCancel(id: string): boolean { return this.active && this.entries.get(id)?.state === 'allowed'; }
  /** 注销先使迟到响应失效，再释放事件订阅。 */
  stop(): void { this.active = false; this.unsubscribe?.(); this.unsubscribe = undefined; }

  /** 编号移除后再加入会获得全新版本，避免旧请求冒领新列表项。 */
  private replace(ids: string[]): boolean {
    const selected = new Set(ids.slice(0, 200)); let changed = false;
    for (const id of this.entries.keys()) if (!selected.has(id)) { this.entries.delete(id); changed = true; }
    for (const id of selected) if (!this.entries.has(id)) { this.entries.set(id, { state: 'checking', version: ++this.clock, locked: false }); changed = true; }
    if (changed) this.publish();
    return changed;
  }
  /** 结构化COMMIT/终态事件立即关闭取消，其他阶段需重新向可信主进程核验。 */
  private event(event: TaskEvent): void {
    const entry = this.entries.get(event.taskId); if (!this.active || !entry) return;
    if (event.status !== 'running') { entry.state = 'finished'; entry.locked = true; }
    else if (!entry.locked) {
      if (event.tableApply?.evidence.commitMayHaveBeenSent || sqliteObjectsCancelLocked(event.sqliteObjects) || sqliteTableMaintenanceCancelLocked(event.sqliteTableMaintenance) || sqliteTableRenameCancelLocked(event.sqliteTableRename) || sqliteColumnsCancelLocked(event.sqliteColumns) || sqliteIndexesCancelLocked(event.sqliteIndexes) || sqliteTableCreateCancelLocked(event.sqliteCreate) || sqliteWriteCancelLocked(event.sqliteWrite, event.sqliteImportOperation === 'apply')) { entry.state = 'confirming'; entry.locked = true; }
      else entry.state = 'checking';
    }
    entry.version = ++this.clock;
    this.publish(); this.refresh();
  }
  /** 发布不可共享内部条目的状态副本，卸载后不再通知React。 */
  private publish(): void { if (this.active) this.ports.changed(new Map([...this.entries].map(([id, e]) => [id, e.state]))); }
  /** 合并进行中的读取请求；不轮询、不依赖延时，失败保持待核验。 */
  private refresh(): void {
    if (!this.active) return;
    if (this.busy) { this.dirty = true; return; }
    const versions = new Map([...this.entries].filter(([, e]) => !e.locked).map(([id, e]) => [id, e.version]));
    if (!versions.size) return;
    this.busy = true; this.dirty = false;
    void Promise.resolve().then(() => this.active ? this.ports.read([...versions.keys()]) : []).then(raw => {
      if (!this.active) return;
      const parsed = taskCancelSnapshotSchema.safeParse(raw);
      if (!parsed.success || new Set(parsed.data.map(item => item.taskId)).size !== parsed.data.length || parsed.data.some(item => !versions.has(item.taskId))) return;
      for (const item of parsed.data) {
        const entry = this.entries.get(item.taskId);
        if (!entry || entry.locked || entry.version !== versions.get(item.taskId)) continue;
        entry.state = item.state;
        if (item.state === 'confirming' || item.state === 'finished') entry.locked = true;
      }
      this.publish();
    }).catch(() => { /* 读取失败不能把未核验阶段授权为可取消。 */ }).finally(() => {
      this.busy = false;
      if (this.active && this.dirty) this.refresh();
    });
  }
}
