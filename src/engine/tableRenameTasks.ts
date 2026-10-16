import { randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery, type StructureTaskHost } from './structureDefinition';
import { readTableRename, assertTableRenameUnchanged, assertRenameDestinationAbsent, tableRenamePhysicalIdentity } from './tableRenameRead';
import { tableCommentHash, type TableCommentRead } from './tableCommentRead';
import { planTableRename, verifyTableRename } from './tableRenameSql';
import { tableRenameAcknowledgements, type TableRenameTarget, type TableRenameGetInput, type TableRenameGetOutput, type TableRenamePreviewInput, type TableRenamePreviewOutput, type TableRenameApplyInput, type TableRenameApplyOutput, type TableRenameReleaseInput, type TableRenameProgress } from '../shared/tableRename';

interface Snapshot extends TableCommentRead { id: string; target: TableRenameTarget; revision: number; expires: number; }
interface Preview { snapshot: Snapshot; newName: string; sql: string; bytes: number; expires: number; }
const initialProgress = (): TableRenameProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
const warnings = [
  'DDL会隐式提交，不能靠事务回滚撤销；可能等待元数据锁。取消请求或本地断线不证明服务器未执行。',
  '执行前会重核完整定义、TABLE_ID、模式、权限、依赖和目标名称，但仍存在外部DDL并发窗口；请在维护时段暂停并行结构修改。',
  '只发送同库单表RENAME，不重述整表；表级授权不会随名称迁移。外部程序、存储程序、事件、查询SQL和已复制对象链接不会自动改写，需人工检查。',
  '首批拒绝已知外键、触发器、视图引用和CHECK约束；这不代表完成全部依赖重构或O01。失败和结果未知不会自动重放。',
];

