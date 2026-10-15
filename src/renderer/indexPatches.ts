import { assertIndexDefinitionNames, tableIndexPatchLimits, validateIndexPatches, type IndexDefinition, type IndexKeyPart, type IndexPatch, type TableIndexView } from '../shared/tableIndexPatches';
import type { TableIndexApplyOutput, TableIndexApplyProgress, TableIndexColumnView, TableIndexGetOutput, TableIndexPatchTarget } from '../shared/tableIndexTasks';
import { indexPatchZh as text } from './locales/indexPatches.zh-CN';
import { assertSpecialIndexDefinition, indexMethodForKind, isSpecialIndexKind } from '../shared/specialIndexRules';

/** 身份保持精确大小写；配置版本还必须由窗口代次及服务器令牌重核。 */
export function sameIndexTarget(a: TableIndexPatchTarget, b: TableIndexPatchTarget): boolean { return a.connectionId === b.connectionId && a.database === b.database && a.table === b.table; }
/** 无效 TTL 不能被 NaN 比较默许为永久有效。 */
export function indexTokenCurrent(expiresAt: string, now = Date.now()): boolean { const expires = Date.parse(expiresAt); return Number.isFinite(expires) && now < expires; }
/** 未知风险不授权，原型同名不是确认项目。 */
export function indexAcknowledgementLabel(id: string): string | undefined {
  const labels = new Map<string, string>([['ddl-implicit-commit', text.ackImplicit], ['external-ddl-window', text.ackWindow], ['drop-unique-constraint', text.ackUnique], ['primary-key-change', text.ackPrimary], ['special-index-change', text.ackSpecial]]);
  return labels.get(id);
}
/** 两项通用确认必须存在，集合精确一致，未知/重复确认都不得执行。 */
export function indexAcknowledgementsComplete(required: readonly string[], checked: ReadonlySet<string>): boolean {
  return required.includes('ddl-implicit-commit') && required.includes('external-ddl-window') && new Set(required).size === required.length
    && checked.size === required.length && required.every(id => indexAcknowledgementLabel(id) !== undefined && checked.has(id));
}
/** 清空前缀真正移除 optional 自有键，不能向严格 JSON 发送 undefined。 */
export function setIndexPrefix(part: IndexKeyPart, value: string): IndexKeyPart {
  const { prefixLength: ignored, ...rest } = part;
  return value === '' ? rest : { ...rest, prefixLength: Number(value) };
}
/** 上下移动只改变数组顺序，不改变稳定字段引用或前缀/方向。 */
export function moveIndexPart(parts: readonly IndexKeyPart[], from: number, to: number): IndexKeyPart[] {
  const next = [...parts]; if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [part] = next.splice(from, 1); next.splice(to, 0, part); return next;
}
/** 对象属性顺序不等于索引语义，省略前缀和显式 undefined 则在后续严格验证区分。 */
function sameParts(a: readonly IndexKeyPart[], b: readonly IndexKeyPart[]): boolean { return a.length === b.length && a.every((part, i) => part.columnRef === b[i].columnRef && part.direction === b[i].direction && part.prefixLength === b[i].prefixLength); }
export interface IndexDraftPermission { allowed: boolean; requiresBatchPreview: boolean; reasons: readonly string[]; }
/** access 是单补丁试算；有其他增改草稿时允许组合送审，但不扩大未知原定义或服务器能力。 */
export function indexDraftPermission(snapshot: TableIndexGetOutput, indexRef: string, action: 'drop' | 'rename' | 'replace', patches: readonly IndexPatch[]): IndexDraftPermission {
  const index = snapshot.indexes.find(value => value.indexRef === indexRef);
  if (!snapshot.writable || !snapshot.capabilities) return { allowed: false, requiresBatchPreview: false, reasons: [text.readonlyTable] };
  if (!index) return { allowed: false, requiresBatchPreview: false, reasons: [text.missing] };
  if (!index.editableDefinition || index.unsupportedReasons.length) return { allowed: false, requiresBatchPreview: false, reasons: index.unsupportedReasons.length ? index.unsupportedReasons : [text.readonly] };
  if (action !== 'drop' && isSpecialIndexKind(index.editableDefinition.kind)) return { allowed: false, requiresBatchPreview: false, reasons: [text.specialReadonly] };
  if (action === 'rename' && (!snapshot.capabilities.renameIndex || index.kind === 'primary')) return { allowed: false, requiresBatchPreview: false, reasons: [text.renameUnsupported] };
  const access = index.access[action];
  if (access.allowed) return { allowed: true, requiresBatchPreview: false, reasons: [] };
  // 当前索引自身的 alter 不能成为自己的替代支撑；撤销其他草稿后会重新恢复单项限制。
  const hasOtherChange = patches.some(patch => patch.op === 'add' || patch.op === 'alter' && patch.indexRef !== indexRef && Object.keys(patch.changes).length > 0);
  return { allowed: hasOtherChange, requiresBatchPreview: hasOtherChange, reasons: access.reasons.length ? access.reasons : [text.readonly] };
}
/** 编辑中的主键转普通键或其他属性变化走重建；只有纯名称变化才要求原生 RENAME 能力。 */
export function indexNameDraftPermission(snapshot: TableIndexGetOutput, indexRef: string, next: IndexDefinition, patches: readonly IndexPatch[]): IndexDraftPermission {
  const original = snapshot.indexes.find(value => value.indexRef === indexRef)?.editableDefinition;
  const replace = original && (next.kind !== original.kind || next.comment !== original.comment || !sameParts(next.keyParts, original.keyParts));
  return indexDraftPermission(snapshot, indexRef, replace ? 'replace' : 'rename', patches);
}
/** 只发送变化属性；恢复原值消掉草稿，不重新序列化原 SQL。 */
export function makeIndexAlter(index: TableIndexView, next: IndexDefinition, context?: { snapshot: TableIndexGetOutput; patches: readonly IndexPatch[] }): IndexPatch | null {
  const original = index.editableDefinition; if (!original || index.unsupportedReasons.length) throw new Error(index.unsupportedReasons.join('\n') || text.readonly);
  if (isSpecialIndexKind(original.kind) || isSpecialIndexKind(next.kind)) throw new Error(text.specialReadonly);
  const changes: Extract<IndexPatch, { op: 'alter' }>['changes'] = {};
  if (next.kind !== original.kind) changes.kind = next.kind;
  if (next.name !== original.name) changes.name = next.name;
  if (!sameParts(next.keyParts, original.keyParts)) changes.keyParts = next.keyParts;
  if (next.comment !== original.comment) changes.comment = next.comment;
  if (next.method !== original.method) throw new Error(text.readonly);
  const keys = Object.keys(changes); if (!keys.length) return null;
  const action = keys.length === 1 && keys[0] === 'name' ? 'rename' : 'replace';
  const access = context ? indexDraftPermission(context.snapshot, index.indexRef, action, context.patches) : index.access[action];
  if (!access.allowed) throw new Error(access.reasons.join('\n') || text.readonly);
  return { op: 'alter', indexRef: index.indexRef, changes };
}
/** 同一旧引用或新增 clientKey 只保留一个草稿，撤销不影响其他键。 */
export function setIndexPatch(patches: readonly IndexPatch[], ref: string, next: IndexPatch | null): IndexPatch[] { const rest = patches.filter(patch => (patch.op === 'add' ? patch.clientKey : patch.indexRef) !== ref); return next ? [...rest, next] : rest; }
/** 不推断未知字段能力，LOB 只在明确前缀能力下进入候选。 */
export function indexColumnSelectable(column: TableIndexColumnView, kind: IndexDefinition['kind'] = 'ordinary'): boolean { return !column.generated && !column.hidden && (isSpecialIndexKind(kind) ? column.specialIndexes?.[kind]?.allowed === true : Number.isSafeInteger(column.fullKeyBytes) && column.fullKeyBytes! > 0 || column.prefix.kind === 'allowed'); }
/** 新增种类必须同时有服务器能力和可选字段；旧BTREE编辑不允许跨方法转换。 */
export function indexCreationKinds(snapshot: TableIndexGetOutput): IndexDefinition['kind'][] {
  return (['ordinary', 'unique', 'primary', 'fulltext', 'spatial'] as const).filter(kind => (!isSpecialIndexKind(kind) || snapshot.capabilities?.specialIndexes?.[kind] === true) && snapshot.columns.some(column => indexColumnSelectable(column, kind)));
}
/** 切换新增索引的算法时重选字段，不把旧前缀、方向或多列草稿偷带入特殊索引。 */
export function changeIndexDraftKind(definition: IndexDefinition, kind: IndexDefinition['kind'], columns: readonly TableIndexColumnView[]): IndexDefinition {
  const reset = isSpecialIndexKind(kind) || isSpecialIndexKind(definition.kind);
  const first = columns.find(column => indexColumnSelectable(column, kind));
  return { ...definition, kind, method: indexMethodForKind(kind), keyParts: reset ? first ? [{ columnRef: first.columnRef, direction: 'asc' }] : [] : definition.keyParts };
}
/** 纯前置校验帮助用户定位输入问题；真正依赖/字节预算仍由可信后端裁决。 */
export function validateIndexDrafts(snapshot: TableIndexGetOutput, input: readonly IndexPatch[]): IndexPatch[] {
  if (!snapshot.writable || !snapshot.capabilities) throw new Error(text.readonlyTable);
  if (!input.length) throw new Error(text.noChange);
  const patches = validateIndexPatches(input), indexes = new Map(snapshot.indexes.map(index => [index.indexRef, index])), columns = new Map(snapshot.columns.map(column => [column.columnRef, column]));
  if (indexes.size !== snapshot.indexes.length || columns.size !== snapshot.columns.length) throw new Error(text.duplicate);
  const names = new Map(snapshot.indexes.map(index => [index.indexRef, { name: index.name, primary: index.kind === 'primary' }]));
  for (const patch of patches) {
    const old = patch.op === 'add' ? undefined : indexes.get(patch.indexRef);
    if (patch.op !== 'add' && !old) throw new Error(text.missing);
    if (patch.op === 'drop') { const access = indexDraftPermission(snapshot, patch.indexRef, 'drop', patches); if (!access.allowed) throw new Error(access.reasons.join('\n') || text.readonly); names.delete(patch.indexRef); continue; }
    if (patch.op === 'add' && indexes.has(patch.clientKey)) throw new Error(text.duplicate);
    if (patch.op === 'alter' && !old!.editableDefinition) throw new Error(text.readonly);
    const value = patch.op === 'add' ? patch.definition : { ...old!.editableDefinition!, ...patch.changes };
    assertIndexDefinitionNames(value);
    if (patch.op === 'alter') makeIndexAlter(old!, value, { snapshot, patches });
    if ([...value.name].length > snapshot.capabilities.maxIndexNameCharacters) throw new Error(text.tooLongName);
    if (new TextEncoder().encode(value.comment).byteLength > snapshot.capabilities.maxIndexCommentBytes || value.comment.includes('\0')) throw new Error(text.tooLongComment);
    if (value.keyParts.length > snapshot.capabilities.maxKeyParts) throw new Error(text.tooManyParts);
    if (isSpecialIndexKind(value.kind)) assertSpecialIndexDefinition(value, columns, snapshot.capabilities);
    else for (const part of value.keyParts) {
      const column = columns.get(part.columnRef); if (!column) throw new Error(text.missing);
      if (!indexColumnSelectable(column)) throw new Error(text.unknownColumn);
      if (part.direction === 'desc' && !snapshot.capabilities.descendingIndexes) throw new Error(text.unsupportedDirection);
      if (value.kind === 'primary' && (column.nullable || part.prefixLength !== undefined)) throw new Error(text.invalidPrimary);
      if (part.prefixLength !== undefined && (column.prefix.kind !== 'allowed' || part.prefixLength > column.prefix.maxLength)) throw new Error(text.invalidPrefix);
      if (part.prefixLength === undefined && (!Number.isSafeInteger(column.fullKeyBytes) || column.fullKeyBytes! <= 0)) throw new Error(text.invalidPrefix);
    }
    names.set(patch.op === 'add' ? patch.clientKey : patch.indexRef, { name: value.name, primary: value.kind === 'primary' });
  }
  if (names.size > tableIndexPatchLimits.indexes) throw new Error(text.duplicate);
  let primary = 0; const folded = new Set<string>();
  for (const value of names.values()) { const name = value.name.toLowerCase(); if (folded.has(name)) throw new Error(text.duplicate); folded.add(name); if (value.primary && ++primary > 1) throw new Error(text.primaryCount); }
  return patches;
}
/** Promise rejected 不证明 DDL 未执行；只使用结构化任务证据。 */
export function indexFailureState(progress: TableIndexApplyProgress | null): 'succeeded' | 'verificationFailed' | 'notSent' | 'failed' | 'unknown' { return progress?.ddlCompleted ? progress.definitionVerified ? 'succeeded' : 'verificationFailed' : progress?.outcome === 'not-sent' && !progress.ddlSubmitted ? 'notSent' : progress?.outcome === 'failed' ? 'failed' : 'unknown'; }
/** 完成证据清本窗口结构草稿，只有核验成功可刷新；其他可能投递的结果只标过期。 */
export function indexExecutionEffect(event: { kind: 'resolved'; result: TableIndexApplyOutput } | { kind: 'rejected'; progress: TableIndexApplyProgress | null; attempted: boolean }): { clearDrafts: boolean; page: 'refresh' | 'stale' | 'none' } {
  if (event.kind === 'resolved') return { clearDrafts: true, page: event.result.definitionVerified ? 'refresh' : 'stale' };
  return { clearDrafts: event.progress?.ddlCompleted === true, page: !event.attempted || indexFailureState(event.progress) === 'notSent' ? 'none' : 'stale' };
}

/** 同步互斥和代次围栏在 await 前生效；取消不会提前释放 busy 或接受迟到响应。 */
export class IndexRequestFence {
  private generation = 0;
  private active: { generation: number; taskId: string; cancelled: boolean } | undefined;
  private live = true;
  get busy(): boolean { return this.active !== undefined; }
  get taskId(): string | undefined { return this.active?.taskId; }
  begin(taskId: string): { generation: number; taskId: string } | undefined {
    if (!this.live || this.active) return undefined;
    this.active = { generation: ++this.generation, taskId, cancelled: false }; return { generation: this.generation, taskId };
  }
  /** 取消标记不代表服务器终态，finish 必须由真实请求 finally 调用。 */
  cancel(): string | undefined { if (!this.active || this.active.cancelled) return undefined; this.active.cancelled = true; return this.active.taskId; }
  accepts(operation: { generation: number }): boolean { return this.live && this.active?.generation === operation.generation && !this.active.cancelled; }
  finish(operation: { generation: number }): void { if (this.active?.generation === operation.generation) this.active = undefined; }
  /** 卸载阻断所有迟到投影；只返回正在进行的任务供外部真实取消。 */
  dispose(): string | undefined { this.live = false; this.generation++; return this.cancel(); }
}
