import { parseExplainPlan, readExplainJson } from './explain';

/** 实测计划只保留有界原文和展示节点；指标保留服务器十进制文本，不求和或转浮点数。 */
export const queryAnalyzeLimits = { rawBytes: 192 * 1024, nodes: 300, depth: 64, label: 1024, path: 2048, metrics: 32, metricValue: 80 } as const;
export type QueryAnalyzeDialect = 'mysql' | 'mariadb';
export type QueryAnalyzeFormat = 'tree' | 'json';
export interface QueryAnalyzeMetric {
  source: string; value: string; kind: 'actual' | 'estimate'; unit?: 'ms' | 'rows' | 'loops' | 'percent' | 'cost';
}
export interface QueryAnalyzeNode {
  id: string; parent?: string; depth: number; label: string; path?: string; pathTruncated?: boolean;
  metrics: QueryAnalyzeMetric[]; neverExecuted?: boolean;
}
export interface QueryAnalyzePlan {
  dialect: QueryAnalyzeDialect; version: string; format: QueryAnalyzeFormat;
  raw: string; rawTruncated: boolean; nodes: QueryAnalyzeNode[]; warnings: string[];
}
export interface QueryAnalyzeCapability {
  supported: boolean; sqlPrefix?: string; format?: QueryAnalyzeFormat; reason?: string;
}

/** 能力只取真实握手版本，不执行探测或降级重放；8.0.18至20尚不接受显式FORMAT。 */
export function queryAnalyzeCapability(status: { dialect: QueryAnalyzeDialect; version: string }): QueryAnalyzeCapability {
  const unsupported = (reason: string): QueryAnalyzeCapability => ({ supported: false, reason });
  if (!status || typeof status.version !== 'string') return unsupported('无法确认当前服务器版本，未启用实际执行分析。');
  const source = status.dialect === 'mariadb' ? status.version.replace(/^5\.5\.5-/, '') : status.version;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,6})(?:$|[-+.\s])/.exec(source);
  if (!match) return unsupported('无法确认当前服务器版本，未启用实际执行分析。');
  const [major, minor, patch] = match.slice(1).map(Number);
  if (status.dialect === 'mysql') {
    if (/mariadb/i.test(source)) return unsupported('服务器版本与MySQL方言不一致，请核对连接。');
    if (major > 8 || major === 8 && (minor > 0 || patch >= 18)) {
      const explicitFormat = major > 8 || minor > 0 || patch >= 21;
      return { supported: true, sqlPrefix: explicitFormat ? 'EXPLAIN ANALYZE FORMAT=TREE' : 'EXPLAIN ANALYZE', format: 'tree' };
    }
    return unsupported('当前MySQL版本不支持实际执行分析，需要MySQL 8.0.18及以上；仍可查看估算执行计划。');
  }
  if (status.dialect === 'mariadb') {
    if (major > 10 || major === 10 && minor >= 1) return { supported: true, sqlPrefix: 'ANALYZE FORMAT=JSON', format: 'json' };
    return unsupported('当前MariaDB版本不支持JSON实际执行分析，需要MariaDB 10.1及以上。');
  }
  return unsupported('当前数据库方言不支持实际执行分析。');
}

/** UTF-16前缀不拆完整代理对；仅展示标签可截断，数值永不截成另一个数。 */
function prefix(value: string, maximum: number): string {
  let end = Math.min(value.length, maximum);
  if (end < value.length && end > 0 && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--;
  return value.slice(0, end);
}

/** 先取有界候选再计UTF-8字节，避免对任意长输入生成同等大的编码副本。 */
function boundedRaw(raw: string): { raw: string; truncated: boolean } {
  const encoder = new TextEncoder(), candidate = raw.slice(0, queryAnalyzeLimits.rawBytes + 1);
  if (candidate.length === raw.length && encoder.encode(candidate).byteLength <= queryAnalyzeLimits.rawBytes) return { raw, truncated: false };
  let low = 0, high = candidate.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(candidate.slice(0, middle)).byteLength <= queryAnalyzeLimits.rawBytes) low = middle; else high = middle - 1;
  }
  return { raw: prefix(candidate, low), truncated: true };
}

