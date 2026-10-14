import type { ColumnInfo, DataRow } from '../shared/contracts';
import { boundedUtf8Bytes, lexicalNodeAtPath, parseJsonLexicalTree, type LexicalDocument, type LexicalPathSegment, type ReadyLexicalDocument } from './jsonLexicalTree';

/** 纯只读候选身份，不向显示/复制文档附加 original、连接或内部行定位信息。 */
export interface ProjectionIdentity {
  readonly target: string; readonly connectionVersion: number; readonly generation: number; readonly metadata: string;
  readonly rowId: string; readonly data: DataRow; readonly original?: DataRow; readonly inserted: boolean; readonly deleted: boolean;
}
export type ProjectionValue =
  | Readonly<{ kind: 'string' | 'json-text'; text: string }>
  | Readonly<{ kind: 'number'; text: string; representation: 'javascript-number' }>
  | Readonly<{ kind: 'boolean'; value: boolean }>
  | Readonly<{ kind: 'null' | 'default' | 'generated-pending' }>
  | Readonly<{ kind: 'binary'; encoding: 'base64'; bytes: number; text: string }>;
export interface ProjectionField { readonly name: string; readonly sqlType: string; readonly hidden: boolean; readonly value: ProjectionValue }
export interface RecordProjectionDocument { readonly format: 'DBArk-record-view'; readonly version: 1; readonly complete: true; readonly fields: readonly ProjectionField[] }
export type ProjectionFailure = Readonly<{ status: 'limited' | 'unavailable'; columnName?: string; reason: string }>;
export type ProjectionBuildResult = Readonly<{ status: 'ready'; document: RecordProjectionDocument; text: string; outputBytes: number }> | ProjectionFailure;
export interface ProjectionSummaryField { readonly name: string; readonly sqlType: string; readonly hidden: boolean; readonly kind: ProjectionValue['kind'] | 'unavailable'; readonly preview: string; readonly truncated: boolean; readonly encoding?: 'base64'; readonly bytes?: number; readonly reason?: string }
export type ProjectionSummary = Readonly<{ status: 'ready'; complete: boolean; fields: readonly ProjectionSummaryField[] }> | ProjectionFailure;
export const recordProjectionLimits = Object.freeze({ fields: 4096, metadataUnits: 1_048_576, summaryUnits: 240, outputBytes: 2 * 1024 * 1024, binaryInputUnits: 16 * 1024 * 1024, inputUnits: 16 * 1024 * 1024 });
type RowSource = Pick<ProjectionIdentity, 'data' | 'inserted'>;
class ProjectionError extends Error { constructor(readonly status: 'limited' | 'unavailable', reason: string, readonly columnName?: string) { super(reason); } }
const unavailable = (reason: string, name?: string): never => { throw new ProjectionError('unavailable', reason, name); };

/** 同行同值不等于同一快照；引用、代次、行身份和删除状态均参与失效判断。 */
export function sameProjectionIdentity(left: ProjectionIdentity, right: ProjectionIdentity): boolean {
  return left.target === right.target && left.connectionVersion === right.connectionVersion && left.generation === right.generation && left.metadata === right.metadata && left.rowId === right.rowId && left.data === right.data && left.original === right.original && left.inserted === right.inserted && left.deleted === right.deleted;
}
/** 结构路径不能移植到等值新文档或另一行；列名作为精确原子而不是访问表达式。 */
export function resolveProjectionPath(current: ProjectionIdentity, columnName: string, document: ReadyLexicalDocument, path: { identity: ProjectionIdentity; columnName: string; document: ReadyLexicalDocument; segments: readonly LexicalPathSegment[] }) {
  if (!sameProjectionIdentity(current, path.identity) || path.columnName !== columnName) return undefined;
  return lexicalNodeAtPath(document, path);
}
/** 只读自有 data descriptor；未知对象不会通过 getter、toJSON 或原型链读取值。 */
function ownValue(object: object, key: string, columnName?: string): { present: boolean; value: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return { present: false, value: undefined };
  if (!('value' in descriptor)) unavailable('投影不能执行访问器', columnName);
  return { present: true, value: descriptor.value };
}
/** 普通对象或 null 原型记录符合 IPC 行契约，其余实例不能伪装为记录。 */
function plain(object: unknown): object {
  if (!object || typeof object !== 'object' || Array.isArray(object) || ![Object.prototype, null].includes(Object.getPrototypeOf(object))) return unavailable('投影值不是普通数据对象');
  if (Object.getOwnPropertySymbols(object).length) return unavailable('投影对象不能含 Symbol 字段');
  return object;
}
/** 规范 Base64 逐字符验证、校验 padding 未使用位；不解码全量字节。 */
export function canonicalBinaryBytes(base64: string): number {
  if (base64.length > recordProjectionLimits.binaryInputUnits) throw new ProjectionError('limited', '二进制源超过有界检查预算');
  if (base64.length % 4 !== 0) return unavailable('二进制 Base64 长度非法');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let last = 0;
  for (let i = 0; i < base64.length - padding; i++) { last = alphabet.indexOf(base64[i]); if (last < 0) return unavailable('二进制 Base64 字符非法'); }
  if (padding && (!base64.length || padding === 2 && (last & 15) !== 0 || padding === 1 && (last & 3) !== 0)) return unavailable('二进制 Base64 padding 非规范');
  return base64.length / 4 * 3 - padding;
}

