import { createHash, randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery, type StructureTaskHost } from './structureDefinition';
import { readIndexStructure, assertIndexStructureUnchanged, indexReferenceNames, type IndexStructureRead, type IndexReferenceNames } from './tableIndexRead';
import { verifyIndexAfter } from './tableIndexVerification';
import { planTableIndexPatches } from './tableIndexPatchSql';
import { validateIndexPatches, type IndexPatch, type IndexPlanResult, type TableIndexView } from '../shared/tableIndexPatches';
import { isSpecialIndexKind } from '../shared/specialIndexRules';
import type { TableIndexApplyInput, TableIndexApplyOutput, TableIndexApplyProgress, TableIndexGetInput, TableIndexGetOutput, TableIndexPatchTarget, TableIndexPreviewInput, TableIndexPreviewOutput, TableIndexReleaseInput } from '../shared/tableIndexTasks';

type ReadyPlan = Extract<IndexPlanResult, { kind: 'ready' }>;
interface Snapshot extends IndexStructureRead { id: string; target: TableIndexPatchTarget; revision: number; expires: number; }
interface Preview { snapshot: Snapshot; patches: IndexPatch[]; plan: ReadyPlan; required: string[]; bytes: number; expires: number; }
const hash = (source: string): string => createHash('sha256').update(source).digest('hex');
const initialProgress = (): TableIndexApplyProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });

/** 访问投影只由可信纯计划得出；界面传回的 allowed 或 SQL 从不作为执行依据。 */
export function indexViews(read: IndexStructureRead): TableIndexView[] {
  const names = new Set([...read.model.indexes.values()].map(index => index.parsed.name.toLowerCase()));
  let candidate = 'dbark_preview_rename'; for (let count = 0; names.has(candidate); count++) candidate = `dbark_preview_rename_${count}`;
  return [...read.model.indexes].map(([ref, index]) => {
    /** 仅在内存试算单项能力，绝不创建数据库对象或投递 SQL。 */
    const access = (patch: IndexPatch) => {
      if (!read.options) return { allowed: false, reasons: read.warnings.length ? [...read.warnings] : ['服务器索引能力尚未证明'] };
      const plan = planTableIndexPatches(read.model, [patch], read.options);
      return plan.kind === 'ready' ? { allowed: true, reasons: [] } : { allowed: false, reasons: plan.kind === 'blocked' ? plan.issues.map(issue => issue.message) : ['此操作没有实际变更'] };
    };
    const unsupportedReasons = [...index.parsed.opaqueReasons];
    if (!index.definition) unsupportedReasons.push('未得到可控的完整索引定义');
    if (index.visible !== true) unsupportedReasons.push('可见性未证明或索引不可见/已忽略');
    if (index.generated !== false) unsupportedReasons.push('尚未排除生成或隐藏索引属性');
    return { indexRef: ref, name: index.parsed.name, rawSql: index.parsed.rawSql, kind: ['ordinary', 'unique', 'primary', 'fulltext', 'spatial'].includes(index.parsed.kind) ? index.parsed.kind as TableIndexView['kind'] : 'unsupported',
      ...(index.definition ? { editableDefinition: structuredClone(index.definition) } : {}), unsupportedReasons: [...new Set(unsupportedReasons)],
      access: { drop: access({ op: 'drop', indexRef: ref }), rename: access({ op: 'alter', indexRef: ref, changes: { name: candidate } }), replace: access({ op: 'alter', indexRef: ref, changes: { comment: index.definition?.comment === 'DBArk 预览能力检查' ? '' : 'DBArk 预览能力检查' } }) } };
  });
}