const numeric = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const numberPattern = new RegExp('^' + numeric + '$');
const actualPattern = new RegExp('\\s+\\(actual time=(' + numeric + ')\\.\\.(' + numeric + ') rows=(' + numeric + ') loops=(' + numeric + ')\\)$');
const costPattern = new RegExp('\\s+\\(cost=(' + numeric + ')(?:\\.\\.(' + numeric + '))? rows=(' + numeric + ')\\)$');
const continuationGroup = '(?:\\(actual time=' + numeric + '\\.\\.' + numeric + ' rows=' + numeric + ' loops=' + numeric + '\\)|\\(cost=' + numeric + '(?:\\.\\.' + numeric + ')? rows=' + numeric + '\\)|\\(never executed\\))';
const continuationPattern = new RegExp('^' + continuationGroup + '(?:\\s+' + continuationGroup + ')*$');

/** 每个指标独立确认原文与长度；无值或非法值保持缺失，不补零。 */
function addMetric(node: QueryAnalyzeNode, source: string, value: unknown, kind: QueryAnalyzeMetric['kind'], unit: QueryAnalyzeMetric['unit'], plan: QueryAnalyzePlan): void {
  if (typeof value !== 'string' || !numberPattern.test(value)) return;
  if (value.length > queryAnalyzeLimits.metricValue) { warning(plan, '部分数值超过80字符展示上限，未截短为另一个数；请查看原始输出。'); return; }
  if (node.metrics.length < queryAnalyzeLimits.metrics) node.metrics.push({ source, value, kind, unit });
}

/** 警告去重，异常节点数不能放大跨进程表示。 */
function warning(plan: QueryAnalyzePlan, message: string): void { if (!plan.warnings.includes(message)) plan.warnings.push(message); }

/** 仅把完整指标组续行归属前一个箭头；普通描述续行不能用于推测节点或层级。 */
function mysqlLines(plan: QueryAnalyzePlan): { indent: number; description: string; lineNumber: number }[] | undefined {
  const output: { indent: number; description: string; lineNumber: number }[] = [];
  let lineNumber = 0;
  for (const line of plan.raw.split(/\r?\n/)) {
    lineNumber++;
    if (!line.trim()) continue;
    const found = /^( *)-> (.+)$/.exec(line);
    if (found) {
      output.push({ indent: found[1].length, description: found[2].trimEnd(), lineNumber });
      // 多读一条只用于证明仍有未展示节点；最终是否先触及深度上限由树构造阶段报告。
      if (output.length > queryAnalyzeLimits.nodes) break;
    } else if (output.length && continuationPattern.test(line.trim())) output[output.length - 1].description += ' ' + line.trim();
    else { warning(plan, 'TREE输出含无法确认的行，未推测节点关系；请查看原始输出。'); return; }
  }
  return output;
}

