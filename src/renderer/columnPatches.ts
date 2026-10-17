import { readControlledTimestampDefault, validateColumnPatches, type ColumnDefaultPatch, type ColumnPatch, type ColumnTypePatch, type ReadColumnDefault, type TableColumnView, type TableColumnPatchTarget, type TableColumnApplyProgress, type TableColumnApplyOutput } from '../shared/tableColumnPatches';
import { columnPatchZh as text } from './locales/columnPatches.zh-CN';
import { sameColumnOnUpdate } from '../shared/tableColumnPatches';

export type ColumnChanges = Extract<ColumnPatch, { kind: 'alter' }>['changes'];
/** 原默认值只做中文语义展示；数值保持原文本，表达式不求值，不将内部模型对象显示给用户。 */
export function formatReadColumnDefault(value: ReadColumnDefault): string {
  switch (value.kind) {
    case 'none': return text.readDefaultNone;
    case 'null': return text.null;
    case 'expression': return `${text.readDefaultExpression}：${value.sql}`;
    case 'opaque': return `${text.readDefaultUnknown}：${value.sql}`;
    case 'literal': {
      if (value.valueType === 'number') return `${text.readDefaultNumber}：${value.value}`;
      if (value.valueType === 'boolean') return `${text.readDefaultBoolean}：${value.value}`;
      if (value.valueType === 'binary') return `${value.encoding === 'bits' ? text.readDefaultBits : text.readDefaultHex}：${value.value}`;
      const kind = value.value === '' ? text.emptyText : value.value === 'NULL' ? text.textNull : text.readDefaultText;
      return `${kind}：${JSON.stringify(value.value)}${value.introducer ? `（${text.readDefaultIntroducer}：${value.introducer}）` : ''}`;
    }
    default: return text.readDefaultUnknown;
  }
}
/** 风险ID只用于协议，确认句集中中文；未知ID拒执行，不猜含义或沿用原型属性。 */
export function columnAcknowledgementLabel(id: string): string | undefined {
  const labels: Record<string, string> = { 'ddl-implicit-commit': text.ackImplicit, 'external-ddl-window': text.ackWindow, 'drop-column-data': text.ackDrop, 'external-name-dependencies': text.ackDependencies, 'conversion-or-nullability': text.ackConversion };
  return Object.hasOwn(labels, id) ? labels[id] : undefined;
}
/** 只比较展示目标身份；同ID配置变更还须由窗口代次与未来引擎令牌重核保护。 */
export function sameColumnTarget(a: TableColumnPatchTarget, b: TableColumnPatchTarget) { return a.connectionId === b.connectionId && a.database === b.database && a.table === b.table; }
export type ColumnPatchProgress = TableColumnApplyProgress;
/** 清空可选精度必须删除自有键，严格JSON补丁不接受显式undefined。 */
export function setColumnPrecision<T extends Extract<ColumnTypePatch, { kind: 'temporal' }> | Extract<ColumnDefaultPatch, { kind: 'expression' }>>(value: T, precision: string): T {
  const { precision: old, ...rest } = value;
  return (precision === '' ? rest : { ...rest, precision: Number(precision) }) as T;
}
/** rejected本身不是未执行证据；只采信任务的结构化阶段，缺证据保守标unknown。 */
export function columnFailureState(progress: ColumnPatchProgress | null): 'succeeded' | 'verificationFailed' | 'notSent' | 'failed' | 'unknown' {
  return progress?.ddlCompleted ? progress.definitionVerified ? 'succeeded' : 'verificationFailed' : progress?.outcome === 'not-sent' && !progress.ddlSubmitted ? 'notSent' : progress?.outcome === 'failed' ? 'failed' : 'unknown';
}
/** 只有真实完成证据才清字段草稿；未知结果只使表页过期，不自动discard或重放。 */
export function columnExecutionEffect(event: { kind: 'resolved'; result: TableColumnApplyOutput } | { kind: 'rejected'; progress: ColumnPatchProgress | null; attempted: boolean }): { clearDrafts: boolean; page: 'refresh' | 'stale' | 'none' } {
  if (event.kind === 'resolved') return { clearDrafts: true, page: event.result.definitionVerified ? 'refresh' : 'stale' };
  return { clearDrafts: event.progress?.ddlCompleted === true, page: !event.attempted || columnFailureState(event.progress) === 'notSent' ? 'none' : 'stale' };
}
/** 仅识别受控时间表达式；其他原 SQL 不转换为可执行用户表达式。 */
export function editableColumnDefault(value: ReadColumnDefault): ColumnDefaultPatch | undefined {
  if (value.kind === 'none' || value.kind === 'null') return { kind: value.kind };
  if (value.kind === 'literal') return value.encoding === 'bits' ? undefined : { kind: 'literal', valueType: value.valueType, value: value.value };
  if (value.kind === 'expression') { const timestamp = readControlledTimestampDefault(value.sql); if (timestamp) return { kind: 'expression', expression: 'current-timestamp', precision: timestamp.precision }; }
  return undefined;
}
/** UI 初始类型只是结构化输入建议，未勾修改时绝不发送或重述原类型。 */
export function defaultColumnType(kind: ColumnTypePatch['kind']): ColumnTypePatch {
  switch (kind) {
    case 'integer': return { kind, type: 'INT', unsigned: false }; case 'decimal': return { kind, precision: 10, scale: 0, unsigned: false }; case 'float': return { kind, type: 'FLOAT', unsigned: false };
    case 'bit': return { kind, length: 1 }; case 'string': return { kind, type: 'VARCHAR', length: 255 }; case 'large': return { kind, type: 'TEXT' }; case 'temporal': return { kind, type: 'DATETIME' }; case 'enumeration': return { kind, type: 'ENUM', values: [''] };
  }
}
/** 返回受控类型文字，仅供显示和原值比较，不在客户端生成DDL。 */
export function columnTypeLabel(type: ColumnTypePatch): string {
  switch (type.kind) {
    case 'integer': case 'float': return type.type + (type.unsigned ? ' UNSIGNED' : ''); case 'decimal': return `DECIMAL(${type.precision},${type.scale})${type.unsigned ? ' UNSIGNED' : ''}`;
    case 'bit': return `BIT(${type.length})`; case 'string': return `${type.type}(${type.length})`; case 'large': return type.type; case 'temporal': return type.type + (type.precision === undefined ? '' : `(${type.precision})`); case 'enumeration': return `${type.type}(${type.values.map(value => JSON.stringify(value)).join(',')})`;
  }
}
/** 恢复原值时消除差异，同时按服务器能力拒绝修改只读属性。 */
export function makeColumnAlter(column: TableColumnView, changes: ColumnChanges): ColumnPatch | null {
  const next: ColumnChanges = {};
  for (const [attribute, value] of Object.entries(changes)) {
    const key = attribute as keyof ColumnChanges; if (value === undefined) continue;
    const original = key === 'type' ? column.typeSql.trim().toUpperCase() : key === 'default' ? editableColumnDefault(column.default) : key === 'position' ? undefined : column[key];
    if (key === 'onUpdate' && sameColumnOnUpdate(column.onUpdate, value as typeof column.onUpdate, column.typeSql)) continue;
    const comparable = key === 'type' ? columnTypeLabel(value as ColumnTypePatch).toUpperCase() : value;
    if (JSON.stringify(original) === JSON.stringify(comparable)) continue;
    if (!Object.hasOwn(column.access, key) || !column.access[key].editable) throw new Error(column.access[key]?.reason || text.readonly);
    Object.defineProperty(next, key, { value, enumerable: true, configurable: true, writable: true });
  }
  return Object.keys(next).length ? { kind: 'alter', columnRef: column.columnRef, changes: next } : null;
}
/** 同一个稳定引用只保留一项补丁，撤销不会影响别的字段。 */
export function setColumnPatch(patches: readonly ColumnPatch[], key: string, next: ColumnPatch | null): ColumnPatch[] {
  const other = patches.filter(patch => (patch.kind === 'add' ? patch.clientKey : patch.columnRef) !== key); return next ? [...other, next] : other;
}
/** 在网络预览前校验名称、位置和预算；引用始终来自快照或新增clientKey。 */
export function validateColumnDrafts(columns: readonly TableColumnView[], input: readonly ColumnPatch[], scale: 30 | 38): ColumnPatch[] {
  if (!input.length) throw new Error(text.noChange);
  const patches = validateColumnPatches(input, scale); const refs = new Map(columns.map(column => [column.columnRef, column]));
  if (refs.size !== columns.length) throw new Error(text.missing);
  const dropped = new Set(patches.filter(patch => patch.kind === 'drop').map(patch => patch.columnRef));
  const names = new Map(columns.filter(column => !dropped.has(column.columnRef)).map(column => [column.columnRef, column.name]));
  for (const patch of patches) {
    if (patch.kind !== 'add' && !refs.has(patch.columnRef)) throw new Error(text.missing);
    if (patch.kind === 'alter' && Object.hasOwn(patch.changes, 'onUpdate')) {
      const column = refs.get(patch.columnRef)!, value = patch.changes.onUpdate;
      if (Object.keys(patch.changes).length !== 1) throw new Error(text.onUpdateMixed);
      const precision = Number(/\((\d+)\)/.exec(column.typeSql)?.[1] ?? 0);
      if (value && value.precision !== undefined && value.precision !== precision) throw new Error(text.onUpdatePrecision);
    }
    if (patch.kind === 'add') { if (refs.has(patch.clientKey)) throw new Error(text.duplicate); names.set(patch.clientKey, patch.name); }
    else if (patch.kind === 'alter') { for (const key of Object.keys(patch.changes) as (keyof ColumnChanges)[]) if (!refs.get(patch.columnRef)!.access[key].editable) throw new Error(refs.get(patch.columnRef)!.access[key].reason || text.readonly); if (patch.changes.name !== undefined) names.set(patch.columnRef, patch.changes.name); }
  }
  if (!names.size) throw new Error(text.lastColumn);
  const folded = new Set<string>(); for (const name of names.values()) { if (folded.has(name.toLowerCase())) throw new Error(text.duplicate); folded.add(name.toLowerCase()); }
  const edges = new Map<string, string>();
  for (const patch of patches) {
    if (patch.kind === 'drop') continue; const key = patch.kind === 'add' ? patch.clientKey : patch.columnRef, position = patch.kind === 'add' ? patch.position : patch.changes.position;
    if (patch.kind === 'alter' && patch.changes.name && columns.some(column => column.columnRef !== patch.columnRef && column.name.toLowerCase() === patch.changes.name!.toLowerCase())) throw new Error(text.renameCycle);
    if (position?.kind === 'after') { if (position.columnRef === key || !names.has(position.columnRef)) throw new Error(text.positionInvalid); edges.set(key, position.columnRef); }
  }
  for (const start of edges.keys()) { const path = new Set<string>(); let current: string | undefined = start; while (current !== undefined) { if (path.has(current)) throw new Error(text.positionInvalid); path.add(current); current = edges.get(current); } }
  return patches;
}
