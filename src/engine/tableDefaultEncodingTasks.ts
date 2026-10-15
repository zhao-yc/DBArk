import { randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery, type StructureTaskHost } from './structureDefinition';
import { readTableDefaultEncoding, assertTableDefaultEncodingUnchanged, verifyTableDefaultEncoding, tableDefaultEncodingHash, type TableDefaultEncodingRead } from './tableDefaultEncodingRead';
import { planTableDefaultEncoding } from './tableDefaultEncodingSql';
import { tableDefaultEncodingAcknowledgements, type TableEncodingPair, type TableDefaultEncodingGetInput, type TableDefaultEncodingGetOutput, type TableDefaultEncodingPreviewInput, type TableDefaultEncodingPreviewOutput, type TableDefaultEncodingApplyInput, type TableDefaultEncodingApplyOutput, type TableDefaultEncodingProgress, type TableDefaultEncodingReleaseInput, type TableDefaultEncodingTarget } from '../shared/tableDefaultEncoding';

interface Snapshot extends TableDefaultEncodingRead { id: string; target: TableDefaultEncodingTarget; revision: number; expires: number; }
interface Preview { snapshot: Snapshot; sql: string; selection: TableEncodingPair; bytes: number; expires: number; }
const initialProgress = (): TableDefaultEncodingProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
const warnings = ['DDL通常隐式提交，不能事务回滚；可能等待元数据锁或触发服务器内部重建。', '执行前会复核完整定义和物理表身份，但仍存在外部DDL并发窗口；请在维护时段暂停并行结构修改。', '本次只改表默认字符集和排序规则，只影响后续未显式指定编码的新增列；不转换现有列或数据。'];

