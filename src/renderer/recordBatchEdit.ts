import type { DataRow, TablePage } from '../shared/contracts';
import { copyInsertSqlLimits as limits } from '../shared/copyInsertSql';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import { boundedUtf8Bytes } from './jsonLexicalTree';
import { collectChanges, type DraftRow } from './dataChanges';
import { changedDraftHistoryBytes, draftHistoryLimits } from './draftHistory';
import { assertRecordBatchFields, recordBatchCellBytes, sameRecordBatchRow } from './recordDuplicateBatch';
import { recordCopyMetadataReason, type RecordCopyPage } from './recordCopySource';
import { recordReadonlyReason, recordTargetKey, type RecordContext } from './recordViews';
import { recordBatchEditZh as text } from './locales/recordBatchEdit.zh-CN';

/** 密集自有数组不执行访问器或接受隐藏的后来元素。 */
function array(value: unknown, maximum: number): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) throw Error(text.invalid);
  for (let i = 0; i < value.length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d?.enumerable || !('value' in d)) throw Error(text.invalid); }
}
/** 行包装先检查自有数据，之后才读取身份及类型标记。 */
function row(value: unknown): asserts value is DraftRow {
  assertRecordBatchFields(value); const keys = Object.keys(value);
  if (keys.some(key => !['id','data','original','inserted','deleted'].includes(key)) || !['id','data','inserted','deleted'].every(key => keys.includes(key))) throw Error(text.invalid);
  const r = value as unknown as DraftRow;
  if (typeof r.id !== 'string' || !r.id || r.id.length > 200 || typeof r.inserted !== 'boolean' || typeof r.deleted !== 'boolean') throw Error(text.invalid);
  assertRecordBatchFields(r.data); if (r.original !== undefined) assertRecordBatchFields(r.original);
}
/** 只比较线路原文和二进制字节，既有数字／时间／JSON不重新解析。 */
function equal(a: DataRow, b: DataRow): boolean { return sameRecordBatchRow(a, b); }
/** 克隆并冻结窗口基线，不能冻结真实网格或借其可变二进制包装修改源值。 */
function snapshot(r: DraftRow): DraftRow {
  const clone = (data: DataRow) => { const result = structuredClone(data); for (const value of Object.values(result)) if (value && typeof value === 'object') Object.freeze(value); return Object.freeze(result); };
  return Object.freeze({ id: r.id, data: clone(r.data), original: r.original === undefined ? undefined : clone(r.original), inserted: r.inserted, deleted: r.deleted });
}
/** 原大值只读保留，独立于新输入／复制SQL预算；扫描前先限制单值与整组内存。 */
export const recordBatchSourceLimits = { units: 1_048_576, bytes: 64 * 1024 * 1024 } as const;
function sourceBytes(value: unknown): number {
  if (typeof value === 'string') { if (value.length > recordBatchSourceLimits.units) throw Error(text.budget); const bytes = boundedUtf8Bytes(value, recordBatchSourceLimits.units * 4); if (bytes === undefined) throw Error(text.invalid); return bytes + 2; }
  if (value && typeof value === 'object') {
    assertRecordBatchFields(value); const binary = value as unknown as { type: unknown; base64: unknown };
    if (Object.keys(value).length !== 2 || binary.type !== 'binary' || typeof binary.base64 !== 'string' || binary.base64.length > recordBatchSourceLimits.units) throw Error(text.invalid);
    const b = binary.base64; if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b) || b.endsWith('==') && !/[AQgw]==$/.test(b) || b.endsWith('=') && !b.endsWith('==') && !/[AEIMQUYcgkosw048]=$/.test(b)) throw Error(text.invalid);
    return b.length + 29;
  }
  return recordBatchCellBytes(value);
}
/** 当前完整页的准确勾选来源；混合新增可省略字段，已有记录必须保持完整旧值。 */
function prepareSelectedRecords(rows: DraftRow[], ids: ReadonlySet<string>, context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null): DraftRow[] {
  const reason = recordReadonlyReason(context); if (reason) throw Error(reason);
  array(rows, 10000); rows.forEach(row);
  if (!ids.size || ids.size > limits.rows || new Set(rows.map(r => r.id)).size !== rows.length) throw Error(text.source);
  const info = context.info!, source = page?.copySource;
  if (info.database !== context.target.database || info.name !== context.target.table || !page || binding?.page !== page || recordCopyMetadataReason(context, binding) || source?.missingColumns.length) throw Error(text.source);
  const names = info.columns.map(c => c.name), keys = page.columns.map(c => c.key);
  if (!names.length || names.length > limits.columns || new Set(names).size !== names.length || new Set(keys).size !== names.length || keys.length !== names.length || names.some(name => !keys.includes(name))) throw Error(text.source);
  const originals = rows.filter(r => !r.inserted);
  if (originals.length !== page.rows.length || originals.some((r, i) => !r.original || !equal(r.original, page.rows[i]))) throw Error(text.source);
  const chosen = rows.filter(r => ids.has(r.id)); if (chosen.length !== ids.size || chosen.some(r => r.deleted)) throw Error(text.source);
  let bytes = 2, cells = 0;
  for (const r of chosen) {
    if (r.inserted ? r.original !== undefined : !r.original || names.some(name => !Object.hasOwn(r.original!, name) || !Object.hasOwn(r.data, name)) || Object.keys(r.original).length !== names.length || info.editableKey.some(key => r.original![key] === null || r.original![key] === undefined)) throw Error(text.source);
    for (const data of [r.data, r.original]) if (data) {
      for (const [key, value] of Object.entries(data)) {
        if (!names.includes(key) || ++cells > limits.cells * 2) throw Error(text.source);
        bytes += recordBatchCellBytes(key) + sourceBytes(value) + 4; if (bytes > recordBatchSourceLimits.bytes) throw Error(text.budget);
      }
    }
  }
  return chosen;
}

