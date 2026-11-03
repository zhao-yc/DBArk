import type { DatabaseSync } from 'node:sqlite';
import { sqliteDriverLimits, type SqliteValue } from './protocol';

/** 私有writer的全量核对不传行值；结果列分组，表字段仍沿1024用户列门。 */
export const sqliteRebuildComparisonLimits = { columns: 1024, groupColumns: 256, batchRows: 256, nameCharacters: 512, inputBytes: 2 * 1024 * 1024, indexes: 4096 } as const;
export interface SqliteRebuildComparisonInput {
  source: string; candidate: string; sourceOrder: string[]; candidateOrdinal: string; columns: string[];
  /** 仅实际列重排计划提供准确候选全列序；值投影始终按源columns逐列名核对。 */
  candidateOrder?: string[];
  rowid?: { source: string; candidate: string };
  /** 仅Main已确认的整数PK身份迁移：原生验证两端身份并比较全部用户值，不要求旧物理号等于新PK。 */
  rowidTransition?: { source: string; candidate: string };
  /** 双验证表的中间源可额外包含真实连续ordinal；不把类型变更后的PK顺序当旧行顺序。 */
  sourceOrdinal?: string;
  /** 只有预览中真实改类型的列才能获此权限；默认空名单，默认值变更不授跨storage转换。 */
  losslessColumns?: string[];
}
export interface SqliteRebuildComparisonResult { sourceRows: string; candidateRows: string; verifiedRows: string; columnGroups: number; }
export interface SqliteRebuildComparisonControl {
  check(): void; yield(): Promise<void>;
  /** 此计数累计每组已比较行，最终为verifiedRows乘columnGroups，不冒充完整行完成数。 */
  progress?(comparedRows: string): Promise<void>;
}

const messages = {
  SQLITE_REBUILD_COMPARISON_INPUT_INVALID: 'SQLite重建核对输入或结果格式无效。',
  SQLITE_REBUILD_COMPARISON_TRANSACTION_REQUIRED: 'SQLite重建核对必须属于原writer事务。',
  SQLITE_REBUILD_COMPARISON_TARGET_INVALID: 'SQLite重建核对目标不是准确普通main表。',
  SQLITE_REBUILD_COMPARISON_COLUMNS_INVALID: 'SQLite重建核对列目录不完整或不一致。',
  SQLITE_REBUILD_COMPARISON_SOURCE_ORDER_INVALID: 'SQLite重建核对缺少可靠的原行顺序。',
  SQLITE_REBUILD_COMPARISON_ROWID_INVALID: 'SQLite重建核对无法确认或保留真实rowid。',
  SQLITE_REBUILD_COMPARISON_ORDINAL_INVALID: 'SQLite重建核对的候选序号定义或连续性无效。',
  SQLITE_REBUILD_COMPARISON_ROW_COUNT_MISMATCH: 'SQLite重建核对的完整行数不一致。',
  SQLITE_REBUILD_COMPARISON_VALUE_MISMATCH: 'SQLite重建核对发现值、字节或精度变化。',
  SQLITE_REBUILD_COMPARISON_VALUE_LIMIT: 'SQLite重建核对单值超过原1MiB预算。',
  SQLITE_REBUILD_COMPARISON_NATIVE_FAILED: 'SQLite重建原生核对未完成。',
  SQLITE_REBUILD_COMPARISON_CLEANUP_FAILED: 'SQLite重建核对游标收尾未确认。',
} as const;
export type SqliteRebuildComparisonErrorCode = keyof typeof messages;
/** 只暴露固定类别，不附带SQLite原错、对象名、行值或内部SQL。 */
export class SqliteRebuildComparisonError extends Error {
  readonly code: SqliteRebuildComparisonErrorCode;
  constructor(code: SqliteRebuildComparisonErrorCode) {
    const accepted = Object.hasOwn(messages, code) ? code : 'SQLITE_REBUILD_COMPARISON_INPUT_INVALID';
    super(messages[accepted]); this.name = 'SqliteRebuildComparisonError'; this.code = accepted;
  }
}

