import { randomUUID } from 'node:crypto';
import type { TaskCancelState } from '../shared/taskCancelState';
import type { RowChange, SqlPreview } from '../shared/contracts';
import { emptyTableApplyEvidence, interruptTableApplyReceipt, mergeTableApplyProgress, parseTableApplyReceipt, tableApplyReceiptLimits, type TableApplyProgress, type TableApplyReceipt, type TableApplyTarget, type TableApplyBinding } from '../shared/tableApplyReceipt';

export interface TableApplyReceiptStore { saveTableApplyReceipt(r: TableApplyReceipt): void; }
interface Preview { target: TableApplyTarget; changes: string; plan: SqlPreview['statements']; bytes: number; expires: number; timer: ReturnType<typeof setTimeout>; }

/** 敏感计划仅驻留有界RAM；renderer只拿随机预览编号，不能签发结果证据。 */
export class TableApplyReceipts {
  private previews = new Map<string, Preview>();
  private active = new Map<string, TableApplyReceipt>();
  private volatile = new Set<string>();
  private persistedAt = new Map<string, number>();
  private completed = new Map<string, TableApplyReceipt>();
  constructor(private readonly store: TableApplyReceiptStore, private readonly warning: () => void = () => {}, private readonly now = Date.now) {}

  /** 主进程在可信预览返回后固定目标修订、changes和所展示计划；过期内容立即释放。 */
  preview(target: TableApplyTarget, changes: RowChange[], plan: SqlPreview): { previewId: string; previewExpiresAt: string } {
    for (const [id, value] of this.previews) if (value.expires <= this.now()) { clearTimeout(value.timer); this.previews.delete(id); }
    const content = JSON.stringify(changes), statements = structuredClone(plan.statements);
    const bytes = Buffer.byteLength(content) + Buffer.byteLength(JSON.stringify(statements));
    if (this.previews.size >= tableApplyReceiptLimits.previews || [...this.previews.values()].reduce((n, p) => n + p.bytes, bytes) > tableApplyReceiptLimits.previewBytes) throw Error('提交预览缓存已满，请关闭或等待旧预览过期后重新预览');
    const previewId = randomUUID(), expires = this.now() + tableApplyReceiptLimits.previewMs;
    const timer = setTimeout(() => this.previews.delete(previewId), tableApplyReceiptLimits.previewMs); timer.unref();
    this.previews.set(previewId, { timer, target: { ...target }, changes: content, plan: statements, bytes, expires });
    return { previewId, previewExpiresAt: new Date(expires).toISOString() };
  }

  /** 两次原子保存都先于broker派发；任何异常都不能发送本批DML，令牌仍单次消费。 */
  prepare(taskId: string, previewId: string | undefined, target: TableApplyTarget, changes: RowChange[]): TableApplyBinding {
    const p = previewId ? this.previews.get(previewId) : undefined;
    if (p) clearTimeout(p.timer);
    if (previewId) this.previews.delete(previewId);
    if (!p || p.expires <= this.now() || JSON.stringify(p.target) !== JSON.stringify(target) || p.changes !== JSON.stringify(changes)) throw Error('提交预览已变化或失效，请重新预览；未发送本批数据写入');
    if (this.active.has(taskId) || this.completed.has(taskId)) throw Error('提交任务编号已使用');
    const operationId = randomUUID(), intent = { insert: 0, update: 0, delete: 0, statementCount: p.plan.length };
    for (const change of changes) intent[change.kind]++;
    let r: TableApplyReceipt = parseTableApplyReceipt({ version: 1, operationId, taskId, previewId, target, intent, startedAt: new Date(this.now()).toISOString(), phase: 'prepared', outcome: null, reason: 'none', sequence: 0, evidence: emptyTableApplyEvidence(), committedReportedRows: null, scope: 'target-transaction-only' });
    this.store.saveTableApplyReceipt(r);
    try { r = { ...r, phase: 'dispatching' }; this.store.saveTableApplyReceipt(r); }
    catch (error) { this.safeSave(interruptTableApplyReceipt({ ...r, phase: 'prepared' })); throw error; }
    this.active.set(taskId, r);
    return { operationId, previewId: previewId!, target: { ...target }, plan: structuredClone(p.plan) };
  }

