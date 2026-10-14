import { foreignKeyDefinitionSchema, tableForeignKeyPatchLimits, validateForeignKeyPatches, type ForeignKeyAction, type ForeignKeyDefinition, type ForeignKeyPair, type ForeignKeyPatch } from '../shared/tableForeignKeyPatches';
import { foreignKeyTaskLimits, type ForeignKeyTableTarget, type TableForeignKeyApplyOutput, type TableForeignKeyApplyProgress, type TableForeignKeyGetOutput, type TableForeignKeyReleaseInput, type TableForeignKeyTarget, type TableForeignKeyView } from '../shared/tableForeignKeyTasks';
import type { TableIndexColumnView } from '../shared/tableIndexTasks';
import { indexFailureState, indexTokenCurrent, sameIndexTarget } from './indexPatches';
import { foreignKeyPatchZh as text } from './locales/foreignKeyPatches.zh-CN';

// 共用已经验证的同步围栏；结构命令仍各自持有实例，互不串线。
export { IndexRequestFence as ForeignKeyRequestFence } from './indexPatches';
export { indexTokenCurrent as foreignKeyTokenCurrent, sameIndexTarget as sameForeignKeyTarget, indexFailureState as foreignKeyFailureState } from './indexPatches';

/** 风险 ID 只映射明确支持的项目，不能以原型属性冒充确认文案。 */
export function foreignKeyAcknowledgementLabel(id: string): string | undefined {
  return new Map<string, string>([['ddl-implicit-commit', text.ackImplicit], ['external-ddl-window', text.ackWindow], ['drop-foreign-key', text.ackDrop], ['referential-action-change', text.ackAction]]).get(id);
}
/** 必须逐项勾选服务器固定计划的全部确认，缺失、额外、未知和重复均拒绝。 */
export function foreignKeyAcknowledgementsComplete(required: readonly string[], checked: ReadonlySet<string>): boolean {
  return required.includes('ddl-implicit-commit') && required.includes('external-ddl-window') && new Set(required).size === required.length
    && checked.size === required.length && required.every(id => foreignKeyAcknowledgementLabel(id) !== undefined && checked.has(id));
}
/** SQL 动作显示中文说明；不把 RESTRICT 与 NO ACTION 合并或猜测默认值。 */
export function foreignKeyActionLabel(action: ForeignKeyAction): string {
  return ({ RESTRICT: text.restrict, 'NO ACTION': text.noAction, CASCADE: text.cascade, 'SET NULL': text.setNull })[action];
}
/** 可见的普通列可形成草稿，类型相容、支持索引和父表唯一键仍由后端计划。 */
export function foreignKeyColumnSelectable(column: TableIndexColumnView): boolean { return !column.generated && !column.hidden; }
/** 移动保持父子两侧作为同一个有序元组，不改原数组或不透明引用。 */
export function moveForeignKeyPair(pairs: readonly ForeignKeyPair[], from: number, to: number): ForeignKeyPair[] {
  const next = [...pairs]; if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [pair] = next.splice(from, 1); next.splice(to, 0, pair); return next;
}
/** 仅对象属性插入顺序不同不构成差异；字段映射的数组顺序具有语义。 */
function samePairs(a: readonly ForeignKeyPair[], b: readonly ForeignKeyPair[]): boolean { return a.length === b.length && a.every((pair, i) => pair.childColumnRef === b[i].childColumnRef && pair.parentColumnRef === b[i].parentColumnRef); }
/** 完整投影才允许结构化编辑；展示 access 并非最终执行授权。 */
export function foreignKeyEditable(value: TableForeignKeyView): boolean { return !!value.editableDefinition && value.unsupportedReasons.length === 0 && value.access.replace.allowed; }
/** 返回真正的差异或空操作；同名重建在生成草稿时明确拒绝。 */
export function makeForeignKeyAlter(original: TableForeignKeyView, input: ForeignKeyDefinition): ForeignKeyPatch | null {
  if (!foreignKeyEditable(original)) throw new Error([...original.unsupportedReasons, ...original.access.replace.reasons].join('\n') || text.readonly);
  const old = original.editableDefinition!;
  if (input.name === old.name && input.parentRef === old.parentRef && input.onUpdate === old.onUpdate && input.onDelete === old.onDelete && samePairs(input.pairs, old.pairs)) return null;
  const value = foreignKeyDefinitionSchema.parse(input);
  const changes: Partial<ForeignKeyDefinition> = {};
  if (value.name !== old.name) changes.name = value.name;
  if (value.parentRef !== old.parentRef) changes.parentRef = value.parentRef;
  if (!samePairs(value.pairs, old.pairs)) changes.pairs = value.pairs;
  if (value.onUpdate !== old.onUpdate) changes.onUpdate = value.onUpdate;
  if (value.onDelete !== old.onDelete) changes.onDelete = value.onDelete;
  if (!Object.keys(changes).length) return null;
  if (value.name.toLowerCase() === old.name.toLowerCase()) throw new Error(text.sameName);
  return { op: 'alter', foreignKeyRef: original.foreignKeyRef, changes };
}
/** 以来源类型和稳定引用共同识别补丁，新增 clientKey 不会抹掉同字面旧引用。 */
export function setForeignKeyPatch(patches: readonly ForeignKeyPatch[], key: string, next: ForeignKeyPatch | null, source: 'existing' | 'added' = 'existing'): ForeignKeyPatch[] {
  const retained = patches.filter(patch => source === 'added' ? patch.op !== 'add' || patch.clientKey !== key : patch.op === 'add' || patch.foreignKeyRef !== key);
  return next ? [...retained, next] : retained;
}
/** 切换父表清除旧父列引用并按新目录显式初始化；不把列名猜成跨表身份。 */
export function changeForeignKeyParent(value: ForeignKeyDefinition, parentRef: string, snapshot: TableForeignKeyGetOutput): ForeignKeyDefinition {
  const parent = snapshot.parents.find(item => item.parentRef === parentRef); if (!parent) throw new Error(text.missing);
  const columns = parent.columns.filter(foreignKeyColumnSelectable);
  return { ...value, parentRef, pairs: value.pairs.map((pair, i) => ({ childColumnRef: pair.childColumnRef, parentColumnRef: columns[i]?.columnRef ?? '' })) };
}
/** 预览前只验证本地快照引用及明确输入约束，不声称已经验证服务端名称空间。 */
export function validateForeignKeyDrafts(snapshot: TableForeignKeyGetOutput, input: unknown): ForeignKeyPatch[] {
  if (!snapshot.writable || !snapshot.capabilities) throw new Error(text.readonlyTable);
  if (Array.isArray(input) && input.length === 0) throw new Error(text.noChange);
  const patches = validateForeignKeyPatches(input), originals = new Map(snapshot.foreignKeys.map(value => [value.foreignKeyRef, value]));
  const columns = new Map(snapshot.columns.map(value => [value.columnRef, value]));
  const names = new Map(snapshot.foreignKeys.map(value => [JSON.stringify(['existing', value.foreignKeyRef]), value.name]));
  const originalNames = new Set(snapshot.foreignKeys.map(value => value.name.toLowerCase()));
  for (const patch of patches) {
    const original = patch.op === 'add' ? undefined : originals.get(patch.foreignKeyRef);
    if (patch.op !== 'add' && !original) throw new Error(text.missing);
    if (patch.op === 'drop') {
      if (!original!.access.drop.allowed) throw new Error(original!.access.drop.reasons.join('\n') || text.readonly);
      names.delete(JSON.stringify(['existing', patch.foreignKeyRef])); continue;
    }
    if (patch.op === 'alter' && !foreignKeyEditable(original!)) throw new Error([...original!.unsupportedReasons, ...original!.access.replace.reasons].join('\n') || text.readonly);
    const value = foreignKeyDefinitionSchema.parse(patch.op === 'add' ? patch.definition : { ...original!.editableDefinition, ...patch.changes });
    // 即使同批删除旧名称也不允许同名替换；名称折叠只用于保守拒绝，不能证明新名可用。
    if (originalNames.has(value.name.toLowerCase())) throw new Error(text.sameName);
    const parent = snapshot.parents.find(item => item.parentRef === value.parentRef); if (!parent) throw new Error(text.missing);
    const parentColumns = new Map(parent.columns.map(column => [column.columnRef, column]));
    if (new Set(value.pairs.map(pair => pair.childColumnRef)).size !== value.pairs.length || new Set(value.pairs.map(pair => pair.parentColumnRef)).size !== value.pairs.length) throw new Error(text.duplicate);
    for (const pair of value.pairs) {
      const child = columns.get(pair.childColumnRef), parentColumn = parentColumns.get(pair.parentColumnRef);
      if (!child || !parentColumn) throw new Error(text.missing);
      if (!foreignKeyColumnSelectable(child) || !foreignKeyColumnSelectable(parentColumn)) throw new Error(text.unknownColumn);
      if ((value.onDelete === 'SET NULL' || value.onUpdate === 'SET NULL') && !child.nullable) throw new Error(text.nullableRequired);
    }
    names.set(JSON.stringify(patch.op === 'add' ? ['added', patch.clientKey] : ['existing', patch.foreignKeyRef]), value.name);
  }
  if (names.size > tableForeignKeyPatchLimits.foreignKeys || new Set([...names.values()].map(name => name.toLowerCase())).size !== names.size) throw new Error(text.duplicate);
  return patches;
}
/** 额外父目标保持精确输入；不裁切空格、不拼 SQL、不同大小写不擅自归一化。 */
export function addForeignKeyParentTarget(current: readonly ForeignKeyTableTarget[], target: ForeignKeyTableTarget): ForeignKeyTableTarget[] {
  // 与主进程目标 schema 的 UTF-16 长度边界一致，先拒绝而不在释放旧快照后才发现参数无效。
  if ([target.database, target.table].some(value => value.length === 0 || value.length > 64 || value.includes('\0'))) throw new Error(text.invalidParent);
  if (current.some(value => value.database === target.database && value.table === target.table)) throw new Error(text.duplicateParent);
  if (current.length >= foreignKeyTaskLimits.extraParents) throw new Error(text.extraLimit);
  return [...current.map(value => ({ ...value })), { ...target }];
}
/** 宿主执行前保护子表和所有已加载父表页，包括自引用与多外键共享父表去重。 */
export function foreignKeyProtectedTargets(snapshot: TableForeignKeyGetOutput): TableForeignKeyTarget[] {
  const targets = [snapshot.target, ...snapshot.parents.map(parent => ({ ...parent.target, connectionId: snapshot.target.connectionId }))];
  return [...new Map(targets.map(target => [JSON.stringify([target.connectionId, target.database, target.table]), { ...target }])).values()];
}
/** 拒绝响应前校验目标、期限与原哈希；不能因为 HTTP/IPC 成功就接受过期计划。 */
export function assertForeignKeyResponse(value: { target: TableForeignKeyTarget; expiresAt: string; ddlHash: string }, target: TableForeignKeyTarget, ddlHash?: string, now = Date.now()): void {
  if (!sameIndexTarget(value.target, target) || (ddlHash !== undefined && value.ddlHash !== ddlHash)) throw new Error(text.previewMismatch);
  if (!indexTokenCurrent(value.expiresAt, now)) throw new Error(text.expired);
}
/** 拒绝 Promise 不证明未执行；只根据后端完成证据决定清草稿及刷新或标旧。 */
export function foreignKeyExecutionEffect(event: { kind: 'resolved'; result: TableForeignKeyApplyOutput } | { kind: 'rejected'; progress: TableForeignKeyApplyProgress | null; attempted: boolean }): { clearDrafts: boolean; page: 'refresh' | 'stale' | 'none' } {
  if (event.kind === 'resolved') return { clearDrafts: true, page: event.result.definitionVerified ? 'refresh' : 'stale' };
  return { clearDrafts: event.progress?.ddlCompleted === true, page: !event.attempted || indexFailureState(event.progress) === 'notSent' ? 'none' : 'stale' };
}

