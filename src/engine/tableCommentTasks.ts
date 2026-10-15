import { randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery, type StructureTaskHost } from './structureDefinition';
import { readTableComment, assertTableCommentUnchanged, verifyTableComment, tableCommentHash, type TableCommentRead } from './tableCommentRead';
import { planTableComment } from './tableCommentSql';
import { tableCommentAcknowledgements, validateTableComment, type TableCommentGetInput, type TableCommentGetOutput, type TableCommentPreviewInput, type TableCommentPreviewOutput, type TableCommentApplyInput, type TableCommentApplyOutput, type TableCommentProgress, type TableCommentReleaseInput, type TableCommentTarget } from '../shared/tableComment';

interface Snapshot extends TableCommentRead { id: string; target: TableCommentTarget; revision: number; expires: number; }
interface Preview { snapshot: Snapshot; sql: string; comment: string; bytes: number; expires: number; }
const initialProgress = (): TableCommentProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
const warnings = ['DDL通常隐式提交，不能事务回滚；可能等待元数据锁或触发服务器内部重建。', '执行前会复核完整定义和物理表身份，但仍存在外部DDL并发窗口；请在维护时段暂停并行结构修改。', '本次只修改普通表注释，不修改字段、索引或其他表选项；失败和结果未知均不会自动重放。'];

