import type { CellValue, DataRow, TableInfo } from '../shared/contracts';
import type { IncomingReferenceRelation, IncomingReferencesOutput, ChildReferencePageOutput } from '../shared/incomingReferences';
import { childReferencesZh as text } from './locales/childReferences.zh-CN';

/** 对象键排序仅用于只读身份比较；数组顺序、原始精度字符串和二进制包装保持不变。 */
function identity(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, (item as Record<string, unknown>)[key]])) : item);
}
/** 快照递归冻结，关系浏览不向父页草稿写入任何属性。 */
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) immutable(item); Object.freeze(value); }
  return value;
}
export class ChildReferenceIntent {
  readonly source: TableInfo; readonly data: DataRow; readonly rowId: string;
  private dead = false; private values: readonly unknown[]; private listeners = new Set<() => void>();
  constructor(source: TableInfo, rowId: string, data: DataRow, values: readonly unknown[], private guard: () => boolean) {
    this.source = immutable(structuredClone(source)); this.data = immutable(structuredClone(data)); this.rowId = rowId; this.values = [...values];
  }
  /** 观察过一次不同环境即永久失效；A→B→A不能复活原行意图。 */
  observe(values: readonly unknown[]): void { if (values.length !== this.values.length || values.some((value, index) => value !== this.values[index])) this.invalidate(); }
  /** 异步回包与旧按钮均读取同步身份，不靠React最后一次渲染猜当前标签。 */
  current(): boolean { if (!this.dead) { try { if (!this.guard()) this.invalidate(); } catch { this.invalidate(); } } return !this.dead; }
  /** 延后通知避免父页渲染期间更新子组件，撤销标记本身同步生效。 */
  invalidate(): void { if (this.dead) return; this.dead = true; queueMicrotask(() => { for (const listener of this.listeners) listener(); }); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}
/** NULL与缺字段分别报告；绝不把缺失元组降级为不带约束的子表查询。 */
export function childReferenceTuple(intent: ChildReferenceIntent, relation: IncomingReferenceRelation): { kind: 'values'; values: CellValue[] } | { kind: 'null' } | { kind: 'missing' } {
  const key = relation.foreignKey;
  if (!key.columns.length || key.columns.length !== key.referencedColumns.length || key.referencedDatabase !== intent.source.database || key.referencedTable !== intent.source.name) throw Error(text.mismatch);
  const values: CellValue[] = [];
  for (const name of key.referencedColumns) {
    const columns = intent.source.columns.filter(column => column.name.toLowerCase() === name.toLowerCase());
    if (columns.length !== 1 || !Object.hasOwn(intent.data, columns[0].name) || intent.data[columns[0].name] === undefined) return { kind: 'missing' };
    values.push(structuredClone(intent.data[columns[0].name]));
  }
  return values.some(value => value === null) ? { kind: 'null' } : { kind: 'values', values };
}
/** 首次与后续目录均核原完整父表，不能把变更后的目录接入旧父行快照。 */
export function checkIncomingReferencePage(intent: ChildReferenceIntent, output: IncomingReferencesOutput, expectedDigest?: string): void {
  // 首次目录保守绑定原完整元数据；后续DDL由引擎摘要验证，允许已确认表尾自增计数自然变化。
  const projection = (source: TableInfo) => { const { ddl: _ddl, ...structure } = source; return structure; };
  if (!intent.current() || identity(expectedDigest === undefined ? output.source : projection(output.source)) !== identity(expectedDigest === undefined ? intent.source : projection(intent.source)) || !/^[a-f0-9]{64}$/.test(output.sourceDigest) || expectedDigest !== undefined && output.sourceDigest !== expectedDigest || output.scope !== 'visible-only' || !Array.isArray(output.relations) || output.relations.length > 50 || output.nextCursor !== undefined && (typeof output.nextCursor !== 'string' || !output.nextCursor.length || output.nextCursor.length > 2048)) throw Error(text.mismatch);
  const seen = new Set<string>();
  for (const relation of output.relations) {
    if (!relation.database || !relation.table || !relation.foreignKey?.name || !/^[a-f0-9]{64}$/.test(relation.digest)) throw Error(text.mismatch);
    const key = identity([relation.database, relation.table, relation.foreignKey.name]); if (seen.has(key)) throw Error(text.mismatch); seen.add(key);
    childReferenceTuple(intent, relation);
  }
}
/** 子页只接纳同一真实方向映射、摘要和完整父表，不构造反向外键。 */
export function checkChildReferencePage(intent: ChildReferenceIntent, relation: IncomingReferenceRelation, digest: string, output: ChildReferencePageOutput, page: number, pageSize: number): void {
  checkIncomingReferencePage(intent, { source: output.source, sourceDigest: output.sourceDigest, scope: 'visible-only', relations: [output.relation] }, digest);
  if (identity(relation) !== identity(output.relation) || output.target.database !== relation.database || output.target.name !== relation.table || output.page.page !== page || output.page.pageSize !== pageSize || typeof output.stablePagination !== 'boolean') throw Error(text.mismatch);
}