/** 默认编码使用独立令牌用途，复用已有短会话、取消与同表租约，不接收客户端SQL。 */
export class TableDefaultEncodingTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>;
  private readonly previews: StructureCacheScope<Preview>;
  constructor(private readonly host: StructureTaskHost, private readonly now = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('tableDefaultEncoding', 'snapshot', value => ({ connectionId: value.target.connectionId, bytes: value.bytes, expires: value.expires }));
    this.previews = cache.scope('tableDefaultEncoding', 'preview', value => ({ connectionId: value.snapshot.target.connectionId, bytes: value.bytes, expires: value.expires }));
  }
  /** 释放自己持有的令牌，不扩大到其他用途或连接。 */
  releaseTokens(input: TableDefaultEncodingReleaseInput): void {
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
  async get(input: TableDefaultEncodingGetInput, revision: unknown): Promise<TableDefaultEncodingGetOutput> {
    const current = this.revision(revision), progress = initialProgress(); let snapshot!: Snapshot;
    const output = await this.host.run(input.connectionId, input.taskId, async context => {
      progress.phase = 'reading'; context.report(); const target = { connectionId: input.connectionId, database: input.database, table: input.table };
      const read = await readTableDefaultEncoding(context, target); this.cache.capacity(read.bytes, 'snapshot');
      snapshot = { ...read, id: randomUUID(), target, revision: current, expires: this.now() + structureCacheLimits.ttlMs };
      return { target: { ...target }, snapshotId: snapshot.id, expiresAt: new Date(snapshot.expires).toISOString(), ddlHash: tableDefaultEncodingHash(read.source),
        current: { ...read.tableEncoding }, engine: read.engine, rowFormat: read.rowFormat, candidates: read.candidates.map(pair => ({ ...pair })), columns: read.encodings.map(column => ({ ...column })),
        writable: !read.reasons.length && !!read.catalogDigest && !!read.tableId, reasons: [...read.reasons], warnings: [...warnings, ...read.warnings], serverVersion: read.serverVersion };
    }, { label: '读取表默认编码', purpose: 'tableDefaultEncoding', progress });
    this.snapshots.set(snapshot.id, snapshot); return output;
  }
  /** 预览只接受一个真实字符集与排序规则配对，复核全快照但绝不发送DDL。 */
  async preview(input: TableDefaultEncodingPreviewInput, revision: unknown): Promise<TableDefaultEncodingPreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.expires <= this.now()) throw new Error('表默认编码快照已失效，请重新读取');
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化，请重新读取');
    if (snapshot.reasons.length || !snapshot.catalogDigest || !snapshot.tableId) throw new Error(snapshot.reasons.join('；') || '当前表默认编码仅可查看');
    const plan = planTableDefaultEncoding(snapshot.target.database, snapshot.target.table, snapshot.tableEncoding, { charset: input.charset, collation: input.collation }, snapshot.candidates);
    const progress = initialProgress(), token = randomUUID(); let preview!: Preview;
    const output = await this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report(); assertTableDefaultEncodingUnchanged(snapshot, await readTableDefaultEncoding(context, snapshot.target));
      if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('表默认编码快照已释放或过期，未生成预览');
      preview = { snapshot, ...plan, expires: snapshot.expires, bytes: snapshot.bytes + Buffer.byteLength(plan.sql) + 8192 };
      this.cache.capacity(preview.bytes, 'preview');
      return { target: { ...snapshot.target }, previewToken: token, expiresAt: new Date(preview.expires).toISOString(), ddlHash: tableDefaultEncodingHash(snapshot.source), sql: plan.sql, before: { ...snapshot.tableEncoding }, after: { ...plan.selection }, warnings: [...warnings, ...snapshot.warnings], requiredAcknowledgements: [...tableDefaultEncodingAcknowledgements] };
    }, { label: '预览表默认编码', purpose: 'tableDefaultEncoding', progress });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('表默认编码快照已释放或过期，未生成预览');
    this.previews.set(token, preview); return output;
  }
  /** 任何等待前消费令牌；失败、取消或后核验未知都不允许重放。 */
  async apply(input: TableDefaultEncodingApplyInput, revision: unknown): Promise<TableDefaultEncodingApplyOutput> {
    const preview = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!preview || preview.expires <= this.now()) throw new Error('表默认编码预览已失效或已使用；未发送DDL');
    const snapshot = preview.snapshot;
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化；未发送DDL');
    if (!Array.isArray(input.acknowledgements) || input.acknowledgements.length !== tableDefaultEncodingAcknowledgements.length || new Set(input.acknowledgements).size !== input.acknowledgements.length || tableDefaultEncodingAcknowledgements.some(value => !input.acknowledgements.includes(value))) throw new Error('确认项与实际预览不一致；令牌已消费，未发送DDL');
    const progress = initialProgress();
    return this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report(); assertTableDefaultEncodingUnchanged(snapshot, await readTableDefaultEncoding(context, snapshot.target));
      if (preview.expires <= this.now()) throw new Error('表默认编码预览已过期；未发送DDL');
      context.checkCancelled(); progress.phase = 'executing'; context.report();
      const result = (await structureTaskQuery<ResultSetHeader>(context, preview.sql, () => { progress.ddlSubmitted = true; progress.outcome = 'unknown'; context.report(); })).rows;
      if (!result || typeof result.affectedRows !== 'number') throw new Error('未返回可确认的DDL成功响应，请核对实际定义；不会重放');
      progress.ddlCompleted = true; progress.outcome = 'succeeded'; progress.phase = 'verifying'; context.report();
      const output: TableDefaultEncodingApplyOutput = { ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: [] };
      // 诊断紧随OK包；后续SHOW CREATE及SELECT会覆盖服务器诊断区。
      if (!Number.isSafeInteger(result.warningStatus) || result.warningStatus < 0 || result.warningStatus > 65535) output.warnings.push('DDL已完成，但服务器警告计数无法确认，不能证明默认编码变更保真；不要重复执行。');
      else if (result.warningStatus) {
        output.warnings.push(`服务器返回${result.warningStatus}条警告，请核对实际默认编码与原列编码。`);
        try {
          const rows = (await structureTaskQuery<{ Code: number; Message: string }[]>(context, 'SHOW WARNINGS LIMIT 20')).rows;
          for (const row of rows.slice(0, 20)) if (Number.isSafeInteger(row.Code) && typeof row.Message === 'string') output.warnings.push(`服务器警告${row.Code}：${row.Message.slice(0, 1024)}`);
        } catch { output.warnings.push('警告读取未完成，不能证明默认编码变更保真；不要重复执行。'); }
      }
      try {
        const after = await readTableDefaultEncoding(context, snapshot.target);
        output.after = { current: { ...after.tableEncoding }, ddlHash: tableDefaultEncodingHash(after.source) };
        output.definitionVerified = progress.definitionVerified = result.warningStatus === 0 && verifyTableDefaultEncoding(snapshot, after, preview.selection);
        if (!output.definitionVerified) output.verificationError = 'DDL已完成，但默认编码、原列编码或其他属性尚未全部核验一致；请核对最新定义，不要重复执行';
      } catch { output.verificationError = 'DDL已收到成功响应，但取消、断线或目录读取失败导致定义未完成核验；不要重复执行'; }
      context.report(); this.cache.release(snapshot.target.connectionId); return output;
    }, { label: '执行表默认编码', purpose: 'tableDefaultEncoding', progress, executionTarget: snapshot.target });
  }
}
