import { randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery, type StructureTaskHost } from './structureDefinition';
import { readTableCopyData, assertTableCopyDataUnchanged, planTableCopyData, type TableCopyDataRead } from './tableCopyDataSql';
import { verifyTableCopyStructureStructure } from './tableCopyStructureSql';
import { assertRenameDestinationAbsent } from './tableRenameRead';
import { tableCommentHash } from './tableCommentRead';
import { qualified } from './sql';
import { tableCopyDataMode, tableCopyDataRequiredAcknowledgements, tableCopyDataConfirmation, type TableCopyDataGetInput, type TableCopyDataGetOutput, type TableCopyDataPreviewInput, type TableCopyDataPreviewOutput, type TableCopyDataApplyInput, type TableCopyDataApplyOutput, type TableCopyDataReleaseInput, type TableCopyDataProgress, type TableCopyDataTarget } from '../shared/tableCopyData';
interface Snapshot extends TableCopyDataRead { id: string; target: TableCopyDataTarget; revision: number; expires: number; }
interface Preview { snapshot: Snapshot; mode: typeof tableCopyDataMode; newName: string; createSql: string; insertSql: string; sql: string; bytes: number; expires: number; }
const progress = (): TableCopyDataProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, dataSubmitted: false, insertCompleted: false, commitSubmitted: false, dataCompleted: false, definitionVerified: false, outcome: 'not-sent' });
const warnings = [
  '仅准确MySQL 8.4.11同库普通InnoDB表；不复制生成列、外键、触发器、视图依赖、授权或跨连接数据。',
  'CREATE LIKE与数据事务分开，整体不是原子操作。失败或取消可能留下空表；提交结果未知可能已有数据，不自动重放、覆盖或补DROP。',
  '预览只读元数据，不读行、不固定数据快照。执行使用READ COMMITTED，INSERT SELECT读取该语句执行时可见的已提交数据；源读不加行锁，目标行仍加锁并消耗空间、日志和IO。',
  '请在维护窗口暂停两端写入及并行DDL；建表与取得事务元数据锁之间存在外部窗口，身份重核不能消除该窗口。',
  '所有普通列含自增值由服务器直接传递，NO_AUTO_VALUE_ON_ZERO保留0；不继承源表下一自增计数，目标下一值由服务器按复制数据决定。未提供逐行校验或跨端验收结论。',
];
/** 专用用途及独立令牌缓存；沿用结构任务的取消、资源关闭和两端互斥，不接收客户端SQL。 */
export class TableCopyDataTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>; private readonly previews: StructureCacheScope<Preview>;
  constructor(private readonly host: StructureTaskHost, private readonly now = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('tableCopyData', 'snapshot', value => ({ connectionId: value.target.connectionId, bytes: value.bytes, expires: value.expires }));
    this.previews = cache.scope('tableCopyData', 'preview', value => ({ connectionId: value.snapshot.target.connectionId, bytes: value.bytes, expires: value.expires }));
  }
  /** 释放本用途快照及其所有预览，不触碰旧空表用途。 */
  releaseTokens(input: TableCopyDataReleaseInput): void { if (input.snapshotId) { const value = this.snapshots.get(input.snapshotId); this.snapshots.delete(input.snapshotId); if (value) for (const [token, preview] of this.previews) if (preview.snapshot === value) this.previews.delete(token); } if (input.previewToken) this.previews.delete(input.previewToken); }
  /** 即使绕过主进程，也必须固定用途和可信连接修订。 */
  private revision(value: unknown, mode: unknown): number { if (mode !== tableCopyDataMode || !Number.isSafeInteger(value) || Number(value) < 0) throw Error('数据复制用途或可信连接修订无效'); return value as number; }
  /** 只读来源结构、依赖和会话事实；不读取源表数据。 */
  async get(input: TableCopyDataGetInput, revision: unknown): Promise<TableCopyDataGetOutput> {
    const version = this.revision(revision, input.mode), state = progress(); let snapshot!: Snapshot;
    const result = await this.host.run(input.connectionId, input.taskId, async context => {
      state.phase = 'reading'; context.report(); const target = { connectionId: input.connectionId, database: input.database, table: input.table }, read = await readTableCopyData(context, target);
      snapshot = { ...read, id: randomUUID(), target, revision: version, expires: this.now() + structureCacheLimits.ttlMs }; this.cache.capacity(snapshot.bytes, 'snapshot');
      return { mode: tableCopyDataMode, target, snapshotId: snapshot.id, expiresAt: new Date(snapshot.expires).toISOString(), ddlHash: tableCommentHash(read.source), sourceDdl: read.source, tableId: read.tableId, serverVersion: read.serverVersion, writable: !read.reasons.length && !!read.tableId && !!read.serverUuid, reasons: read.reasons, warnings: [...warnings] };
    }, { label: '读取结构及数据复制来源', purpose: 'tableCopyData', progress: state });
    this.snapshots.set(snapshot.id, snapshot); return result;
  }
  /** 只读重核后签发单用途预览；新名、完整SQL和源事实均仅保存在服务端。 */
  async preview(input: TableCopyDataPreviewInput, revision: unknown): Promise<TableCopyDataPreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId); if (!snapshot || snapshot.expires <= this.now() || snapshot.revision !== this.revision(revision, input.mode)) throw Error('数据复制快照失效或连接变化，请重新读取');
    if (snapshot.reasons.length) throw Error(snapshot.reasons.join('；'));
    const plan = planTableCopyData(snapshot, snapshot.target, input.newName), state = progress(), token = randomUUID(); let value!: Preview;
    const result = await this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      state.phase = 'rechecking'; context.report(); assertTableCopyDataUnchanged(snapshot, await readTableCopyData(context, snapshot.target)); await assertRenameDestinationAbsent(context, snapshot.target, plan.newName);
      if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw Error('数据复制快照已释放或过期，未发布预览');
      value = { snapshot, mode: tableCopyDataMode, ...plan, bytes: snapshot.bytes + Buffer.byteLength(plan.sql) + 4096, expires: snapshot.expires }; this.cache.capacity(value.bytes, 'preview');
      return { mode: tableCopyDataMode, target: { ...snapshot.target }, newName: plan.newName, previewToken: token, expiresAt: new Date(value.expires).toISOString(), ddlHash: tableCommentHash(snapshot.source), sql: plan.sql, warnings: [...warnings], requiredAcknowledgements: [...tableCopyDataRequiredAcknowledgements()] };
    }, { label: '只读预览结构及数据复制', purpose: 'tableCopyData', progress: state });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw Error('数据复制快照已释放或过期，未发布预览'); this.previews.set(token, value); return result;
  }
  /** 首次await前消费整个快照；DDL成功、INSERT成功和COMMIT成功分别报告，任何未知均不重放或删除。 */
  async apply(input: TableCopyDataApplyInput, revision: unknown): Promise<TableCopyDataApplyOutput> {
    const value = this.previews.get(input.previewToken); this.previews.delete(input.previewToken); if (!value || value.expires <= this.now()) throw Error('数据复制预览失效或已使用，未发送DDL');
    const snapshot = value.snapshot; this.releaseTokens({ snapshotId: snapshot.id });
    if (value.mode !== tableCopyDataMode || snapshot.revision !== this.revision(revision, input.mode)) throw Error('连接或用途已变化，未发送DDL');
    const required = tableCopyDataRequiredAcknowledgements();
    if (input.confirmation !== tableCopyDataConfirmation(snapshot.target, value.newName) || !Array.isArray(input.acknowledgements) || input.acknowledgements.length !== required.length || new Set(input.acknowledgements).size !== required.length || required.some(id => !input.acknowledgements.includes(id))) throw Error('准确新名或数据复制确认项不一致；预览已消费，未发送DDL');
    const newTarget = { ...snapshot.target, table: value.newName }, state = progress();
    return this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      state.phase = 'rechecking'; context.report(); assertTableCopyDataUnchanged(snapshot, await readTableCopyData(context, snapshot.target)); await assertRenameDestinationAbsent(context, snapshot.target, value.newName); if (value.expires <= this.now()) throw Error('预览已过期，未发送DDL');
      state.phase = 'executing'; context.report();
      const created = (await structureTaskQuery<ResultSetHeader>(context, value.createSql, () => { state.ddlSubmitted = true; state.outcome = 'unknown'; context.report(); })).rows;
      if (!created || created.affectedRows !== 0) throw Error('建表未返回无警告成功响应；请核对目标，不会补DROP或重试');
      state.ddlCompleted = true; context.report();
      if (created.warningStatus !== 0) throw Error('建表已成功但有警告，目标保留，未发送数据');
      // DDL已经独立提交；事务只覆盖后续数据。LIMIT 0不拉行，在事务内先取得两端元数据锁，再核完整事实。
      const createdRead = await readTableCopyData(context, newTarget);
      await structureTaskQuery(context, 'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
      const isolation = (await structureTaskQuery<{ isolation: string }[]>(context, 'SELECT @@SESSION.transaction_isolation AS isolation')).rows;
      if (isolation.length !== 1 || isolation[0].isolation !== 'READ-COMMITTED') throw Error('READ COMMITTED未确认，目标保留，未发送数据');
      await structureTaskQuery(context, 'START TRANSACTION');
      await structureTaskQuery(context, `SELECT 1 FROM ${qualified(snapshot.target.database, snapshot.target.table)} LIMIT 0`);
      await structureTaskQuery(context, `SELECT 1 FROM ${qualified(newTarget.database, newTarget.table)} LIMIT 0`);
      // 专属会话隔离级别已主动改变，结构事实仍以原用途完整守卫核验，不混同会话能力变化。
      const source = await readTableCopyData(context, snapshot.target), after = await readTableCopyData(context, newTarget);
      const empty = (await structureTaskQuery<unknown[]>(context, `SELECT 1 FROM ${qualified(newTarget.database, newTarget.table)} LIMIT 1`)).rows;
      if (!createdRead.tableId || createdRead.tableId !== after.tableId || !Array.isArray(empty) || !verifyTableCopyStructureStructure(snapshot, source, after, empty.length === 0) || source.reasons.length || after.reasons.length) throw Error('写入前源/目标身份、完整结构或空表守卫失败，目标保留，未发送数据');
      state.definitionVerified = true; context.report();
      const modes = [...new Set([...snapshot.normalizedMode.split(',').filter(Boolean), 'NO_AUTO_VALUE_ON_ZERO', 'STRICT_ALL_TABLES'])].join(',');
      await structureTaskQuery(context, `SET SESSION sql_mode = '${modes}'`);
      const actualModes = (await structureTaskQuery<{ sqlMode: string }[]>(context, 'SELECT @@SESSION.sql_mode AS sqlMode')).rows;
      if (actualModes.length !== 1 || typeof actualModes[0].sqlMode !== 'string' || JSON.stringify(actualModes[0].sqlMode.split(',').sort()) !== JSON.stringify(modes.split(',').sort())) throw Error('保留自增0和严格写入模式未确认，目标保留，未发送数据');
      const inserted = (await structureTaskQuery<ResultSetHeader>(context, value.insertSql, () => { state.dataSubmitted = true; context.report(); })).rows;
      if (!inserted || !Number.isSafeInteger(inserted.affectedRows) || inserted.affectedRows < 0 || inserted.warningStatus !== 0) throw Error('数据语句未返回可准确确认的无警告响应；不提交、不重放，保留目标待核查');
      state.insertCompleted = true; state.affectedRows = String(inserted.affectedRows); context.report();
      // 不在失败路径补COMMIT/ROLLBACK/DROP；原命令结束后由既有专属会话严格关闭，提交ACK丢失仍视为未知。
      await structureTaskQuery(context, 'COMMIT', () => { state.commitSubmitted = true; context.report(); });
      state.dataCompleted = true; state.outcome = 'succeeded'; context.report(); this.cache.release(snapshot.target.connectionId);
      return { mode: tableCopyDataMode, target: { ...snapshot.target }, newTarget, ddlSubmitted: true, ddlCompleted: true, dataSubmitted: true, insertCompleted: true, commitSubmitted: true, dataCompleted: true, definitionVerified: true, affectedRows: state.affectedRows, warnings: ['已核写入前结构并收到数据事务提交成功响应；未逐行比较，目标下一自增值不等于来源当前计数。'] };
    }, { label: '复制表结构及数据', purpose: 'tableCopyData', progress: state, executionTargets: [snapshot.target, newTarget] });
  }
}