/** 多行局部缓冲只携带本批选中行，最终发布仍绑定原全页与原original定位。 */
export class RecordBatchEditIntent {
  private stopped = false;
  private readonly target: string;
  private readonly metadata: string;
  private readonly sourceSignature: string;
  private readonly ids: Set<string>;
  private readonly chosen: DraftRow[];
  private readonly rowRefs: DraftRow[];
  private readonly references: { data: DataRow; original?: DataRow; inserted: boolean; deleted: boolean }[];
  readonly initial: DraftRow[];
  readonly context: RecordContext;
  constructor(readonly rows: DraftRow[], readonly selected: ReadonlySet<string>, context: RecordContext, readonly binding: RecordCopyPage | null, readonly page: TablePage | null, readonly id: string) {
    if (!id || id.length > 200) throw Error(text.invalid);
    this.rowRefs = [...rows];
    this.chosen = prepareSelectedRecords(rows, this.selected, context, binding, page);
    this.references = this.chosen.map(r => ({ data: r.data, original: r.original, inserted: r.inserted, deleted: r.deleted }));
    this.sourceSignature = JSON.stringify(page?.copySource); this.target = recordTargetKey(context.target); this.metadata = tableCopyMetadataKey(context.info!); this.ids = new Set(this.selected);
    this.context = Object.freeze({ ...context, target: Object.freeze({ ...context.target }) });
    this.initial = this.chosen.map(snapshot); Object.freeze(this.initial);
  }
  /** 关闭、外部行／选择／连接变化留下永久失效标记，原引用恢复不能复活。 */
  invalidate(): void { this.stopped = true; }
  get invalidated(): boolean { return this.stopped; }
  reason(rows: DraftRow[], ids: ReadonlySet<string>, context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null): string {
    if (this.stopped) return text.stale;
    try {
      if (rows !== this.rows || rows.length !== this.rowRefs.length || rows.some((row, at) => row !== this.rowRefs[at]) || ids !== this.selected || ids.size !== this.ids.size || [...ids].some(id => !this.ids.has(id)) || context.info !== this.context.info || context.connectionVersion !== this.context.connectionVersion || context.generation !== this.context.generation || recordTargetKey(context.target) !== this.target || !context.info || tableCopyMetadataKey(context.info) !== this.metadata || binding !== this.binding || page !== this.page || JSON.stringify(page?.copySource) !== this.sourceSignature) throw Error(text.stale);
      const now = prepareSelectedRecords(rows, ids, context, binding, page);
      if (now.some((r, i) => r !== this.chosen[i] || r.data !== this.references[i].data || r.original !== this.references[i].original || r.inserted !== this.references[i].inserted || r.deleted !== this.references[i].deleted || !equal(r.data, this.initial[i].data) || (r.original === undefined ? this.initial[i].original !== undefined : !equal(r.original, this.initial[i].original!)))) throw Error(text.stale);
      return '';
    } catch (reason) { this.stopped = true; return reason instanceof Error ? reason.message : text.stale; }
  }
  /** 每次保留及最终暂存都先校验整组，预算失败不发布最后一行或消费旧缓冲。 */
  check(candidates: DraftRow[]): DraftRow[] {
    const reason = this.reason(this.rows, this.selected, this.context, this.binding, this.page); if (reason) throw Error(reason);
    array(candidates, limits.rows); if (candidates.length !== this.initial.length) throw Error(text.invalid);
    let bytes = 2, cells = 0, history = 128; const replacements = new Map<string, DraftRow>();
    const columns = this.context.info!.columns;
    candidates.forEach((candidate, i) => {
      row(candidate); const base = this.initial[i], source = this.chosen[i];
      if (candidate.id !== base.id || candidate.original !== base.original || candidate.inserted !== base.inserted || candidate.deleted !== base.deleted) throw Error(text.stale);
      const keys = Object.keys(candidate.data); if (keys.some(key => !columns.some(c => c.name === key)) || !base.inserted && (keys.length !== columns.length || columns.some(c => !Object.hasOwn(candidate.data, c.name)))) throw Error(text.invalid);
      for (const column of columns) {
        const before = Object.fromEntries(Object.hasOwn(base.data, column.name) ? [[column.name, base.data[column.name]]] : []), after = Object.fromEntries(Object.hasOwn(candidate.data, column.name) ? [[column.name, candidate.data[column.name]]] : []);
        if (equal(before, after)) continue;
        const value = candidate.data[column.name];
        bytes += recordBatchCellBytes(column.name) + (value === undefined ? 4 : recordBatchCellBytes(value)) + 4; if (++cells > limits.cells || bytes > limits.inputBytes) throw Error(text.budget);
        if (column.generated || value === undefined && !base.inserted || value === null && !column.nullable || value !== undefined && value !== null && /^(?:TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|BINARY|VARBINARY|BIT)\b/i.test(column.type) && typeof value !== 'object') throw Error(text.invalid);
      }
      if (equal(base.data, candidate.data)) return;
      const data = Object.fromEntries(Object.entries(candidate.data).map(([key, value]) => [key, Object.hasOwn(source.data, key) && equal({ value: source.data[key] }, { value }) ? source.data[key] : structuredClone(value)])), next = { ...source, data };
      history += changedDraftHistoryBytes(source, next); if (history > draftHistoryLimits.bytes) throw Error(text.budget); replacements.set(source.id, next);
    });
    const result = replacements.size ? this.rows.map(r => replacements.get(r.id) ?? r) : this.rows;
    if (collectChanges(result).length > 5000) throw Error(text.budget);
    return result;
  }
  /** 父级重新核实时来源后一次消费；失败可修正，成功后旧按钮不能重复发布。 */
  consume(candidates: DraftRow[], rows: DraftRow[], ids: ReadonlySet<string>, context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null): DraftRow[] {
    const reason = this.reason(rows, ids, context, binding, page); if (reason) throw Error(reason);
    const next = this.check(candidates); this.stopped = true; return next;
  }
}