/** 精确 SQL 类型 json 才自动标记；Maria LONGTEXT 或名称含 json 的普通列不猜测。 */
function projectValue(data: object, inserted: boolean, column: { name: string; type: string; generated: boolean }, remainingSource: number): ProjectionValue {
  const own = ownValue(data, column.name, column.name);
  if (!own.present) {
    if (!inserted) return unavailable('已有记录缺少当前字段', column.name);
    return Object.freeze({ kind: column.generated ? 'generated-pending' : 'default' });
  }
  const value = own.value;
  if (value === undefined) return unavailable('自有 undefined 不是合法单元格值', column.name);
  if (value === null) return Object.freeze({ kind: 'null' });
  if (typeof value === 'string') {
    if (value.length > remainingSource) throw new ProjectionError('limited', '活动行源文本超过投影预算', column.name);
    return Object.freeze({ kind: column.type.toLowerCase() === 'json' ? 'json-text' : 'string', text: value });
  }
  if (typeof value === 'boolean') return Object.freeze({ kind: 'boolean', value });
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return unavailable('非有限数不能完整投影', column.name);
    return Object.freeze({ kind: 'number', text: Object.is(value, -0) ? '-0' : String(value), representation: 'javascript-number' });
  }
  const object = plain(value); const keys = Object.getOwnPropertyNames(object);
  if (keys.length !== 2 || !keys.includes('type') || !keys.includes('base64')) return unavailable('未知对象不是二进制单元格', column.name);
  const type = ownValue(object, 'type', column.name), base64 = ownValue(object, 'base64', column.name);
  if (type.value !== 'binary' || typeof base64.value !== 'string') return unavailable('二进制单元格类型不合法', column.name);
  if (base64.value.length > remainingSource) throw new ProjectionError('limited', '活动行源文本超过投影预算', column.name);
  return Object.freeze({ kind: 'binary', encoding: 'base64', bytes: canonicalBinaryBytes(base64.value), text: base64.value });
}

/** 元数据顺序决定输出，拒绝重复列与未纳入元数据的行字段，不静默遗漏整行内容。 */
function prepare(row: RowSource, columns: readonly ColumnInfo[]) {
  if (columns.length > recordProjectionLimits.fields) throw new ProjectionError('limited', '字段数超过投影预算');
  const data = plain(row.data); const names = new Set<string>(); let metadataUnits = 0;
  const metadata = columns.map(column => {
    const object = plain(column); const name = ownValue(object, 'name').value; const type = ownValue(object, 'type').value; const generated = ownValue(object, 'generated').value;
    if (typeof name !== 'string' || typeof type !== 'string' || typeof generated !== 'boolean' || names.has(name)) return unavailable('列元数据缺失、重复或类型非法');
    if (name.length > 1024 || type.length > 65_536) throw new ProjectionError('limited', '列元数据文本超过预算', name);
    metadataUnits += name.length + type.length;
    if (metadataUnits > recordProjectionLimits.metadataUnits) throw new ProjectionError('limited', '列元数据累计文本超过预算', name);
    names.add(name); return { name, type, generated };
  });
  const keys = Object.getOwnPropertyNames(data);
  if (keys.length > recordProjectionLimits.fields) throw new ProjectionError('limited', '行自有字段数超过预算');
  if (keys.some(key => !names.has(key))) return unavailable('记录含未纳入列元数据的字段');
  if (typeof row.inserted !== 'boolean') return unavailable('新增记录标记缺失');
  return { data, metadata };
}
/** 错误结果没有 document/部分完整 JSON；摘要中的 unavailable 则明确标记单列不可确认。 */
function failure(error: unknown): ProjectionFailure {
  if (!(error instanceof ProjectionError)) throw error;
  return Object.freeze({ status: error.status, reason: error.message, ...(error.columnName === undefined ? {} : { columnName: error.columnName }) });
}

