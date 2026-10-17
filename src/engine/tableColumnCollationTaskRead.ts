import { readColumnCollationFacts, assertColumnCollationUnchanged, type ColumnCollationFacts } from './tableColumnCollationRead';
import { readColumnCollationPhysicalFacts, type ColumnCollationPhysicalResult } from './tableColumnCollationPhysicalRead';
import { buildColumnCollationDefinition } from './tableColumnCollationSql';
import type { IndexReferenceNames } from './tableIndexRead';
import type { StructureDefinitionRead, StructureTaskContext } from './structureDefinition';
import type { TableColumnPatchTarget, TableColumnView } from '../shared/tableColumnPatches';
import type { TableEncodingPair } from '../shared/tableDefaultEncoding';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';

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

/** 投影不能把取消、断线或已中止会话当成单列只读资格；沿用原context的取消原因。 */
function projectionActive(context: StructureTaskContext): void {
  context.checkCancelled();
  if (context.managed.signal?.aborted) throw context.managed.signal.reason ?? new Error('列排序规则投影已取消');
  if (context.managed.broken) throw new Error('列排序规则投影的结构连接已断开');
}

/** 真正让出Node事件循环，Promise微任务不足以处理已排队的取消事件。 */
async function projectionTurn(context: StructureTaskContext): Promise<void> {
  projectionActive(context); await yieldEventLoop(); projectionActive(context);
}

/** current与候选硬门保持；每四列及不足四列的尾批协作让出，完成前仍检查原任务终态。 */
export async function columnCollationTaskViews(columns: TableColumnView[], base: StructureDefinitionRead, value: ColumnCollationTaskFacts, context: StructureTaskContext): Promise<TableColumnView[]> {
  await projectionTurn(context);
  const encodings = new Map(base.encodings.map(encoding => [encoding.name, encoding]));
  const alternatives = new Map<string, TableEncodingPair[]>();
  for (const pair of value.facts.catalog.candidates) {
    const list = alternatives.get(pair.charset) ?? [];
    if (list.length < 2) list.push(pair);
    alternatives.set(pair.charset, list);
  }
  const projected: TableColumnView[] = [];
  for (const [index, column] of columns.entries()) {
    projectionActive(context);
    const encoding = encodings.get(column.name);
    if (!encoding || !encoding.charset || !encoding.collation || base.encodings.filter(item => item.name === column.name).length !== 1) projected.push(column);
    else {
      const current = { charset: encoding.charset, collation: encoding.collation };
      const next = alternatives.get(current.charset)?.find(pair => pair.collation !== current.collation);
      let access: NonNullable<TableColumnView['collation']>['access'] = { editable: false, reason: '当前列不满足普通无索引CHAR/VARCHAR、完整定义及目录权限范围' };
      if (!next) access = { editable: false, reason: '当前字符集没有其它可用排序规则' };
      else {
        // 仅纯候选范围验证可变为单列只读；任务终态检查必须位于此catch之外。
        try { buildColumnCollationDefinition(value.facts, column.columnRef, next); access = { editable: true }; } catch { /* 不扩大原七属性能力。 */ }
      }
      projected.push({ ...column, collation: { current, access } });
    }
    projectionActive(context);
    if ((index + 1) % 4 === 0 || index === columns.length - 1) await projectionTurn(context);
  }
  projectionActive(context);
  return projected;
}
