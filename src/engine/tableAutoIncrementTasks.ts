import { randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery, type StructureTaskHost } from './structureDefinition';
import { readTableAutoIncrement, assertTableAutoIncrementUnchanged, verifyTableAutoIncrementStructure, type TableAutoIncrementRead } from './tableAutoIncrementRead';
import { tableCommentHash as tableAutoIncrementHash } from './tableCommentRead';
import { planTableAutoIncrement } from './tableAutoIncrementSql';
import { tableAutoIncrementCapabilityWarnings } from './tableAutoIncrementCapabilities';
import { compareAutoIncrementDecimal, tableAutoIncrementRequiredAcknowledgements, validateTableAutoIncrement, type TableAutoIncrementGetInput, type TableAutoIncrementGetOutput, type TableAutoIncrementPreviewInput, type TableAutoIncrementPreviewOutput, type TableAutoIncrementApplyInput, type TableAutoIncrementApplyOutput, type TableAutoIncrementProgress, type TableAutoIncrementReleaseInput, type TableAutoIncrementTarget } from '../shared/tableAutoIncrement';

interface Snapshot extends TableAutoIncrementRead { id: string; target: TableAutoIncrementTarget; revision: number; expires: number; }
interface Preview { snapshot: Snapshot; sql: string; value: string; bytes: number; expires: number; }
const initialProgress = (): TableAutoIncrementProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
const warnings = ['DDL通常隐式提交，不能事务回滚；可能等待元数据锁或服务器内部处理。', '执行前严格重核完整定义、原生物理身份、模式和目录计数；仍存在外部DDL/DML窗口，请在维护时段暂停写入与并行结构变更。', '首批只上调目录观测值，客户端不查询业务行或MAX、不新增或修改列级AUTO_INCREMENT；服务器可能忽略、调整请求或被并发DML推进。只报告核验时的目录观测值，不保证下一次插入分配值；失败、取消及未知结果不自动重放。'];

