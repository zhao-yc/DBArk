import { z } from 'zod';
import type { SqlPreview } from './contracts';
export interface TableApplyBinding { operationId: string; previewId: string; target: TableApplyTarget; plan: SqlPreview['statements']; }

export const tableApplyReceiptLimits = { records: 200, recordBytes: 8192, previews: 32, previewBytes: 20 * 1024 * 1024, previewMs: 300000, pageSize: 25 } as const;
const count = z.number().int().min(0).max(5000);
export const tableApplyOutcomeSchema = z.enum(['not-sent', 'committed', 'rolled-back', 'unknown']);
export const tableApplyReasonSchema = z.enum(['none', 'validation', 'conflict', 'cancelled', 'connection-loss', 'rollback-unconfirmed', 'commit-unconfirmed', 'interrupted', 'cleanup-failed', 'statement-failed', 'transaction-unconfirmed']);
export const tableApplyEvidenceSchema = z.object({
  dmlMayHaveBeenSent: z.boolean(), dmlAcknowledged: count, serverReportedRows: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  commitMayHaveBeenSent: z.boolean(), commitAcknowledged: z.boolean(), rollbackAcknowledged: z.boolean(),
  transactionProtected: z.boolean(), transactionKnown: z.boolean(), transactionOpen: z.boolean()
}).strict().superRefine((v, c) => {
  if (v.commitAcknowledged && (!v.commitMayHaveBeenSent || !v.transactionProtected || !v.transactionKnown || v.transactionOpen)) c.addIssue({ code: 'custom', message: '提交证据不完整' });
  if (v.rollbackAcknowledged && (v.commitMayHaveBeenSent || !v.transactionKnown || v.transactionOpen)) c.addIssue({ code: 'custom', message: '回滚证据不完整' });
  if ((!v.dmlMayHaveBeenSent && v.dmlAcknowledged > 0)) c.addIssue({ code: 'custom', message: '写入数量证据不一致' });
});
export type TableApplyEvidence = z.infer<typeof tableApplyEvidenceSchema>;
export const tableApplyPhaseSchema = z.enum(['prepared', 'dispatching', 'executing', 'committing', 'rolling-back', 'terminal']);
export const tableApplyProgressSchema = z.object({ operationId: z.uuid(), sequence: z.number().int().positive(), phase: tableApplyPhaseSchema, reason: tableApplyReasonSchema, evidence: tableApplyEvidenceSchema }).strict();
export type TableApplyProgress = z.infer<typeof tableApplyProgressSchema>;
const name = z.string().min(1).max(256).refine(s => !s.includes('\0'));
export const tableApplyTargetSchema = z.object({ connectionId: name, connectionRevision: z.number().int().nonnegative(), database: name, table: name }).strict();
export type TableApplyTarget = z.infer<typeof tableApplyTargetSchema>;
export const tableApplyReceiptSchema = z.object({
  version: z.literal(1), operationId: z.uuid(), taskId: name, previewId: z.uuid(), target: tableApplyTargetSchema,
  intent: z.object({ insert: count, update: count, delete: count, statementCount: count }).strict(),
  startedAt: z.iso.datetime(), finishedAt: z.iso.datetime().optional(), phase: tableApplyPhaseSchema,
  outcome: tableApplyOutcomeSchema.nullable(), reason: tableApplyReasonSchema, sequence: z.number().int().nonnegative(),
  evidence: tableApplyEvidenceSchema, committedReportedRows: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), scope: z.literal('target-transaction-only')
}).strict();
export type TableApplyReceipt = z.infer<typeof tableApplyReceiptSchema>;
export const tableApplyReceiptListSchema = z.object({ page: z.number().int().min(0).max(7).default(0), outcome: tableApplyOutcomeSchema.optional(), connectionId: name.optional(), taskId: name.optional() }).strict();
export type TableApplyReceiptListInput = z.input<typeof tableApplyReceiptListSchema>;
export interface TableApplyReceiptPage { items: TableApplyReceipt[]; total: number; page: number; }