/** 结构确认项来自实际操作；删除或替换唯一约束必须额外明确确认。 */
function acknowledgements(snapshot: Snapshot, plan: ReadyPlan): string[] {
  const required = new Set(['ddl-implicit-commit', 'external-ddl-window']);
  for (const operation of plan.operations) {
    const old = operation.sourceIndexRef ? snapshot.model.indexes.get(operation.sourceIndexRef)?.definition : undefined;
    const final = plan.finalIndexes.find(index => operation.sourceIndexRef ? index.sourceIndexRef === operation.sourceIndexRef : index.clientKey === operation.clientKey)?.definition;
    if ((operation.strategy === 'drop' || operation.strategy === 'replace') && old && ['unique', 'primary'].includes(old.kind)) required.add('drop-unique-constraint');
    if (old && isSpecialIndexKind(old.kind) || final && isSpecialIndexKind(final.kind)) required.add('special-index-change');
    if (operation.strategy !== 'rename' && (old?.kind === 'primary' || final?.kind === 'primary')) required.add('primary-key-change');
  }
  return [...required];
}
/** 执行后复用旧列引用，改名索引保留旧引用；新增引用只在引擎内生成。 */
function afterReferences(preview: Preview): IndexReferenceNames {
  return { columns: indexReferenceNames(preview.snapshot).columns, indexes: new Map(preview.plan.finalIndexes.map(index => [index.sourceIndexRef ?? randomUUID(), index.definition?.name ?? preview.snapshot.model.indexes.get(index.sourceIndexRef!)!.parsed.name])) };
}