/** 摘要默认不解析 JSON、不解码 BLOB，仅保存有界前缀；全文复制必须另走完整预算。 */
export function buildRecordSummary(row: RowSource, columns: readonly ColumnInfo[], hidden: ReadonlySet<string> = new Set()): ProjectionSummary {
  try {
    const { data, metadata } = prepare(row, columns); let complete = true; let inputUnits = 0;
    const fields = metadata.map(column => {
      try {
        const value = projectValue(data, row.inserted, column, recordProjectionLimits.inputUnits - inputUnits); const source = 'text' in value ? value.text : value.kind === 'boolean' ? String(value.value) : value.kind;
        inputUnits += source.length; if (inputUnits > recordProjectionLimits.inputUnits) throw new ProjectionError('limited', '活动行源文本超过投影预算', column.name);
        const limit = value.kind === 'binary' ? 64 : recordProjectionLimits.summaryUnits;
        return Object.freeze({ name: column.name, sqlType: column.type, hidden: hidden.has(column.name), kind: value.kind, preview: source.slice(0, limit), truncated: source.length > limit, ...(value.kind === 'binary' ? { encoding: 'base64' as const, bytes: value.bytes } : {}) });
      } catch (error) {
        const result = failure(error); if (result.status === 'limited') throw error; complete = false;
        return Object.freeze({ name: column.name, sqlType: column.type, hidden: hidden.has(column.name), kind: 'unavailable' as const, preview: '', truncated: false, reason: result.reason });
      }
    });
    return Object.freeze({ status: 'ready', complete, fields: Object.freeze(fields) });
  } catch (error) { return failure(error); }
}

/** 精确计算 JSON 字符串 token 转义后的 UTF-8 字节，孤立 surrogate 按六字节转义保留。 */
function quotedBytes(text: string, remaining: number): number {
  let bytes = 2;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) bytes += 2;
    else if (code < 32) bytes += 6;
    else if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
    else bytes += 3;
    if (bytes > remaining) throw new ProjectionError('limited', '完整投影超过转义后 UTF-8 字节预算');
  }
  if (bytes > remaining) throw new ProjectionError('limited', '完整投影超过转义后 UTF-8 字节预算');
  return bytes;
}
/** 只遍历本模块创建的封闭结构；先精确计费，最后才 JSON.stringify，不对未知原始行 stringify。 */
function encodedBytes(value: unknown, maximum: number): number {
  let used = 0;
  const charge = (bytes: number) => { used += bytes; if (used > maximum) throw new ProjectionError('limited', '完整投影超过转义后 UTF-8 字节预算'); };
  function visit(item: unknown): void {
    if (typeof item === 'string') { charge(quotedBytes(item, maximum - used)); return; }
    if (typeof item === 'boolean') { charge(item ? 4 : 5); return; }
    if (typeof item === 'number') { charge(String(item).length); return; }
    if (Array.isArray(item)) { charge(2 + Math.max(0, item.length - 1)); item.forEach(visit); return; }
    if (item && typeof item === 'object') {
      const entries = Object.entries(item); charge(2 + Math.max(0, entries.length - 1));
      for (const [key, content] of entries) { charge(quotedBytes(key, maximum - used) + 1); visit(content); } return;
    }
    throw new Error('内部类型化投影出现未定义的值');
  }
  visit(value); return used;
}

