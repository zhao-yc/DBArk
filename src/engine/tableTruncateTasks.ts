import { randomUUID, createHash } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { qualified } from './sql';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery, type StructureTaskHost } from './structureDefinition';
import { planTableTruncate, readTableTruncate, assertTableTruncateUnchanged, assertTableTruncateConfirmation, verifyTableTruncate, type TableTruncateRead } from './tableTruncateSql';
import { tableTruncateAcknowledgements, tableTruncateAcksComplete, type TableTruncateTarget, type TableTruncateGetInput, type TableTruncateGetOutput, type TableTruncatePreviewInput, type TableTruncatePreviewOutput, type TableTruncateApplyInput, type TableTruncateApplyOutput, type TableTruncateReleaseInput, type TableTruncateProgress } from '../shared/tableTruncate';

interface Snapshot extends TableTruncateRead { id: string; target: TableTruncateTarget; revision: number; expires: number; }
interface Preview { snapshot: Snapshot; sql: string; bytes: number; expires: number; }
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const progress = (): TableTruncateProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
const warnings = ['清空全部当前数据，DDL隐式提交且不能事务回滚；不会触发ON DELETE触发器，不能用撤销恢复。', '自增计数将重置；不提供删除行数，OK包的0行不是删除0条。', '请核对备份并在维护窗口暂停并行DDL与数据写入；重核不消除外部变更窗口。'];

