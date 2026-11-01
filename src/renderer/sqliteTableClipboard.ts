import { encodeClipboard, decodeClipboard, cellClipboardType, type ClipboardCell } from './gridClipboard';
import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { sqliteEditValueSchema, type SqliteOriginalValue } from '../shared/sqliteTableEdit';
import { sqliteTableClipboardZh as text } from './locales/sqliteTableClipboard.zh-CN';

export const sqliteCellClipboardType = 'application/x-dbark-sqlite-cells';
export const sqliteClipboardLimits = { copyRows: 1000, pasteRows: 500, cells: 10000, bytes: 2 * 1024 * 1024, valueUnits: 65536, columns: 1024, types: 64 } as const;
export type SqliteClipboardCell = SqliteOriginalValue | undefined;
export interface SqliteClipboardSource { values: SqliteClipboardCell[][]; plain: boolean; text: string; columns?: string[]; }
export interface SqliteClipboardContent { text: string; typed: string; sqlite: string; }
export type SqlitePasteKind = 'preserve' | 'text' | 'integer' | 'real' | 'blob' | 'null' | 'default';
export interface SqlitePasteColumnMapping { column: string | null; kind: SqlitePasteKind; }
export type SqlitePasteMapping = SqlitePasteColumnMapping[];
export interface SqlitePastePlan { readonly rows: number; readonly width: number; }
interface ClipboardRead { readonly types: ArrayLike<string> | Iterable<string>; getData(type: string): string; }
interface ClipboardWrite { setData(type: string, value: string): void; }
const encoder = new TextEncoder(), fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
const kinds = ['preserve', 'text', 'integer', 'real', 'blob', 'null', 'default'] as const;
const plans = new WeakMap<SqlitePastePlan, { page: SqliteTablePage; schema: string; values: SqliteClipboardCell[][] }>();
/** Unicode原文必须能完整往返；NUL在TEXT中保持，不可变成截断或替换字符。 */
function validUnicode(value: string): boolean { return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value); }
/** JSON解析前限制原文UTF8预算，不先为巨大输入创建整组单元格。 */
function rawText(value: unknown): string { if (typeof value !== 'string') throw Error(text.invalid); if (value.length > sqliteClipboardLimits.bytes || encoder.encode(value).byteLength > sqliteClipboardLimits.bytes) throw Error(text.tooLarge); if (!validUnicode(value)) throw Error(text.unicode); return value; }
/** 只读取自有可枚举数据属性，拒访问器、类实例和额外能力字段。 */
function object(raw: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw Error(text.invalid);
  const actual = Reflect.ownKeys(raw); if (actual.length < keys.length || actual.length > keys.length + optional.length || keys.some(key => !Object.hasOwn(raw, key)) || actual.some(key => typeof key !== 'string' || !keys.includes(key) && !optional.includes(key))) throw Error(text.invalid);
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of [...keys, ...optional.filter(key => Object.hasOwn(raw, key))]) { const descriptor = Object.getOwnPropertyDescriptor(raw, key); if (!descriptor?.enumerable || !('value' in descriptor)) throw Error(text.invalid); result[key] = descriptor.value; }
  return result;
}
/** 数组先核长度和完整索引，再复制，稀疏数组和getter均不能变成空值。 */
function array(raw: unknown, maximum: number): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > maximum || Reflect.ownKeys(raw).length !== raw.length + 1) throw Error(text.invalid);
  const values: unknown[] = []; for (let index = 0; index < raw.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(raw, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) throw Error(text.invalid); values.push(descriptor.value); } return values;
}
/** 原生值可含真实无穷REAL用于复制展示；新草稿会再次走有限值合同。 */
function nativeCell(raw: unknown, defaultPacket = false): SqliteClipboardCell {
  if (raw === undefined && !defaultPacket) return undefined;
  if (!raw || typeof raw !== 'object') throw Error(text.invalid);
  const descriptor = Object.getOwnPropertyDescriptor(raw, 'kind'); if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') throw Error(text.invalid);
  const kind = descriptor.value, value = object(raw, kind === 'null' || kind === 'default' ? ['kind'] : ['kind', 'value']);
  if (kind === 'default' && defaultPacket) return undefined; if (kind === 'null') return { kind: 'null' };
  if (!['text', 'integer', 'real', 'blob'].includes(kind) || typeof value.value !== 'string') throw Error(text.invalid);
  const body = value.value; if (body.length > sqliteClipboardLimits.valueUnits) throw Error(text.valueLimit); if (!validUnicode(body)) throw Error(text.unicode);
  if (kind === 'integer') { if (!/^-?(?:0|[1-9][0-9]*)$/.test(body) || body.length > 20 || BigInt(body) < -9223372036854775808n || BigInt(body) > 9223372036854775807n) throw Error(text.invalid); }
  if (kind === 'real' && (!['Infinity', '-Infinity'].includes(body) && (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(body) || body.length > 64 || !Number.isFinite(Number(body))))) throw Error(text.invalid);
  if (kind === 'blob' && !/^(?:[0-9a-fA-F]{2})*$/.test(body)) throw Error(text.invalid);
  return { kind: kind as 'text' | 'integer' | 'real' | 'blob', value: body };
}
/** 复制与粘贴行数分开；先核矩形及总格数，再逐格解析，不在未知输入上map。 */
function matrix(raw: unknown, maximum: number, packet = false): SqliteClipboardCell[][] {
  const rows = array(raw, maximum); if (!rows.length) throw Error(text.invalid); let width: number | undefined, cells = 0, bytes = 0; const output: SqliteClipboardCell[][] = [];
  for (const rawRow of rows) { const row = array(rawRow, sqliteClipboardLimits.columns); if (!row.length || width !== undefined && row.length !== width) throw Error(text.ragged); width = row.length; cells += row.length; if (cells > sqliteClipboardLimits.cells) throw Error(text.cellLimit);
    const parsed: SqliteClipboardCell[] = []; for (const rawCell of row) { const cell = nativeCell(rawCell, packet); bytes += encoder.encode(JSON.stringify(cell ?? { kind: 'default' })).byteLength + 1; if (bytes > sqliteClipboardLimits.bytes) throw Error(text.tooLarge); parsed.push(cell); } output.push(parsed);
  } return output;
}
/** 可选来源列名只建议映射，不授予可写资格；同名规则与SQLite一致按ASCII查重。 */
function sourceColumnNames(raw: unknown, width: number): string[] {
  const values = array(raw, sqliteClipboardLimits.columns); if (values.length !== width) throw Error(text.mappingInvalid); const seen = new Set<string>();
  return values.map(value => { if (typeof value !== 'string' || !value || value.length > 512 || value.includes('\0') || !validUnicode(value) || seen.has(fold(value))) throw Error(text.mappingInvalid); seen.add(fold(value)); return value; });
}
/** 通用MIME保兼容，int64与REAL仍按原文字串交给非SQLite网格，不经过Number。 */
function genericCell(value: SqliteClipboardCell): ClipboardCell { if (value === undefined) return undefined; if (value.kind === 'null') return null; if (value.kind === 'blob') { let binary = ''; for (let index = 0; index < value.value.length; index += 2) binary += String.fromCharCode(parseInt(value.value.slice(index, index + 2), 16)); return { type: 'binary', base64: btoa(binary) }; } return value.value; }
/** 原页最多1000行可复制；三种格式分别受2MiB限制，原生MIME完整区分NULL和DEFAULT。 */
export function encodeSqliteClipboard(input: readonly (readonly SqliteClipboardCell[])[], columns?: readonly string[]): SqliteClipboardContent {
  if (Array.isArray(input) && input.length > sqliteClipboardLimits.copyRows) throw Error(text.copyRowLimit); const values = matrix(input, sqliteClipboardLimits.copyRows), names = columns === undefined ? undefined : sourceColumnNames(columns, values[0].length), generic = encodeClipboard(values.map(row => row.map(genericCell))), sqlite = JSON.stringify({ version: 1, rows: values.map(row => row.map(value => value ?? { kind: 'default' })), ...(names ? { columns: names } : {}) });
  return { text: rawText(generic.text), typed: rawText(generic.typed), sqlite: rawText(sqlite) };
}
/** 浏览器copy事件内同步写三MIME；不能await后再依赖已结束的原事件。 */
export function writeSqliteClipboardData(data: ClipboardWrite, content: SqliteClipboardContent): void { const value = object(content, ['text', 'typed', 'sqlite']); const plain = rawText(value.text), typed = rawText(value.typed), sqlite = rawText(value.sqlite); data.setData('text/plain', plain); data.setData(cellClipboardType, typed); data.setData(sqliteCellClipboardType, sqlite); }
/** 通用格式的每格只保声明类型；有限安全整数/布尔按INTEGER，BLOB按准确Base64字节转Hex。 */
function fromGeneric(value: ClipboardCell): SqliteClipboardCell {
  if (value === undefined) return undefined; if (value === null) return { kind: 'null' }; if (typeof value === 'string') return nativeCell({ kind: 'text', value }); if (typeof value === 'boolean') return { kind: 'integer', value: value ? '1' : '0' };
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw Error(text.conversionInvalid); return { kind: Number.isSafeInteger(value) && !Object.is(value, -0) ? 'integer' : 'real', value: Object.is(value, -0) ? '-0' : String(value) }; }
  const binary = object(value, ['type', 'base64']); if (binary.type !== 'binary' || typeof binary.base64 !== 'string' || binary.base64.length > 65536 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(binary.base64)) throw Error(text.invalid);
  let decoded: string; try { decoded = atob(binary.base64); } catch { throw Error(text.invalid); } if (btoa(decoded) !== binary.base64) throw Error(text.invalid); return nativeCell({ kind: 'blob', value: [...decoded].map(byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('') });
}
/** 普通TSV沿通用引号语法解析，但逐字符和逐分隔符先核更小的SQLite粘贴预算。 */
function plainValues(source: string): SqliteClipboardCell[][] {
  const result: SqliteClipboardCell[][] = []; let row: SqliteClipboardCell[] = [], value = '', quoted = false, cells = 0, width: number | undefined;
  const append = (character: string) => { if (value.length + character.length > sqliteClipboardLimits.valueUnits) throw Error(text.valueLimit); value += character; };
  const cell = () => { if (++cells > sqliteClipboardLimits.cells || row.length >= sqliteClipboardLimits.columns) throw Error(text.cellLimit); row.push({ kind: 'text', value }); value = ''; };
  const finish = () => { if (result.length >= sqliteClipboardLimits.pasteRows) throw Error(text.rowLimit); if (width !== undefined && width !== row.length) throw Error(text.ragged); width = row.length; result.push(row); row = []; };
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) { if (character === '"' && source[index + 1] === '"') { append('"'); index++; } else if (character === '"') quoted = false; else append(character); }
    else if (character === '"' && value === '') quoted = true;
    else if (character === '\t') cell();
    else if (character === '\n' || character === '\r') { cell(); finish(); if (character === '\r' && source[index + 1] === '\n') index++; }
    else append(character);
  }
  if (quoted) throw Error(text.invalid); if (value !== '' || row.length || !result.length) { cell(); finish(); } return result;
}
/** 通用typed包仍沿gridClipboard解码；先严格核外壳与格数，不能靠额外字段或巨大矩阵绕预算。 */
function genericValues(source: string, plain: string): SqliteClipboardCell[][] {
  let raw: unknown; try { raw = JSON.parse(source); } catch { throw Error(text.invalid); } const packet = object(raw, ['version', 'rows']); if (packet.version !== 1) throw Error(text.invalid);
  if (Array.isArray(packet.rows) && packet.rows.length > sqliteClipboardLimits.pasteRows) throw Error(text.rowLimit);
  const rows = array(packet.rows, sqliteClipboardLimits.pasteRows); let count = 0, width: number | undefined; if (!rows.length) throw Error(text.invalid);
  for (const rawRow of rows) { const row = array(rawRow, sqliteClipboardLimits.columns); if (!row.length || width !== undefined && width !== row.length) throw Error(text.ragged); width = row.length; count += row.length; if (count > sqliteClipboardLimits.cells) throw Error(text.cellLimit);
    for (const value of row) if (value && typeof value === 'object') { const type = Object.getOwnPropertyDescriptor(value, 'type'); if (!type || !('value' in type)) throw Error(text.invalid); const item = object(value, type.value === 'default' ? ['type'] : ['type', 'base64']); if (!['default', 'binary'].includes(item.type as string)) throw Error(text.invalid); }
  }
  const decoded = decodeClipboard(source, plain, { maximum: sqliteClipboardLimits.pasteRows, message: text.rowLimit }); return decoded.map(row => row.map(fromGeneric));
}
/** 原生MIME一旦存在则严格解析；损坏或未知版本绝不降级解释成另一种内容。 */
export function decodeSqliteClipboard(sqlite: string, generic: string, plain: string): SqliteClipboardSource {
  rawText(sqlite); rawText(generic); rawText(plain);
  if (sqlite) { try { const packet = object(JSON.parse(sqlite), ['version', 'rows'], ['columns']); if (packet.version !== 1) throw Error(text.nativeInvalid); if (!Array.isArray(packet.rows)) throw Error(text.nativeInvalid); if (packet.rows.length > sqliteClipboardLimits.pasteRows) throw Error(text.rowLimit); const values = matrix(packet.rows, sqliteClipboardLimits.pasteRows, true), columns = Object.hasOwn(packet, 'columns') ? sourceColumnNames(packet.columns, values[0].length) : undefined; return { values, plain: false, text: plain, ...(columns ? { columns } : {}) }; } catch (reason) { throw Error(reason instanceof Error && [text.rowLimit, text.cellLimit, text.tooLarge, text.valueLimit, text.ragged, text.unicode].includes(reason.message as any) ? reason.message : text.nativeInvalid); } }
  return { values: matrix(generic ? genericValues(generic, plain) : plainValues(plain), sqliteClipboardLimits.pasteRows), plain: !generic, text: plain };
}
/** 先有界枚举格式列表；重复、非字符串或超量格式不能偷偷退回普通文本。 */
function clipboardTypes(raw: unknown): string[] {
  try {
    if (!raw || typeof raw !== 'object') throw Error(text.invalid); const values: unknown[] = [];
    if (Array.isArray(raw)) values.push(...array(raw, sqliteClipboardLimits.types));
    else {
      const iteratorMethod = (raw as Iterable<unknown>)[Symbol.iterator];
      if (iteratorMethod !== undefined) {
        if (typeof iteratorMethod !== 'function') throw Error(text.invalid); const iterator = iteratorMethod.call(raw); let done = false;
        try { for (;;) { const item = iterator.next(); if (!item || typeof item !== 'object') throw Error(text.invalid); if (item.done) { done = true; break; } if (values.length >= sqliteClipboardLimits.types) throw Error(text.invalid); values.push(item.value); } }
        finally { if (!done) iterator.return?.(); }
      } else {
        const length = (raw as ArrayLike<unknown>).length; if (!Number.isInteger(length) || length < 0 || length > sqliteClipboardLimits.types) throw Error(text.invalid);
        for (let index = 0; index < length; index++) values.push((raw as ArrayLike<unknown>)[index]);
      }
    }
    const seen = new Set<string>(); if (!values.length) throw Error(text.invalid);
    return values.map(value => { if (typeof value !== 'string' || value.length > 200 || value !== 'Files' && !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(value) || seen.has(fold(value))) throw Error(text.invalid); seen.add(fold(value)); return value; });
  } catch { throw Error(text.invalid); }
}
/** types中存在但空的typed格式也视为损坏，不能借空字符串规避优先级。 */
export function readSqliteClipboard(data: ClipboardRead): SqliteClipboardSource {
  const types = clipboardTypes(data.types);
  if (types.some(type => fold(type).startsWith(sqliteCellClipboardType) && type !== sqliteCellClipboardType)) throw Error(text.nativeInvalid);
  if (types.some(type => fold(type).startsWith(cellClipboardType) && type !== cellClipboardType)) throw Error(text.invalid);
  if (types.includes(sqliteCellClipboardType)) { const sqlite = data.getData(sqliteCellClipboardType); if (!sqlite) throw Error(text.nativeInvalid); return decodeSqliteClipboard(sqlite, '', data.getData('text/plain')); }
  if (types.includes(cellClipboardType)) { const generic = data.getData(cellClipboardType); if (!generic) throw Error(text.invalid); return decodeSqliteClipboard('', generic, data.getData('text/plain')); }
  if (!types.includes('text/plain')) throw Error(text.invalid); return decodeSqliteClipboard('', '', data.getData('text/plain'));
}
/** 只从原可编辑快照取准确列；主页面与editor仍须再次核原票据/活动页/忙态。 */
function editable(page: SqliteTablePage) {
  const edit = page.edit; if (edit?.kind !== 'editable' || page.target.kind !== 'table' || page.target.database !== 'main') throw Error(text.readonly);
  if (!edit.snapshotId || edit.columns.length !== page.columns.length || !edit.columns.length || edit.columns.length > sqliteClipboardLimits.columns || edit.columns.some((column, index) => column.name !== page.columns[index].name || !!column.generated !== !!page.columns[index].generated || typeof column.name !== 'string' || column.name.length > 512 || !column.name || column.name.includes('\0') || !validUnicode(column.name)) || new Set(edit.columns.map(column => fold(column.name))).size !== edit.columns.length) throw Error(text.invalid); return edit;
}
/** 默认按可写字段顺序保留来源类型；自增字段同样明确映射，不擅自猜测省略。 */
export function defaultSqlitePasteMapping(page: SqliteTablePage, width: number, sourceColumns?: readonly string[]): SqlitePasteMapping {
  const edit = editable(page); if (!Number.isInteger(width) || width < 1 || width > sqliteClipboardLimits.columns) throw Error(text.mappingInvalid); if (sourceColumns !== undefined) return sourceColumnNames(sourceColumns, width).map(name => ({ column: edit.columns.find(column => column.name === name && !column.generated)?.name ?? null, kind: 'preserve' })); const writable = edit.columns.filter(column => !column.generated); return Array.from({ length: width }, (_, index) => ({ column: writable[index]?.name ?? null, kind: 'preserve' }));
}
/** 明确转换只改本格值；DEFAULT不混成NULL，整数不截断，blob不借字符串逃逸SQL。 */
export function convertSqliteClipboardCell(value: SqliteClipboardCell, kind: SqlitePasteKind): SqliteClipboardCell {
  if (kind === 'default') return undefined; if (kind === 'null') return { kind: 'null' }; if (kind === 'preserve') { if (value?.kind === 'real' && !Number.isFinite(Number(value.value))) throw Error(text.nonfinite); return value === undefined ? undefined : sqliteEditValueSchema.parse(value); }
  if (value === undefined) throw Error(text.defaultConversion); const body = value.kind === 'null' ? 'NULL' : value.value;
  if (kind === 'text') return sqliteEditValueSchema.parse({ kind, value: value.kind === 'blob' ? '0x' + body : body });
  if (value.kind === 'null') throw Error(text.conversionInvalid);
  if (kind === 'integer' && value.kind === 'real') { const real = Number(body); if (!Number.isFinite(real) || !Number.isInteger(real) || Object.is(real, -0)) throw Error(text.conversionInvalid); const integer = BigInt(real); if (integer < -9223372036854775808n || integer > 9223372036854775807n) throw Error(text.conversionInvalid); return sqliteEditValueSchema.parse({ kind, value: String(integer) }); }
  if (kind === 'real' && value.kind === 'integer') { const real = Number(body); if (!Number.isFinite(real) || BigInt(real) !== BigInt(body)) throw Error(text.conversionInvalid); }
  return sqliteEditValueSchema.parse({ kind, value: kind === 'blob' && /^0x/i.test(body) ? body.slice(2) : body });
}
/** 全组预检后签发冻结计划；只持原page引用及typed值，不接收用户SQL或可执行动作。 */
export function prepareSqlitePaste(page: SqliteTablePage, input: readonly (readonly SqliteClipboardCell[])[], rawMapping: readonly SqlitePasteColumnMapping[]): SqlitePastePlan {
  const edit = editable(page); if (Array.isArray(input) && input.length > sqliteClipboardLimits.pasteRows) throw Error(text.rowLimit); const values = matrix(input, sqliteClipboardLimits.pasteRows), width = values[0].length;
  const mapping = array(rawMapping, width); if (mapping.length !== width) throw Error(text.mappingInvalid); const used = new Set<string>(); let mapped = 0;
  const columns = mapping.map(raw => { const item = object(raw, ['column', 'kind']); if (item.column !== null && typeof item.column !== 'string' || typeof item.kind !== 'string' || !kinds.includes(item.kind as SqlitePasteKind)) throw Error(text.mappingInvalid); if (item.column === null) return { index: -1, kind: item.kind as SqlitePasteKind }; const index = edit.columns.findIndex(column => column.name === item.column); if (index < 0) throw Error(text.mappingInvalid); if (edit.columns[index].generated) throw Error(text.generated); const key = fold(item.column as string); if (used.has(key)) throw Error(text.mappingDuplicate); used.add(key); mapped++; return { index, kind: item.kind as SqlitePasteKind }; });
  if (!mapped) throw Error(text.noMapping); const output: SqliteClipboardCell[][] = []; let cells = 0, bytes = 0;
  for (const row of values) { const result: SqliteClipboardCell[] = Array(edit.columns.length).fill(undefined); for (let source = 0; source < width; source++) { const column = columns[source]; if (column.index < 0) continue; const value = convertSqliteClipboardCell(row[source], column.kind); if (value !== undefined) { if (++cells > sqliteClipboardLimits.cells) throw Error(text.cellLimit); bytes += encoder.encode(JSON.stringify({ column: edit.columns[column.index].name, value })).byteLength + 1; if (bytes > sqliteClipboardLimits.bytes) throw Error(text.tooLarge); } result[column.index] = value; } output.push(result); }
  const plan: SqlitePastePlan = Object.freeze({ rows: output.length, width: edit.columns.length }); plans.set(plan, { page, schema: JSON.stringify([page.schemaKey, page.target, edit.snapshotId, edit.expiresAt, edit.columns]), values: output }); return plan;
}
/** 只有签发计划的准确原page才可取值；复制后交editor，不向外暴露WeakMap内存或恢复能力。 */
export function sqlitePastePlanValues(plan: SqlitePastePlan, page: SqliteTablePage): SqliteClipboardCell[][] {
  const value = plans.get(plan); if (!value || value.page !== page) throw Error(text.stale); const edit = editable(page); if (value.schema !== JSON.stringify([page.schemaKey, page.target, edit.snapshotId, edit.expiresAt, edit.columns])) throw Error(text.stale); return value.values.map(row => row.map(cell => cell === undefined ? undefined : { ...cell }));
}
