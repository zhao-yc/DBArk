import type { CellValue, DataRow, RowChange } from './contracts';
import { tableDraftZh as text } from './tableDraft.zh-CN';

export interface TableDraftTarget { connectionId: string; database: string; table: string }
export interface TableDraftPayload { target: TableDraftTarget; metadataKey: string; changes: RowChange[] }
export interface TableDraftDocument extends TableDraftPayload { kind: 'dbark.table-draft'; version: 1; endpointKey: string }
export const tableDraftLimits = { bytes: 8 * 1024 * 1024, changes: 1000, columns: 1024, cellBytes: 256 * 1024, metadataBytes: 2 * 1024 * 1024, cells: 200000 } as const;
type WireCell = Exclude<CellValue, number> | { type: 'number'; text: string };
type Budget = { bytes: number; cells: number };
const invalid = (): never => { throw Error(text.invalid); };
const large = (): never => { throw Error(text.tooLarge); };

/** 所有不可信字段均从自有数据描述符读取，不执行访问器。 */
function own(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return invalid();
  return descriptor.value;
}

/** 普通对象、精确字段和自有可枚举值是文件与 IPC 的共同边界。 */
function record(value: unknown, fields?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const keys = Reflect.ownKeys(value);
  if (fields && (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key)))) return invalid();
  for (const key of keys) { if (typeof key !== 'string') return invalid(); own(value, key); }
  return value as Record<string, unknown>;
}

/** 数组拒绝空洞、继承索引及额外属性，先限长度再遍历。 */
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0) return invalid();
  if (length > maximum) return large();
  if (Reflect.ownKeys(value).length !== length + 1) return invalid();
  for (let index = 0; index < length; index++) own(value, String(index));
  return value;
}

/** 逐码元测量 UTF-8 与 JSON 转义字节，不先分配超大编码缓冲。 */
function stringSize(value: string, maximum: number, escaped: boolean): number {
  if (value.length > maximum) return large();
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index++; }
      else bytes += escaped ? 6 : 3;
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes += escaped ? 6 : 3;
    else if (escaped && (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code))) bytes += 2;
    else if (escaped && code < 32) bytes += 6;
    else bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    if (bytes > maximum) return large();
  }
  return bytes;
}

/** 累积预算在克隆下一单元格前生效，限制中间对象分配。 */
function add(budget: Budget, bytes: number): void { budget.bytes += bytes; if (budget.bytes > tableDraftLimits.bytes) large(); }
function string(value: unknown, maximum: number, budget: Budget, nonempty = false): string {
  if (typeof value !== 'string' || nonempty && value.length === 0) return invalid();
  stringSize(value, maximum, false); add(budget, stringSize(value, tableDraftLimits.bytes, true) + 2);
  return value;
}

/** 标准 Base64 严格校验填充比特；空串表示零字节而非 NULL。 */
function binary(value: unknown, budget: Budget): { type: 'binary'; base64: string } {
  const source = record(value, ['type', 'base64']);
  if (own(source, 'type') !== 'binary') return invalid();
  const base64 = string(own(source, 'base64'), tableDraftLimits.cellBytes, budget);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) return invalid();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (base64.endsWith('==') && (alphabet.indexOf(base64[base64.length - 3]) & 15) !== 0) return invalid();
  if (!base64.endsWith('==') && base64.endsWith('=') && (alphabet.indexOf(base64[base64.length - 2]) & 3) !== 0) return invalid();
  return { type: 'binary', base64 };
}

/** 文件数值必须显式标记；Number 的唯一最短往返串之外仅接受负零。 */
function cell(value: unknown, budget: Budget, wire: boolean): CellValue {
  if (++budget.cells > tableDraftLimits.cells) return large();
  if (value === null || typeof value === 'boolean') { add(budget, value === null ? 4 : value ? 4 : 5); return value; }
  if (typeof value === 'string') return string(value, tableDraftLimits.cellBytes, budget);
  if (!wire && typeof value === 'number') {
    if (!Number.isFinite(value)) return invalid();
    add(budget, String(value).length); return value;
  }
  const source = record(value);
  if (own(source, 'type') === 'binary') return binary(source, budget);
  if (wire && own(source, 'type') === 'number') {
    record(source, ['type', 'text']);
    const valueText = string(own(source, 'text'), 32, budget), number = Number(valueText);
    if (!Number.isFinite(number) || valueText !== '-0' && String(number) !== valueText) return invalid();
    return number;
  }
  return invalid();
}

/** 行按精确自有字段安全重建；缺省字段保持 DEFAULT，不转换为 NULL。 */
function row(value: unknown, budget: Budget, wire: boolean): DataRow {
  const source = record(value), keys = Object.keys(source);
  if (keys.length > tableDraftLimits.columns) return large();
  add(budget, 2 + Math.max(0, keys.length - 1));
  return Object.fromEntries(keys.map(key => {
    if (!key || key.includes('\0')) return invalid();
    string(key, 1024, budget); add(budget, 1);
    return [key, cell(own(source, key), budget, wire)];
  }));
}

/** 目标不包含地址、密码或密钥；端点摘要由主进程另行绑定。 */
function target(value: unknown, budget: Budget): TableDraftTarget {
  const source = record(value, ['connectionId', 'database', 'table']);
  const field = (key: string, limit: number) => {
    const result = string(own(source, key), limit, budget, true);
    if (result.includes('\0')) return invalid();
    return result;
  };
  return { connectionId: field('connectionId', 200), database: field('database', 1024), table: field('table', 1024) };
}

