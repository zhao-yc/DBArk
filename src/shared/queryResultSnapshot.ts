import type { CellValue, DataRow, QueryResult, ResultColumn } from './contracts';
import { queryResultSnapshotZh as text } from './queryResultSnapshot.zh-CN';

export const queryResultSnapshotLimits = {
  bytes: 16 * 1024 * 1024, rows: 100000, columns: 4096, cells: 1000000,
  cellBytes: 16 * 1024 * 1024, binaryBytes: 16 * 1024 * 1024, columnBytes: 8192, typeBytes: 1024,
  nameBytes: 256, insertIdBytes: 256, statementBytes: 16 * 1024 * 1024, jsonDepth: 12, jsonNodes: 2200000,
} as const;
export interface QueryResultSnapshotDocument {
  kind: 'dbark.query-result-snapshot'; version: 1; name?: string; result: QueryResult;
}
type Budget = { bytes: number; cells: number };
const invalid = (): never => { throw Error(text.invalid); };
const large = (): never => { throw Error(text.tooLarge); };
const requiredResult = ['columns', 'rows', 'truncated', 'elapsedMs', 'statement'];
const optionalResult = ['affectedRows', 'insertId', 'warningCount'] as const;

/** 只读取自有、可枚举的数据描述符，绝不执行输入的getter或toJSON。 */
function own(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return invalid();
  return descriptor.value;
}
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const keys = Reflect.ownKeys(value), allowed = new Set([...required, ...optional]);
  if (keys.length < required.length || keys.length > allowed.size) return invalid();
  for (const key of keys) { if (typeof key !== 'string' || !allowed.has(key)) return invalid(); own(value, key); }
  for (const key of required) own(value, key);
  return value as Record<string, unknown>;
}

/** 数组先限制长度，再检查稠密自有索引和额外字段，不使用输入迭代器。 */
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0) return invalid();
  if (length > maximum) return large();
  if (Reflect.ownKeys(value).length !== length + 1) return invalid();
  for (let index = 0; index < length; index++) own(value, String(index));
  return value;
}

/** 同时测量原始UTF-8和JSON转义字节，拒绝孤立代理项，不先创建编码缓冲。 */
function stringSize(value: unknown, maximum: number): { value: string; quoted: number } {
  if (typeof value !== 'string') return invalid();
  if (value.length > maximum) return large();
  let bytes = 0, quoted = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return invalid();
      bytes += 4; quoted += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) return invalid();
    else {
      const width = code < 128 ? 1 : code < 2048 ? 2 : 3;
      bytes += width;
      quoted += code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : code < 32 ? 6 : width;
    }
    if (bytes > maximum) return large();
  }
  return { value, quoted };
}
function add(budget: Budget, bytes: number): void { budget.bytes += bytes; if (budget.bytes > queryResultSnapshotLimits.bytes) large(); }
function string(value: unknown, maximum: number, budget: Budget): string { const checked = stringSize(value, maximum); add(budget, checked.quoted); return checked.value; }

/** 所有Number均使用唯一最短往返文本，只有负零使用单独的-0词法。 */
function number(value: unknown, budget: Budget, wire: boolean): number {
  let result: number, representation: string;
  if (wire) {
    const source = record(value, ['type', 'text']);
    if (own(source, 'type') !== 'number') return invalid();
    const supplied = own(source, 'text');
    if (typeof supplied !== 'string' || supplied.length > 32) return invalid();
    result = Number(supplied); representation = supplied;
    if (!Number.isFinite(result) || (representation !== '-0' && String(result) !== representation)) return invalid();
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value)) return invalid();
    result = value; representation = Object.is(value, -0) ? '-0' : String(value);
  }
  add(budget, '{"type":"number","text":'.length); string(representation, 32, budget); add(budget, 1);
  return result;
}

