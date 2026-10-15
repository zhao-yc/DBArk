import { randomUUID } from 'node:crypto';
import type { TaskEvent } from '../shared/contracts';
import { schemaCompareInputSchema, schemaCompareLimits, schemaComparePreviewSchema, type SchemaCompareInput, type SchemaComparePreviewInput, type SchemaCompareResult, type SchemaCompareTarget } from '../shared/schemaCompare';
import { compareSchemaSnapshots } from './schemaCompareProjection';
import type { SchemaComparisonSnapshot } from './schemaCompare';
import { buildSchemaComparePreview } from './schemaComparePreview';

interface Host { read(target: SchemaCompareTarget, taskId: string): Promise<SchemaComparisonSnapshot>; cancel(taskId: string): Promise<void>; }
interface Work { input: SchemaCompareInput; childId?: string; cancelled: boolean; cancellation?: Promise<void>; done: Promise<void>; }
interface Snapshot { source: SchemaComparisonSnapshot; target: SchemaComparisonSnapshot; report: SchemaCompareResult; revision: number; bytes: number; }

/** 一个公共任务串行读取两侧，独立短会话逐侧释放；取消必须等待真实终态。 */
export class SchemaCompareTasks {
  private readonly active = new Map<string, Work>();
  private readonly snapshots = new Map<string, Snapshot>();
  constructor(private readonly host: Host, private readonly emit: (event: TaskEvent) => void, private readonly now = Date.now) {}
  /** 公共编号在全部私有读取及关闭完成之前始终保持占用。 */
  has(taskId: string): boolean { return this.active.has(taskId); }
  /** 逐侧读取并保存有界快照，任意失败都不交付半成品报告。 */
  async compare(input: SchemaCompareInput, revision: number): Promise<SchemaCompareResult> {
    input = schemaCompareInputSchema.parse(input);
    if (this.active.has(input.taskId) || this.active.size >= schemaCompareLimits.active) throw new Error('结构比较任务繁忙或编号重复');
    this.prune();
    if (this.snapshots.size >= schemaCompareLimits.snapshots) throw new Error('结构比较快照已达上限，请关闭旧比较后重试');
    let finish!: () => void;
    const work: Work = { input, cancelled: false, done: new Promise<void>(resolve => { finish = resolve; }) };
    this.active.set(input.taskId, work);
    const check = () => { if (work.cancelled) throw new Error('结构比较已取消'); };
    const read = async (target: SchemaCompareTarget) => {
      check(); work.childId = randomUUID();
      try { const result = await this.host.read(target, work.childId); check(); return result; }
      finally { work.childId = undefined; }
    };
    try {
      this.emit({ taskId: input.taskId, status: 'running', progress: 0, message: '只读比较结构：读取源表' });
      const source = await read(input.source);
      this.emit({ taskId: input.taskId, status: 'running', progress: 50, message: '只读比较结构：读取目标表' });
      const target = await read(input.target); check();
      const report: SchemaCompareResult = { ...compareSchemaSnapshots(source, target), snapshotId: randomUUID(), expiresAt: new Date(this.now() + schemaCompareLimits.snapshotMs).toISOString() };
      const bytes = Buffer.byteLength(JSON.stringify({ source, target, report }));
      if (Buffer.byteLength(JSON.stringify(report)) > schemaCompareLimits.reportBytes || [...this.snapshots.values()].reduce((sum, item) => sum + item.bytes, bytes) > schemaCompareLimits.cacheBytes || this.snapshots.size >= schemaCompareLimits.snapshots) throw new Error('结构比较结果超过内存预算，请缩小表结构');
      this.snapshots.set(report.snapshotId, { source, target, report, revision, bytes });
      this.emit({ taskId: input.taskId, status: 'completed', progress: 100, message: '只读结构比较完成，尚未同步' });
      return report;
    } catch (error) {
      let cancelFailed = false;
      try { await work.cancellation; } catch { cancelFailed = true; }
      this.emit({ taskId: input.taskId, status: work.cancelled && !cancelFailed ? 'cancelled' : 'failed', progress: 0, message: work.cancelled && !cancelFailed ? '结构比较已取消' : '结构比较失败，请在比较窗口核对' });
      throw error;
    } finally { this.active.delete(input.taskId); finish(); }
  }
  /** 预览只消费引擎保存的原定义，不接受渲染侧回传 SQL 或差异投影。 */
  preview(input: SchemaComparePreviewInput, revision: number) {
    input = schemaComparePreviewSchema.parse(input); this.prune();
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.revision !== revision) throw new Error('比较快照已过期或连接配置已变化，请重新比较');
    return buildSchemaComparePreview(snapshot.source, snapshot.target, snapshot.report, input.selections);
  }
  /** 只撤销比较自己的内存快照，不释放其它结构编辑器的能力。 */
  release(snapshotId: string): void { this.snapshots.delete(snapshotId); }
  /** 标记后禁止启动下一侧；取消回执和整次真实释放都完成后才返回。 */
  async cancel(taskId: string): Promise<void> {
    const work = this.active.get(taskId); if (!work) return;
    work.cancelled = true;
    try { if (work.childId) { work.cancellation ??= this.host.cancel(work.childId); await work.cancellation; } }
    finally { await work.done; }
  }
  /** 断连/退出先取消关联的公共任务；所有私有连接关闭后才能删除配置。 */
  async close(connectionId?: string): Promise<void> {
    const results = await Promise.allSettled([...this.active].filter(([, work]) => !connectionId || [work.input.source.connectionId, work.input.target.connectionId].includes(connectionId)).map(([id]) => this.cancel(id)));
    for (const [id, value] of this.snapshots) if (!connectionId || [value.source.target.connectionId, value.target.target.connectionId].includes(connectionId)) this.snapshots.delete(id);
    const failed = results.find(result => result.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason;
  }
  /** 在产生或使用快照前按注入时钟清理，过期数据不会被继续预览。 */
  private prune(): void { for (const [id, value] of this.snapshots) if (Date.parse(value.report.expiresAt) <= this.now()) this.snapshots.delete(id); }
}
