import type { RowChange } from '../shared/contracts';
import { parseTableApplyReceipt, tableApplyProgressSchema, type TableApplyReceipt } from '../shared/tableApplyReceipt';
import { recordTargetKey, type RecordTarget } from './recordViews';
import { tableApplyRecoveryZh as text } from './locales/tableApplyRecovery.zh-CN';
export interface TableApplyRecoveryScope { target: RecordTarget; connectionVersion: number; }
export interface TableApplyRecoveryTicket { readonly taskId: string; readonly previewId?: string; readonly scope: TableApplyRecoveryScope; readonly statements: number; readonly counts: Readonly<{ insert: number; update: number; delete: number }>; }
export interface TableApplyRecoveryRead { readonly attempt: TableApplyRecoveryTicket; readonly scope: TableApplyRecoveryScope; }
export interface TableApplyRecoveryView { outcome: 'idle' | 'in-flight' | 'committed' | 'unknown' | 'rolled-back' | 'not-sent'; locked: boolean; reading: boolean; epoch?: object; operationId?: string; }
/** 目标比较只用于当前读取归属；Main的全局connectionRevision不能当作Renderer的连接代次。 */
function sameScope(a: TableApplyRecoveryScope, b: TableApplyRecoveryScope): boolean { return a.connectionVersion === b.connectionVersion && recordTargetKey(a.target) === recordTargetKey(b.target); }
/** 不保存SQL、原行或赋值；提交后的原草稿必须经过真实读取才能解除保护。 */
export class TableApplyRecovery {
  private attempt?: TableApplyRecoveryTicket;
  private outcome: TableApplyRecoveryView['outcome'] = 'idle';
  private operationId?: string;
  private sequence = 0;
  private commitMay = false;
  private commitAck = false;
  private permit?: { attempt: TableApplyRecoveryTicket; scope: TableApplyRecoveryScope };
  private read?: TableApplyRecoveryRead;
  get locked(): boolean { return ['in-flight','committed','unknown'].includes(this.outcome); }
  get view(): TableApplyRecoveryView { return { outcome: this.outcome, locked: this.locked, reading: !!this.read, epoch: this.attempt, ...(this.operationId ? { operationId: this.operationId } : {}) }; }
  /** 在实际投递前占用一次机会，旧异步回包只属于此ticket，不能接管后来的提交。 */
  begin(scope: TableApplyRecoveryScope, taskId: string, previewId: string | undefined, changes: readonly RowChange[], statements: number): TableApplyRecoveryTicket {
    if (this.locked || !taskId || taskId.length > 200 || !changes.length || changes.length > 5000 || !Number.isSafeInteger(statements) || statements < 0 || statements > changes.length) throw Error(text.blocked);
    const counts = { insert: 0, update: 0, delete: 0 }; for (const change of changes) { if (!Object.hasOwn(counts, change.kind)) throw Error(text.blocked); counts[change.kind]++; }
    const ticket = Object.freeze({ taskId, previewId, scope: Object.freeze({ target: Object.freeze({ ...scope.target }), connectionVersion: scope.connectionVersion }), counts: Object.freeze(counts), statements });
    this.attempt = ticket; this.outcome = 'in-flight'; this.operationId = undefined; this.sequence = 0; this.commitMay = false; this.commitAck = false; this.permit = undefined; this.read = undefined; return ticket;
  }
  /** 可信进度单调累计；commit ACK不能被迟到的回滚或缺失磁盘记录降为可重试。 */
  observe(taskId: string, raw: unknown): boolean {
    if (!this.attempt || this.attempt.taskId !== taskId || !['in-flight', 'unknown'].includes(this.outcome)) return false;
    try {
      const p = tableApplyProgressSchema.parse(raw);
      if (p.sequence <= this.sequence || this.operationId && this.operationId !== p.operationId || this.commitMay && !p.evidence.commitMayHaveBeenSent || this.commitAck && !p.evidence.commitAcknowledged || p.evidence.dmlAcknowledged > this.attempt.statements || p.evidence.commitAcknowledged && p.evidence.dmlAcknowledged !== this.attempt.statements) return false;
      this.sequence = p.sequence; this.operationId = p.operationId; this.commitMay ||= p.evidence.commitMayHaveBeenSent; this.commitAck ||= p.evidence.commitAcknowledged;
      // 同一提交的迟到ACK只提升已确认事实，仍须重新读取才能恢复编辑。
      if (this.outcome === 'unknown' && this.commitAck) this.outcome = 'committed';
      return true;
    } catch { return false; }
  }
  /** 普通成功回包来自Main已确认的提交路径，记录保存失败不会撤销服务器ACK。 */
  succeeded(ticket: TableApplyRecoveryTicket, result: { affectedRows: number; receiptId?: string }): boolean {
    if (this.attempt !== ticket || this.outcome !== 'in-flight') return false;
    if (!Number.isSafeInteger(result.affectedRows) || result.affectedRows < 0 || this.operationId && result.receiptId && this.operationId !== result.receiptId) { this.outcome = this.commitAck ? 'committed' : 'unknown'; return false; }
    this.operationId = result.receiptId || this.operationId; this.commitAck = true; this.commitMay = true; this.outcome = 'committed'; return true;
  }
  /** 异常只接受同task／preview／目标／计划的严格回执；缺失、未终态或矛盾均继续锁定。 */
  failed(ticket: TableApplyRecoveryTicket, raw?: unknown): TableApplyRecoveryView['outcome'] {
    if (this.attempt !== ticket || this.outcome !== 'in-flight') return this.outcome;
    let receipt: TableApplyReceipt | undefined;
    try {
      const r = parseTableApplyReceipt(raw);
      if (r.taskId === ticket.taskId && r.previewId === ticket.previewId && recordTargetKey(r.target) === recordTargetKey(ticket.scope.target) && r.phase === 'terminal' && Object.keys(ticket.counts).every(kind => r.intent[kind as keyof typeof ticket.counts] === ticket.counts[kind as keyof typeof ticket.counts]) && r.intent.statementCount === ticket.statements && (!this.operationId || r.operationId === this.operationId) && (!this.commitMay || r.evidence.commitMayHaveBeenSent) && (!this.commitAck || r.evidence.commitAcknowledged)) receipt = r;
    } catch { /* 记录缺失或无效不依据原错误文字推断未发送或回滚。 */ }
    if (receipt) this.operationId = receipt.operationId;
    this.outcome = this.commitAck ? 'committed' : receipt?.outcome ?? 'unknown'; return this.outcome;
  }
  /** 用户确认仅授权一次指定目标读取，不解除锁，不修改或重新发送旧变化。 */
  authorizeRead(view: TableApplyRecoveryView, scope: TableApplyRecoveryScope): boolean {
    if (!this.attempt || !this.locked || this.outcome === 'in-flight' || view.epoch !== this.attempt || view.outcome !== this.outcome || view.operationId !== this.operationId || this.read) return false;
    this.permit = { attempt: this.attempt, scope: { target: { ...scope.target }, connectionVersion: scope.connectionVersion } }; return true;
  }
  /** 已确认提交可自动刷新原目标；未知只消费明确确认的读取授权。 */
  beginRead(scope: TableApplyRecoveryScope): TableApplyRecoveryRead | undefined {
    if (!this.locked) return;
    if (!this.attempt || this.outcome === 'in-flight' || this.read || !(this.outcome === 'committed' && sameScope(scope, this.attempt.scope) || this.permit?.attempt === this.attempt && sameScope(scope, this.permit.scope))) throw Error(text.blocked);
    this.permit = undefined; const ticket = Object.freeze({ attempt: this.attempt, scope: Object.freeze({ target: Object.freeze({ ...scope.target }), connectionVersion: scope.connectionVersion }) }); this.read = ticket; return ticket;
  }
  /** 只有这次真实读取成功采用后才清除旧候选保护，失败或旧回包永不解锁。 */
  completeRead(ticket: TableApplyRecoveryRead, scope: TableApplyRecoveryScope): boolean {
    if (this.read !== ticket || this.attempt !== ticket.attempt || !sameScope(ticket.scope, scope)) return false;
    this.read = undefined; this.attempt = undefined; this.outcome = 'idle'; this.operationId = undefined; this.permit = undefined; return true;
  }
  /** 读取失败仅结束自己的读取，占用状态继续，不能以空白页面或错误假装核对完成。 */
  failRead(ticket: TableApplyRecoveryRead): void { if (this.read === ticket) this.read = undefined; }
}