/** 不解码分配BLOB；逐字符校验标准Base64及填充比特，再按解码字节数限额。 */
function binary(value: unknown, budget: Budget): { type: 'binary'; base64: string } {
  const source = record(value, ['type', 'base64']);
  if (own(source, 'type') !== 'binary') return invalid();
  const supplied = own(source, 'base64');
  if (typeof supplied !== 'string') return invalid();
  if (supplied.length > 4 * Math.ceil(queryResultSnapshotLimits.binaryBytes / 3)) return large();
  // 合法Base64全部为ASCII，不含JSON转义；先以真实wire开销拒绝总文件必然超限的输入。
  if (budget.bytes + '{"type":"binary","base64":'.length + supplied.length + 3 > queryResultSnapshotLimits.bytes) return large();
  if (supplied.length % 4) return invalid();
  const padding = supplied.endsWith('==') ? 2 : supplied.endsWith('=') ? 1 : 0;
  if (supplied.length / 4 * 3 - padding > queryResultSnapshotLimits.binaryBytes) return large();
  const end = supplied.length - padding, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let index = 0; index < end; index++) if (alphabet.indexOf(supplied[index]) < 0) return invalid();
  if (padding === 2 && (alphabet.indexOf(supplied[end - 1]) & 15) !== 0 || padding === 1 && (alphabet.indexOf(supplied[end - 1]) & 3) !== 0) return invalid();
  add(budget, '{"type":"binary","base64":'.length);
  const base64 = string(supplied, 4 * Math.ceil(queryResultSnapshotLimits.binaryBytes / 3), budget); add(budget, 1);
  return { type: 'binary', base64 };
}

/** 单元格对象只允许字节标签，磁盘另允许数值标签；JSON字段原文仍是普通字符串。 */
function cell(value: unknown, budget: Budget, wire: boolean): CellValue {
  if (++budget.cells > queryResultSnapshotLimits.cells) return large();
  if (value === null || typeof value === 'boolean') { add(budget, value === null || value === true ? 4 : 5); return value; }
  if (typeof value === 'string') return string(value, queryResultSnapshotLimits.cellBytes, budget);
  if (!wire && typeof value === 'number') return number(value, budget, false);
  if (!value || typeof value !== 'object') return invalid();
  const type = own(value, 'type');
  if (type === 'binary') return binary(value, budget);
  if (wire && type === 'number') return number(value, budget, true);
  return invalid();
}

/** 预算包括列键在每一行的实际重复开销，校验通过的下一格才获得克隆空间。 */
function result(value: unknown, budget: Budget, wire: boolean): QueryResult {
  const source = record(value, requiredResult, optionalResult), inputs = array(own(source, 'columns'), queryResultSnapshotLimits.columns), records = array(own(source, 'rows'), queryResultSnapshotLimits.rows);
  if (inputs.length * records.length > queryResultSnapshotLimits.cells) return large();
  const columns: ResultColumn[] = [], keys = new Set<string>();
  add(budget, '{"columns":['.length);
  for (let index = 0; index < inputs.length; index++) {
    const column = record(own(inputs, String(index)), ['key', 'name', 'type']);
    add(budget, (index ? 1 : 0) + '{"key":'.length);
    const key = string(own(column, 'key'), queryResultSnapshotLimits.columnBytes, budget);
    if (keys.has(key)) return invalid(); keys.add(key);
    add(budget, ',"name":'.length); const name = string(own(column, 'name'), queryResultSnapshotLimits.columnBytes, budget);
    add(budget, ',"type":'.length); const type = string(own(column, 'type'), queryResultSnapshotLimits.typeBytes, budget); add(budget, 1);
    columns.push({ key, name, type });
  }
  add(budget, '],"rows":['.length);
  const rows: DataRow[] = [];
  for (let index = 0; index < records.length; index++) {
    const candidate = own(records, String(index));
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || ![Object.prototype, null].includes(Object.getPrototypeOf(candidate))) return invalid();
    const rowKeys = Reflect.ownKeys(candidate);
    if (rowKeys.length !== keys.size) return invalid();
    for (const key of rowKeys) if (typeof key !== 'string' || !keys.has(key)) return invalid();
    add(budget, (index ? 1 : 0) + 1);
    const row = Object.create(null) as DataRow;
    for (let column = 0; column < columns.length; column++) {
      if (column) add(budget, 1);
      const key = columns[column].key; string(key, queryResultSnapshotLimits.columnBytes, budget); add(budget, 1);
      row[key] = cell(own(candidate, key), budget, wire);
    }
    add(budget, 1); rows.push(row);
  }
  const truncated = own(source, 'truncated'); if (typeof truncated !== 'boolean') return invalid();
  add(budget, '],"truncated":'.length + (truncated ? 4 : 5));
  add(budget, ',"elapsedMs":'.length); const elapsedMs = number(own(source, 'elapsedMs'), budget, wire);
  const extras: Pick<QueryResult, 'affectedRows' | 'insertId' | 'warningCount'> = {};
  for (const key of optionalResult) if (Object.hasOwn(source, key)) {
    add(budget, key.length + 4);
    // insertId本身就是精确字符串，不能经Number舍入或套用数值标签。
    if (key === 'insertId') extras.insertId = string(own(source, key), queryResultSnapshotLimits.insertIdBytes, budget);
    else extras[key] = number(own(source, key), budget, wire);
  }
  add(budget, ',"statement":'.length); const statement = string(own(source, 'statement'), queryResultSnapshotLimits.statementBytes, budget); add(budget, 1);
  return { columns, rows, truncated, elapsedMs, ...extras, statement };
}

