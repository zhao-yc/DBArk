import { randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery, type StructureTaskHost } from './structureDefinition';
import { assertDatabaseDropUnchanged, readDatabaseDrop, verifyDatabaseDropAbsent, type DatabaseDropRead } from './databaseDropRead';
import { databaseDropAcknowledgements, databaseDropIdentifier, isProtectedDatabaseDropName, type DatabaseDropTarget, type DatabaseDropGetInput, type DatabaseDropGetOutput, type DatabaseDropPreviewInput, type DatabaseDropPreviewOutput, type DatabaseDropApplyInput, type DatabaseDropApplyOutput, type DatabaseDropReleaseInput, type DatabaseDropProgress } from '../shared/databaseDrop';

interface Snapshot extends DatabaseDropRead { id: string; target: DatabaseDropTarget; revision: number; expires: number; }
interface Preview { snapshot: Snapshot; sql: string; expires: number; bytes: number; }
interface Owner { connectionId: string; database: string; snapshotId?: string; }
const initialProgress = (): DatabaseDropProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
const warnings = [
  '将永久删除整个数据库及其表、视图、存储过程、函数、触发器和事件；不扫描行数、不自动备份，不能靠事务回滚恢复。请先验证独立备份。',
  'DROP DATABASE可能隐式提交并等待元数据锁。服务器失败可能已删除部分对象；取消、断线或本地关闭不能证明尚未执行，绝不自动重放。',
  '执行前重核全部可见对象与定义，但数据库无独立物理OID且仍存在外部DDL和名称回收窗口；请在维护时段暂停结构修改。',
  '入向跨库外键会阻止本入口；外部视图、例程、程序和保存SQL不会自动修复，数据库授权不会自动清除，请在维护前后人工检查。',
  '其它会话及其临时表不会由本操作逐一关闭或清理；内部引用按服务器原生DROP处理，不关闭外键检查，不撤权，不补发DROP。',
];

