import type { CellValue, DataRow, TablePage } from '../shared/contracts';
import { copyInsertSqlLimits as limits } from '../shared/copyInsertSql';
import type { DraftRow } from './dataChanges';
import { addedDraftHistoryBytes, draftHistoryLimits } from './draftHistory';
import { recordDuplicateZh as text } from './locales/recordDuplicate.zh-CN';
import { duplicateRecordDraft, recordDuplicateReadonlyReason } from './recordDuplicate';
import { recordCopyMetadataReason, type RecordCopyPage } from './recordCopySource';
import type { RecordContext } from './recordViews';

/** 只读取普通自有数据属性；未知包装、访问器和缺值不具备整批复制资格。 */
function fields(data: unknown): asserts data is DataRow {
  if (!data || typeof data !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(data))) throw Error(text.batchValue);
  for (const key of Reflect.ownKeys(data)) {
    const property = Object.getOwnPropertyDescriptor(data, key)!;
    if (typeof key !== 'string' || !property.enumerable || !Object.hasOwn(property, 'value')) throw Error(text.batchValue);
  }
}
/** 比较加载原值时保留负零、精确字符串与二进制，不把缺值或数字文本折叠成NULL。 */
function sameRow(left: DataRow | undefined, right: DataRow): boolean {
  if (!left) return false;
  fields(left); fields(right);
  return Object.keys(left).length === Object.keys(right).length && Object.keys(right).every(key => {
    if (!Object.hasOwn(left, key)) return false;
    const a = left[key], b = right[key];
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      fields(a); fields(b);
      return a.type === b.type && a.base64 === b.base64;
    }
    return Object.is(a, b);
  });
}
/** 同时计量UTF-8值与JSON线路转义成本；遇超限即停，不先分配大型编码缓冲。 */
function stringBytes(value: string): { raw: number; json: number } {
  let raw = 0, json = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw Error(text.batchValue);
      raw += 4; json += 4;
    } else {
      if (code >= 0xdc00 && code <= 0xdfff) throw Error(text.batchValue);
      raw += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
      json += code === 34 || code === 92 ? 2 : code < 32 ? ([8, 9, 10, 12, 13].includes(code) ? 2 : 6) : code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    }
    if (raw > limits.cellBytes || json > limits.inputBytes) throw Error(text.batchLimit);
  }
  return { raw, json };
}
/** 验证线路真实类型，二进制按原始字节预算；JSON和大数文本绝不解析或转换。 */
function cellBytes(value: unknown): number {
  if (value === null) return 4;
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error(text.batchValue);
    return String(value).length;
  }
  if (typeof value === 'string') return stringBytes(value).json;
  fields(value);
  const binary = value as unknown as { type: unknown; base64: unknown };
  if (Object.keys(value).length !== 2 || binary.type !== 'binary' || typeof binary.base64 !== 'string') throw Error(text.batchValue);
  const base64 = binary.base64;
  if (base64.length > Math.ceil(limits.cellBytes / 3) * 4) throw Error(text.batchLimit);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
    || base64.endsWith('==') && !/[AQgw]==$/.test(base64)
    || base64.endsWith('=') && !base64.endsWith('==') && !/[AEIMQUYcgkosw048]=$/.test(base64)) throw Error(text.batchValue);
  const bytes = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (bytes > limits.cellBytes) throw Error(text.batchLimit);
  return base64.length + 29;
}

/** 先整批校验来源、类型和既有预算，最后才分配身份与深复制；调用方只发布一次结果。 */
export function duplicateSelectedRecordDrafts(rows: DraftRow[], ids: ReadonlySet<string>, context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null, newId: () => string, now = Date.now()): { rows: DraftRow[]; ids: string[] } {
  if (!ids.size) throw Error(text.batchSelection);
  if (ids.size > limits.rows) throw Error(text.batchLimit);
  const source = page?.copySource;
  // 引擎完整页只返回同一MDL内的目录身份，不签发补取租约；缺列或显式不可用均不得降级复制。
  if (!page || binding?.page !== page || recordCopyMetadataReason(context, binding) || source && (source.status !== 'ready' || !source.pageRef || !Number.isFinite(source.expiresAt) || source.expiresAt <= now || source.missingColumns.length || source.rowRefs.length !== page.rows.length)) throw Error(text.batchSource);
  const loaded = new Set(page.columns.map(column => column.key));
  if (loaded.size !== page.columns.length || page.columns.some(column => !context.info!.columns.some(item => item.name === column.key)) || context.info!.columns.some(column => !column.generated && !/\bauto_increment\b/i.test(column.extra) && !loaded.has(column.name))) throw Error(text.batchSource);
  const allIds = new Set(rows.map(row => row.id));
  if (allIds.size !== rows.length) throw Error(text.batchSelection);
  const originals = rows.filter(row => !row.inserted);
  if (originals.length !== page.rows.length || originals.some((row, index) => !sameRow(row.original, page.rows[index]))) throw Error(text.batchSource);
  // 勾选按当前网格顺序复制；不能静默忽略缺失身份，也不能只追加合法子集。
  const selected = rows.filter(row => ids.has(row.id));
  if (selected.length !== ids.size || selected.some(row => row.inserted || row.deleted || !row.original)) throw Error(text.batchSelection);
  const refs = new Set<string>();
  for (const row of selected) {
    if (source?.status === 'ready') {
      const ref = source.rowRefs[originals.indexOf(row)];
      if (typeof ref !== 'string' || !ref || refs.has(ref)) throw Error(text.batchSource); refs.add(ref);
    }
    fields(row.data); fields(row.original);
    const reason = recordDuplicateReadonlyReason(context, row); if (reason) throw Error(reason);
    for (const key of context.info!.editableKey) cellBytes(row.original![key]);
  }
  const columns = context.info!.columns.filter(column => !column.generated && !/\bauto_increment\b/i.test(column.extra));
  if (context.info!.columns.length > limits.columns || selected.length * columns.length > limits.cells) throw Error(text.batchLimit);
  // JSON字节预算包含字段名、容器和逗号；不构造SQL或JSON序列化整批值。
  const names = new Set<string>(); let rowOverhead = 2;
  for (const column of columns) {
    if (!column.name || column.name.length > 64 || names.has(column.name)) throw Error(text.batchValue);
    names.add(column.name); rowOverhead += stringBytes(column.name).json + 2;
  }
  let bytes = 2, historyBytes = 128;
  for (const row of selected) {
    bytes += rowOverhead + 1;
    const entries = columns.map(column => {
      const value = row.data[column.name]; cellBytes(row.original![column.name]);
      bytes += cellBytes(value); if (bytes > limits.inputBytes) throw Error(text.batchLimit);
      return [column.name, value] as [string, CellValue];
    });
    // 使用既有历史成本和身份最大长度作保守预检，确保整批发布仍可一步撤销。
    historyBytes += addedDraftHistoryBytes({ id: 'x'.repeat(200), data: Object.fromEntries(entries), inserted: true, deleted: false });
    if (historyBytes > draftHistoryLimits.bytes) throw Error(text.batchLimit);
  }
  // 所有行通过后才消耗身份，身份全部通过后才克隆；任何异常均未发布部分数组。
  const generated = selected.map(() => {
    const id = newId(); if (!id || id.length > 200 || allIds.has(id)) throw Error(text.changed);
    allIds.add(id); return id;
  });
  const added = selected.map((row, index) => duplicateRecordDraft([row], row.id, context, generated[index])[1]);
  return { rows: [...rows, ...added], ids: generated };
}