/** MySQL的首/末行时间及行数是服务器每轮指标，循环次数单列，禁止相乘或父子求和。 */
function mysqlTree(plan: QueryAnalyzePlan): void {
  const parents: { indent: number; node: QueryAnalyzeNode }[] = [];
  const lines = mysqlLines(plan);
  if (!lines) return;
  for (const line of lines) {
    const { indent, lineNumber } = line;
    while (parents.length && parents[parents.length - 1].indent >= indent) parents.pop();
    if (parents.length >= queryAnalyzeLimits.depth) { warning(plan, '树形展示达到64层上限，其余内容请查看原始输出。'); break; }
    if (plan.nodes.length >= queryAnalyzeLimits.nodes) { warning(plan, '树形展示达到300个节点上限，其余内容请查看原始输出。'); break; }
    let description = line.description;
    const node: QueryAnalyzeNode = { id: String(plan.nodes.length), parent: parents.at(-1)?.node.id, depth: parents.length, label: '', path: 'line:' + lineNumber, metrics: [] };
    const actual = actualPattern.exec(description);
    if (actual) {
      addMetric(node, 'actual.first_row_time_ms', actual[1], 'actual', 'ms', plan);
      addMetric(node, 'actual.last_row_time_ms', actual[2], 'actual', 'ms', plan);
      addMetric(node, 'actual.rows', actual[3], 'actual', 'rows', plan);
      addMetric(node, 'actual.loops', actual[4], 'actual', 'loops', plan);
      description = description.slice(0, actual.index);
    } else if (/\s+\(never executed\)$/.test(description)) {
      node.neverExecuted = true; description = description.replace(/\s+\(never executed\)$/, '');
    } else if (/\(actual\b|\(never executed\b/.test(description)) warning(plan, '部分TREE节点的实测指标格式未识别，未推测或补零；请查看原始输出。');
    const estimate = costPattern.exec(description);
    if (estimate) {
      addMetric(node, estimate[2] === undefined ? 'cost' : 'cost.first', estimate[1], 'estimate', 'cost', plan);
      if (estimate[2] !== undefined) addMetric(node, 'cost.last', estimate[2], 'estimate', 'cost', plan);
      addMetric(node, 'rows', estimate[3], 'estimate', 'rows', plan);
      description = description.slice(0, estimate.index);
    }
    node.label = prefix(description, queryAnalyzeLimits.label);
    if (node.label.length < description.length) warning(plan, '部分节点标签超过1024字符，完整描述请查看原始输出。');
    plan.nodes.push(node); parents.push({ indent, node });
  }
  if (!plan.nodes.length) warning(plan, '没有可生成树的实测计划节点，请查看原始输出。');
  else if (!plan.nodes.some(node => node.neverExecuted || node.metrics.some(item => item.kind === 'actual'))) warning(plan, '当前TREE输出未提供可识别的实测指标，未将估算值当作实际耗时。');
}

/** JSON Pointer逐段只读自身字段，__proto__等真实键不落到原型。 */
function ownPath(document: unknown, path: string): unknown {
  let value = document;
  for (const segment of path.split('/').slice(1)) {
    if (!value || typeof value !== 'object') return;
    value = Object.getOwnPropertyDescriptor(value, segment.replaceAll('~1', '/').replaceAll('~0', '~'))?.value;
  }
  return value;
}

/** MariaDB保留JSON包含关系；r_total_time_ms含子节点，不与其他时间叠加。 */
function mariaJson(plan: QueryAnalyzePlan): void {
  const document = readExplainJson(plan.raw), estimated = parseExplainPlan(plan.raw, 'mariadb', plan.version);
  plan.warnings.push(...estimated.warnings);
  if (!estimated.nodes.length) return;
  plan.nodes = estimated.nodes.map(item => {
    const label = item.kind + (item.name === undefined ? '' : ' · ' + item.name);
    const node: QueryAnalyzeNode = { id: item.id, parent: item.parent, depth: item.depth, label: prefix(label, queryAnalyzeLimits.label), path: item.path, ...(item.pathTruncated ? { pathTruncated: true } : {}), metrics: [] };
    for (const [source, metric, unit] of [['rows', item.rows, 'rows'], ['filtered', item.filtered, 'percent']] as const) if (metric) addMetric(node, source, metric.value, 'estimate', unit, plan);
    for (const metric of item.costs) addMetric(node, metric.source, metric.value, 'estimate', 'cost', plan);
    // 已截断路径不能被误用于另一个同名前缀节点；原估算指标来自原记录，不受此查找影响。
    const record = item.pathTruncated ? undefined : ownPath(document, item.path);
    if (record && typeof record === 'object' && !Array.isArray(record)) {
      for (const [source, unit] of [['r_total_time_ms', 'ms'], ['r_table_time_ms', 'ms'], ['r_other_time_ms', 'ms'], ['r_rows', 'rows'], ['r_loops', 'loops'], ['r_filtered', 'percent'], ['pages_read_time_ms', 'ms']] as const) {
        addMetric(node, source, Object.getOwnPropertyDescriptor(record, source)?.value, 'actual', unit, plan);
      }
    }
    return node;
  });
  if (!plan.nodes.some(node => node.metrics.some(item => item.kind === 'actual'))) warning(plan, '当前JSON输出未提供可识别的实测指标，未将估算值当作实际耗时。');
}

/** 原文被驱动或字节预算截断时不解析前缀，格式错误仍可查看有界原文，绝不执行SQL。 */
export function parseQueryAnalyzePlan(raw: string, dialect: QueryAnalyzeDialect, version: string, format: QueryAnalyzeFormat, sourceTruncated = false): QueryAnalyzePlan {
  const bounded = boundedRaw(raw);
  const plan: QueryAnalyzePlan = { dialect, version, format, raw: bounded.raw, rawTruncated: bounded.truncated || sourceTruncated, nodes: [], warnings: [] };
  if (plan.rawTruncated) { warning(plan, '实际执行分析输出不完整或超过192KiB上限，未从截断前缀生成树；请缩小分析语句。'); return plan; }
  if (!raw.trim()) { warning(plan, '服务器没有返回可展示的实际执行分析输出。'); return plan; }
  if (dialect === 'mysql' && format !== 'tree' || dialect === 'mariadb' && format !== 'json') { warning(plan, '实际执行分析格式与数据库方言不一致，未推测计划结构。'); return plan; }
  try { if (format === 'tree') mysqlTree(plan); else mariaJson(plan); }
  catch (reason) { plan.nodes = []; warning(plan, reason instanceof Error ? reason.message : '实际执行分析输出解析失败，请查看原始输出。'); }
  return plan;
}
