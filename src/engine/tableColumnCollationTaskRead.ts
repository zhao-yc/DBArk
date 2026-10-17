import { readColumnCollationFacts, assertColumnCollationUnchanged, type ColumnCollationFacts } from './tableColumnCollationRead';
import { readColumnCollationPhysicalFacts, type ColumnCollationPhysicalResult } from './tableColumnCollationPhysicalRead';
import { buildColumnCollationDefinition } from './tableColumnCollationSql';
import type { IndexReferenceNames } from './tableIndexRead';
import type { StructureDefinitionRead, StructureTaskContext } from './structureDefinition';
import type { TableColumnPatchTarget, TableColumnView } from '../shared/tableColumnPatches';
import type { TableEncodingPair } from '../shared/tableDefaultEncoding';

export type ColumnCollationObservedPhysical = Extract<ColumnCollationPhysicalResult, { status: 'observed' }>;
/** 同一轮完整事实和前后物理观测，仅供Tasks内存快照使用。 */
export interface ColumnCollationTaskFacts {
  facts: ColumnCollationFacts; physical: ColumnCollationObservedPhysical; bytes: number;
}
export type ColumnCollationTaskReadResult = { kind: 'ready'; value: ColumnCollationTaskFacts } | { kind: 'unavailable'; reason: string };

/** 原始目录事实进入统一预算，Map按实际条目计量，不仅计摘要或公开候选。 */
function evidenceBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value, (_key, item) => item instanceof Map ? [...item] : item));
}

/** 服务器身份、原生编号和名称映射均须相同；字节账面差异不代表身份漂移。 */
function samePhysical(before: ColumnCollationObservedPhysical, after: ColumnCollationObservedPhysical): void {
  if (before.tableId !== after.tableId || before.serverIdentity !== after.serverIdentity || JSON.stringify(before.target) !== JSON.stringify(after.target) || JSON.stringify(before.mapping) !== JSON.stringify(after.mapping)) throw new Error('列排序规则物理目标或名称映射已变化；未发送DDL');
}

/** 仅准确不支持、明确权限或附加目录预算可以关闭新能力，身份缺失/歧义必须失败。 */
function unavailablePhysical(result: Exclude<ColumnCollationPhysicalResult, { status: 'observed' }>): ColumnCollationTaskReadResult {
  if (['unsupported-version', 'unsupported-target', 'unsupported-mapping', 'unsupported-engine', 'partitioned-table', 'catalog-permission', 'catalog-budget'].includes(result.reason)) return { kind: 'unavailable', reason: result.reason };
  throw new Error('列排序规则物理身份目录缺失、歧义或格式未知；请重新读取');
}

/** 使用原规范context夹读实际物理身份；取消、断线、未知driver错误由原reader继续抛出。 */
export async function readColumnCollationTaskFacts(context: StructureTaskContext, target: TableColumnPatchTarget, base: StructureDefinitionRead, refs: IndexReferenceNames): Promise<ColumnCollationTaskReadResult> {
  const physical = await readColumnCollationPhysicalFacts(context, target, base);
  if (physical.status !== 'observed') return unavailablePhysical(physical);
  const result = await readColumnCollationFacts(context, target, base, refs);
  const finalPhysical = await readColumnCollationPhysicalFacts(context, target, base);
  if (finalPhysical.status !== 'observed') {
    if (finalPhysical.reason === 'catalog-permission' || finalPhysical.reason === 'catalog-budget') return { kind: 'unavailable', reason: finalPhysical.reason };
    throw new Error('列排序规则读取期间物理目标、版本或名称映射已变化；未发送DDL');
  }
  samePhysical(physical, finalPhysical);
  if (result.status !== 'preparation') {
    if (result.reason === 'unsupported-version') throw new Error('列排序规则读取期间服务器版本已变化；未发送DDL');
    return { kind: 'unavailable', reason: result.reason };
  }
  if (physical.serverIdentity !== base.identity || JSON.stringify(physical.target) !== JSON.stringify(target)) throw new Error('列排序规则物理观测与原始目标不一致');
  const bytes = Math.max(result.facts.bytes, evidenceBytes(result.facts)) + physical.bytes + finalPhysical.bytes + evidenceBytes([physical, finalPhysical]);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('列排序规则私有事实计量无效');
  context.checkCancelled();
  return { kind: 'ready', value: { facts: result.facts, physical, bytes } };
}

/** 新会话前核完整准备事实及真实ID；后核ID允许变化，不调用此断言。 */
export function assertColumnCollationTaskUnchanged(before: ColumnCollationTaskFacts, after: ColumnCollationTaskFacts): void {
  samePhysical(before.physical, after.physical);
  assertColumnCollationUnchanged(before.facts, after.facts);
}

/** 真实候选只在整表输出一次；返回副本，公开对象不能改写私有事实。 */
export function columnCollationTaskCatalog(value: ColumnCollationTaskFacts): TableEncodingPair[] {
  return value.facts.catalog.candidates.map(pair => ({ charset: pair.charset, collation: pair.collation }));
}

/** current只取实际有效列编码；可编辑性必须通过真实候选的原范围门，不能使用权限布尔推断。 */
export function columnCollationTaskViews(columns: TableColumnView[], base: StructureDefinitionRead, value: ColumnCollationTaskFacts): TableColumnView[] {
  const encodings = new Map(base.encodings.map(encoding => [encoding.name, encoding]));
  const alternatives = new Map<string, TableEncodingPair[]>();
  for (const pair of value.facts.catalog.candidates) {
    const list = alternatives.get(pair.charset) ?? [];
    if (list.length < 2) list.push(pair);
    alternatives.set(pair.charset, list);
  }
  return columns.map(column => {
    const encoding = encodings.get(column.name);
    if (!encoding || !encoding.charset || !encoding.collation || base.encodings.filter(item => item.name === column.name).length !== 1) return column;
    const current = { charset: encoding.charset, collation: encoding.collation };
    const next = alternatives.get(current.charset)?.find(pair => pair.collation !== current.collation);
    let access: NonNullable<TableColumnView['collation']>['access'] = { editable: false, reason: '当前列不满足普通无索引CHAR/VARCHAR、完整定义及目录权限范围' };
    if (!next) access = { editable: false, reason: '当前字符集没有其它可用排序规则' };
    else {
      // 此处只运行纯候选验证，不生成可执行授权；preview/apply仍独立重读全部事实。
      try { buildColumnCollationDefinition(value.facts, column.columnRef, next); access = { editable: true }; } catch { /* 范围门拒绝仅使此列只读，不扩大原七属性能力。 */ }
    }
    return { ...column, collation: { current, access } };
  });
}
