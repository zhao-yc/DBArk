import type { CellValue, QueryOutcome, QueryResult } from './contracts';
import { parseExplainPlan } from './explain';
import { parseQueryAnalyzePlan } from './queryAnalyze';
import { explainSnapshotZh as text } from './explainSnapshot.zh-CN';

export const explainSnapshotLimits = { bytes: 1048576, columns: 64, rows: 1000, warnings: 64, version: 256, cell: 196608, raw: 196608, column: 2048, warning: 16000, items: 70000 } as const;
export type SnapshotCell = null | string | boolean | { type: 'number'; text: string } | { type: 'binary'; base64: string };
export interface ExplainSnapshotDocument {
  kind: 'dbark.explain-snapshot'; version: 1; dialect: 'mysql' | 'mariadb'; serverVersion: string; format: 'json' | 'text';
  raw: string; rawTruncated: boolean; warnings: string[];
  result: { columns: { key: string; name: string; type: string }[]; rows: Record<string, SnapshotCell>[]; truncated: boolean };
}
export interface AnalyzeSnapshotDocument {
  kind: 'dbark.analyze-snapshot'; version: 1; dialect: 'mysql' | 'mariadb'; serverVersion: string; format: 'tree' | 'json';
  raw: string; rawTruncated: boolean; warnings: string[];
  result: ExplainSnapshotDocument['result'];
}
export type PlanSnapshotDocument = ExplainSnapshotDocument | AnalyzeSnapshotDocument;
type Budget = { bytes: number; items: number };
const invalid = (): never => { throw Error(text.invalid); };
const large = (): never => { throw Error(text.tooLarge); };

/** 只读取自有数据描述符；访问器永远不执行。 */
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return invalid();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
  return descriptor.value;
}

/** 文件容器只接受普通对象或空原型对象，并拒绝符号和未声明字段。 */
function record(value: unknown, fields?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const keys = Reflect.ownKeys(value);
  if (fields && (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key)))) return invalid();
  for (const key of keys) { if (typeof key !== 'string') return invalid(); own(value, key); }
  return value as Record<string, unknown>;
}

/** 先核对长度和稠密索引，随后才分配有限输出；额外数组字段同样拒绝。 */
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0) return invalid();
  if (length > maximum) return large();
  if (Reflect.ownKeys(value).length !== length + 1) return invalid();
  for (let index = 0; index < length; index++) own(value, String(index));
  return value;
}

/** 逐码元计入真实 UTF-8 字节，拒绝孤立代理项；不先编码超大字符串。 */
function string(value: unknown, maximum: number, budget: Budget, encodedBudget = true): string {
  if (typeof value !== 'string') return invalid();
  if (value.length > maximum) return large();
  let bytes = 0, encoded = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return invalid();
      bytes += 4; encoded += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) return invalid();
    else {
      const width = code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
      bytes += width;
      encoded += code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code) ? 2 : code < 32 ? 6 : width;
    }
    if (bytes > maximum) return large();
  }
  budget.bytes += encodedBudget ? encoded : bytes;
  if (budget.bytes > explainSnapshotLimits.bytes) return large();
  return value;
}

/** 标签数值必须是 Number 的唯一最短往返串，负零另行明确标记。 */
function numberText(value: unknown, budget: Budget): string {
  const valueText = string(value, 32, budget), number = Number(valueText);
  if (!Number.isFinite(number) || (valueText !== '-0' && String(number) !== valueText)) return invalid();
  return valueText;
}

/** 标准 Base64 的末位填充比特也检查，避免同一字节出现多种文本。 */
function binary(value: unknown, budget: Budget): { type: 'binary'; base64: string } {
  record(value, ['type', 'base64']);
  if (own(value, 'type') !== 'binary') return invalid();
  const base64 = string(own(value, 'base64'), explainSnapshotLimits.cell, budget);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) return invalid();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (base64.endsWith('==') && (alphabet.indexOf(base64[base64.length - 3]) & 15) !== 0) return invalid();
  if (!base64.endsWith('==') && base64.endsWith('=') && (alphabet.indexOf(base64[base64.length - 2]) & 3) !== 0) return invalid();
  return { type: 'binary', base64 };
}

