import { randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery, type StructureTaskHost } from './structureDefinition';
import { readTableChecks, assertTableChecksUnchanged, verifyTableCheckBase, tableCheckHash, type TableCheckRead } from './tableCheckRead';
import { planTableCheckChange, verifyTableCheckPlan, type TableCheckPlan } from './tableCheckPlan';
import { tableCheckGetSchema, tableCheckPreviewSchema, tableCheckApplySchema, tableCheckReleaseSchema, tableCheckConfirmationsMatch, tableCheckMessages as text, type TableCheckGetInput, type TableCheckGetOutput, type TableCheckPreviewInput, type TableCheckPreviewOutput, type TableCheckApplyInput, type TableCheckApplyOutput, type TableCheckReleaseInput, type TableCheckProgress, type TableCheckTarget, type TableCheckView } from '../shared/tableChecks';

interface Snapshot extends TableCheckRead { id: string; target: TableCheckTarget; revision: number; expires: number; }
interface Preview { snapshot: Snapshot; plan: TableCheckPlan; bytes: number; expires: number; }
const initial = (): TableCheckProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
/** 可见副本不与Engine私有access/reasons数组共享，renderer不能改写下一次执行的权限事实。 */
function view(value: TableCheckView): TableCheckView { return { ...value, reasons: [...value.reasons], access: { drop: { ...value.access.drop, reasons: [...value.access.drop.reasons] }, replace: { ...value.access.replace, reasons: [...value.access.replace.reasons] }, enforcement: { ...value.access.enforcement, reasons: [...value.access.enforcement.reasons] } } }; }