/** 注释使用独立令牌用途，复用已有短会话、取消与同表租约，不接收客户端SQL。 */
export class TableCommentTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>;
  private readonly previews: StructureCacheScope<Preview>;
  constructor(private readonly host: StructureTaskHost, private readonly now = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('tableComment', 'snapshot', value => ({ connectionId: value.target.connectionId, bytes: value.bytes, expires: value.expires }));
    this.previews = cache.scope('tableComment', 'preview', value => ({ connectionId: value.snapshot.target.connectionId, bytes: value.bytes, expires: value.expires }));
  }
  /** 释放自己持有的令牌，不扩大到其他用途或连接。 */
  releaseTokens(input: TableCommentReleaseInput): void {
    if (input.snapshotId) {
      const snapshot = this.snapshots.get(input.snapshotId); this.snapshots.delete(input.snapshotId);
      if (snapshot) for (const [id, preview] of this.previews) if (preview.snapshot === snapshot) this.previews.delete(id);
    }
    if (input.previewToken) this.previews.delete(input.previewToken);
  }
  /** 连接修订只由主进程注入，不向renderer公开。 */
  private revision(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('缺少可信连接配置修订');
    return value as number;
  }
  /** 读取连接真实关闭后才发布缓存；读取失败不留下可执行令牌。 */
  async get(input: TableCommentGetInput, revision: unknown): Promise<TableCommentGetOutput> {
    const current = this.revision(revision), progress = initialProgress(); let snapshot!: Snapshot;
    const output = await this.host.run(input.connectionId, input.taskId, async context => {
      progress.phase = 'reading'; context.report(); const target = { connectionId: input.connectionId, database: input.database, table: input.table };
      const read = await readTableComment(context, target); this.cache.capacity(read.bytes, 'snapshot');
      snapshot = { ...read, id: randomUUID(), target, revision: current, expires: this.now() + structureCacheLimits.ttlMs };
      return { target, snapshotId: snapshot.id, expiresAt: new Date(snapshot.expires).toISOString(), ddlHash: tableCommentHash(read.source),
        comment: read.comment, engine: read.engine, rowFormat: read.rowFormat, autoIncrement: read.autoIncrement, charset: read.tableEncoding.charset, collation: read.tableEncoding.collation,
        writable: !read.reasons.length && !!read.budget && !!read.tableId, reasons: [...read.reasons], warnings: [...warnings], budget: read.budget, serverVersion: read.serverVersion };
    }, { label: '读取表注释', purpose: 'tableComment', progress });
    this.snapshots.set(snapshot.id, snapshot); return output;
  }
  /** 预览只接受一个注释值，复核全快照但绝不发送DDL。 */
  async preview(input: TableCommentPreviewInput, revision: unknown): Promise<TableCommentPreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.expires <= this.now()) throw new Error('表注释快照已失效，请重新读取');
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化，请重新读取');
    if (snapshot.reasons.length || !snapshot.budget || !snapshot.tableId) throw new Error(snapshot.reasons.join('；') || '当前表注释仅可查看');
    validateTableComment(input.comment, snapshot.budget);
    const plan = planTableComment(snapshot.target.database, snapshot.target.table, snapshot.comment, input.comment, snapshot.context, snapshot.budget);
    const progress = initialProgress(), token = randomUUID(); let preview!: Preview;
    const output = await this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report(); assertTableCommentUnchanged(snapshot, await readTableComment(context, snapshot.target));
      if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('表注释快照已释放或过期，未生成预览');
      preview = { snapshot, ...plan, expires: snapshot.expires, bytes: snapshot.bytes + Buffer.byteLength(plan.sql) + 8192 };
      this.cache.capacity(preview.bytes, 'preview');
      return { target: { ...snapshot.target }, previewToken: token, expiresAt: new Date(preview.expires).toISOString(), ddlHash: tableCommentHash(snapshot.source), sql: plan.sql, before: snapshot.comment, after: plan.comment, warnings: [...warnings], requiredAcknowledgements: [...tableCommentAcknowledgements] };
    }, { label: '预览表注释', purpose: 'tableComment', progress });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('表注释快照已释放或过期，未生成预览');
    this.previews.set(token, preview); return output;
  }
  /** 任何等待前消费令牌；失败、取消或后核验未知都不允许重放。 */
  async apply(input: TableCommentApplyInput, revision: unknown): Promise<TableCommentApplyOutput> {
    const preview = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!preview || preview.expires <= this.now()) throw new Error('表注释预览已失效或已使用；未发送DDL');
    const snapshot = preview.snapshot;
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化；未发送DDL');
    if (!Array.isArray(input.acknowledgements) || input.acknowledgements.length !== tableCommentAcknowledgements.length || new Set(input.acknowledgements).size !== input.acknowledgements.length || tableCommentAcknowledgements.some(value => !input.acknowledgements.includes(value))) throw new Error('确认项与实际预览不一致；令牌已消费，未发送DDL');
    const progress = initialProgress();
    return this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report(); assertTableCommentUnchanged(snapshot, await readTableComment(context, snapshot.target));
      if (preview.expires <= this.now()) throw new Error('表注释预览已过期；未发送DDL');
      context.checkCancelled(); progress.phase = 'executing'; context.report();
      const result = (await structureTaskQuery<ResultSetHeader>(context, preview.sql, () => { progress.ddlSubmitted = true; progress.outcome = 'unknown'; context.report(); })).rows;
      if (!result || typeof result.affectedRows !== 'number') throw new Error('未返回可确认的DDL成功响应，请核对实际定义；不会重放');
      progress.ddlCompleted = true; progress.outcome = 'succeeded'; progress.phase = 'verifying'; context.report();
      const output: TableCommentApplyOutput = { ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: [] };
      // 诊断紧随OK包；后续SHOW CREATE及SELECT会覆盖服务器诊断区。
      if (!Number.isSafeInteger(result.warningStatus) || result.warningStatus < 0 || result.warningStatus > 65535) output.warnings.push('DDL已完成，但服务器警告计数无法确认，不能证明注释无损；不要重复执行。');
      else if (result.warningStatus) {
        output.warnings.push(`服务器返回${result.warningStatus}条警告，请核对实际注释。`);
        try {
          const rows = (await structureTaskQuery<{ Code: number; Message: string }[]>(context, 'SHOW WARNINGS LIMIT 20')).rows;
          for (const row of rows.slice(0, 20)) if (Number.isSafeInteger(row.Code) && typeof row.Message === 'string') output.warnings.push(`服务器警告${row.Code}：${row.Message.slice(0, 1024)}`);
        } catch { output.warnings.push('警告读取未完成，不能证明注释无损；不要重复执行。'); }
      }
      try {
        const after = await readTableComment(context, snapshot.target);
        output.after = { comment: after.comment, ddlHash: tableCommentHash(after.source) };
        output.definitionVerified = progress.definitionVerified = result.warningStatus === 0 && verifyTableComment(snapshot, after, preview.comment);
        if (!output.definitionVerified) output.verificationError = 'DDL已完成，但注释、原定义或其他属性尚未全部核验一致；请核对最新定义，不要重复执行';
      } catch { output.verificationError = 'DDL已收到成功响应，但取消、断线或目录读取失败导致定义未完成核验；不要重复执行'; }
      context.report(); this.cache.release(snapshot.target.connectionId); return output;
    }, { label: '执行表注释', purpose: 'tableComment', progress, executionTarget: snapshot.target });
  }
}