/** 文件只包含真实QueryResult及可选标签；源SQL是文字，任何连接或会话字段均拒绝。 */
function document(value: unknown, wire: boolean): QueryResultSnapshotDocument {
  const source = record(value, ['kind', 'version', 'result'], ['name']);
  if (own(source, 'kind') !== 'dbark.query-result-snapshot' || own(source, 'version') !== 1) throw Error(text.version);
  const budget = { bytes: '{"kind":"dbark.query-result-snapshot","version":1,'.length, cells: 0 };
  let name: string | undefined;
  if (Object.hasOwn(source, 'name')) { add(budget, '"name":'.length); name = string(own(source, 'name'), queryResultSnapshotLimits.nameBytes, budget); add(budget, 1); }
  add(budget, '"result":'.length); const captured = result(own(source, 'result'), budget, wire); add(budget, '}\n'.length);
  return { kind: 'dbark.query-result-snapshot', version: 1, ...(name === undefined ? {} : { name }), result: captured };
}

/** 捕获当前已返回结果，不补读数据库，不接受QueryOutcome/连接状态代替单个结果。 */
export function createQueryResultSnapshot(value: QueryResult, name?: string): QueryResultSnapshotDocument {
  return document({ kind: 'dbark.query-result-snapshot', version: 1, ...(name === undefined ? {} : { name }), result: value }, false);
}
/** 内存文档同样严格检查，返回独立副本，保存失败不改源固定结果。 */
export function parseQueryResultSnapshot(value: unknown): QueryResultSnapshotDocument { return document(value, false); }

/** 只序列化已经校验的自有值；不对任意JS对象调用JSON.stringify或toJSON。 */
export function encodeQueryResultSnapshot(value: QueryResultSnapshotDocument): string {
  const checked = parseQueryResultSnapshot(value), output: string[] = [];
  const quoted = (value: string) => JSON.stringify(value);
  const numeric = (value: number) => '{"type":"number","text":' + quoted(Object.is(value, -0) ? '-0' : String(value)) + '}';
  const literal = (value: CellValue): string => value === null ? 'null' : typeof value === 'boolean' ? String(value) : typeof value === 'string' ? quoted(value) : typeof value === 'number' ? numeric(value) : '{"type":"binary","base64":' + quoted(value.base64) + '}';
  output.push('{"kind":"dbark.query-result-snapshot","version":1,');
  if (checked.name !== undefined) output.push('"name":', quoted(checked.name), ',');
  const source = checked.result;
  output.push('"result":{"columns":[');
  for (let index = 0; index < source.columns.length; index++) { const column = source.columns[index]; if (index) output.push(','); output.push('{"key":', quoted(column.key), ',"name":', quoted(column.name), ',"type":', quoted(column.type), '}'); }
  output.push('],"rows":[');
  for (let index = 0; index < source.rows.length; index++) {
    if (index) output.push(','); output.push('{');
    for (let column = 0; column < source.columns.length; column++) { if (column) output.push(','); const key = source.columns[column].key; output.push(quoted(key), ':', literal(source.rows[index][key])); }
    output.push('}');
  }
  output.push('],"truncated":', String(source.truncated), ',"elapsedMs":', numeric(source.elapsedMs));
  for (const key of optionalResult) if (Object.hasOwn(source, key)) output.push(',', quoted(key), ':', key === 'insertId' ? quoted(source.insertId!) : numeric(source[key]!));
  output.push(',"statement":', quoted(source.statement), '}}\n');
  return output.join('');
}