/** 索引生命周期与字段编辑共用缓存及短任务主机；不复制取消状态机或重放失败 DDL。 */
export class TableIndexPatchTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>;
  private readonly previews: StructureCacheScope<Preview>;
  constructor(private readonly host: StructureTaskHost, private readonly now: () => number = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('indexes', 'snapshot', value => ({ connectionId: value.target.connectionId, expires: value.expires, bytes: value.bytes }));
    this.previews = cache.scope('indexes', 'preview', value => ({ connectionId: value.snapshot.target.connectionId, expires: value.expires, bytes: value.bytes }));
  }
  /** 关闭或连接重配后销毁索引令牌，不清理其他用途的有效编辑器。 */
  release(connectionId?: string): void {
    for (const [id, value] of this.snapshots) if (!connectionId || value.target.connectionId === connectionId) this.snapshots.delete(id);
    for (const [id, value] of this.previews) if (!connectionId || value.snapshot.target.connectionId === connectionId) this.previews.delete(id);
  }
  /** 释放快照及关联预览；仅处理本用途已知令牌，不能扩大到连接或字段编辑器。 */
  releaseTokens(input: TableIndexReleaseInput): void {
    if (input.snapshotId) {
      const snapshot = this.snapshots.get(input.snapshotId); this.snapshots.delete(input.snapshotId);
      if (snapshot) for (const [token, preview] of this.previews) if (preview.snapshot === snapshot) this.previews.delete(token);
    }
    if (input.previewToken) this.previews.delete(input.previewToken);
  }
  /** 修订由主进程注入，客户端没有公开的连接修订输入。 */
  private revision(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('缺少可信连接配置修订');
    return value as number;
  }
  /** 返回能力快照前必须等待网络资源真实关闭，失败时不留下可执行令牌。 */
  async get(input: TableIndexGetInput, revision: unknown): Promise<TableIndexGetOutput> {
    const currentRevision = this.revision(revision), progress = initialProgress(); let snapshot!: Snapshot;
    const output = await this.host.run(input.connectionId, input.taskId, async context => {
      progress.phase = 'reading'; context.report();
      const target = { connectionId: input.connectionId, database: input.database, table: input.table }, read = await readIndexStructure(context, target);
      this.cache.capacity(read.bytes, 'snapshot'); snapshot = { ...read, id: randomUUID(), target, revision: currentRevision, expires: this.now() + structureCacheLimits.ttlMs };
      return { target: { ...target }, snapshotId: snapshot.id, expiresAt: new Date(snapshot.expires).toISOString(), ddlHash: hash(read.source), writable: !!read.options,
        columns: [...read.model.columns].map(([columnRef, column]) => ({ columnRef, name: column.name, typeSql: column.columnType, nullable: column.nullable, generated: column.generated, hidden: column.hidden, prefix: column.prefix, ...(column.fullKeyBytes === undefined ? {} : { fullKeyBytes: column.fullKeyBytes }), ...(column.charset ? { charset: column.charset, collation: column.collation } : {}), ...(column.specialIndexes ? { specialIndexes: structuredClone(column.specialIndexes) } : {}) })),
        indexes: indexViews(read), warnings: [...read.warnings, '结构读取使用独立短会话，查询标签的事务、临时表和检查设置保持原状。', '执行前重核仍存在外部 DDL 并发窗口，请在维护时段暂停并行结构修改。'], incomingCoverage: read.model.dependencies.incomingCoverage,
        ...(read.options ? { capabilities: { ...read.options.capabilities, dialect: read.context.dialect, serverVersion: read.serverVersion } } : {}) };
    }, { label: '读取索引定义', purpose: 'indexes', progress });
    this.cache.capacity(snapshot.bytes, 'snapshot'); this.snapshots.set(snapshot.id, snapshot); return output;
  }
  /** 预览重读原定义、实际目录和外部依赖；不执行 ALTER，也不保留连接。 */
  async preview(input: TableIndexPreviewInput, revision: unknown): Promise<TableIndexPreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.expires <= this.now()) throw new Error('索引快照已失效，请重新读取');
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化，请重新读取索引定义');
    if (!snapshot.options) throw new Error('当前服务器索引能力尚未证明，仅可查看定义');
    const patches = validateIndexPatches(input.patches), progress = initialProgress(), token = randomUUID(); let value!: Preview;
    const output = await this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report();
      const read = await readIndexStructure(context, snapshot.target, indexReferenceNames(snapshot)); assertIndexStructureUnchanged(snapshot, read);
      if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('索引快照已释放或过期，未创建新预览');
      const plan = planTableIndexPatches(snapshot.model, patches, snapshot.options!);
      if (plan.kind === 'blocked') throw new Error(plan.issues.map(issue => issue.message).join('；'));
      if (plan.kind === 'noop') throw new Error('索引补丁没有实际变更');
      const bytes = snapshot.bytes + Buffer.byteLength(plan.sql) + Buffer.byteLength(JSON.stringify(patches)) + 4096, required = acknowledgements(snapshot, plan);
      this.cache.capacity(bytes, 'preview'); value = { snapshot, patches, plan, required, bytes, expires: this.now() + structureCacheLimits.ttlMs };
      return { target: { ...snapshot.target }, previewToken: token, expiresAt: new Date(value.expires).toISOString(), ddlHash: hash(snapshot.source), sql: plan.sql,
        changes: plan.operations.map(operation => ({ ...(operation.sourceIndexRef ? { indexRef: operation.sourceIndexRef } : { clientKey: operation.clientKey }), description: operation.strategy === 'add' ? '新增索引' : operation.strategy === 'drop' ? '删除索引或约束' : operation.strategy === 'rename' ? '原生重命名索引' : '删除并重建指定索引或约束' })),
        warnings: [...plan.warnings.map(issue => issue.message), ...(plan.finalIndexes.some(index => index.definition && ['primary', 'unique'].includes(index.definition.kind) && plan.operations.some(operation => operation.strategy !== 'rename' && (operation.clientKey ? operation.clientKey === index.clientKey : operation.sourceIndexRef === index.sourceIndexRef))) ? ['新增或重建唯一键由数据库按真实排序规则检查重复值；客户端不根据已加载分页猜测唯一性。'] : [])], requiredAcknowledgements: [...required], concurrencyPolicy: 'recheck-before-ddl' as const };
    }, { label: '预览索引变更', purpose: 'indexes', progress });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('索引快照已释放或过期，未创建新预览');
    this.cache.capacity(value.bytes, 'preview'); this.previews.set(token, value); return output;
  }
  /** 一次性令牌在任何等待之前消费；精确确认集合后，同一会话最多发送一条受控 ALTER。 */
  async apply(input: TableIndexApplyInput, revision: unknown): Promise<TableIndexApplyOutput> {
    const preview = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!preview || preview.expires <= this.now()) throw new Error('索引预览已失效或已使用，请重新预览；未发送 DDL');
    const snapshot = preview.snapshot;
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化，请重新读取和预览；未发送 DDL');
    if (!Array.isArray(input.acknowledgements) || input.acknowledgements.length !== preview.required.length || new Set(input.acknowledgements).size !== input.acknowledgements.length || preview.required.some(required => !input.acknowledgements.includes(required))) throw new Error('结构变更确认项与实际预览不一致；预览已消费，未发送 DDL');
    const progress = initialProgress();
    return this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report();
      const current = await readIndexStructure(context, snapshot.target, indexReferenceNames(snapshot)); assertIndexStructureUnchanged(snapshot, current);
      if (preview.expires <= this.now()) throw new Error('索引预览在准备期间已过期，请重新预览；未发送 DDL');
      context.checkCancelled(); progress.phase = 'executing'; context.report();
      let result: ResultSetHeader;
      try {
        result = (await structureTaskQuery<ResultSetHeader>(context, preview.plan.sql, () => { progress.ddlSubmitted = true; progress.outcome = 'unknown'; context.report(); })).rows;
      } catch (error) { progress.outcome = progress.ddlSubmitted ? 'unknown' : 'not-sent'; context.report(); throw error; }
      if (!result || typeof result.affectedRows !== 'number') throw new Error('索引命令未返回可确认的 OK 包，请核对实际定义');
      progress.ddlCompleted = true; progress.outcome = 'succeeded'; progress.phase = 'verifying'; context.report();
      const output: TableIndexApplyOutput = { ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: result.warningStatus ? [`服务器返回 ${result.warningStatus} 条索引变更警告。`] : [] };
      // 诊断必须紧随 ALTER OK，后续元数据 SELECT 会覆盖服务器诊断区。
      if (result.warningStatus) {
        try {
          const warnings = (await structureTaskQuery<{ Code: number; Message: string }[]>(context, 'SHOW WARNINGS LIMIT 20')).rows; let budget = 32 * 1024;
          for (const warning of warnings.slice(0, 20)) {
            if (typeof warning.Message !== 'string' || !Number.isSafeInteger(warning.Code)) throw new Error('服务器警告格式无法识别');
            let message = warning.Message.slice(0, 2048); while (Buffer.byteLength(message) > budget && message.length) message = message.slice(0, Math.floor(message.length / 2));
            if (!message) break; budget -= Buffer.byteLength(message); output.warnings.push(`服务器警告 ${warning.Code}：${message}${message.length < warning.Message.length ? '（已截断）' : ''}`);
          }
          if (result.warningStatus > warnings.length) output.warnings.push('仅显示前 20 条警告，后续警告未全部返回。');
        } catch { output.warnings.push('DDL 已完成，但警告读取失败或被取消，请人工核对实际结果；不要重复执行。'); }
      }
      try {
        const after = await readIndexStructure(context, snapshot.target, afterReferences(preview));
        output.definitionVerified = progress.definitionVerified = verifyIndexAfter(snapshot, preview.plan, after);
        output.after = { ddlHash: hash(after.source), indexes: indexViews(after) };
        if (!output.definitionVerified) output.verificationError = 'DDL 已完成，但最终索引、原列或关联属性尚未全部核验一致，请核对最新定义；不要重复执行';
      } catch { output.verificationError = 'DDL 已收到成功响应，但取消、断线或读取失败使后续定义未能核验；不要重复执行'; }
      context.report(); this.cache.release(snapshot.target.connectionId); return output;
    }, { label: '执行索引变更', purpose: 'indexes', progress, executionTarget: snapshot.target });
  }
}