  /** main明确仍在broker调用前失败，不能把本地绑定/保存失败说成已发送写入。 */
  notDispatched(taskId: string): void {
    const r = this.active.get(taskId);
    if (r && r.sequence === 0 && !r.evidence.dmlMayHaveBeenSent) { const next = interruptTableApplyReceipt({ ...r, phase: 'prepared' }); this.active.set(taskId, next); this.safeSave(next); }
  }
  /** 只接收已绑定table.apply的引擎事件；无效事件不转换为成功。 */
  receive(taskId: string, progress: TableApplyProgress): void {
    const current = this.active.get(taskId); if (!current) return;
    let next: TableApplyReceipt;
    try { next = mergeTableApplyProgress(current, progress); } catch { this.warning(); return; }
    this.active.set(taskId, next);
    if (next.phase === 'terminal' || next.phase !== current.phase || next.evidence.commitAcknowledged !== current.evidence.commitAcknowledged || next.evidence.dmlMayHaveBeenSent !== current.evidence.dmlMayHaveBeenSent || this.now() - (this.persistedAt.get(taskId) ?? 0) >= 1000) { this.safeSave(next); this.persistedAt.set(taskId, this.now()); }
  }

  /** 仅已校验且绑定当前任务的ACK可决定成功；保留有界终态供退出竞态核对。 */
  confirmed(taskId: string): TableApplyReceipt | undefined { const r = this.active.get(taskId) ?? this.completed.get(taskId); return r?.evidence.commitAcknowledged ? r : undefined; }
  /** 当前内存证据先于辅助写盘；持久化失败不得把COMMIT降回可取消阶段。 */
  cancelState(taskId: string, operationId: string | undefined): TaskCancelState {
    const r = this.active.get(taskId) ?? this.completed.get(taskId);
    if (!r || !operationId || r.operationId !== operationId) return 'checking';
    if (r.phase === 'terminal') return 'finished';
    if (r.evidence.commitMayHaveBeenSent) return 'confirming';
    return r.phase === 'executing' && r.sequence > 0 && r.evidence.transactionProtected && r.evidence.transactionKnown && r.evidence.transactionOpen ? 'allowed' : 'checking';
  }
  /** 清理错误是附加原因，不撤销已经收到的数据库提交确认。 */
  cleanupFailed(taskId: string): void { const r = this.confirmed(taskId); if (r) { const next = { ...r, reason: 'cleanup-failed' as const }; this.active.set(taskId, next); this.safeSave(next); } }
  /** 响应、退出和异常共用收尾；缺少可信终态只会归为未知，绝不据RPC成功补造COMMIT。 */
  finish(taskId: string): { receiptId?: string; receiptSaved?: boolean } {
    const r = this.active.get(taskId); if (!r) return {};
    const next = interruptTableApplyReceipt(r); this.active.set(taskId, next); this.safeSave(next);
    this.active.delete(taskId); this.persistedAt.delete(taskId); this.completed.set(taskId, next);
    while (this.completed.size > 200) this.completed.delete(this.completed.keys().next().value!);
    const receiptSaved = !this.volatile.has(next.operationId); this.volatile.delete(next.operationId);
    return { receiptId: next.operationId, receiptSaved };
  }
  /** 引擎/应用中断同时撤销预览，旧令牌不可在重启后复活。 */
  interrupt(): void { for (const p of this.previews.values()) clearTimeout(p.timer); this.previews.clear(); for (const id of [...this.active.keys()]) this.finish(id); }
  /** 后续辅助写盘故障不能改变数据库事实；旧磁盘dispatching在重启后会保守恢复unknown。 */
  private safeSave(r: TableApplyReceipt): void { try { this.store.saveTableApplyReceipt(r); this.volatile.delete(r.operationId); } catch { this.volatile.add(r.operationId); this.warning(); } }
}