const limits = sqliteRebuildComparisonLimits, encoder = new TextEncoder(), maxInteger = 9223372036854775807n;
const fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const fail = (code: SqliteRebuildComparisonErrorCode): never => { throw new SqliteRebuildComparisonError(code); };
const validName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= limits.nameCharacters && !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
/** 只读自有数据描述符，拒原型实例、访问器、隐藏键及额外字段。 */
function own(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID');
  const keys = Reflect.ownKeys(input); if (keys.length < required.length || keys.length > required.length + optional.length || required.some(key => !Object.hasOwn(input, key))) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID');
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== 'string' || !required.includes(key) && !optional.includes(key)) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID');
    const descriptor = Object.getOwnPropertyDescriptor(input, key); if (!descriptor?.enumerable || !('value' in descriptor)) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID'); output[key] = descriptor.value;
  }
  return output;
}
/** 独立复制原调用的数组和rowid能力，不能在发送或await后继承调用者改动。 */
export function copySqliteRebuildComparisonInput(raw: unknown): SqliteRebuildComparisonInput {
  const value = own(raw, ['source', 'candidate', 'sourceOrder', 'candidateOrdinal', 'columns'], ['rowid', 'rowidTransition', 'losslessColumns', 'sourceOrdinal', 'candidateOrder']); let bytes = 200;
  const name = (input: unknown): string => { if (!validName(input) || (bytes += encoder.encode(input).length + 4) > limits.inputBytes) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID'); return input; };
  const list = (input: unknown, allowEmpty = false): string[] => {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || !allowEmpty && !input.length || input.length > limits.columns || Reflect.ownKeys(input).length !== input.length + 1) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID');
    const result: string[] = [], seen = new Set<string>();
    for (let index = 0; index < input.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(input, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID'); const item = name(descriptor.value), key = fold(item); if (seen.has(key)) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID'); seen.add(key); result.push(item); }
    return result;
  };
  const source = name(value.source), candidate = name(value.candidate), candidateOrdinal = name(value.candidateOrdinal), sourceOrder = list(value.sourceOrder), columns = list(value.columns);
  if (/^sqlite_/i.test(source) || /^sqlite_/i.test(candidate) || fold(source) === fold(candidate) || columns.some(column => fold(column) === fold(candidateOrdinal))) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID');
  const sourceOrdinal = value.sourceOrdinal === undefined ? undefined : name(value.sourceOrdinal);
  if (sourceOrdinal !== undefined && columns.some(column => fold(column) === fold(sourceOrdinal))) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID');
  const losslessColumns = value.losslessColumns === undefined ? undefined : list(value.losslessColumns, true);
  if (losslessColumns?.some(column => !columns.includes(column))) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID');
  const candidateOrder = value.candidateOrder === undefined ? undefined : list(value.candidateOrder);
  if (candidateOrder && (candidateOrder.length !== columns.length || candidateOrder.some(column => !columns.includes(column)))) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID');
  let rowid: SqliteRebuildComparisonInput['rowid']; if (value.rowid !== undefined) { const pair = own(value.rowid, ['source', 'candidate']); rowid = { source: name(pair.source), candidate: name(pair.candidate) }; }
  let rowidTransition: SqliteRebuildComparisonInput['rowidTransition']; if (value.rowidTransition !== undefined) { const pair = own(value.rowidTransition, ['source', 'candidate']); rowidTransition = { source: name(pair.source), candidate: name(pair.candidate) }; if (rowid || sourceOrdinal) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID'); }
  return { source, candidate, sourceOrder, candidateOrdinal, columns, ...(rowid ? { rowid } : {}), ...(rowidTransition ? { rowidTransition } : {}), ...(sourceOrdinal === undefined ? {} : { sourceOrdinal }), ...(losslessColumns === undefined ? {} : { losslessColumns }), ...(candidateOrder === undefined ? {} : { candidateOrder }) };
}
/** 只有相等的完整计数才可成为成功结果；私有比较不能夹带行值或SQL。 */
export function copySqliteRebuildComparisonResult(raw: unknown): SqliteRebuildComparisonResult {
  const value = own(raw, ['sourceRows', 'candidateRows', 'verifiedRows', 'columnGroups']);
  const count = (input: unknown): string => { if (typeof input !== 'string' || input.length > 19 || !/^(?:0|[1-9][0-9]*)$/.test(input) || BigInt(input) > maxInteger) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID'); return input; };
  const sourceRows = count(value.sourceRows), candidateRows = count(value.candidateRows), verifiedRows = count(value.verifiedRows), columnGroups = value.columnGroups;
  if (sourceRows !== candidateRows || sourceRows !== verifiedRows || typeof columnGroups !== 'number' || !Number.isInteger(columnGroups) || columnGroups < 1 || columnGroups > Math.ceil(limits.columns / limits.groupColumns)) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID');
  return { sourceRows, candidateRows, verifiedRows, columnGroups };
}

type Row = unknown[];
interface Cursor { next(): IteratorResult<unknown>; return?(): unknown; }
interface Column { cid: number; name: string; integerType: boolean; notNull: boolean; pk: number; hidden: number; }
interface Index { name: string; unique: boolean; origin: string; partial: boolean; }
/** 原生异常只转固定类别，禁止把含对象名或SQL的原错误附到对外异常上。 */
function native<T>(action: () => T): T { try { return action(); } catch (reason) { if (reason instanceof SqliteRebuildComparisonError) throw reason; return fail('SQLITE_REBUILD_COMPARISON_NATIVE_FAILED'); } }
function openCursor(db: DatabaseSync, sql: string, parameters: string[] = []): Cursor {
  return native(() => { const statement = db.prepare(sql); statement.setReadBigInts(true); statement.setReturnArrays(true); return statement.iterate(...parameters) as unknown as Cursor; });
}
function next(cursor: Cursor): IteratorResult<unknown> { return native(() => cursor.next()); }
function close(cursor: Cursor | undefined): boolean { if (!cursor) return true; try { cursor.return?.(); return true; } catch { return false; } }
function row(value: unknown, columns: number): Row { if (!Array.isArray(value) || value.length !== columns) return fail('SQLITE_REBUILD_COMPARISON_NATIVE_FAILED'); return value; }
function small(value: unknown, maximum = 2147483647): number { if (typeof value !== 'bigint' || value < 0n || value > BigInt(maximum)) return fail('SQLITE_REBUILD_COMPARISON_NATIVE_FAILED'); return Number(value); }
/** 元数据有独立行数门；不存在业务行累计上限，元数据同样不能以截断代替完整事实。 */
function metadata(db: DatabaseSync, sql: string, parameters: string[], maximum: number, control: SqliteRebuildComparisonControl): Row[] {
  const cursor = openCursor(db, sql, parameters), result: Row[] = [];
  try { for (;;) { control.check(); const item = next(cursor); if (item.done) break; if (result.length === maximum || !Array.isArray(item.value)) return fail('SQLITE_REBUILD_COMPARISON_TARGET_INVALID'); result.push(item.value); } }
  finally { if (!close(cursor)) fail('SQLITE_REBUILD_COMPARISON_CLEANUP_FAILED'); }
  return result;
}
function columns(db: DatabaseSync, table: string, control: SqliteRebuildComparisonControl): Column[] {
  const values = metadata(db, 'SELECT cid,name,(type COLLATE NOCASE=\'INTEGER\'),"notnull",pk,hidden FROM pragma_table_xinfo(?,\'main\') ORDER BY cid', [table], limits.columns + 1, control);
  return values.map((value, index) => { const cells = row(value, 6), name = cells[1], cid = small(cells[0]), hidden = small(cells[5], 3); if (cid !== index || !validName(name) || ![0, 2, 3].includes(hidden)) return fail('SQLITE_REBUILD_COMPARISON_COLUMNS_INVALID'); return { cid, name, integerType: small(cells[2], 1) === 1, notNull: small(cells[3], 1) === 1, pk: small(cells[4], limits.columns + 1), hidden }; });
}
function indexes(db: DatabaseSync, table: string, control: SqliteRebuildComparisonControl): Index[] {
  return metadata(db, 'SELECT name,"unique",origin,partial FROM pragma_index_list(?,\'main\')', [table], limits.indexes, control).map(value => { const cells = row(value, 4); if (!validName(cells[0]) || typeof cells[2] !== 'string') return fail('SQLITE_REBUILD_COMPARISON_TARGET_INVALID'); return { name: cells[0], unique: small(cells[1], 1) === 1, origin: cells[2], partial: small(cells[3], 1) === 1 }; });
}
function keyColumns(db: DatabaseSync, name: string, control: SqliteRebuildComparisonControl): string[] | undefined {
  const keys = metadata(db, 'SELECT seqno,cid,name,"key" FROM pragma_index_xinfo(?,\'main\') ORDER BY seqno', [name], limits.columns + 2, control).map(value => row(value, 4)).filter(value => value[3] === 1n);
  if (keys.some((value, index) => value[0] !== BigInt(index) || typeof value[1] !== 'bigint' || value[1] < 0n || !validName(value[2]))) return undefined;
  return keys.map(value => value[2] as string);
}
/** 真实table_list排除虚拟/影子表；不从输入名称、DDL词法或rowid当前值猜测表种类。 */
function withoutRowid(db: DatabaseSync, table: string, control: SqliteRebuildComparisonControl): boolean {
  const values = metadata(db, 'SELECT m.type,l.type,l.wr FROM main.sqlite_schema AS m JOIN pragma_table_list AS l ON l.schema=\'main\' AND l.name=m.name COLLATE BINARY WHERE m.name=? COLLATE BINARY AND m.type=\'table\' LIMIT 2', [table], 2, control);
  if (values.length !== 1) return fail('SQLITE_REBUILD_COMPARISON_TARGET_INVALID'); const cells = row(values[0], 3); if (cells[0] !== 'table' || cells[1] !== 'table') return fail('SQLITE_REBUILD_COMPARISON_TARGET_INVALID'); return small(cells[2], 1) === 1;
}
/** INTEGER PRIMARY KEY DESC有独立pk索引，因此不会被误认成真实rowid别名。 */
function actualRowid(name: string, fields: Column[], allIndexes: Index[]): boolean {
  const key = fold(name), declared = fields.find(column => fold(column.name) === key);
  if (['rowid', '_rowid_', 'oid'].includes(key) && !declared) return true;
  const primary = fields.filter(column => column.pk > 0); return primary.length === 1 && primary[0].pk === 1 && primary[0].integerType && fold(primary[0].name) === key && !allIndexes.some(index => index.origin === 'pk');
}

function equalBytes(left: unknown, right: unknown): boolean { return left instanceof Uint8Array && right instanceof Uint8Array && left.byteLength === right.byteLength && left.every((value, index) => value === right[index]); }
interface Cell { kind: 'null' | 'integer' | 'real' | 'text' | 'blob'; value: null | bigint | number | string | Uint8Array; bytes: null | Uint8Array; }
function cell(cells: Row, start: number): Cell {
  const kind = cells[start], value = cells[start + 1], bytes = cells[start + 2];
  // SQLite投影先阻止超量原值进入JS；这里仍核实际BLOB和TEXT的原编码及UTF8预算，不能借内部record预算放行。
  if (kind === null || kind === 'blob' && value instanceof Uint8Array && value.byteLength > sqliteDriverLimits.valueBytes || kind === 'text' && (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > sqliteDriverLimits.valueBytes || bytes instanceof Uint8Array && bytes.byteLength > sqliteDriverLimits.valueBytes)) return fail('SQLITE_REBUILD_COMPARISON_VALUE_LIMIT');
  if (kind === 'null' && value === null && bytes === null || kind === 'integer' && typeof value === 'bigint' && value >= -maxInteger - 1n && value <= maxInteger && bytes === null || kind === 'real' && typeof value === 'number' && !Number.isNaN(value) && bytes === null || kind === 'text' && typeof value === 'string' && bytes instanceof Uint8Array || kind === 'blob' && value instanceof Uint8Array && bytes === null) return { kind, value, bytes } as Cell;
  return fail('SQLITE_REBUILD_COMPARISON_NATIVE_FAILED');
}
/** TEXT同storage只比较真实库编码字节；跨storage转换前还必须证明解码没有替换或丢BOM。 */
function exactText(value: Cell, decoder: TextDecoder): string | undefined {
  if (value.kind !== 'text' || !(value.bytes instanceof Uint8Array) || typeof value.value !== 'string') return undefined;
  try { const text = decoder.decode(value.bytes); return text === value.value ? text : undefined; } catch { return undefined; }
}
/** 比较十进制有理数和IEEE754的精确分数；Number/toString只用于canonical门，不能充当精度证明。 */
function decimalEqualsReal(text: string, value: number): boolean {
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:e([+-]?[0-9]+))?$/.exec(text); if (!match || text.length > 32 || !Number.isFinite(value)) return false;
  const fraction = match[3] ?? '', exponent = Number(match[4] ?? '0') - fraction.length; if (!Number.isInteger(exponent) || Math.abs(exponent) > 400) return false;
  let decimalNumerator = BigInt(match[2] + fraction) * (match[1] ? -1n : 1n), decimalDenominator = 1n;
  if (exponent >= 0) decimalNumerator *= 10n ** BigInt(exponent); else decimalDenominator = 10n ** BigInt(-exponent);
  const bits = new DataView(new ArrayBuffer(8)); bits.setFloat64(0, value, false); const binary = bits.getBigUint64(0, false), exp = Number(binary >> 52n & 2047n), fractionBits = binary & 4503599627370495n;
  let binaryNumerator = (exp === 0 ? fractionBits : fractionBits + 4503599627370496n) * (binary >> 63n ? -1n : 1n), binaryDenominator = 1n; const shift = exp === 0 ? -1074 : exp - 1023 - 52;
  if (shift >= 0) binaryNumerator <<= BigInt(shift); else binaryDenominator <<= BigInt(-shift);
  return decimalNumerator * binaryDenominator === binaryNumerator * decimalDenominator;
}
function exactIntegerReal(integer: bigint, real: number): boolean { return Number.isFinite(real) && Number.isInteger(real) && !Object.is(real, -0) && BigInt(real) === integer; }
/** 转换只允许可证明无损的分支；BLOB/NULL或其它跨storage路径一律拒绝。 */
function equalCell(source: Cell, candidate: Cell, decoder: TextDecoder, allowConversion: boolean): boolean {
  if (source.kind === candidate.kind) {
    if (source.kind === 'text') return equalBytes(source.bytes, candidate.bytes);
    if (source.kind === 'blob') return equalBytes(source.value, candidate.value);
    return Object.is(source.value, candidate.value);
  }
  if (!allowConversion) return false;
  if (source.kind === 'integer' && candidate.kind === 'real') return exactIntegerReal(source.value as bigint, candidate.value as number);
  if (source.kind === 'real' && candidate.kind === 'integer') return exactIntegerReal(candidate.value as bigint, source.value as number);
  if (source.kind === 'text' && candidate.kind === 'integer') return exactText(source, decoder) === String(candidate.value);
  if (source.kind === 'integer' && candidate.kind === 'text') return exactText(candidate, decoder) === String(source.value);
  if (source.kind === 'text' && candidate.kind === 'real') {
    const text = exactText(source, decoder), value = candidate.value as number, canonical = Object.is(value, -0) ? '-0' : String(value);
    return text !== undefined && text === canonical && decimalEqualsReal(text, value);
  }
  if (source.kind === 'real' && candidate.kind === 'text') {
    const text = exactText(candidate, decoder), value = source.value as number;
    return text !== undefined && /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(text) && Number.isFinite(value) && Object.is(Number(text), value);
  }
  return false;
}

/** 只接受原driver完整typed值；TEXT的原库编码字节已由调用方exact投影先证明无损。 */
function storedKeyCell(raw: unknown): Cell {
  if (raw === null) return { kind: 'null', value: null, bytes: null };
  if (typeof raw === 'string') {
    if (raw.length > sqliteDriverLimits.valueBytes || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(raw)) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID');
    const bytes = encoder.encode(raw); if (bytes.byteLength > sqliteDriverLimits.valueBytes) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID'); return { kind: 'text', value: raw, bytes };
  }
  const value = own(raw, ['type'], ['value', 'base64']);
  if (Object.keys(value).length !== 2) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID');
  if (value.type === 'integer' && Object.hasOwn(value, 'value') && typeof value.value === 'string' && value.value.length <= 20 && /^(?:0|-?[1-9][0-9]*)$/.test(value.value)) {
    const integer = BigInt(value.value); if (integer < -maxInteger - 1n || integer > maxInteger) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID'); return { kind: 'integer', value: integer, bytes: null };
  }
  if (value.type === 'real' && Object.hasOwn(value, 'value') && typeof value.value === 'string' && value.value.length <= 64) {
    const real = Number(value.value); if (Number.isNaN(real) || (Object.is(real, -0) ? value.value !== '-0' : String(real) !== value.value)) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID'); return { kind: 'real', value: real, bytes: null };
  }
  if (value.type === 'binary' && Object.hasOwn(value, 'base64') && typeof value.base64 === 'string' && value.base64.length <= Math.ceil(sqliteDriverLimits.valueBytes / 3) * 4) {
    const bytes = Buffer.from(value.base64, 'base64'); if (bytes.byteLength > sqliteDriverLimits.valueBytes || bytes.toString('base64') !== value.base64) return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID'); return { kind: 'blob', value: bytes, bytes: null };
  }
  return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID');
}
/** FK旧违规行的真实PK身份复用同一精度证明；仅已批准改type的准确列可获跨storage转换。 */
export function sqliteRebuildStoredKeyEquivalent(source: SqliteValue, candidate: SqliteValue, allowConversion: boolean): boolean {
  try {
    if (typeof allowConversion !== 'boolean') return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID');
    return equalCell(storedKeyCell(source), storedKeyCell(candidate), new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }), allowConversion);
  } catch (reason) { if (reason instanceof SqliteRebuildComparisonError) throw reason; return fail('SQLITE_REBUILD_COMPARISON_INPUT_INVALID'); }
}

