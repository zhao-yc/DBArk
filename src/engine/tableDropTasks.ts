import { randomUUID, createHash } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery, type StructureTaskHost } from './structureDefinition';
import { planTableDrop, readTableDrop, assertTableDropUnchanged, assertTableDropConfirmation, verifyTableDrop, type TableDropRead } from './tableDropSql';
import { tableDropAcknowledgements, tableDropAcksComplete, type TableDropTarget, type TableDropGetInput, type TableDropGetOutput, type TableDropPreviewInput, type TableDropPreviewOutput, type TableDropApplyInput, type TableDropApplyOutput, type TableDropReleaseInput, type TableDropProgress } from '../shared/tableDrop';

interface Snapshot extends TableDropRead { id: string; target: TableDropTarget; revision: number; expires: number; }
interface Preview { snapshot: Snapshot; sql: string; bytes: number; expires: number; }
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const progress = (): TableDropProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
const warnings = ['永久删除此表全部数据和结构；DROP TABLE隐式提交且不能事务回滚，撤销和取消不能恢复。', '使用独立结构会话，不替其它查询标签提交事务；不提供删除行数。', '请核对备份并在维护窗口暂停并行DDL和数据写入；重核不消除外部变更窗口，不级联或关闭外键检查。', '入口检查外键、触发器和视图依赖；不会自动修复例程、事件或应用SQL中的引用，请预先核对。'];

/** 删除专用用途共享原缓存预算、物理身份与结构执行锁；客户端不提供SQL。 */
export class TableDropTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>; private readonly previews: StructureCacheScope<Preview>;
  constructor(private readonly host: StructureTaskHost, private readonly now = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('tableDrop', 'snapshot', value => ({ connectionId: value.target.connectionId, bytes: value.bytes, expires: value.expires }));
    this.previews = cache.scope('tableDrop', 'preview', value => ({ connectionId: value.snapshot.target.connectionId, bytes: value.bytes, expires: value.expires }));
  }
  /** 释放自身令牌，不能释放其它编辑器能力。 */
  releaseTokens(input: TableDropReleaseInput): void {
    if (input.snapshotId) { const value = this.snapshots.get(input.snapshotId); this.snapshots.delete(input.snapshotId); if (value) for (const [id, preview] of this.previews) if (preview.snapshot === value) this.previews.delete(id); }
    if (input.previewToken) this.previews.delete(input.previewToken);
  }
  /** 修订只来自主进程，渲染进程不能自行补入。 */
  private revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('缺少可信连接配置修订'); return value as number; }
  /** get只读取真实目录及权限，不扫描数据、不删除。 */
  async get(input: TableDropGetInput, revision: unknown): Promise<TableDropGetOutput> {
    const current = this.revision(revision), state = progress(); let snapshot!: Snapshot;
    const output = await this.host.run(input.connectionId, input.taskId, async context => {
      state.phase = 'reading'; context.report(); const target = { connectionId: input.connectionId, database: input.database, table: input.table }, read = await readTableDrop(context, target);
      this.cache.capacity(read.bytes, 'snapshot'); snapshot = { ...read, id: randomUUID(), target, revision: current, expires: this.now() + structureCacheLimits.ttlMs };
      return { target, snapshotId: snapshot.id, expiresAt: new Date(snapshot.expires).toISOString(), ddlHash: hash(read.source), writable: read.reasons.length === 0 && !!read.tableId, reasons: [...read.reasons], warnings: [...warnings], serverVersion: read.serverVersion, engine: read.engine };
    }, { label: '读取删除表能力', purpose: 'tableDrop', progress: state });
    this.snapshots.set(snapshot.id, snapshot); return output;
  }
  /** 预览只从真实快照生成一条DROP，重核后发放有界单次令牌。 */
  async preview(input: TableDropPreviewInput, revision: unknown): Promise<TableDropPreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.expires <= this.now() || snapshot.revision !== this.revision(revision)) throw new Error('删除快照失效或连接配置变化，请重新读取');
    if (snapshot.reasons.length || !snapshot.tableId) throw new Error(snapshot.reasons.join('；') || '当前目标只读');
    const state = progress(), token = randomUUID(); let value!: Preview;
    const result = await this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      state.phase = 'rechecking'; context.report(); assertTableDropUnchanged(snapshot, await readTableDrop(context, snapshot.target));
      if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('快照已释放或过期，未创建删除预览');
      const sql = planTableDrop(snapshot.target); value = { snapshot, sql, bytes: snapshot.bytes + Buffer.byteLength(sql) + 4096, expires: snapshot.expires }; this.cache.capacity(value.bytes, 'preview');
      return { target: { ...snapshot.target }, previewToken: token, expiresAt: new Date(value.expires).toISOString(), ddlHash: hash(snapshot.source), sql, requiredAcknowledgements: [...tableDropAcknowledgements], warnings: [...warnings] };
    }, { label: '预览删除单表', purpose: 'tableDrop', progress: state });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('快照已释放或过期，未创建删除预览');
    this.previews.set(token, value); return result;
  }
  /** 同步消费令牌后才等待；确认错误、取消、断线及未知结果都不能重放。 */
  async apply(input: TableDropApplyInput, revision: unknown): Promise<TableDropApplyOutput> {
    const value = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!value || value.expires <= this.now()) throw new Error('删除预览已失效或已使用，未发送DDL');
    const snapshot = value.snapshot;
    // 同一读取批次的其它预览也同时失效；未知或失败后必须重新读取，不能再包装旧快照。
    this.releaseTokens({ snapshotId: snapshot.id });
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化，未发送DDL');
    assertTableDropConfirmation(snapshot.target, input.confirmation);
    if (!tableDropAcksComplete(tableDropAcknowledgements, input.acknowledgements)) throw new Error('删除确认项不完整或含未知项目；令牌已消费，未发送DDL');
    const state = progress();
    return this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      state.phase = 'rechecking'; context.report(); assertTableDropUnchanged(snapshot, await readTableDrop(context, snapshot.target));
      if (value.expires <= this.now()) throw new Error('删除预览已过期，未发送DDL');
      context.checkCancelled(); state.phase = 'executing'; context.report();
      const ok = (await structureTaskQuery<ResultSetHeader>(context, value.sql, () => { state.ddlSubmitted = true; state.outcome = 'unknown'; context.report(); })).rows;
      if (!ok || !Number.isSafeInteger(ok.affectedRows) || ok.affectedRows < 0) throw new Error('未收到可确认的删除DDL成功响应，请核对服务器，不会重放');
      state.ddlCompleted = true; state.outcome = 'succeeded'; state.phase = 'verifying'; context.report();
      const output: TableDropApplyOutput = { ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: [] };
      if (ok.warningStatus !== 0) output.warnings.push('DDL已完成但警告计数不为已确认的零，请核对服务器，不要重复执行');
      try {
        output.after = await verifyTableDrop(context, snapshot.target, snapshot);
        output.definitionVerified = state.definitionVerified = ok.warningStatus === 0 && output.after.targetAbsent && output.after.physicalTableAbsent;
        if (!output.definitionVerified) output.verificationError = '删除DDL已收到成功响应，但原表消失尚未完整核验；不要重复执行';
      } catch { output.verificationError = '删除DDL已收到成功响应，后核验因取消、断线或读取失败未完成；不要重复执行'; }
      context.report(); this.cache.release(snapshot.target.connectionId); return output;
    }, { label: '执行删除单表', purpose: 'tableDrop', progress: state, executionTarget: snapshot.target });
  }
}
