import { createHash, randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery, type StructureTaskContext, type StructureTaskHost } from './structureDefinition';
import { readForeignKeyStructure, assertForeignKeyStructureUnchanged, type ForeignKeyStructureRead, type ForeignKeyReferenceNames } from './tableForeignKeyRead';
import { readForeignKeyNamespace, compareForeignKeyNames } from './tableForeignKeyNamespaceRead';
import type { ForeignKeyNamespaceEvidence } from './tableForeignKeyNamespaceEvidence';
import { readTableForeignKeyDefinition } from './tableForeignKeyDefinition';
import { planTableForeignKeyPatches } from './tableForeignKeyPatchSql';
import { verifyForeignKeyAfter } from './tableForeignKeyVerification';
import { defaultForeignKeyAction, validateForeignKeyPatches, type ForeignKeyPatch, type ForeignKeyPlanResult } from '../shared/tableForeignKeyPatches';
import type { TableForeignKeyApplyInput, TableForeignKeyApplyOutput, TableForeignKeyApplyProgress, TableForeignKeyGetInput, TableForeignKeyGetOutput, TableForeignKeyPreviewInput, TableForeignKeyPreviewOutput, TableForeignKeyReleaseInput, TableForeignKeyView, TableForeignKeyParentView } from '../shared/tableForeignKeyTasks';
import type { TableIndexColumnView } from '../shared/tableIndexTasks';
import type { TrustedIndexColumn } from '../shared/tableIndexPatches';

type ReadyPlan = Extract<ForeignKeyPlanResult, { kind: 'ready' }>;
interface Snapshot extends ForeignKeyStructureRead { id: string; revision: number; expires: number; namespace: ForeignKeyNamespaceEvidence; }
interface Preview { snapshot: Snapshot; plannedRead: ForeignKeyStructureRead; patches: ForeignKeyPatch[]; plan: ReadyPlan; required: string[]; bytes: number; expires: number; }
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const initialProgress = (): TableForeignKeyApplyProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
/** self 已由读取器复用，内部保留列表只传此前实际取得的其他父表，最多 31 个。 */
function retainedParents(read: ForeignKeyStructureRead): { database: string; table: string }[] { return [...read.snapshot.parents.values()].map(parent => parent.target).filter(target => target.database !== read.target.database || target.table !== read.target.table); }

/** 列能力直接投影真实目录，不把缺少完整字节证明的类型显示为可用键。 */
function columns(values: ReadonlyMap<string, TrustedIndexColumn>): TableIndexColumnView[] {
  return [...values].map(([columnRef, column]) => ({ columnRef, name: column.name, typeSql: column.columnType, nullable: column.nullable, generated: column.generated, hidden: column.hidden, prefix: column.prefix, ...(column.fullKeyBytes === undefined ? {} : { fullKeyBytes: column.fullKeyBytes }) }));
}
/** 父键只展示已有的完整可见普通唯一键；是否与子元组兼容仍由计划器逐项检查。 */
function parentViews(read: ForeignKeyStructureRead): TableForeignKeyParentView[] {
  return [...read.snapshot.parents].map(([parentRef, table]) => ({ parentRef, target: { ...table.target }, columns: columns(table.columns), keys: [...table.indexes.values()].flatMap(index => {
    const value = index.definition;
    return value && value.kind !== 'ordinary' && index.visible === true && index.generated === false && !index.parsed.opaqueReasons.length && value.method === 'BTREE' && value.keyParts.every(part => part.direction === 'asc' && part.prefixLength === undefined) ? [{ name: value.name, kind: value.kind, columnRefs: value.keyParts.map(part => part.columnRef) }] : [];
  }) }));
}
/** 权限显示不能代替执行计划；原始片段和只读原因一起保留。 */
export function foreignKeyViews(read: ForeignKeyStructureRead): TableForeignKeyView[] {
  const parsed = readTableForeignKeyDefinition(read.snapshot.child.definition, read.target.database, read.childRead.serverVersion);
  return [...read.snapshot.foreignKeys].map(([foreignKeyRef, foreignKey]) => {
    const source = parsed.foreignKeys.find(value => value.name === foreignKey.name), unsupportedReasons = [...foreignKey.opaqueReasons];
    if (!foreignKey.definition) unsupportedReasons.push('父子字段或父表快照尚未完整对应，仅保留原始定义');
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(foreignKey.name)) unsupportedReasons.push('该旧外键名称尚未证明受控修改规则，首批仅保留原始定义');
    const dropPlan = read.options ? planTableForeignKeyPatches(read.snapshot, [{ op: 'drop', foreignKeyRef }], read.options) : undefined;
    const drop = dropPlan?.kind === 'ready' ? { allowed: true, reasons: [] } : { allowed: false, reasons: dropPlan?.kind === 'blocked' ? dropPlan.issues.map(issue => issue.message) : ['当前外键能力尚未证明'] };
    const replace = read.options && read.snapshot.outgoingComplete && !unsupportedReasons.length ? { allowed: true, reasons: [] } : { allowed: false, reasons: unsupportedReasons.length ? [...unsupportedReasons] : ['当前外键能力尚未证明'] };
    return { foreignKeyRef, name: foreignKey.name, rawSql: foreignKey.rawSql, ...(foreignKey.definition ? { editableDefinition: structuredClone(foreignKey.definition) } : {}), childColumnNames: source?.childColumnNames ?? [], parentColumnNames: source?.parentColumnNames ?? [], ...(source?.parentTarget ? { parentTarget: { ...source.parentTarget } } : {}), ...(source?.onUpdate ? { onUpdate: source.onUpdate } : {}), ...(source?.onDelete ? { onDelete: source.onDelete } : {}), unsupportedReasons: [...new Set(unsupportedReasons)], access: { drop, replace } };
  });
}
/** 新增与替换名称来自经过验证的补丁和可信旧定义，不能把 SQL 或名称可用投影传回执行。 */
function candidateNames(read: ForeignKeyStructureRead, patches: ForeignKeyPatch[]): string[] {
  const result = new Set<string>();
  for (const patch of patches) {
    if (patch.op === 'add') result.add(patch.definition.name);
    else if (patch.op === 'alter') { const name = patch.changes.name ?? read.snapshot.foreignKeys.get(patch.foreignKeyRef)?.definition?.name; if (name) result.add(name); }
  }
  return [...result];
}
/** 收到成功包后使用旧字段、父表和更新后的外键名称映射，确保后核验引用仍属于本次快照。 */
function afterReferences(preview: Preview): ForeignKeyReferenceNames {
  const refs = preview.plannedRead.refs;
  return { ...refs, foreignKeys: new Map(preview.plan.finalForeignKeys.map(value => [value.sourceForeignKeyRef ?? randomUUID(), value.definition?.name ?? preview.plannedRead.snapshot.foreignKeys.get(value.sourceForeignKeyRef!)!.name])) };
}