/** 在同writer事务中按稳定原顺序与候选连续ordinal全量比较，每组至多770结果列。 */
export async function compareSqliteRebuildTables(db: DatabaseSync, raw: SqliteRebuildComparisonInput, control: SqliteRebuildComparisonControl): Promise<SqliteRebuildComparisonResult> {
  const input = copySqliteRebuildComparisonInput(raw); control.check(); if (!db.isTransaction) return fail('SQLITE_REBUILD_COMPARISON_TRANSACTION_REQUIRED');
  const sourceWithout = withoutRowid(db, input.source, control), candidateWithout = withoutRowid(db, input.candidate, control), sourceColumns = columns(db, input.source, control), candidateColumns = columns(db, input.candidate, control);
  if (sourceWithout !== candidateWithout) return fail('SQLITE_REBUILD_COMPARISON_ROWID_INVALID');
  const candidateOrder = input.candidateOrder ?? input.columns;
  if (sourceColumns.length !== input.columns.length + (input.sourceOrdinal ? 1 : 0) || sourceColumns.filter(column => column.name !== input.sourceOrdinal).some((column, index) => column.name !== input.columns[index]) || candidateColumns.length !== input.columns.length + 1 || candidateColumns.filter(column => column.name !== input.candidateOrdinal).some((column, index) => column.name !== candidateOrder[index])) return fail('SQLITE_REBUILD_COMPARISON_COLUMNS_INVALID');
  const sourceIndexes = indexes(db, input.source, control), candidateIndexes = indexes(db, input.candidate, control);
  /** 源与候选ordinal均由真实NOT NULL INTEGER和准确完整单列唯一索引授权。 */
  const assertOrdinal = (name: string, fields: Column[], allIndexes: Index[]) => {
    const ordinal = fields.find(column => column.name === name); if (!ordinal || !ordinal.integerType || !ordinal.notNull || ordinal.hidden !== 0) return fail('SQLITE_REBUILD_COMPARISON_ORDINAL_INVALID');
    for (const index of allIndexes) if (index.unique && !index.partial) { const keys = keyColumns(db, index.name, control); if (keys?.length === 1 && keys[0] === name) return; }
    return fail('SQLITE_REBUILD_COMPARISON_ORDINAL_INVALID');
  };
  assertOrdinal(input.candidateOrdinal, candidateColumns, candidateIndexes);
  if (input.sourceOrdinal) assertOrdinal(input.sourceOrdinal, sourceColumns, sourceIndexes);
  if (sourceWithout) {
    if (input.rowid || input.rowidTransition) return fail('SQLITE_REBUILD_COMPARISON_ROWID_INVALID'); const primary = sourceColumns.filter(column => column.pk > 0).sort((left, right) => left.pk - right.pk), primaryIndex = sourceIndexes.filter(index => index.origin === 'pk');
    if (!primary.length || primary.some((column, index) => column.pk !== index + 1) || input.sourceOrder.length !== primary.length || primary.some((column, index) => column.name !== input.sourceOrder[index]) || primaryIndex.length !== 1 || !primaryIndex[0].unique || primaryIndex[0].partial) return fail('SQLITE_REBUILD_COMPARISON_SOURCE_ORDER_INVALID');
    const keys = keyColumns(db, primaryIndex[0].name, control); if (!keys || keys.length !== primary.length || keys.some((key, index) => key !== primary[index].name)) return fail('SQLITE_REBUILD_COMPARISON_SOURCE_ORDER_INVALID');
  } else {
    const identity = input.rowid ?? input.rowidTransition;
    if (!identity || input.sourceOrder.length !== 1 || input.sourceOrder[0] !== identity.source || !actualRowid(identity.source, sourceColumns, sourceIndexes) || !actualRowid(identity.candidate, candidateColumns, candidateIndexes)) return fail('SQLITE_REBUILD_COMPARISON_ROWID_INVALID');
    if (input.rowidTransition && (!input.columns.includes(identity.candidate) || identity.source === identity.candidate)) return fail('SQLITE_REBUILD_COMPARISON_ROWID_INVALID');
  }
  let sourceOrdinalRows: bigint | undefined;
  // 原ordinal仅证明这是准确中间候选；主游标仍按当前真实PK总序，不能把旧行序强套新类型PK。
  if (input.sourceOrdinal) {
    const cursor = openCursor(db, 'SELECT ' + quote(input.sourceOrdinal) + ' FROM main.' + quote(input.source) + ' ORDER BY ' + quote(input.sourceOrdinal) + ' ASC'); let count = 0n;
    try { for (;;) { control.check(); const item = next(cursor); if (item.done) break; count++; if (count > maxInteger || row(item.value, 1)[0] !== count) return fail('SQLITE_REBUILD_COMPARISON_ORDINAL_INVALID'); if (count % BigInt(limits.batchRows) === 0n) { await control.yield(); control.check(); } } }
    finally { if (!close(cursor)) fail('SQLITE_REBUILD_COMPARISON_CLEANUP_FAILED'); }
    sourceOrdinalRows = count;
  }
  const encodingRows = metadata(db, 'PRAGMA main.encoding', [], 1, control); if (encodingRows.length !== 1 || encodingRows[0].length !== 1) return fail('SQLITE_REBUILD_COMPARISON_NATIVE_FAILED');
  const encoding = encodingRows[0][0], label = encoding === 'UTF-8' ? 'utf-8' : encoding === 'UTF-16le' ? 'utf-16le' : encoding === 'UTF-16be' ? 'utf-16be' : undefined; if (!label) return fail('SQLITE_REBUILD_COMPARISON_NATIVE_FAILED');
  const decoder = new TextDecoder(label, { fatal: true, ignoreBOM: true }), columnGroups = Math.ceil(input.columns.length / limits.groupColumns), losslessColumns = new Set(input.losslessColumns ?? []); let expectedRows: bigint | undefined, cumulative = 0n, published: bigint | undefined;
  const progress = async () => { if (control.progress && published !== cumulative) { control.check(); await control.progress(cumulative.toString()); control.check(); published = cumulative; } };
  for (let group = 0; group < columnGroups; group++) {
    control.check(); if (!db.isTransaction) return fail('SQLITE_REBUILD_COMPARISON_TRANSACTION_REQUIRED'); const names = input.columns.slice(group * limits.groupColumns, (group + 1) * limits.groupColumns);
    const sourceAlias = '"__dbark_source"', candidateAlias = '"__dbark_candidate"', field = (alias: string, name: string) => alias + '.' + quote(name);
    // 完整比较不走公开结果帧：必须在SQLite内先拦原TEXT/BLOB超量值，不能把4MiB内部记录整格交给Node再判断。
    const project = (alias: string) => names.flatMap(name => {
      const value = field(alias, name), bounded = "(typeof(" + value + ") NOT IN ('text','blob') OR length(CAST(" + value + ' AS BLOB))<=' + sqliteDriverLimits.valueBytes + ')';
      // typeof永远返回非NULL文本，因此类型槽NULL是不能与任何用户值碰撞的内部拒绝标记，列数仍保持每格三列。
      return ['CASE WHEN ' + bounded + ' THEN typeof(' + value + ') ELSE NULL END', 'CASE WHEN ' + bounded + ' THEN ' + value + ' ELSE NULL END', "CASE WHEN " + bounded + " AND typeof(" + value + ")='text' THEN CAST(" + value + ' AS BLOB) ELSE NULL END'];
    });
    const sourcePrefix = input.rowid ? [field(sourceAlias, input.rowid.source)] : [], candidatePrefix = [field(candidateAlias, input.candidateOrdinal), ...(input.rowid ? [field(candidateAlias, input.rowid.candidate)] : [])];
    const sourceSql = 'SELECT ' + [...sourcePrefix, ...project(sourceAlias)].join(',') + ' FROM main.' + quote(input.source) + ' AS ' + sourceAlias + ' ORDER BY ' + input.sourceOrder.map(name => field(sourceAlias, name) + ' COLLATE BINARY ASC').join(',');
    const candidateSql = 'SELECT ' + [...candidatePrefix, ...project(candidateAlias)].join(',') + ' FROM main.' + quote(input.candidate) + ' AS ' + candidateAlias + ' ORDER BY ' + field(candidateAlias, input.candidateOrdinal) + ' ASC';
    let sourceCursor: Cursor | undefined, candidateCursor: Cursor | undefined, compared = 0n;
    try {
      sourceCursor = openCursor(db, sourceSql); candidateCursor = openCursor(db, candidateSql);
      for (;;) {
        control.check(); const left = next(sourceCursor), right = next(candidateCursor); if (left.done || right.done) { if (!left.done || !right.done) return fail('SQLITE_REBUILD_COMPARISON_ROW_COUNT_MISMATCH'); break; }
        const sourceRow = row(left.value, sourcePrefix.length + names.length * 3), candidateRow = row(right.value, candidatePrefix.length + names.length * 3); compared++;
        if (compared > maxInteger || candidateRow[0] !== compared) return fail('SQLITE_REBUILD_COMPARISON_ORDINAL_INVALID');
        if (input.rowid && (typeof sourceRow[0] !== 'bigint' || typeof candidateRow[1] !== 'bigint' || sourceRow[0] !== candidateRow[1])) return fail('SQLITE_REBUILD_COMPARISON_ROWID_INVALID');
        for (let index = 0; index < names.length; index++) if (!equalCell(cell(sourceRow, sourcePrefix.length + index * 3), cell(candidateRow, candidatePrefix.length + index * 3), decoder, losslessColumns.has(names[index]))) return fail('SQLITE_REBUILD_COMPARISON_VALUE_MISMATCH');
        cumulative++; if (compared % BigInt(limits.batchRows) === 0n) { await progress(); control.check(); await control.yield(); control.check(); }
      }
    } finally { const sourceClosed = close(sourceCursor), candidateClosed = close(candidateCursor); if (!sourceClosed || !candidateClosed) fail('SQLITE_REBUILD_COMPARISON_CLEANUP_FAILED'); }
    if (expectedRows !== undefined && expectedRows !== compared) return fail('SQLITE_REBUILD_COMPARISON_ROW_COUNT_MISMATCH'); expectedRows = compared; await progress();
  }
  control.check(); if (sourceOrdinalRows !== undefined && sourceOrdinalRows !== expectedRows) return fail('SQLITE_REBUILD_COMPARISON_ROW_COUNT_MISMATCH'); if (!db.isTransaction) return fail('SQLITE_REBUILD_COMPARISON_TRANSACTION_REQUIRED'); const rows = (expectedRows ?? 0n).toString();
  return copySqliteRebuildComparisonResult({ sourceRows: rows, candidateRows: rows, verifiedRows: rows, columnGroups });
}
