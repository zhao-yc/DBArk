import { randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery, type StructureTaskHost } from './structureDefinition';
import { readTableCopyStructure, assertTableCopyStructureUnchanged, verifyTableCopyStructureStructure, planTableCopyStructure, type TableCopyStructureRead } from './tableCopyStructureSql';
import { assertRenameDestinationAbsent } from './tableRenameRead';
import { tableCommentHash } from './tableCommentRead';
import { qualified } from './sql';
import { tableCopyStructureRequiredAcknowledgements, tableCopyStructureConfirmation, type TableCopyStructureGetInput, type TableCopyStructureGetOutput, type TableCopyStructurePreviewInput, type TableCopyStructurePreviewOutput, type TableCopyStructureApplyInput, type TableCopyStructureApplyOutput, type TableCopyStructureReleaseInput, type TableCopyStructureProgress, type TableCopyStructureTarget } from '../shared/tableCopyStructure';
interface Snapshot extends TableCopyStructureRead { id: string; target: TableCopyStructureTarget; revision: number; expires: number; }
interface Preview { snapshot: Snapshot; newName: string; sql: string; bytes: number; expires: number; }
const progress = (): TableCopyStructureProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
const warnings = ['仅同库创建空表，复制已核列、普通BTREE索引及表选项；不复制行数据、外键、触发器、授权或其它对象。', '首片不支持生成/隐藏字段、特殊索引、CHECK及已知依赖，不代表完整克隆数据库。', 'CREATE TABLE LIKE会隐式提交，事务回滚和取消不能撤销；断线或未知结果不会自动重放。', '请在维护窗口暂停并行DDL；重核不能消除外部并发窗口，目标同名由服务器拒绝，不覆盖、不自动改名。'];
/** 专用能力复用独立结构任务、全局有界缓存与源/目标锁，不接收客户端SQL。 */
export class TableCopyStructureTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>; private readonly previews: StructureCacheScope<Preview>;
  constructor(private readonly host: StructureTaskHost, private readonly now = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('tableCopyStructure', 'snapshot', value => ({ connectionId: value.target.connectionId, bytes: value.bytes, expires: value.expires }));
    this.previews = cache.scope('tableCopyStructure', 'preview', value => ({ connectionId: value.snapshot.target.connectionId, bytes: value.bytes, expires: value.expires }));
  }
  /** 只释放本用途及同快照派生预览，避免串用删除或重命名能力。 */
  releaseTokens(input: TableCopyStructureReleaseInput): void { if (input.snapshotId) { const value = this.snapshots.get(input.snapshotId); this.snapshots.delete(input.snapshotId); if (value) for (const [token, preview] of this.previews) if (preview.snapshot === value) this.previews.delete(token); } if (input.previewToken) this.previews.delete(input.previewToken); }
  /** 修订只能由main注入。 */
  private revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw Error('缺少可信连接修订'); return value as number; }
  /** 只读身份、完整定义、依赖和能力，不读取源表行数据。 */
  async get(input: TableCopyStructureGetInput, revision: unknown): Promise<TableCopyStructureGetOutput> {
    const version = this.revision(revision), state = progress(); let snapshot!: Snapshot;
    const result = await this.host.run(input.connectionId, input.taskId, async context => {
      state.phase = 'reading'; context.report(); const target = { connectionId: input.connectionId, database: input.database, table: input.table }, read = await readTableCopyStructure(context, target);
      snapshot = { ...read, id: randomUUID(), target, revision: version, expires: this.now() + structureCacheLimits.ttlMs }; this.cache.capacity(snapshot.bytes, 'snapshot');
      return { target, snapshotId: snapshot.id, expiresAt: new Date(snapshot.expires).toISOString(), ddlHash: tableCommentHash(read.source), sourceDdl: read.source, tableId: read.tableId, serverVersion: read.serverVersion, writable: !read.reasons.length && !!read.tableId && !!read.serverUuid, reasons: read.reasons, warnings: [...warnings], ...(read.autoIncrementPlan ? { autoIncrement: structuredClone(read.autoIncrementPlan) } : {}) };
    }, { label: '读取复制表结构来源', purpose: 'tableCopyStructure', progress: state });
    this.snapshots.set(snapshot.id, snapshot); return result;
  }
  /** 明确新名后重核源身份和目标不存在，再签发只读SQL预览。 */
  async preview(input: TableCopyStructurePreviewInput, revision: unknown): Promise<TableCopyStructurePreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId); if (!snapshot || snapshot.expires <= this.now() || snapshot.revision !== this.revision(revision)) throw Error('复制结构快照失效或连接变化，请重新读取');
    if (snapshot.reasons.length) throw Error(snapshot.reasons.join('；'));
    const plan = planTableCopyStructure(snapshot.target, input.newName), state = progress(), token = randomUUID(); let value!: Preview;
    const result = await this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      state.phase = 'rechecking'; context.report(); assertTableCopyStructureUnchanged(snapshot, await readTableCopyStructure(context, snapshot.target)); await assertRenameDestinationAbsent(context, snapshot.target, plan.newName);
      if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw Error('复制结构快照已释放或过期，未发布预览');
      value = { snapshot, ...plan, bytes: snapshot.bytes + Buffer.byteLength(plan.sql) + 4096, expires: snapshot.expires }; this.cache.capacity(value.bytes, 'preview');
      return { target: { ...snapshot.target }, newName: plan.newName, previewToken: token, expiresAt: new Date(value.expires).toISOString(), ddlHash: tableCommentHash(snapshot.source), sql: plan.sql, warnings: [...warnings], requiredAcknowledgements: [...tableCopyStructureRequiredAcknowledgements(snapshot.autoIncrementPlan)], ...(snapshot.autoIncrementPlan ? { autoIncrement: structuredClone(snapshot.autoIncrementPlan) } : {}) };
    }, { label: '预览复制空表结构', purpose: 'tableCopyStructure', progress: state });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw Error('复制结构快照已释放或过期，未发布预览'); this.previews.set(token, value); return result;
  }
  /** 首次等待前消费本快照所有预览；同步锁覆盖源、新名及实际连接收尾，未知不重放。 */
  async apply(input: TableCopyStructureApplyInput, revision: unknown): Promise<TableCopyStructureApplyOutput> {
    const value = this.previews.get(input.previewToken); this.previews.delete(input.previewToken); if (!value || value.expires <= this.now()) throw Error('复制结构预览已失效或已使用，未发送DDL');
    const snapshot = value.snapshot; this.releaseTokens({ snapshotId: snapshot.id });
    if (snapshot.revision !== this.revision(revision)) throw Error('连接配置已变化，未发送DDL');
    const required = tableCopyStructureRequiredAcknowledgements(snapshot.autoIncrementPlan);
    if (input.confirmation !== tableCopyStructureConfirmation(snapshot.target, value.newName) || !Array.isArray(input.acknowledgements) || input.acknowledgements.length !== required.length || new Set(input.acknowledgements).size !== input.acknowledgements.length || required.some(id => !input.acknowledgements.includes(id))) throw Error('准确新名或确认项不一致；预览已消费，未发送DDL');
    const newTarget = { ...snapshot.target, table: value.newName }, state = progress();
    return this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      state.phase = 'rechecking'; context.report(); assertTableCopyStructureUnchanged(snapshot, await readTableCopyStructure(context, snapshot.target)); await assertRenameDestinationAbsent(context, snapshot.target, value.newName); if (value.expires <= this.now()) throw Error('复制结构预览在准备期间已过期，未发送DDL');
      state.phase = 'executing'; context.report();
      const result = (await structureTaskQuery<ResultSetHeader>(context, value.sql, () => { state.ddlSubmitted = true; state.outcome = 'unknown'; context.report(); })).rows;
      if (!result || result.affectedRows !== 0) throw Error('复制结构未返回可确认成功响应，请核对新表，不要重试');
      state.ddlCompleted = true; state.outcome = 'succeeded'; state.phase = 'verifying'; context.report();
      const output: TableCopyStructureApplyOutput = { target: { ...snapshot.target }, newTarget, ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, structureVerified: false, counter: snapshot.autoIncrementPlan ? { state: 'unverified', sourceValue: snapshot.autoIncrementPlan.sourceValue, expectedValue: snapshot.autoIncrementPlan.expectedNewValue } : { state: 'not-applicable' }, warnings: [] };
      try {
        const source = await readTableCopyStructure(context, snapshot.target), after = await readTableCopyStructure(context, newTarget), rows = (await structureTaskQuery<unknown[]>(context, `SELECT 1 FROM ${qualified(newTarget.database, newTarget.table)} LIMIT 1`)).rows;
        if (!Array.isArray(rows)) throw Error('新表空表状态未知');
        output.structureVerified = result.warningStatus === 0 && verifyTableCopyStructureStructure(snapshot, source, after, rows.length === 0);
        if (snapshot.autoIncrementPlan) output.counter = { state: after.autoIncrementPlan ? after.autoIncrementPlan.sourceValue === snapshot.autoIncrementPlan.expectedNewValue ? 'matched' : 'different' : 'unverified', sourceValue: snapshot.autoIncrementPlan.sourceValue, expectedValue: snapshot.autoIncrementPlan.expectedNewValue, ...(after.autoIncrementPlan ? { actualValue: after.autoIncrementPlan.sourceValue } : {}) };
        output.definitionVerified = state.definitionVerified = output.structureVerified && (!snapshot.autoIncrementPlan || output.counter?.state === 'matched');
        if (after.tableId) output.after = { tableId: after.tableId, ddlHash: tableCommentHash(after.source), autoIncrement: after.autoIncrement };
      } catch { /* DDL已成功，后核失败仍保留完成事实，绝不删除新表或重放。 */ }
      if (!output.definitionVerified) output.verificationError = '创建已完成，但源身份、新表完整定义、依赖、空表或准确自增计数未全部核验；请人工核对，不要重复执行';
      context.report(); this.cache.release(snapshot.target.connectionId); return output;
    }, { label: '复制空表结构', purpose: 'tableCopyStructure', progress: state, executionTargets: [snapshot.target, newTarget] });
  }
}