/** 捕获时把有限数字显式标签化；文件读取时不接受裸数字或任意对象。 */
function cell(value: unknown, budget: Budget, capture: boolean): SnapshotCell {
  if (++budget.items > explainSnapshotLimits.items) return large();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return string(value, explainSnapshotLimits.cell, budget);
  if (capture && typeof value === 'number') {
    if (!Number.isFinite(value)) return invalid();
    return { type: 'number', text: numberText(Object.is(value, -0) ? '-0' : String(value), budget) };
  }
  record(value);
  if (own(value, 'type') === 'binary') return binary(value, budget);
  if (!capture && own(value, 'type') === 'number') {
    record(value, ['type', 'text']);
    return { type: 'number', text: numberText(own(value, 'text'), budget) };
  }
  return invalid();
}

/** 结果列键精确匹配；空原型行保证 __proto__ 等服务器列名不会改写原型。 */
function result(value: unknown, budget: Budget, capture: boolean): ExplainSnapshotDocument['result'] {
  record(value, capture ? undefined : ['columns', 'rows', 'truncated']);
  const sourceColumns = array(own(value, 'columns'), explainSnapshotLimits.columns);
  const sourceRows = array(own(value, 'rows'), explainSnapshotLimits.rows);
  const truncated = own(value, 'truncated');
  if (typeof truncated !== 'boolean') return invalid();
  const keys = new Set<string>();
  const columns = sourceColumns.map(column => {
    record(column, ['key', 'name', 'type']);
    const key = string(own(column, 'key'), explainSnapshotLimits.column, budget);
    if (keys.has(key)) return invalid();
    keys.add(key);
    return { key, name: string(own(column, 'name'), explainSnapshotLimits.column, budget), type: string(own(column, 'type'), explainSnapshotLimits.column, budget) };
  });
  const rows = sourceRows.map(row => {
    record(row, [...keys]);
    const output = Object.create(null) as Record<string, SnapshotCell>;
    for (const key of keys) {
      // 列键在每行都会重新编码，不能只按目录中的一次字符串计量。
      string(key, explainSnapshotLimits.column, budget);
      output[key] = cell(own(row, key), budget, capture);
    }
    return output;
  });
  return { columns, rows, truncated };
}

/** 有界深复制只保存原始计划和结果，不信任输入节点、路径或派生指标。 */
function document(value: unknown, capture = false): ExplainSnapshotDocument {
  record(value, ['kind', 'version', 'dialect', 'serverVersion', 'format', 'raw', 'rawTruncated', 'warnings', 'result']);
  const budget: Budget = { bytes: 0, items: 0 };
  if (own(value, 'kind') !== 'dbark.explain-snapshot' || own(value, 'version') !== 1) return invalid();
  const dialect = own(value, 'dialect'), format = own(value, 'format'), rawTruncated = own(value, 'rawTruncated');
  if ((dialect !== 'mysql' && dialect !== 'mariadb') || (format !== 'json' && format !== 'text') || typeof rawTruncated !== 'boolean') return invalid();
  const serverVersion = string(own(value, 'serverVersion'), explainSnapshotLimits.version, budget);
  const raw = string(own(value, 'raw'), explainSnapshotLimits.raw, budget);
  if (format === 'text' && raw !== '') return invalid();
  const warnings = array(own(value, 'warnings'), explainSnapshotLimits.warnings).map(item => string(item, explainSnapshotLimits.warning, budget));
  const output: ExplainSnapshotDocument = { kind: 'dbark.explain-snapshot', version: 1, dialect, serverVersion, format, raw, rawTruncated, warnings, result: result(own(value, 'result'), budget, capture) };
  if (format === 'json' && output.result.columns.length === 1 && output.result.rows.length === 1 && output.result.rows[0][output.result.columns[0].key] !== raw) return invalid();
  // 前面已经限定累计字符串和单元格数，最终 JSON 编码不会从无界输入扩张。
  if (new TextEncoder().encode(JSON.stringify(output) + '\n').byteLength > explainSnapshotLimits.bytes) return large();
  return output;
}