/** 专用用途复用结构短会话、真实取消、连接修订和共享源/目标租约。 */
export class TableRenameTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>;
  private readonly previews: StructureCacheScope<Preview>;
  constructor(private readonly host: StructureTaskHost, private readonly now = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('tableRename', 'snapshot', value => ({ connectionId: value.target.connectionId, bytes: value.bytes, expires: value.expires }));
    this.previews = cache.scope('tableRename', 'preview', value => ({ connectionId: value.snapshot.target.connectionId, bytes: value.bytes, expires: value.expires }));
  }
  /** 释放快照时一并撤销其全部预览，不触碰其他用途令牌。 */
  releaseTokens(input: TableRenameReleaseInput): void {
    if (input.snapshotId) {
      const snapshot = this.snapshots.get(input.snapshotId); this.snapshots.delete(input.snapshotId);
      if (snapshot) for (const [id, preview] of this.previews) if (preview.snapshot === snapshot) this.previews.delete(id);
    }
    if (input.previewToken) this.previews.delete(input.previewToken);
  }
  /** 可信修订只能来自主进程；renderer不能提供。 */
  private revision(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('缺少可信连接配置修订');
    return value as number;
  }
  /** 真实读取并关闭短会话后才发布快照，未知能力明确只读。 */
  async get(input: TableRenameGetInput, revision: unknown): Promise<TableRenameGetOutput> {
    const current = this.revision(revision), progress = initialProgress(); let snapshot!: Snapshot;
    const output = await this.host.run(input.connectionId, input.taskId, async context => {
      progress.phase = 'reading'; context.report(); const target = { connectionId: input.connectionId, database: input.database, table: input.table };
      const read = await readTableRename(context, target, undefined, 'get'); this.cache.capacity(read.bytes, 'snapshot');
      snapshot = { ...read, id: randomUUID(), target, revision: current, expires: this.now() + structureCacheLimits.ttlMs };
      return { target, snapshotId: snapshot.id, expiresAt: new Date(snapshot.expires).toISOString(), ddlHash: tableCommentHash(read.source), tableId: read.tableId,
        engine: read.engine, rowFormat: read.rowFormat, autoIncrement: read.autoIncrement, charset: read.tableEncoding.charset, collation: read.tableEncoding.collation,
        writable: !read.reasons.length && !!read.tableId, reasons: [...read.reasons], warnings: [...warnings], serverVersion: read.serverVersion };
    }, { label: '读取表重命名', purpose: 'tableRename', progress });
    this.snapshots.set(snapshot.id, snapshot); return output;
  }
  /** 只读预览重核来源及真实目标冲突；新名称不能改变连接或数据库。 */
  async preview(input: TableRenamePreviewInput, revision: unknown): Promise<TableRenamePreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.expires <= this.now()) throw new Error('表重命名快照已失效，请重新读取');
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化，请重新读取');
    if (snapshot.reasons.length || !snapshot.tableId) throw new Error(snapshot.reasons.join('；') || '当前表重命名仅可查看');
    const plan = planTableRename(snapshot.target, input.newName), progress = initialProgress(), token = randomUUID(); let preview!: Preview;
    const output = await this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report();
      assertTableRenameUnchanged(snapshot, await readTableRename(context, snapshot.target, plan.newName, 'execute'));
      await assertRenameDestinationAbsent(context, snapshot.target, plan.newName);
      if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('快照已释放或过期，未生成重命名预览');
      preview = { snapshot, ...plan, expires: snapshot.expires, bytes: snapshot.bytes + Buffer.byteLength(plan.sql) + 8192 }; this.cache.capacity(preview.bytes, 'preview');
      return { target: { ...snapshot.target }, previewToken: token, expiresAt: new Date(preview.expires).toISOString(), ddlHash: tableCommentHash(snapshot.source), sql: plan.sql, before: snapshot.target.table, after: plan.newName, warnings: [...warnings], requiredAcknowledgements: [...tableRenameAcknowledgements] };
    }, { label: '预览表重命名', purpose: 'tableRename', progress });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('快照已释放或过期，未生成重命名预览');
    this.previews.set(token, preview); return output;
  }
  /** 所有等待之前消费令牌，源/目标同时占用；DDL失败、取消、未知均不重放。 */
  async apply(input: TableRenameApplyInput, revision: unknown): Promise<TableRenameApplyOutput> {
    const preview = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!preview || preview.expires <= this.now()) throw new Error('重命名预览已失效或已使用；未发送DDL');
    const snapshot = preview.snapshot;
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化；未发送DDL');
    if (!Array.isArray(input.acknowledgements) || input.acknowledgements.length !== tableRenameAcknowledgements.length || new Set(input.acknowledgements).size !== input.acknowledgements.length || tableRenameAcknowledgements.some(value => !input.acknowledgements.includes(value))) throw new Error('风险确认项与预览不一致；令牌已消费，未发送DDL');
    const newTarget = { ...snapshot.target, table: preview.newName }, progress = initialProgress();
    return this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report();
      assertTableRenameUnchanged(snapshot, await readTableRename(context, snapshot.target, preview.newName, 'execute'));
      await assertRenameDestinationAbsent(context, snapshot.target, preview.newName);
      if (preview.expires <= this.now()) throw new Error('重命名预览已过期；未发送DDL');
      context.checkCancelled(); progress.phase = 'executing'; context.report();
      const result = (await structureTaskQuery<ResultSetHeader>(context, preview.sql, () => { progress.ddlSubmitted = true; progress.outcome = 'unknown'; context.report(); })).rows;
      if (!result || result.affectedRows !== 0) throw new Error('未返回可确认的单表RENAME成功响应；请核对源表和新表，不会重放');
      progress.ddlCompleted = true; progress.outcome = 'succeeded'; progress.phase = 'verifying'; context.report();
      const output: TableRenameApplyOutput = { target: { ...snapshot.target }, newTarget, ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: [] };
      if (result.warningStatus !== 0) output.warnings.push('DDL已完成但警告计数非零或未知，不能证明完整核验；请检查源表和新表。');
      try {
        const after = await readTableRename(context, newTarget, undefined, 'verify');
        await assertRenameDestinationAbsent(context, snapshot.target, snapshot.target.table);
        if (after.tableId) output.after = { tableId: after.tableId, ddlHash: tableCommentHash(after.source), physicalIdentity: tableRenamePhysicalIdentity(after) };
        output.definitionVerified = progress.definitionVerified = result.warningStatus === 0 && verifyTableRename(snapshot, after);
        if (!output.definitionVerified) output.verificationError = 'DDL已完成，但新名称的物理身份、完整定义或旧名称消失尚未全部核验；请核对实际状态，不要重复执行';
      } catch { output.verificationError = '已收到DDL成功响应，但取消、断线或目录读取失败导致后核验未完成；请核对源表和新表，不要重复执行'; }
      context.report(); this.cache.release(snapshot.target.connectionId); return output;
    }, { label: '执行表重命名', purpose: 'tableRename', progress, executionTargets: [snapshot.target, newTarget] });
  }
}