/** 完整 JSON 为只读显示格式；不是导入协议，不接收 original、SQL 或任何写回操作。 */
export function buildRecordProjection(row: RowSource, columns: readonly ColumnInfo[], hidden: ReadonlySet<string> = new Set(), maximumBytes = recordProjectionLimits.outputBytes): ProjectionBuildResult {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > recordProjectionLimits.outputBytes) throw new Error('完整投影预算只能降低');
  try {
    const { data, metadata } = prepare(row, columns); let inputUnits = 0;
    const fields = metadata.map(column => {
      const value = projectValue(data, row.inserted, column, recordProjectionLimits.inputUnits - inputUnits); inputUnits += 'text' in value ? value.text.length : 0;
      if (inputUnits > recordProjectionLimits.inputUnits) throw new ProjectionError('limited', '活动行源文本超过投影预算', column.name);
      return Object.freeze({ name: column.name, sqlType: column.type, hidden: hidden.has(column.name), value });
    });
    const document: RecordProjectionDocument = Object.freeze({ format: 'DBArk-record-view', version: 1, complete: true, fields: Object.freeze(fields) });
    const outputBytes = encodedBytes(document, maximumBytes);
    return Object.freeze({ status: 'ready', document, text: JSON.stringify(document), outputBytes });
  } catch (error) { return failure(error); }
}

/** 单活动行按需缓存；新身份立刻释放旧源引用，不缓存整页或未暂存字段输入。 */
export class RecordJsonTreeCache {
  private identity?: ProjectionIdentity;
  private readonly documents = new Map<string, ReadyLexicalDocument>();
  private bytes = 0;
  private nodes = 0;
  /** 公开只读计数用于预算验收，不把缓存峰值写死为常数。 */
  get usage() { return Object.freeze({ fields: this.documents.size, sourceBytes: this.bytes, nodes: this.nodes }); }
  /** 换页、关闭面板或显示目标失效时明确释放全部文档引用。 */
  clear() { this.documents.clear(); this.identity = undefined; this.bytes = 0; this.nodes = 0; }
  /** 仅精确 JSON 类型或明确“按 JSON 查看”才解析，其他普通字符串默认保持原文。 */
  read(identity: ProjectionIdentity, column: ColumnInfo, explicit = false): LexicalDocument | ProjectionFailure {
    if (!this.identity || !sameProjectionIdentity(this.identity, identity)) { this.clear(); this.identity = Object.freeze({ ...identity }); }
    try {
      const object = plain(column); const name = ownValue(object, 'name').value; const type = ownValue(object, 'type').value;
      if (typeof name !== 'string' || typeof type !== 'string') return unavailable('JSON 查看缺少可信列元数据');
      if (type.toLowerCase() !== 'json' && !explicit) return unavailable('此列不是已确认 JSON 类型；需明确按 JSON 查看', name);
      const own = ownValue(plain(identity.data), name, name);
      if (!own.present || typeof own.value !== 'string') return unavailable('只有当前草稿中的真实字符串可以按 JSON 查看', name);
      const previous = this.documents.get(name); if (previous) return previous;
      if (own.value.length > 262_144 || this.nodes >= 16_384) return Object.freeze({ status: 'limited', reason: '单字段原文或活动行节点超过预算', columnName: name });
      const sourceBytes = boundedUtf8Bytes(own.value, Math.min(262_144, 1_048_576 - this.bytes));
      if (sourceBytes === undefined) return Object.freeze({ status: 'limited', reason: '单字段或活动行 JSON 原文超过字节预算', columnName: name });
      const document = parseJsonLexicalTree(own.value, { nodes: Math.max(1, Math.min(8192, 16_384 - this.nodes)) });
      if (document.status !== 'ready') return document;
      if (this.nodes + document.nodes.length > 16_384) return Object.freeze({ status: 'limited', reason: '活动行 JSON 节点超过预算', columnName: name });
      this.documents.set(name, document); this.bytes += document.sourceBytes; this.nodes += document.nodes.length;
      return document;
    } catch (error) { return failure(error); }
  }
}