/** 下一自增值使用独立令牌用途，复用已有短会话、取消与同表租约，不接收客户端SQL。 */
export class TableAutoIncrementTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>;
  private readonly previews: StructureCacheScope<Preview>;
  constructor(private readonly host: StructureTaskHost, private readonly now = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('tableAutoIncrement', 'snapshot', value => ({ connectionId: value.target.connectionId, bytes: value.bytes, expires: value.expires }));
    this.previews = cache.scope('tableAutoIncrement', 'preview', value => ({ connectionId: value.snapshot.target.connectionId, bytes: value.bytes, expires: value.expires }));
  }
  /** 释放自己持有的令牌，不扩大到其他用途或连接。 */
  releaseTokens(input: TableAutoIncrementReleaseInput): void {
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
  async get(input: TableAutoIncrementGetInput, revision: unknown): Promise<TableAutoIncrementGetOutput> {
    const current = this.revision(revision), progress = initialProgress(); let snapshot!: Snapshot;
    const output = await this.host.run(input.connectionId, input.taskId, async context => {
      progress.phase = 'reading'; context.report(); const target = { connectionId: input.connectionId, database: input.database, table: input.table };
      const read = await readTableAutoIncrement(context, target); this.cache.capacity(read.bytes, 'snapshot');
      snapshot = { ...read, id: randomUUID(), target, revision: current, expires: this.now() + structureCacheLimits.ttlMs };
      return { target, snapshotId: snapshot.id, expiresAt: new Date(snapshot.expires).toISOString(), ddlHash: tableAutoIncrementHash(read.source),
        tableId: read.tableId, column: read.column, policy: read.policy, capability: read.capability, engine: read.engine, rowFormat: read.rowFormat, autoIncrement: read.autoIncrement, charset: read.tableEncoding.charset, collation: read.tableEncoding.collation,
        writable: !read.reasons.length && !!read.capability && !!read.column && !!read.policy && !!read.tableId && !!read.autoIncrement && compareAutoIncrementDecimal(read.autoIncrement, read.column.maximum) < 0, reasons: [...read.reasons, ...(read.column && read.autoIncrement && compareAutoIncrementDecimal(read.autoIncrement, read.column.maximum) >= 0 ? ['目录计数已达列类型上限，没有可上调空间'] : [])], warnings: [...warnings, ...tableAutoIncrementCapabilityWarnings(read.capability)], serverVersion: read.serverVersion };
    }, { label: '读取表下一自增值', purpose: 'tableAutoIncrement', progress });
    this.snapshots.set(snapshot.id, snapshot); return output;
  }
  /** 预览只接受一个下一自增值值，复核全快照但绝不发送DDL。 */
  async preview(input: TableAutoIncrementPreviewInput, revision: unknown): Promise<TableAutoIncrementPreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.expires <= this.now()) throw new Error('表下一自增值快照已失效，请重新读取');
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化，请重新读取');
    if (snapshot.reasons.length || !snapshot.column || !snapshot.policy || !snapshot.autoIncrement || !snapshot.tableId) throw new Error(snapshot.reasons.join('；') || '当前表下一自增值仅可查看');
    validateTableAutoIncrement(input.value, snapshot.column!.maximum);
    const plan = planTableAutoIncrement(snapshot.target.database, snapshot.target.table, snapshot.autoIncrement!, input.value, snapshot.column!);
    const progress = initialProgress(), token = randomUUID(); let preview!: Preview;
    const output = await this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report(); assertTableAutoIncrementUnchanged(snapshot, await readTableAutoIncrement(context, snapshot.target));
      if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('表下一自增值快照已释放或过期，未生成预览');
      preview = { snapshot, ...plan, expires: snapshot.expires, bytes: snapshot.bytes + Buffer.byteLength(plan.sql) + 8192 };
      this.cache.capacity(preview.bytes, 'preview');
      return { target: { ...snapshot.target }, previewToken: token, expiresAt: new Date(preview.expires).toISOString(), ddlHash: tableAutoIncrementHash(snapshot.source), sql: plan.sql, before: snapshot.autoIncrement!, after: plan.value, warnings: [...warnings, ...tableAutoIncrementCapabilityWarnings(snapshot.capability)], requiredAcknowledgements: [...tableAutoIncrementRequiredAcknowledgements(snapshot.capability)] };
    }, { label: '预览表下一自增值', purpose: 'tableAutoIncrement', progress });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('表下一自增值快照已释放或过期，未生成预览');
    this.previews.set(token, preview); return output;
  }
  /** 任何等待前消费令牌；失败、取消或后核验未知都不允许重放。 */
  async apply(input: TableAutoIncrementApplyInput, revision: unknown): Promise<TableAutoIncrementApplyOutput> {
    const preview = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!preview || preview.expires <= this.now()) throw new Error('表下一自增值预览已失效或已使用；未发送DDL');
    const snapshot = preview.snapshot;
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化；未发送DDL');
    const required = tableAutoIncrementRequiredAcknowledgements(snapshot.capability);
    if (!Array.isArray(input.acknowledgements) || input.acknowledgements.length !== required.length || new Set(input.acknowledgements).size !== input.acknowledgements.length || required.some(value => !input.acknowledgements.includes(value))) throw new Error('确认项与实际预览不一致；令牌已消费，未发送DDL');
    const progress = initialProgress();
    return this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report(); assertTableAutoIncrementUnchanged(snapshot, await readTableAutoIncrement(context, snapshot.target));
      if (preview.expires <= this.now()) throw new Error('表下一自增值预览已过期；未发送DDL');
      context.checkCancelled(); progress.phase = 'executing'; context.report();
      const result = (await structureTaskQuery<ResultSetHeader>(context, preview.sql, () => { progress.ddlSubmitted = true; progress.outcome = 'unknown'; context.report(); })).rows;
      if (!result || result.affectedRows !== 0) throw new Error('未返回可确认的DDL成功响应，请核对实际定义；不会重放');
      progress.ddlCompleted = true; progress.outcome = 'succeeded'; progress.phase = 'verifying'; context.report();
      const output: TableAutoIncrementApplyOutput = { ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, structureVerified: false, requestedValue: preview.value, counterState: 'unverified', warnings: [] };
      // 诊断紧随OK包；后续SHOW CREATE及SELECT会覆盖服务器诊断区。
      if (!Number.isSafeInteger(result.warningStatus) || result.warningStatus < 0 || result.warningStatus > 65535) output.warnings.push('DDL已完成，但服务器警告计数无法确认，不能证明下一自增值无损；不要重复执行。');
      else if (result.warningStatus) {
        output.warnings.push(`服务器返回${result.warningStatus}条警告，请核对实际下一自增值。`);
        try {
          const rows = (await structureTaskQuery<{ Code: number; Message: string }[]>(context, 'SHOW WARNINGS LIMIT 20')).rows;
          for (const row of rows.slice(0, 20)) if (Number.isSafeInteger(row.Code) && typeof row.Message === 'string') output.warnings.push(`服务器警告${row.Code}：${row.Message.slice(0, 1024)}`);
        } catch { output.warnings.push('警告读取未完成，不能证明下一自增值无损；不要重复执行。'); }
      }
      try {
        const after = await readTableAutoIncrement(context, snapshot.target);
        output.after = { value: after.autoIncrement, ddlHash: tableAutoIncrementHash(after.source), tableId: after.tableId };
        output.structureVerified = result.warningStatus === 0 && verifyTableAutoIncrementStructure(snapshot, after);
        output.counterState = after.autoIncrement === null ? 'unverified' : after.autoIncrement === preview.value ? 'matched' : 'different';
        output.definitionVerified = progress.definitionVerified = output.structureVerified && output.counterState === 'matched';
        if (!output.definitionVerified) output.verificationError = output.counterState === 'different' ? 'DDL已完成，但目录观测值不等于请求值；可能有并发DML推进或服务器忽略/调整，不能认定请求值设置成功，不要重放' : 'DDL已完成，但物理身份、完整定义、运行模式或计数尚未全部核验；请暂停写入后重新读取，不要重放';
      } catch { output.verificationError = 'DDL已收到成功响应，但取消、断线或目录读取失败导致定义未完成核验；不要重复执行'; }
      context.report(); this.cache.release(snapshot.target.connectionId); return output;
    }, { label: '执行表下一自增值', purpose: 'tableAutoIncrement', progress, executionTarget: snapshot.target });
  }
}