/** 删除数据库专用短会话与一次性令牌；共享结构执行器负责数据库级租约、取消和实际资源终态。 */
export class DatabaseDropTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>;
  private readonly previews: StructureCacheScope<Preview>;
  private readonly pendingReads = new Set<Owner>();
  private readonly pendingApplies = new Set<Owner>();
  constructor(private readonly host: StructureTaskHost, private readonly now = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('databaseDrop', 'snapshot', value => ({ connectionId: value.target.connectionId, expires: value.expires, bytes: value.bytes }));
    this.previews = cache.scope('databaseDrop', 'preview', value => ({ connectionId: value.snapshot.target.connectionId, expires: value.expires, bytes: value.bytes }));
  }
  /** 连接修改、退出和关闭使尚未发布及等待发送的本用途操作失效。 */
  releaseConnection(connectionId?: string): void {
    for (const set of [this.pendingReads, this.pendingApplies]) for (const owner of set) if (!connectionId || owner.connectionId === connectionId) set.delete(owner);
    for (const [id, snapshot] of this.snapshots) if (!connectionId || snapshot.target.connectionId === connectionId) this.snapshots.delete(id);
    for (const [id, preview] of this.previews) if (!connectionId || preview.snapshot.target.connectionId === connectionId) this.previews.delete(id);
  }
  /** 精确释放当前快照及其兄弟预览；单预览释放不影响其它独立来源。 */
  releaseTokens(input: DatabaseDropReleaseInput): void {
    if (input.snapshotId) {
      this.snapshots.delete(input.snapshotId);
      for (const [id, value] of this.previews) if (value.snapshot.id === input.snapshotId) this.previews.delete(id);
      for (const owner of this.pendingApplies) if (owner.snapshotId === input.snapshotId) this.pendingApplies.delete(owner);
    }
    if (input.previewToken) this.previews.delete(input.previewToken);
  }
  /** DDL提交时撤销同目标的独立旧来源，阻止删除后的迟到读取重新发布。 */
  private releaseTarget(target: DatabaseDropTarget): void {
    const same = (value: DatabaseDropTarget) => value.connectionId === target.connectionId && value.database === target.database;
    for (const owner of this.pendingReads) if (same(owner)) this.pendingReads.delete(owner);
    for (const [id, value] of this.snapshots) if (same(value.target)) this.releaseTokens({ snapshotId: id });
    for (const [id, value] of this.previews) if (same(value.snapshot.target)) this.previews.delete(id);
  }
  /** renderer不能指定或覆盖可信配置修订。 */
  private revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw Error('缺少可信连接配置修订'); return value as number; }

  /** 完整读取且实际短会话收尾之后才发布快照，未知能力仍允许明确只读查看。 */
  async get(input: DatabaseDropGetInput, revision: unknown): Promise<DatabaseDropGetOutput> {
    const current = this.revision(revision), target = { connectionId: input.connectionId, database: input.database }, progress = initialProgress(); let snapshot!: Snapshot;
    databaseDropIdentifier(target.database);
    if (this.pendingReads.size >= structureCacheLimits.snapshots) throw Error('删除数据库读取已达并发预算，请等待原任务收尾');
    const owner: Owner = { ...target }; this.pendingReads.add(owner);
    try {
      const output = await this.host.run(input.connectionId, input.taskId, async context => {
        progress.phase = 'reading'; context.report();
        const read = await readDatabaseDrop(context, target); this.cache.capacity(read.bytes, 'snapshot');
        snapshot = { ...read, id: randomUUID(), target, revision: current, expires: this.now() + structureCacheLimits.ttlMs };
        return { target: { ...target }, snapshotId: snapshot.id, expiresAt: new Date(snapshot.expires).toISOString(), catalogDigest: read.catalogDigest, counts: { ...read.counts }, charset: read.charset, collation: read.collation, writable: !read.reasons.length && !isProtectedDatabaseDropName(target.database), reasons: [...read.reasons], warnings: [...warnings, ...read.warnings], serverVersion: read.serverVersion };
      }, { label: '读取删除数据库目录', purpose: 'databaseDrop', progress });
      if (!this.pendingReads.has(owner)) throw Error('读取期间数据库编辑状态已释放，未发布迟到快照');
      this.snapshots.set(snapshot.id, snapshot); return output;
    } finally { this.pendingReads.delete(owner); }
  }

  /** 预览重读完整库定义和所有对象，SQL只有一个精确引用的原生DROP DATABASE。 */
  async preview(input: DatabaseDropPreviewInput, revision: unknown): Promise<DatabaseDropPreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.expires <= this.now()) throw Error('删除数据库快照已失效，请重新读取');
    if (snapshot.revision !== this.revision(revision)) throw Error('连接配置已变化，请重新读取');
    if (snapshot.reasons.length || isProtectedDatabaseDropName(snapshot.target.database)) throw Error(snapshot.reasons.join('；') || '系统数据库永远禁止删除');
    const progress = initialProgress(), token = randomUUID(); let preview!: Preview;
    const output = await this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report();
      assertDatabaseDropUnchanged(snapshot, await readDatabaseDrop(context, snapshot.target));
      if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw Error('快照已释放或过期，未生成删除数据库预览');
      const sql = `DROP DATABASE ${databaseDropIdentifier(snapshot.target.database)};`;
      preview = { snapshot, sql, expires: snapshot.expires, bytes: snapshot.bytes + Buffer.byteLength(sql) + 8192 }; this.cache.capacity(preview.bytes, 'preview');
      return { target: { ...snapshot.target }, previewToken: token, expiresAt: new Date(preview.expires).toISOString(), catalogDigest: snapshot.catalogDigest, counts: { ...snapshot.counts }, sql, requiredAcknowledgements: [...databaseDropAcknowledgements], warnings: [...warnings, ...snapshot.warnings] };
    }, { label: '预览删除数据库', purpose: 'databaseDrop', progress });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw Error('快照已释放或过期，未发布迟到删除预览');
    this.previews.set(token, preview); return output;
  }

  /** 首次等待前消费来源及全部兄弟，确认失败、取消、驱动错误和结果未知均不可重放。 */
  async apply(input: DatabaseDropApplyInput, revision: unknown): Promise<DatabaseDropApplyOutput> {
    const preview = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!preview || preview.expires <= this.now()) throw Error('删除数据库预览已失效或已使用；未发送DDL');
    const snapshot = preview.snapshot, active = this.snapshots.get(snapshot.id) === snapshot;
    this.releaseTokens({ snapshotId: snapshot.id });
    if (!active) throw Error('删除数据库来源已失效或已使用；未发送DDL');
    if (snapshot.revision !== this.revision(revision)) throw Error('连接配置已变化；令牌已消费，未发送DDL');
    if (isProtectedDatabaseDropName(snapshot.target.database)) throw Error('系统数据库永远禁止删除；未发送DDL');
    if (input.confirmation !== snapshot.target.database) throw Error('须逐字输入原数据库名称，不会修剪空格；令牌已消费，未发送DDL');
    if (!Array.isArray(input.acknowledgements) || input.acknowledgements.length !== databaseDropAcknowledgements.length || new Set(input.acknowledgements).size !== input.acknowledgements.length || databaseDropAcknowledgements.some(value => !input.acknowledgements.includes(value))) throw Error('风险确认项与预览不一致；令牌已消费，未发送DDL');
    const progress = initialProgress(), owner: Owner = { ...snapshot.target, snapshotId: snapshot.id }; this.pendingApplies.add(owner);
    try {
      return await this.host.run(snapshot.target.connectionId, input.taskId, async context => {
        progress.phase = 'rechecking'; context.report();
        assertDatabaseDropUnchanged(snapshot, await readDatabaseDrop(context, snapshot.target));
        if (!this.pendingApplies.has(owner) || preview.expires <= this.now()) throw Error('删除数据库预览已过期或来源已释放；未发送DDL');
        context.checkCancelled(); progress.phase = 'executing'; context.report();
        const result = (await structureTaskQuery<ResultSetHeader>(context, preview.sql, () => { this.releaseTarget(snapshot.target); progress.ddlSubmitted = true; progress.outcome = 'unknown'; context.report(); })).rows;
        // DROP DATABASE的affectedRows随实际删除的表数变化，不以0假定成功，也不把收到成功包后的核验失败改成失败重试。
        if (!result || !Number.isSafeInteger(result.affectedRows) || result.affectedRows < 0) throw Error('未返回可确认的DROP DATABASE成功响应；请核对实际状态，不会重放');
        progress.ddlCompleted = true; progress.outcome = 'succeeded'; progress.phase = 'verifying'; context.report();
        const output: DatabaseDropApplyOutput = { target: { ...snapshot.target }, ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: [] };
        if (result.warningStatus !== 0) output.warnings.push('已收到DDL成功响应，但警告计数非零或未知，不能报告完整核验；请检查实际库状态。');
        try {
          const absent = await verifyDatabaseDropAbsent(context, snapshot.target, snapshot); output.after = { databaseAbsent: absent };
          output.definitionVerified = progress.definitionVerified = absent && result.warningStatus === 0;
          if (!output.definitionVerified) output.verificationError = 'DDL已完成，但精确名称消失和零警告尚未全部证明；请人工核对，不要重复执行';
        } catch { output.verificationError = '已收到DDL成功响应，但取消、断线、权限变化或目录读取失败使后核验未完成；请核对实际状态，不要重复执行'; }
        context.report(); return output;
      }, { label: '执行删除数据库', purpose: 'databaseDrop', progress, executionDatabase: snapshot.target.database });
    } finally { this.pendingApplies.delete(owner); }
  }
}