/** 捕获单个真实 EXPLAIN 结果；SQL、连接、会话、耗时和派生节点从不进入文件。 */
export function captureExplainSnapshot(outcome: QueryOutcome): ExplainSnapshotDocument {
  record(outcome);
  const results = array(own(outcome, 'results'), 1);
  if (results.length !== 1) return invalid();
  const plan = own(outcome, 'explain'); record(plan);
  return document({ kind: 'dbark.explain-snapshot', version: 1, dialect: own(plan, 'dialect'), serverVersion: own(plan, 'version'), format: own(plan, 'format'), raw: own(plan, 'raw'), rawTruncated: own(plan, 'rawTruncated'), warnings: own(plan, 'warnings'), result: results[0] }, true);
}

/** 严格版本化文件入口；验证失败不会修改源对象。 */
export function parseExplainSnapshot(value: unknown): ExplainSnapshotDocument { return document(value); }

/** 离线恢复仅重建展示树，始终清空语句和耗时，不保留活动事务状态。 */
export function explainSnapshotOutcome(value: ExplainSnapshotDocument): QueryOutcome {
  const snapshot = parseExplainSnapshot(value);
  const plan = snapshot.format === 'json' ? parseExplainPlan(snapshot.raw, snapshot.dialect, snapshot.serverVersion)
    : { dialect: snapshot.dialect, version: snapshot.serverVersion, format: 'text' as const, raw: '', rawTruncated: false, nodes: [], warnings: [] };
  plan.rawTruncated = snapshot.rawTruncated;
  // 保存的警告保留顺序；新解析器诊断不能被文件中的空数组抹掉，也不能反复往返增长。
  const diagnostics = [...new Set(plan.warnings)].slice(0, explainSnapshotLimits.warnings);
  const savedWarnings = [...new Set(snapshot.warnings)].filter(warning => !diagnostics.includes(warning));
  plan.warnings = [...savedWarnings.slice(0, explainSnapshotLimits.warnings - diagnostics.length), ...diagnostics];
  const rows = snapshot.result.rows.map(row => {
    const output = Object.create(null) as Record<string, CellValue>;
    for (const column of snapshot.result.columns) {
      const value = row[column.key];
      output[column.key] = value && typeof value === 'object' && value.type === 'number' ? Number(value.text) : value;
    }
    return output;
  });
  const restored: QueryResult = { columns: snapshot.result.columns, rows, truncated: snapshot.result.truncated, elapsedMs: 0, statement: '' };
  return { results: [restored], elapsedMs: 0, explain: plan };
}

/** 只编码校验后的独立副本；文件固定 UTF-8 JSON 加一个换行。 */
export function encodeExplainSnapshot(value: ExplainSnapshotDocument): string { return JSON.stringify(parseExplainSnapshot(value)) + '\n'; }

/** 在 JSON.parse 分配前先限制文件字节；UTF-8 的严格字节解码由主进程执行。 */
export function decodeExplainSnapshot(value: string): ExplainSnapshotDocument {
  string(value, explainSnapshotLimits.bytes, { bytes: 0, items: 0 }, false);
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return invalid(); }
  return parseExplainSnapshot(parsed);
}

/** 实测格式独立版本化；只有明确标记不完整的输出才允许保留异常原始结果容器。 */
function analyzeDocument(value: unknown, capture = false): AnalyzeSnapshotDocument {
  record(value, ['kind', 'version', 'dialect', 'serverVersion', 'format', 'raw', 'rawTruncated', 'warnings', 'result']);
  const budget: Budget = { bytes: 0, items: 0 };
  if (own(value, 'kind') !== 'dbark.analyze-snapshot' || own(value, 'version') !== 1) return invalid();
  const dialect = own(value, 'dialect'), format = own(value, 'format'), rawTruncated = own(value, 'rawTruncated');
  if ((dialect !== 'mysql' && dialect !== 'mariadb') || (format !== 'tree' && format !== 'json') || typeof rawTruncated !== 'boolean' || dialect === 'mysql' && format !== 'tree' || dialect === 'mariadb' && format !== 'json') return invalid();
  const serverVersion = string(own(value, 'serverVersion'), explainSnapshotLimits.version, budget);
  const raw = string(own(value, 'raw'), explainSnapshotLimits.raw, budget);
  const warnings = array(own(value, 'warnings'), explainSnapshotLimits.warnings).map(item => string(item, explainSnapshotLimits.warning, budget));
  const output: AnalyzeSnapshotDocument = { kind: 'dbark.analyze-snapshot', version: 1, dialect, serverVersion, format, raw, rawTruncated, warnings, result: result(own(value, 'result'), budget, capture) };
  const oneCell = output.result.columns.length === 1 && output.result.rows.length === 1;
  const originalCell = oneCell ? output.result.rows[0][output.result.columns[0].key] : undefined;
  // 不完整标记也不能掩盖两份互相矛盾的单格文本；非文本/多格仅供明确不完整的结果回看。
  if (oneCell && typeof originalCell === 'string' && originalCell !== raw) return invalid();
  if (!rawTruncated && !output.result.truncated && (!oneCell || typeof originalCell !== 'string' || originalCell !== raw)) return invalid();
  if (new TextEncoder().encode(JSON.stringify(output) + '\n').byteLength > explainSnapshotLimits.bytes) return large();
  return output;
}