/** JSON子集解析器在构建对象时拒绝重复解码键；数字仅允许版本的canonical 1。 */
function parseJson(source: string): unknown {
  let position = 0, nodes = 0;
  const whitespace = () => { while (position < source.length && /[\x20\t\r\n]/.test(source[position])) position++; };
  const stringToken = (): string => {
    const start = position++;
    while (position < source.length) {
      const code = source.charCodeAt(position++);
      if (code === 34) {
        let value: unknown; try { value = JSON.parse(source.slice(start, position)); } catch { return invalid(); }
        return stringSize(value, queryResultSnapshotLimits.bytes).value;
      }
      if (code < 32) return invalid();
      if (code === 92) {
        const escaped = source[position++];
        if (escaped === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(source.slice(position, position + 4))) return invalid(); position += 4; }
        else if (!escaped || !'"\\/bfnrt'.includes(escaped)) return invalid();
      }
    }
    return invalid();
  };
  const value = (depth: number): unknown => {
    if (depth > queryResultSnapshotLimits.jsonDepth || ++nodes > queryResultSnapshotLimits.jsonNodes) return large();
    whitespace(); const character = source[position];
    if (character === '"') return stringToken();
    if (character === '{') {
      position++; const result = Object.create(null) as Record<string, unknown>, keys = new Set<string>(); whitespace();
      if (source[position] === '}') { position++; return result; }
      while (position < source.length) {
        whitespace(); if (source[position] !== '"') return invalid(); const key = stringToken();
        if (keys.has(key)) throw Error(text.duplicate);
        if (keys.size >= queryResultSnapshotLimits.columns) return large(); keys.add(key);
        whitespace(); if (source[position++] !== ':') return invalid(); result[key] = value(depth + 1); whitespace();
        const end = source[position++]; if (end === '}') return result; if (end !== ',') return invalid();
      }
      return invalid();
    }
    if (character === '[') {
      position++; const result: unknown[] = []; whitespace();
      if (source[position] === ']') { position++; return result; }
      while (position < source.length) {
        if (result.length >= queryResultSnapshotLimits.rows) return large(); result.push(value(depth + 1)); whitespace();
        const end = source[position++]; if (end === ']') return result; if (end !== ',') return invalid();
      }
      return invalid();
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null], ['1', 1]] as const) {
      if (source.startsWith(token, position)) { position += token.length; if (position < source.length && !/[\x20\t\r\n,}\]]/.test(source[position])) return invalid(); return result; }
    }
    return invalid();
  };
  const result = value(0); whitespace(); if (position !== source.length) return invalid(); return result;
}

/** 先限原始文件字节再解析；字符串调用方也须先由文件层fatal UTF-8解码。 */
export function decodeQueryResultSnapshot(value: string | Uint8Array): QueryResultSnapshotDocument {
  let source: string;
  if (typeof value === 'string') { stringSize(value, queryResultSnapshotLimits.bytes); source = value; }
  else {
    if (!(value instanceof Uint8Array)) return invalid();
    let length: number;
    try { length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(value) as number; } catch { return invalid(); }
    if (length > queryResultSnapshotLimits.bytes) return large();
    try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value); } catch { throw Error(text.encoding); }
  }
  return document(parseJson(source), true);
}