/** CHECK用途独立缓存和单次预览，任务资源仍由共用短连接/同表租约负责严格收尾。 */
export class TableCheckTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>;
  private readonly previews: StructureCacheScope<Preview>;
  constructor(private readonly host: StructureTaskHost, private readonly now = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('tableChecks', 'snapshot', value => ({ connectionId: value.target.connectionId, bytes: value.bytes, expires: value.expires }));
    this.previews = cache.scope('tableChecks', 'preview', value => ({ connectionId: value.snapshot.target.connectionId, bytes: value.bytes, expires: value.expires }));
  }
  private revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw Error(text.stale); return value as number; }
  /** 退休准确父对象及其兄弟，不借相同ID误删后来登记的其它对象。 */
  private retire(snapshot: Snapshot): void { if (this.snapshots.get(snapshot.id) === snapshot) this.snapshots.delete(snapshot.id); for (const [token, value] of this.previews) if (value.snapshot === snapshot) this.previews.delete(token); }
  /** 释放只撤销本用途能力，不声称已取消或释放仍在执行的服务器任务。 */
  releaseTokens(input: TableCheckReleaseInput): void {
    const checked = tableCheckReleaseSchema.parse(input);
    if (checked.snapshotId) { const snapshot = this.snapshots.get(checked.snapshotId); if (snapshot) this.retire(snapshot); }
    if (checked.previewToken) this.previews.delete(checked.previewToken);
  }
  /** 只在原host完成严格关闭后发布快照；权限缺失的未知目录仍明确标记只读。 */
  async get(input: TableCheckGetInput, revision: unknown): Promise<TableCheckGetOutput> {
    const checked = tableCheckGetSchema.parse(input), current = this.revision(revision), progress = initial(); let snapshot!: Snapshot;
    const output = await this.host.run(checked.connectionId, checked.taskId, async context => {
      progress.phase = 'reading'; context.report(); const target = { connectionId: checked.connectionId, database: checked.database, table: checked.table };
      const read = await readTableChecks(context, target); this.cache.capacity(read.bytes, 'snapshot');
      snapshot = { ...read, target, id: randomUUID(), revision: current, expires: this.now() + structureCacheLimits.ttlMs };
      return { target: { ...target }, snapshotId: snapshot.id, expiresAt: new Date(snapshot.expires).toISOString(), ddlHash: tableCheckHash(read.source), serverVersion: read.serverVersion, dialect: read.context.dialect, sqlMode: read.originalMode, coverage: read.coverage, checks: [...read.checks.values()].map(item => view(item.view)), columns: read.definition.columns.map(column => column.name), writable: read.writable, allowsNotEnforced: read.allowsNotEnforced, reasons: [...read.reasons], warnings: [...text.warnings, ...read.warnings] };
    }, { label: text.labels.get, purpose: 'tableChecks', progress });
    this.snapshots.set(snapshot.id, snapshot); return output;
  }
  /** 原父能力和全量目录双重复核，预览不发送ALTER，晚release不得发布孤儿预览。 */
  async preview(input: TableCheckPreviewInput, revision: unknown): Promise<TableCheckPreviewOutput> {
    const checked = tableCheckPreviewSchema.parse(input), snapshot = this.snapshots.get(checked.snapshotId);
    if (!snapshot || snapshot.expires <= this.now() || snapshot.revision !== this.revision(revision)) throw Error(text.stale);
    if (!snapshot.writable) throw Error(snapshot.reasons.join('；') || text.readonly);
    const plan = planTableCheckChange(snapshot, checked.change), progress = initial(), token = randomUUID(); let preview!: Preview;
    const output = await this.host.run(snapshot.target.connectionId, checked.taskId, async context => {
      progress.phase = 'rechecking'; context.report(); assertTableChecksUnchanged(snapshot, await readTableChecks(context, snapshot.target));
      if (this.snapshots.get(snapshot.id) !== snapshot || snapshot.expires <= this.now()) throw Error(text.stale);
      preview = { snapshot, plan, expires: snapshot.expires, bytes: snapshot.bytes + Buffer.byteLength(plan.sql) + 8192 }; this.cache.capacity(preview.bytes, 'preview');
      return { target: { ...snapshot.target }, previewToken: token, expiresAt: new Date(preview.expires).toISOString(), ddlHash: tableCheckHash(snapshot.source), sql: plan.sql, change: { ...plan.change }, ...(plan.before ? { before: view(plan.before) } : {}), ...(plan.after ? { after: { ...plan.after } } : {}), warnings: [...new Set([...text.warnings, ...plan.warnings])], requiredAcknowledgements: [...plan.requiredAcknowledgements] };
    }, { label: text.labels.preview, purpose: 'tableChecks', progress });
    if (this.snapshots.get(snapshot.id) !== snapshot || snapshot.expires <= this.now()) throw Error(text.stale);
    this.previews.set(token, preview); return output;
  }
  /** 任一确认/刷新失败都消费整组旧能力；每份fresh get最多有一次DDL投递机会。 */
  async apply(input: TableCheckApplyInput, revision: unknown): Promise<TableCheckApplyOutput> {
    const preview = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!preview) throw Error(text.stale); const snapshot = preview.snapshot, exactParent = this.snapshots.get(snapshot.id) === snapshot; this.retire(snapshot);
    const checked = tableCheckApplySchema.parse(input);
    if (!exactParent || preview.expires <= this.now() || snapshot.revision !== this.revision(revision)) throw Error(text.stale);
    if (!tableCheckConfirmationsMatch(checked, snapshot.target) || checked.acknowledgements.length !== preview.plan.requiredAcknowledgements.length || preview.plan.requiredAcknowledgements.some(item => !checked.acknowledgements.includes(item))) throw Error(text.confirmation);
    const progress = initial();
    const output = await this.host.run(snapshot.target.connectionId, checked.taskId, async context => {
      progress.phase = 'rechecking'; context.report(); assertTableChecksUnchanged(snapshot, await readTableChecks(context, snapshot.target));
      if (preview.expires <= this.now()) throw Error(text.stale); context.checkCancelled(); progress.phase = 'executing'; context.report();
      try {
        const result = (await structureTaskQuery<ResultSetHeader>(context, preview.plan.sql, () => { progress.ddlSubmitted = true; progress.outcome = 'unknown'; context.report(); })).rows;
        if (!result || !Number.isSafeInteger(result.affectedRows) || result.affectedRows < 0) throw Error(text.unknown);
        progress.ddlCompleted = true; progress.outcome = 'succeeded'; progress.phase = 'verifying'; context.report();
        const answer: Omit<TableCheckApplyOutput, 'resourcesReleased'> = { target: { ...snapshot.target }, ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: [] };
        const warningKnown = Number.isSafeInteger(result.warningStatus) && result.warningStatus >= 0 && result.warningStatus <= 65535;
        if (!warningKnown) answer.warnings.push('DDL已完成，但警告计数无法确认，请核对约束；不要重复执行。');
        else if (result.warningStatus) {
          answer.warnings.push(`服务器返回${result.warningStatus}条警告，请核对约束。`);
          try {
            const warnings = (await structureTaskQuery<{ Code: number; Message: string }[]>(context, 'SHOW WARNINGS LIMIT 20')).rows; let remaining = 32768;
            if (!Array.isArray(warnings) || warnings.length > 20) throw Error(text.verify);
            for (const warning of warnings) { if (!Number.isSafeInteger(warning.Code) || typeof warning.Message !== 'string') throw Error(text.verify); const message = warning.Message.slice(0, Math.min(1024, remaining)); remaining -= message.length; if (!message) break; answer.warnings.push(`服务器警告${warning.Code}：${message}`); }
          } catch { answer.warnings.push('警告读取未完成，请核对实际约束，不要重复执行。'); }
        }
        try {
          const after = await readTableChecks(context, snapshot.target); answer.after = { ddlHash: tableCheckHash(after.source), checks: [...after.checks.values()].map(item => view(item.view)) };
          answer.definitionVerified = progress.definitionVerified = warningKnown && result.warningStatus === 0 && verifyTableCheckBase(snapshot, after) && verifyTableCheckPlan(preview.plan, snapshot, { ...after, target: snapshot.target });
          if (!answer.definitionVerified) answer.verificationError = text.verify;
        } catch { answer.verificationError = text.verify; }
        context.report(); return answer;
      } finally { if (progress.ddlSubmitted) this.cache.release(snapshot.target.connectionId); }
    }, { label: text.labels.apply, purpose: 'tableChecks', progress, executionTarget: snapshot.target });
    // host resolve已包括原命令、控制连接和strict关闭；OK包本身绝不授予此事实。
    return { ...output, resourcesReleased: true };
  }
}