/** 通用捕获只选择一种计划来源；原文条件可能含业务字面值，但不会主动保存原SQL字段。 */
export function capturePlanSnapshot(outcome: QueryOutcome): PlanSnapshotDocument {
  record(outcome);
  const estimated = Object.hasOwn(outcome, 'explain'), actual = Object.hasOwn(outcome, 'analysis');
  if (estimated === actual) return invalid();
  if (estimated) return captureExplainSnapshot(outcome);
  const results = array(own(outcome, 'results'), 1);
  if (results.length !== 1) return invalid();
  const plan = own(outcome, 'analysis'); record(plan);
  return analyzeDocument({ kind: 'dbark.analyze-snapshot', version: 1, dialect: own(plan, 'dialect'), serverVersion: own(plan, 'version'), format: own(plan, 'format'), raw: own(plan, 'raw'), rawTruncated: own(plan, 'rawTruncated'), warnings: own(plan, 'warnings'), result: results[0] }, true);
}

/** 文件kind严格分流，旧估算v1和新实测v1不能互相冒充或借用另一方的格式。 */
export function parsePlanSnapshot(value: unknown): PlanSnapshotDocument {
  record(value, ['kind', 'version', 'dialect', 'serverVersion', 'format', 'raw', 'rawTruncated', 'warnings', 'result']);
  const kind = own(value, 'kind');
  if (kind === 'dbark.explain-snapshot') return parseExplainSnapshot(value);
  if (kind === 'dbark.analyze-snapshot') return analyzeDocument(value);
  return invalid();
}

/** 只从文件重建展示，不建立会话；两种截断事实都禁止将实测前缀解析为完整树。 */
export function planSnapshotOutcome(value: PlanSnapshotDocument): QueryOutcome {
  const snapshot = parsePlanSnapshot(value);
  if (snapshot.kind === 'dbark.explain-snapshot') return explainSnapshotOutcome(snapshot);
  const analysis = parseQueryAnalyzePlan(snapshot.raw, snapshot.dialect, snapshot.serverVersion, snapshot.format, snapshot.rawTruncated || snapshot.result.truncated);
  const diagnostics = [...new Set(analysis.warnings)].slice(0, explainSnapshotLimits.warnings);
  const savedWarnings = [...new Set(snapshot.warnings)].filter(warning => !diagnostics.includes(warning));
  analysis.warnings = [...savedWarnings.slice(0, explainSnapshotLimits.warnings - diagnostics.length), ...diagnostics];
  const rows = snapshot.result.rows.map(row => {
    const output = Object.create(null) as Record<string, CellValue>;
    for (const column of snapshot.result.columns) {
      const value = row[column.key];
      output[column.key] = value && typeof value === 'object' && value.type === 'number' ? Number(value.text) : value;
    }
    return output;
  });
  return { results: [{ columns: snapshot.result.columns, rows, truncated: snapshot.result.truncated, elapsedMs: 0, statement: '' }], elapsedMs: 0, analysis };
}

/** 编码独立校验副本；离线另存应传原文件文档，不能重捕获派生展示状态。 */
export function encodePlanSnapshot(value: PlanSnapshotDocument): string { return JSON.stringify(parsePlanSnapshot(value)) + '\n'; }

/** 解析前沿用1MiB字节预算；严格UTF-8字节解码仍由Main负责。 */
export function decodePlanSnapshot(value: string): PlanSnapshotDocument {
  string(value, explainSnapshotLimits.bytes, { bytes: 0, items: 0 }, false);
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return invalid(); }
  return parsePlanSnapshot(parsed);
}