type ResourceKind = 'snapshotId' | 'previewToken';
/** 每个资源先登记责任，释放失败保留；同一令牌同时释放只使用一次真实服务请求。 */
export class ForeignKeyResourceLedger {
  private readonly pending = new Map<string, { kind: ResourceKind; id: string }>();
  private readonly inFlight = new Map<string, Promise<void>>();
  /** 注入服务引用函数，组件换服务后释放仍使用当前真实适配器。 */
  constructor(private readonly send: (input: TableForeignKeyReleaseInput) => Promise<void>) {}
  /** 用元组键区分快照/预览及任何包含分隔符的 opaque token。 */
  track(kind: ResourceKind, id: string): void { this.pending.set(JSON.stringify([kind, id]), { kind, id }); }
  /** 仅暴露责任数量供生命周期核对，不泄漏可修改的令牌集合。 */
  get size(): number { return this.pending.size; }
  /** 只有服务确实成功才删除责任，失败允许后续显式关闭或重读再次尝试。 */
  async release(kind: ResourceKind, id: string): Promise<void> {
    this.track(kind, id); const key = JSON.stringify([kind, id]);
    let request = this.inFlight.get(key);
    if (!request) {
      request = Promise.resolve().then(() => this.send({ [kind]: id })).then(() => { this.pending.delete(key); });
      this.inFlight.set(key, request);
    }
    try { await request; } finally { if (this.inFlight.get(key) === request) this.inFlight.delete(key); }
  }
  /** 首项失败不跳过其他资源；失败汇总返回宿主，同时保持待释放集合。 */
  async releaseAll(includeSnapshots: boolean): Promise<void> {
    const failures: string[] = [], resources = [...this.pending.values()].filter(value => includeSnapshots || value.kind === 'previewToken').sort((a, b) => a.kind === b.kind ? 0 : a.kind === 'previewToken' ? -1 : 1);
    for (const { kind, id } of resources) try { await this.release(kind, id); } catch (reason) { failures.push(reason instanceof Error ? reason.message : String(reason)); }
    if (failures.length) throw new Error(failures.join('\n'));
  }
}
