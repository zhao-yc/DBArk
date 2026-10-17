import { readControlledTimestampDefault, validateColumnPatches, type ColumnDefaultPatch, type ColumnPatch, type ColumnTypePatch, type ReadColumnDefault, type TableColumnView, type TableColumnPatchTarget, type TableColumnApplyProgress, type TableColumnApplyOutput } from '../shared/tableColumnPatches';
import { columnPatchZh as text } from './locales/columnPatches.zh-CN';
import { sameColumnOnUpdate } from '../shared/tableColumnPatches';
import { columnCollationPatchSchema, type TableColumnGetOutput } from '../shared/tableColumnPatches';
import { sameTableEncodingPair, tableDefaultEncodingLimits, type TableEncodingPair } from '../shared/tableDefaultEncoding';

export type ColumnChanges = Extract<ColumnPatch, { kind: 'alter' }>['changes'];
/** 完整目录先逐项校验且拒绝重复；仅服务器明确授权的同charset真实配对可选。 */
export function columnCollationCandidates(column: TableColumnView, catalog?: readonly TableEncodingPair[]): readonly TableEncodingPair[] {
  if (column.collation?.access.editable !== true) throw new Error(column.collation?.access.reason || text.collationReadonly);
  const current = columnCollationPatchSchema.parse(column.collation.current);
  if (!catalog || !catalog.length || catalog.length > tableDefaultEncodingLimits.candidates) throw new Error(text.collationCatalog);
  const seen = new Set<string>();
  const valid = catalog.map(pair => { const parsed = columnCollationPatchSchema.parse(pair); if (seen.has(parsed.collation)) throw new Error(text.collationCatalog); seen.add(parsed.collation); return parsed; });
  const candidates = valid.filter(pair => pair.charset === current.charset);
  if (!candidates.length) throw new Error(text.collationCatalog);
  return candidates;
}
/** 捕获当前快照、原列和完整目录的证明；一经观察漂移永久撤销，恢复旧值不能复活。 */
export class ColumnCollationIntent {
  readonly candidates: readonly TableEncodingPair[];
  #invalid = false; readonly #check: (snapshot: TableColumnGetOutput | null) => boolean;
  constructor(snapshot: TableColumnGetOutput, column: TableColumnView) {
    this.candidates = Object.freeze(columnCollationCandidates(column, snapshot.collationCatalog).map(pair => Object.freeze(pair)));
    const columns = snapshot.columns, refs = columns.slice(), catalog = snapshot.collationCatalog!, entries = catalog.map(pair => ({ ref: pair, charset: pair.charset, collation: pair.collation }));
    const metadata = columns.map(item => ({ ref: item.columnRef, type: item.typeSql, raw: item.rawDefinition, source: item.collation, pair: item.collation?.current, charset: item.collation?.current.charset, collation: item.collation?.current.collation, access: item.collation?.access, editable: item.collation?.access.editable, reason: item.collation?.access.reason }));
    const source = column.collation!, current = source.current, access = source.access;
    const original = { charset: current.charset, collation: current.collation, editable: access.editable, reason: access.reason, ref: column.columnRef, name: column.name, ordinal: column.ordinal, type: column.typeSql, raw: column.rawDefinition };
    const id = snapshot.snapshotId, hash = snapshot.ddlHash, expires = snapshot.expiresAt, target = { ...snapshot.target };
    this.#check = value => value === snapshot && value.columns === columns && columns.length === refs.length && columns.every((item, i) => item === refs[i] && item.columnRef === metadata[i].ref && item.typeSql === metadata[i].type && item.rawDefinition === metadata[i].raw && item.collation === metadata[i].source && item.collation?.current === metadata[i].pair && item.collation?.current.charset === metadata[i].charset && item.collation?.current.collation === metadata[i].collation && item.collation?.access === metadata[i].access && item.collation?.access.editable === metadata[i].editable && item.collation?.access.reason === metadata[i].reason) && columns.filter(item => item.columnRef === original.ref).length === 1 && columns.includes(column)
      && value.snapshotId === id && value.ddlHash === hash && value.expiresAt === expires && Date.now() < Date.parse(expires) && sameColumnTarget(value.target, target)
      && column.columnRef === original.ref && column.name === original.name && column.ordinal === original.ordinal && column.typeSql === original.type && column.rawDefinition === original.raw
      && column.collation === source && source.current === current && source.access === access && columnCollationPatchSchema.safeParse(current).success && current.charset === original.charset && current.collation === original.collation && access.editable === true && access.editable === original.editable && access.reason === original.reason
      && value.collationCatalog === catalog && catalog.length === entries.length && catalog.every((pair, i) => pair === entries[i].ref && columnCollationPatchSchema.safeParse(pair).success && pair.charset === entries[i].charset && pair.collation === entries[i].collation);
  }
  /** 旧控制器不能借新快照重新取得授权。 */
  current(snapshot: TableColumnGetOutput | null): boolean { if (this.#invalid) return false; try { if (this.#check(snapshot)) return true; } catch { /* 漂移或不完整对象均永久拒绝。 */ } this.invalidate(); return false; }
  /** 目标代次与明确撤销也可同步收回本意图。 */
  invalidate(): void { this.#invalid = true; }
}
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
  const labels: Record<string, string> = { 'ddl-implicit-commit': text.ackImplicit, 'external-ddl-window': text.ackWindow, 'drop-column-data': text.ackDrop, 'external-name-dependencies': text.ackDependencies, 'conversion-or-nullability': text.ackConversion, 'column-collation-semantics': text.ackCollationSemantics, 'column-collation-default-algorithm': text.ackCollationAlgorithm };
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
export function makeColumnAlter(column: TableColumnView, changes: ColumnChanges, catalog?: readonly TableEncodingPair[]): ColumnPatch | null {
  if (Object.hasOwn(changes, 'collation')) {
    if (Object.keys(changes).length !== 1) throw new Error(text.collationMixed);
    const selected = columnCollationPatchSchema.parse(changes.collation), candidates = columnCollationCandidates(column, catalog);
    if (!candidates.some(pair => sameTableEncodingPair(pair, selected))) throw new Error(text.collationInvalid);
    return sameTableEncodingPair(column.collation!.current, selected) ? null : { kind: 'alter', columnRef: column.columnRef, changes: { collation: selected } };
  }
  const next: ColumnChanges = {};
  for (const [attribute, value] of Object.entries(changes)) {
    const key = attribute as keyof ColumnChanges; if (value === undefined) continue;
    if (key === 'collation') continue;
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
export function validateColumnDrafts(columns: readonly TableColumnView[], input: readonly ColumnPatch[], scale: 30 | 38, catalog?: readonly TableEncodingPair[]): ColumnPatch[] {
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
    else if (patch.kind === 'alter') { for (const key of Object.keys(patch.changes) as (keyof ColumnChanges)[]) { if (key === 'collation') { if (!makeColumnAlter(refs.get(patch.columnRef)!, patch.changes, catalog)) throw new Error(text.noChange); continue; } if (!refs.get(patch.columnRef)!.access[key].editable) throw new Error(refs.get(patch.columnRef)!.access[key].reason || text.readonly); } if (patch.changes.name !== undefined) names.set(patch.columnRef, patch.changes.name); }
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