/** 未知数量用null；ACK只证明此目标事务，不能扩展为触发器或外部副作用保证。 */
export function tableApplyOutcome(e: TableApplyEvidence): TableApplyReceipt['outcome'] {
  if (e.commitAcknowledged) return 'committed';
  if (!e.dmlMayHaveBeenSent && !e.commitMayHaveBeenSent) return 'not-sent';
  if (e.rollbackAcknowledged && e.transactionProtected && !e.commitMayHaveBeenSent) return 'rolled-back';
  return e.dmlMayHaveBeenSent || e.commitMayHaveBeenSent ? 'unknown' : 'not-sent';
}
/** 初始证据没有任何写入或事务成功事实。 */
export function emptyTableApplyEvidence(): TableApplyEvidence {
  return { dmlMayHaveBeenSent: false, dmlAcknowledged: 0, serverReportedRows: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, transactionProtected: false, transactionKnown: false, transactionOpen: false };
}
/** 只允许可信进度单调累积；迟到消息不得撤销已经收到的提交ACK。 */
export function mergeTableApplyProgress(receipt: TableApplyReceipt, raw: unknown): TableApplyReceipt {
  const p = tableApplyProgressSchema.parse(raw);
  if (p.operationId !== receipt.operationId || p.sequence <= receipt.sequence || receipt.phase === 'terminal') return receipt;
  const allowed: Record<TableApplyReceipt['phase'], string[]> = { prepared: ['executing', 'rolling-back', 'terminal'], dispatching: ['executing', 'rolling-back', 'terminal'], executing: ['executing', 'committing', 'rolling-back', 'terminal'], committing: ['committing', 'terminal'], 'rolling-back': ['rolling-back', 'terminal'], terminal: [] };
  if (!allowed[receipt.phase].includes(p.phase)) throw Error('提交执行阶段不能倒退');
  const a = receipt.evidence, b = p.evidence;
  for (const key of ['dmlMayHaveBeenSent', 'commitMayHaveBeenSent', 'commitAcknowledged', 'rollbackAcknowledged'] as const) if (a[key] && !b[key]) throw Error('提交证据不能倒退');
  if (b.dmlAcknowledged < a.dmlAcknowledged || b.serverReportedRows < a.serverReportedRows || b.dmlAcknowledged > receipt.intent.statementCount) throw Error('提交进度数量无效');
  if (b.commitAcknowledged && (b.dmlAcknowledged !== receipt.intent.statementCount || b.serverReportedRows !== b.dmlAcknowledged)) throw Error('提交ACK与本批计划不一致');
  const terminal = p.phase === 'terminal', outcome = terminal ? tableApplyOutcome(b) : null;
  return { ...receipt, ...p, outcome, committedReportedRows: outcome === 'committed' ? b.serverReportedRows : outcome === 'rolled-back' || outcome === 'not-sent' ? 0 : null, ...(terminal ? { finishedAt: new Date().toISOString() } : {}) };
}
/** 中断只保留已持久确认的事实，不依据通用failed/cancelled标签伪造回滚。 */
export function interruptTableApplyReceipt(r: TableApplyReceipt): TableApplyReceipt {
  if (r.phase === 'terminal') return r;
  const e = r.evidence;
  const outcome = e.commitAcknowledged ? 'committed' : r.phase === 'prepared' ? 'not-sent' : 'unknown';
  return { ...r, phase: 'terminal', outcome, reason: 'interrupted', finishedAt: new Date().toISOString(), committedReportedRows: outcome === 'committed' ? e.serverReportedRows : outcome === 'not-sent' ? 0 : null };
}
/** 存储入口也执行白名单和字节预算，拒绝携带额外SQL、字段值或错误文本。 */
export function parseTableApplyReceipt(raw: unknown): TableApplyReceipt {
  const value = tableApplyReceiptSchema.parse(raw);
  if (new TextEncoder().encode(JSON.stringify(value)).length > tableApplyReceiptLimits.recordBytes) throw Error('提交记录超过大小上限');
  if (value.intent.insert + value.intent.update + value.intent.delete > 5000 || value.intent.statementCount > value.intent.insert + value.intent.update + value.intent.delete) throw Error('提交计划数量无效');
  if (value.phase !== 'terminal' && (value.outcome !== null || value.committedReportedRows !== null)) throw Error('运行中记录不能伪造终态');
  if (value.outcome === 'not-sent' && (value.evidence.dmlMayHaveBeenSent || value.evidence.commitMayHaveBeenSent)) throw Error('已可能发送的写入不能记为未发送');
  if (value.outcome === 'committed' && (value.evidence.dmlAcknowledged !== value.intent.statementCount || value.committedReportedRows !== value.evidence.serverReportedRows)) throw Error('提交数量证据不一致');
  if ((value.outcome === 'rolled-back' || value.outcome === 'not-sent') && value.committedReportedRows !== 0) throw Error('未提交记录数量必须为零');
  if (value.outcome === 'unknown' && value.committedReportedRows !== null) throw Error('未知记录不能伪造行数');
  if (value.phase === 'terminal' && value.evidence.commitAcknowledged && value.outcome !== 'committed') throw Error('已确认提交不能降级为其他终态');
  if (value.phase === 'terminal' && !value.outcome) throw Error('提交记录缺少终态');
  if (value.outcome === 'committed' && !value.evidence.commitAcknowledged) throw Error('提交记录没有可信ACK');
  if (value.outcome === 'rolled-back' && (!value.evidence.rollbackAcknowledged || !value.evidence.transactionProtected)) throw Error('提交记录没有可信回滚ACK');
  return value;
}
