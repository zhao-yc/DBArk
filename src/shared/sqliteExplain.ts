import type { QueryResult } from './contracts';

export const sqliteExplainLimits = { rows: 1000, nodes: 300, depth: 64, detail: 16000, rawBytes: 192 * 1024 } as const;
export const sqliteExplainMessages = {
  columns: 'SQLite 计划列与当前支持的四列格式不一致，请查看原始表格。',
  truncated: 'SQLite 计划结果已达到返回上限，不能从不完整结果生成关系树。',
  nodes: 'SQLite 计划超过 300 个节点，仅显示原始表格。',
  relation: 'SQLite 计划的节点编号或父子关系无法可靠确认，仅显示原始表格。',
  depth: 'SQLite 计划超过 64 层，仅显示原始表格。',
  detail: 'SQLite 计划说明超过树展示上限，请查看原始表格。',
  raw: '原始计划展示达到 192 KiB 上限，以下只保留输出前缀。',
} as const;
/** 节点标识、辅助值和说明只保留SQLite原值；不把说明文字解析成估计成本或实际耗时。 */
export interface SqliteExplainNode { id: string; parent?: string; depth: number; detail: string; auxiliary: string; }
export interface SqliteExplainPlan {
  dialect: 'sqlite'; version: string; initialView: 'tree' | 'table'; nodes: SqliteExplainNode[];
  raw: string; rawTruncated: boolean; warnings: string[];
}

/** 只读取自有数据字段；损坏的关系不能通过访问器执行代码或假装成有效节点。 */
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
/** 行号沿原有精确文本保存；只接纳真实整数，不接受浮点或已失精的number。 */
function integer(value: unknown, signed = false): string | undefined {
  const text = typeof value === 'string' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : undefined;
  if (text === undefined || !(signed ? /^(?:0|-?[1-9]\d{0,18})$/ : /^(?:0|[1-9]\d{0,18})$/).test(text)) return undefined;
  const parsed = BigInt(text);
  return parsed >= (signed ? -9223372036854775808n : 0n) && parsed <= 9223372036854775807n ? text : undefined;
}

/** 原始四列按实际返回顺序编码；先限标量输入再编码，超限只留明确标记的UTF8完整前缀。 */
function rawPlan(result: QueryResult): { raw: string; truncated: boolean } {
  let raw = '', bytes = 0, truncated = false;
  const encoder = new TextEncoder();
  const append = (value: string) => {
    if (truncated) return;
    const remaining = sqliteExplainLimits.rawBytes - bytes, encoded = encoder.encode(value);
    if (encoded.length <= remaining) { raw += value; bytes += encoded.length; return; }
    let length = 0, used = 0;
    for (const character of value) { const size = encoder.encode(character).length; if (used + size > remaining) break; used += size; length += character.length; }
    raw += value.slice(0, length); bytes += used; truncated = true;
  };
  const scalar = (value: unknown) => {
    if (typeof value === 'string') {
      // 即使单元格为16MiB，也只编码最多192KiB字符，避免JSON转义先分配无界副本。
      let end = Math.min(value.length, sqliteExplainLimits.rawBytes);
      if (end && end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--;
      append(JSON.stringify(value.slice(0, end)));
      if (end < value.length) truncated = true;
    } else if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) append(JSON.stringify(value));
    else if (own(value, 'type') === 'binary' && typeof own(value, 'base64') === 'string') { append('{"type":"binary","base64":'); scalar(own(value, 'base64')); append('}'); }
    else append('null');
  };
  const columns = Array.isArray(result.columns) ? result.columns.slice(0, 64) : [], rows = Array.isArray(result.rows) ? result.rows : [];
  append('{"columns":[');
  columns.forEach((column, index) => { if (index) append(','); scalar(own(column, 'name')); });
  append('],"rows":[');
  for (let index = 0; index < Math.min(rows.length, sqliteExplainLimits.rows) && !truncated; index++) {
    if (index) append(','); append('[');
    columns.forEach((column, field) => { if (field) append(','); const key = own(column, 'key'); scalar(typeof key === 'string' ? own(rows[index], key) : undefined); });
    append(']');
  }
  append(']}');
  return { raw, truncated: truncated || rows.length > sqliteExplainLimits.rows || result.columns.length > columns.length };
}

/** 原生四列计划仅在完整关系可确认时建树；异常关系保留原始表格，不伪造父节点。 */
export function buildSqliteExplainPlan(result: QueryResult, version: string, initialView: 'tree' | 'table' = 'tree'): SqliteExplainPlan {
  const original = rawPlan(result), plan: SqliteExplainPlan = { dialect: 'sqlite', version, initialView, nodes: [], raw: original.raw, rawTruncated: original.truncated, warnings: original.truncated ? [sqliteExplainMessages.raw] : [] };
  const fallback = (warning: string) => { plan.initialView = 'table'; plan.warnings.push(warning); return plan; };
  if (result.truncated || result.rows.length > sqliteExplainLimits.rows) return fallback(sqliteExplainMessages.truncated);
  if (result.columns.length !== 4 || result.columns.some((column, index) => own(column, 'name') !== ['id', 'parent', 'notused', 'detail'][index] || typeof own(column, 'key') !== 'string') || new Set(result.columns.map(column => own(column, 'key'))).size !== 4) return fallback(sqliteExplainMessages.columns);
  if (result.rows.length > sqliteExplainLimits.nodes) return fallback(sqliteExplainMessages.nodes);
  const items = new Map<string, SqliteExplainNode>(), parents = new Map<string, string>();
  for (const row of result.rows) {
    const values = result.columns.map(column => own(row, column.key)), id = integer(values[0]), parent = integer(values[1]), auxiliary = integer(values[2], true), detail = values[3];
    if (id === undefined || parent === undefined || auxiliary === undefined || typeof detail !== 'string' || items.has(id)) return fallback(sqliteExplainMessages.relation);
    if (detail.length > sqliteExplainLimits.detail) return fallback(sqliteExplainMessages.detail);
    items.set(id, { id, depth: 0, detail, auxiliary }); parents.set(id, parent);
  }
  const roots: SqliteExplainNode[] = [], children = new Map<string, SqliteExplainNode[]>();
  for (const item of items.values()) {
    const parent = parents.get(item.id)!;
    // SQLite以parent=0表示根；0号节点本身不能把整份计划误构造成自环。
    if (parent === '0') roots.push(item);
    else {
      if (!items.has(parent) || parent === item.id) return fallback(sqliteExplainMessages.relation);
      item.parent = parent; const group = children.get(parent) ?? []; group.push(item); children.set(parent, group);
    }
  }
  const pending = roots.map(node => ({ node, depth: 0 })).reverse(), nodes: SqliteExplainNode[] = [], visited = new Set<string>();
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (visited.has(node.id)) return fallback(sqliteExplainMessages.relation);
    if (depth >= sqliteExplainLimits.depth) return fallback(sqliteExplainMessages.depth);
    visited.add(node.id); nodes.push({ ...node, depth });
    for (const child of [...children.get(node.id) ?? []].reverse()) pending.push({ node: child, depth: depth + 1 });
  }
  if (nodes.length !== items.size) return fallback(sqliteExplainMessages.relation);
  plan.nodes = nodes; return plan;
}