/** 与字段和索引共用短会话主机、缓存、取消及多表执行租约，不复制数据库任务状态机。 */
export class TableForeignKeyPatchTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>;
  private readonly previews: StructureCacheScope<Preview>;
  constructor(private readonly host: StructureTaskHost, private readonly now: () => number = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('foreignKeys', 'snapshot', value => ({ connectionId: value.target.connectionId, expires: value.expires, bytes: value.bytes }));
    this.previews = cache.scope('foreignKeys', 'preview', value => ({ connectionId: value.snapshot.target.connectionId, expires: value.expires, bytes: value.bytes }));
  }
  /** 连接重配和退出只清理当前用途记录，共享额度由同一缓存真实回收。 */
  release(connectionId?: string): void {
    for (const [id, value] of this.snapshots) if (!connectionId || value.target.connectionId === connectionId) this.snapshots.delete(id);
    for (const [id, value] of this.previews) if (!connectionId || value.snapshot.target.connectionId === connectionId) this.previews.delete(id);
  }
  /** 显式关闭编辑器释放其快照以及关联预览，不影响其他窗口的令牌。 */
  releaseTokens(input: TableForeignKeyReleaseInput): void {
    if (input.snapshotId) { const snapshot = this.snapshots.get(input.snapshotId); this.snapshots.delete(input.snapshotId); if (snapshot) for (const [token, value] of this.previews) if (value.snapshot === snapshot) this.previews.delete(token); }
    if (input.previewToken) this.previews.delete(input.previewToken);
  }
  /** 修订只接受主进程可信注入，不从 renderer 请求传播。 */
  private revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('缺少可信连接配置修订'); return value as number; }
  /** 目录不完整保留查看入口，名称可用性必须随后在服务器上逐候选比较。 */
  async get(input: TableForeignKeyGetInput, revision: unknown): Promise<TableForeignKeyGetOutput> {
    const currentRevision = this.revision(revision), progress = initialProgress(); let snapshot!: Snapshot;
    const output = await this.host.run(input.connectionId, input.taskId, async context => {
      progress.phase = 'reading'; context.report();
      const target = { connectionId: input.connectionId, database: input.database, table: input.table };
      const read = await readForeignKeyStructure(context, target, { additionalParents: input.parentTargets });
      const namespace = await readForeignKeyNamespace(context);
      read.snapshot = { ...read.snapshot, namespaceNames: { complete: namespace.evidence.kind === 'complete', names: namespace.evidence.kind === 'complete' ? namespace.evidence.entries.filter(value => value.child.database === target.database).map(value => value.name) : [] } };
      const bytes = read.bytes + namespace.bytes + 4096;
      this.cache.capacity(bytes, 'snapshot'); snapshot = { ...read, bytes, id: randomUUID(), revision: currentRevision, expires: this.now() + structureCacheLimits.ttlMs, namespace: namespace.evidence };
      return { target, snapshotId: snapshot.id, expiresAt: new Date(snapshot.expires).toISOString(), ddlHash: hash(read.snapshot.child.definition.source), columns: columns(read.snapshot.child.columns), parents: parentViews(read), foreignKeys: foreignKeyViews(read), writable: !!read.options && read.snapshot.outgoingComplete, incomingCoverage: read.snapshot.incomingCoverage, namespaceCoverage: namespace.evidence.kind, warnings: [...new Set([...read.warnings, ...namespace.warnings, '结构读取使用独立短会话；执行前重新核对仍存在外部 DDL 并发窗口。', '新增与替换外键需要已有子表支持索引及父表完整唯一键；客户端不会自动创建索引或修复数据。'])], ...(read.options ? { capabilities: { dialect: read.options.dialect, serverVersion: read.options.serverVersion, defaultAction: defaultForeignKeyAction(read.options) } } : {}) };
    }, { label: '读取外键定义', purpose: 'foreignKeys', progress });
    this.cache.capacity(snapshot.bytes, 'snapshot'); this.snapshots.set(snapshot.id, snapshot); return output;
  }
  /** 完整重读所有原父表、子表与命名空间，原始 SQL 仅由可信计划器生成。 */
  private async recheck(context: StructureTaskContext, snapshot: Snapshot, patches?: ForeignKeyPatch[]): Promise<ForeignKeyStructureRead> {
    const read = await readForeignKeyStructure(context, snapshot.target, { refs: snapshot.refs, retainedParents: retainedParents(snapshot), namespaceNames: snapshot.snapshot.namespaceNames });
    assertForeignKeyStructureUnchanged(snapshot, read);
    const namespace = await readForeignKeyNamespace(context);
    if (JSON.stringify(namespace.evidence) !== JSON.stringify(snapshot.namespace)) throw new Error('外键命名空间或可见性已变化，请重新读取和预览；未发送 DDL');
    const names = patches ? candidateNames(read, patches) : [];
    if (names.length) read.snapshot = { ...read.snapshot, namespaceNames: { ...read.snapshot.namespaceNames, comparisons: await compareForeignKeyNames(context, namespace.evidence, snapshot.target.database, names) } };
    return read;
  }
  /** 预览零 DDL，快照过期、释放或容量不足时不创建可执行令牌。 */
  async preview(input: TableForeignKeyPreviewInput, revision: unknown): Promise<TableForeignKeyPreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.expires <= this.now()) throw new Error('外键快照已失效，请重新读取');
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化，请重新读取外键定义');
    if (!snapshot.options) throw new Error('当前服务器外键能力尚未证明，仅可查看定义');
    const patches = validateForeignKeyPatches(input.patches), progress = initialProgress(), token = randomUUID(); let value!: Preview;
    const output = await this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report();
      const read = await this.recheck(context, snapshot, patches);
      if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('外键快照已释放或过期，未创建预览');
      const plan = planTableForeignKeyPatches(read.snapshot, patches, snapshot.options!);
      if (plan.kind === 'blocked') throw new Error(plan.issues.map(issue => issue.message).join('；'));
      if (plan.kind === 'noop') throw new Error('外键补丁没有实际变更');
      const required = ['ddl-implicit-commit', 'external-ddl-window'];
      if (plan.operations.some(operation => operation.strategy !== 'add')) required.push('drop-foreign-key');
      if (plan.operations.some(operation => operation.strategy === 'replace')) required.push('referential-action-change');
      const bytes = snapshot.bytes + read.bytes + Buffer.byteLength(plan.sql) + Buffer.byteLength(JSON.stringify(patches)) + 4096;
      this.cache.capacity(bytes, 'preview'); value = { snapshot, plannedRead: read, patches, plan, required, bytes, expires: this.now() + structureCacheLimits.ttlMs };
      return { target: { ...snapshot.target }, previewToken: token, expiresAt: new Date(value.expires).toISOString(), ddlHash: hash(snapshot.snapshot.child.definition.source), sql: plan.sql, changes: plan.operations.map(operation => ({ ...(operation.sourceForeignKeyRef ? { foreignKeyRef: operation.sourceForeignKeyRef } : { clientKey: operation.clientKey }), description: operation.strategy === 'add' ? '新增外键约束' : operation.strategy === 'drop' ? '删除指定外键约束' : '使用明确的新名称替换指定外键约束' })), warnings: plan.warnings.map(issue => issue.message), requiredAcknowledgements: [...required], concurrencyPolicy: 'recheck-before-ddl' as const };
    }, { label: '预览外键变更', purpose: 'foreignKeys', progress });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('外键快照已释放或过期，未创建预览');
    this.cache.capacity(value.bytes, 'preview'); this.previews.set(token, value); return output;
  }
  /** 一次性令牌在等待前消费；同一受控会话只投递一条 ALTER，父子租约持有到真实关闭。 */
  async apply(input: TableForeignKeyApplyInput, revision: unknown): Promise<TableForeignKeyApplyOutput> {
    const preview = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!preview || preview.expires <= this.now()) throw new Error('外键预览已失效或已使用；未发送 DDL');
    const snapshot = preview.snapshot;
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化；未发送 DDL');
    if (!Array.isArray(input.acknowledgements) || input.acknowledgements.length !== preview.required.length || new Set(input.acknowledgements).size !== input.acknowledgements.length || preview.required.some(required => !input.acknowledgements.includes(required))) throw new Error('外键确认项与实际预览不一致；预览已消费，未发送 DDL');
    const progress = initialProgress();
    return this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report();
      const current = await this.recheck(context, snapshot, preview.patches);
      const currentPlan = planTableForeignKeyPatches(current.snapshot, preview.patches, snapshot.options!);
      if (currentPlan.kind !== 'ready' || currentPlan.sql !== preview.plan.sql) throw new Error('外键计划或名称可用性已变化，请重新预览；未发送 DDL');
      if (preview.expires <= this.now()) throw new Error('外键预览在准备期间已过期；未发送 DDL');
      context.checkCancelled(); progress.phase = 'executing'; context.report();
      const result = (await structureTaskQuery<ResultSetHeader>(context, preview.plan.sql, () => { progress.ddlSubmitted = true; progress.outcome = 'unknown'; context.report(); })).rows;
      if (!result || typeof result.affectedRows !== 'number') throw new Error('外键命令未返回可确认的 OK 包，请核对实际定义');
      progress.ddlCompleted = true; progress.outcome = 'succeeded'; progress.phase = 'verifying'; context.report();
      const output: TableForeignKeyApplyOutput = { ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: [] };
      if (result.warningStatus) {
        output.warnings.push(`服务器返回 ${result.warningStatus} 条外键变更警告。`);
        try { const rows = (await structureTaskQuery<{ Code: number; Message: string }[]>(context, 'SHOW WARNINGS LIMIT 20')).rows; let budget = 32768;
          for (const warning of rows.slice(0, 20)) { if (typeof warning.Message !== 'string' || !Number.isSafeInteger(warning.Code)) throw new Error('服务器警告格式无法识别'); let message = warning.Message.slice(0, 2048); while (Buffer.byteLength(message) > budget && message.length) message = message.slice(0, Math.floor(message.length / 2)); if (!message) break; budget -= Buffer.byteLength(message); output.warnings.push(`服务器警告 ${warning.Code}：${message}${message.length < warning.Message.length ? '（已截断）' : ''}`); }
          if (result.warningStatus > rows.length) output.warnings.push('仅显示前 20 条服务器警告。');
        } catch { output.warnings.push('DDL 已完成，但警告读取失败或被取消；请核对实际定义，不要重复执行。'); }
      }
      try {
        const after = await readForeignKeyStructure(context, snapshot.target, { refs: afterReferences(preview), retainedParents: retainedParents(snapshot) });
        output.definitionVerified = progress.definitionVerified = verifyForeignKeyAfter(preview.plannedRead.snapshot, preview.plan, after.snapshot);
        output.after = { ddlHash: hash(after.snapshot.child.definition.source), foreignKeys: foreignKeyViews(after) };
        if (!output.definitionVerified) output.verificationError = 'DDL 已完成，但外键、原字段、索引或相关父表尚未全部核验一致；请核对最新定义，不要重复执行';
      } catch { output.verificationError = 'DDL 已收到成功响应，但取消、断线或读取失败使最终定义未能核验；不要重复执行'; }
      context.report(); this.cache.release(snapshot.target.connectionId); return output;
    }, { label: '执行外键变更', purpose: 'foreignKeys', progress, executionTargets: [snapshot.target, ...[...snapshot.snapshot.parents.values()].map(value => value.target)] });
  }
}