/** 严格逐项复制变更，任何坏记录都拒绝整份文件，不能部分恢复。 */
function payload(value: unknown, document: boolean, wire: boolean): TableDraftPayload | TableDraftDocument {
  const source = record(value, document ? ['kind', 'version', 'endpointKey', 'target', 'metadataKey', 'changes'] : ['target', 'metadataKey', 'changes']);
  const budget: Budget = { bytes: 0, cells: 0 };
  const selectedTarget = target(own(source, 'target'), budget);
  const metadataKey = string(own(source, 'metadataKey'), tableDraftLimits.metadataBytes, budget, true);
  const inputs = array(own(source, 'changes'), tableDraftLimits.changes);
  if (!inputs.length) return invalid();
  const changes = inputs.map((value): RowChange => {
    const candidate = record(value), kind = own(candidate, 'kind');
    if (kind === 'insert') { record(candidate, ['kind', 'values']); return { kind, values: row(own(candidate, 'values'), budget, wire) }; }
    if (kind === 'delete') { record(candidate, ['kind', 'before']); return { kind, before: row(own(candidate, 'before'), budget, wire) }; }
    if (kind === 'update') { record(candidate, ['kind', 'before', 'values']); const before = row(own(candidate, 'before'), budget, wire), values = row(own(candidate, 'values'), budget, wire); if (!Object.keys(values).length) return invalid(); return { kind, before, values }; }
    return invalid();
  });
  const result: TableDraftPayload = { target: selectedTarget, metadataKey, changes };
  if (!document) { assertEncodedSize(toWire({ ...result, kind: 'dbark.table-draft', version: 1, endpointKey: '0'.repeat(64) })); return result; }
  if (own(source, 'kind') !== 'dbark.table-draft' || own(source, 'version') !== 1) return invalid();
  const endpointKey = own(source, 'endpointKey');
  if (typeof endpointKey !== 'string' || !/^[a-f0-9]{64}$/.test(endpointKey)) return invalid();
  const full: TableDraftDocument = { ...result, kind: 'dbark.table-draft', version: 1, endpointKey };
  assertEncodedSize(toWire(full)); return full;
}

/** 数字标签仅用于磁盘文档，内存契约仍使用原 CellValue。 */
function toWire(document: TableDraftDocument) {
  const convert = (source: DataRow) => Object.fromEntries(Object.entries(source).map(([key, value]): [string, WireCell] => [key, typeof value === 'number' ? { type: 'number', text: Object.is(value, -0) ? '-0' : String(value) } : value]));
  return { ...document, changes: document.changes.map(change => change.kind === 'insert' ? { kind: change.kind, values: convert(change.values) } : change.kind === 'delete' ? { kind: change.kind, before: convert(change.before) } : { kind: change.kind, before: convert(change.before), values: convert(change.values) }) };
}

/** 只测量已净化对象的精确 JSON 字节，包含所有属性名、分隔符和转义。 */
function assertEncodedSize(value: unknown): void {
  let bytes = 0;
  const visit = (item: unknown): void => {
    if (item === null) bytes += 4;
    else if (typeof item === 'boolean') bytes += item ? 4 : 5;
    else if (typeof item === 'number') bytes += String(item).length;
    else if (typeof item === 'string') bytes += stringSize(item, tableDraftLimits.bytes, true) + 2;
    else if (Array.isArray(item)) { bytes += 2 + Math.max(0, item.length - 1); for (const child of item) visit(child); }
    else if (item && typeof item === 'object') { const entries = Object.entries(item); bytes += 2 + Math.max(0, entries.length - 1); for (const [key, child] of entries) { bytes += stringSize(key, tableDraftLimits.bytes, true) + 3; visit(child); } }
    else return invalid();
    if (bytes > tableDraftLimits.bytes) large();
  };
  visit(value);
}

/** IPC 捕获输入只接纳普通运行时值，并返回不共享行或字节包装的副本。 */
export function parseTableDraftPayload(value: unknown): TableDraftPayload { return payload(value, false, false) as TableDraftPayload; }
/** 主进程文件与复核命令共用严格目标解析，不能通过继承字段改写连接目标。 */
export function parseTableDraftTarget(value: unknown): TableDraftTarget { return target(value, { bytes: 0, cells: 0 }); }
/** 打开的文档输出仍采用运行时值；标签对象只允许通过磁盘解码入口。 */
export function parseTableDraftDocument(value: unknown): TableDraftDocument { return payload(value, true, false) as TableDraftDocument; }
/** 先完成严格校验及预算，再序列化有界文档，不增加换行突破字节上限。 */
export function encodeTableDraft(document: TableDraftDocument): string { return JSON.stringify(toWire(parseTableDraftDocument(document))); }
/** 先限制原始 UTF-8 字节再解析，裸数值和未知文档版本均拒绝。 */
export function decodeTableDraft(value: string): TableDraftDocument {
  if (typeof value !== 'string') return invalid();
  stringSize(value, tableDraftLimits.bytes, false);
  let decoded: unknown;
  try { decoded = JSON.parse(value); } catch { return invalid(); }
  return payload(decoded, true, true) as TableDraftDocument;
}