/** 清空专用用途共享原缓存预算、物理身份与结构执行锁；客户端不提供SQL。 */
export class TableTruncateTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>; private readonly previews: StructureCacheScope<Preview>;
  constructor(private readonly host: StructureTaskHost, private readonly now = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('tableTruncate', 'snapshot', value => ({ connectionId: value.target.connectionId, bytes: value.bytes, expires: value.expires }));
    this.previews = cache.scope('tableTruncate', 'preview', value => ({ connectionId: value.snapshot.target.connectionId, bytes: value.bytes, expires: value.expires }));
  }
  /** 释放自身令牌，不能释放其它编辑器能力。 */
  releaseTokens(input: TableTruncateReleaseInput): void {
    if (input.snapshotId) { const value = this.snapshots.get(input.snapshotId); this.snapshots.delete(input.snapshotId); if (value) for (const [id, preview] of this.previews) if (preview.snapshot === value) this.previews.delete(id); }
    if (input.previewToken) this.previews.delete(input.previewToken);
  }
  /** 修订只来自主进程，渲染进程不能自行补入。 */
  private revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('缺少可信连接配置修订'); return value as number; }
  /** get只读取真实目录及权限，不扫描数据、不清空。 */
  async get(input: TableTruncateGetInput, revision: unknown): Promise<TableTruncateGetOutput> {
    const current = this.revision(revision), state = progress(); let snapshot!: Snapshot;
    const output = await this.host.run(input.connectionId, input.taskId, async context => {
      state.phase = 'reading'; context.report(); const target = { connectionId: input.connectionId, database: input.database, table: input.table }, read = await readTableTruncate(context, target);
      this.cache.capacity(read.bytes, 'snapshot'); snapshot = { ...read, id: randomUUID(), target, revision: current, expires: this.now() + structureCacheLimits.ttlMs };
      return { target, snapshotId: snapshot.id, expiresAt: new Date(snapshot.expires).toISOString(), ddlHash: hash(read.source), writable: read.reasons.length === 0 && !!read.tableId, reasons: [...read.reasons], warnings: [...warnings], serverVersion: read.serverVersion, engine: read.engine, autoIncrement: read.autoIncrement };
    }, { label: '读取清空表能力', purpose: 'tableTruncate', progress: state });
    this.snapshots.set(snapshot.id, snapshot); return output;
  }
  /** 预览只从真实快照生成一条TRUNCATE，重核后发放有界单次令牌。 */
  async preview(input: TableTruncatePreviewInput, revision: unknown): Promise<TableTruncatePreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.expires <= this.now() || snapshot.revision !== this.revision(revision)) throw new Error('清空快照失效或连接配置变化，请重新读取');
    if (snapshot.reasons.length || !snapshot.tableId) throw new Error(snapshot.reasons.join('；') || '当前目标只读');
    const state = progress(), token = randomUUID(); let value!: Preview;
    const result = await this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      state.phase = 'rechecking'; context.report(); assertTableTruncateUnchanged(snapshot, await readTableTruncate(context, snapshot.target));
      if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('快照已释放或过期，未创建清空预览');
      const sql = planTableTruncate(snapshot.target); value = { snapshot, sql, bytes: snapshot.bytes + Buffer.byteLength(sql) + 4096, expires: snapshot.expires }; this.cache.capacity(value.bytes, 'preview');
      return { target: { ...snapshot.target }, previewToken: token, expiresAt: new Date(value.expires).toISOString(), ddlHash: hash(snapshot.source), sql, requiredAcknowledgements: [...tableTruncateAcknowledgements], warnings: [...warnings] };
    }, { label: '预览清空单表', purpose: 'tableTruncate', progress: state });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('快照已释放或过期，未创建清空预览');
    this.previews.set(token, value); return result;
  }
  /** 同步消费令牌后才等待；确认错误、取消、断线及未知结果都不能重放。 */
  async apply(input: TableTruncateApplyInput, revision: unknown): Promise<TableTruncateApplyOutput> {
    const value = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!value || value.expires <= this.now()) throw new Error('清空预览已失效或已使用，未发送DDL');
    const snapshot = value.snapshot;
    // 同一读取批次的其它预览也同时失效；未知或失败后必须重新读取，不能再包装旧快照。
    this.releaseTokens({ snapshotId: snapshot.id });
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化，未发送DDL');
    assertTableTruncateConfirmation(snapshot.target, input.confirmation);
    if (!tableTruncateAcksComplete(tableTruncateAcknowledgements, input.acknowledgements)) throw new Error('清空确认项不完整或含未知项目；令牌已消费，未发送DDL');
    const state = progress();
    return this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      state.phase = 'rechecking'; context.report(); assertTableTruncateUnchanged(snapshot, await readTableTruncate(context, snapshot.target));
      if (value.expires <= this.now()) throw new Error('清空预览已过期，未发送DDL');
      context.checkCancelled(); state.phase = 'executing'; context.report();
      const ok = (await structureTaskQuery<ResultSetHeader>(context, value.sql, () => { state.ddlSubmitted = true; state.outcome = 'unknown'; context.report(); })).rows;
      if (!ok || typeof ok.affectedRows !== 'number') throw new Error('未收到可确认的清空DDL成功响应，请核对服务器，不会重放');
      state.ddlCompleted = true; state.outcome = 'succeeded'; state.phase = 'verifying'; context.report();
      const output: TableTruncateApplyOutput = { ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: [] };
      if (ok.warningStatus !== 0) output.warnings.push('DDL已完成但警告计数不为已确认的零，请核对服务器，不要重复执行');
      try {
        const after = await readTableTruncate(context, snapshot.target, true), rows = (await structureTaskQuery<unknown[]>(context, `SELECT 1 AS present FROM ${qualified(snapshot.target.database, snapshot.target.table)} LIMIT 1`)).rows;
        const emptyObserved = Array.isArray(rows) && rows.length === 0;
        output.after = { ddlHash: hash(after.source), emptyObserved, autoIncrement: after.autoIncrement };
        output.definitionVerified = state.definitionVerified = ok.warningStatus === 0 && verifyTableTruncate(snapshot, after, emptyObserved);
        if (!output.definitionVerified) output.verificationError = '清空DDL已收到成功响应，但空表、计数或定义尚未完整核验；不要重复执行';
      } catch { output.verificationError = '清空DDL已收到成功响应，后核验因取消、断线或读取失败未完成；不要重复执行'; }
      context.report(); this.cache.release(snapshot.target.connectionId); return output;
    }, { label: '执行清空单表', purpose: 'tableTruncate', progress: state, executionTarget: snapshot.target });
  }
}
