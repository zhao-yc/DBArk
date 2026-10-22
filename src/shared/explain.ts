/** 执行计划仅保存优化器估计值；数字保留原始十进制文本，不转成浮点数。 */
export const explainLimits = { jsonBytes: 192 * 1024, depth: 64, tokens: 16000, nodes: 300, label: 160, path: 2048, detail: 16000, textRows: 1000, property: 2048, propertyItems: 32 } as const;
export type ExplainDialect = 'mysql' | 'mariadb';
export const explainQueryArrayKinds = ['query_specifications', 'subqueries', 'attached_subqueries', 'optimized_away_subqueries', 'having_subqueries', 'select_list_subqueries'] as const;
export interface ExplainArrayEntry { container: (typeof explainQueryArrayKinds)[number]; index: number; }
export interface ExplainMetric { source: string; value: string; }
export interface ExplainProperty { source: string; value: string; truncated?: boolean; }
export interface ExplainNode {
  id: string; parent?: string; depth: number; path: string; pathTruncated?: boolean; kind: string; name?: string; unknown: boolean;
  access?: string; rows?: ExplainMetric; produced?: ExplainMetric; filtered?: ExplainMetric; costs: ExplainMetric[]; index?: string;
  properties?: ExplainProperty[];
  arrayEntry?: ExplainArrayEntry;
}
export interface ExplainPlan {
  dialect: ExplainDialect; version: string; format: 'json' | 'text'; nodes: ExplainNode[];
  raw: string; rawTruncated: boolean; warnings: string[];
}

/** 先检查 JSON 预算，再把字符串外的数值原样转成文本，避免 BIGINT/DECIMAL 精度丢失。 */
export function readExplainJson(raw: string): unknown {
  if (new TextEncoder().encode(raw).byteLength > explainLimits.jsonBytes) throw Error('计划 JSON 超过 192 KiB 上限，未生成树');
  let output = '', quoted = false, escaped = false, depth = 0, tokens = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (quoted) {
      output += char;
      if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; tokens++; }
    else if (char === '{' || char === '[') { if (++depth > explainLimits.depth) throw Error('计划 JSON 超过 64 层上限，未生成树'); tokens++; }
    else if (char === '}' || char === ']') depth--;
    else if (char === ',' || char === ':') tokens++;
    if (tokens > explainLimits.tokens) throw Error('计划 JSON 超过解析项数上限，未生成树');
    if (char === '-' || /[0-9]/.test(char)) {
      const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(raw.slice(i));
      if (number) { output += JSON.stringify(number[0]); i += number[0].length - 1; continue; }
    }
    output += char;
  }
  return JSON.parse(output);
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const scalar = (value: unknown): string | undefined => typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
const metric = (value: Record<string, unknown>, key: string): ExplainMetric | undefined => {
  const text = scalar(value[key]); return text !== undefined && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text) ? { source: key, value: text } : undefined;
};
const commonKinds = new Set(['plan','query_block','table','nested_loop','subqueries','query_specifications','union_result','materialized','expression_cache','filesort','read_sorted_file','temporary_table','buffer_result','block-nl-join','ordering_operation','grouping_operation','duplicates_removal','materialized_from_subquery','attached_subqueries','optimized_away_subqueries','having_subqueries','select_list_subqueries','windowing','windows','window']);
const queryArrayKinds = new Set<string>(explainQueryArrayKinds);
const dataKeys = new Set(['cost_info','possible_keys','used_key_parts','used_columns','ref','partitions']);
const propertyLists = ['possible_keys','used_key_parts','used_columns','ref','partitions'] as const;
const propertyTexts = ['attached_condition','index_condition','using_join_buffer','sort_key','message'] as const;
const propertyBooleans = ['using_index','using_temporary_table','using_filesort','dependent','cacheable'] as const;

/** 按 UTF-16 预算取展示前缀，不把原本完整的代理对从中间截开。 */
function propertyPrefix(value: string, length: number = explainLimits.property): string {
  let end = Math.min(value.length, length);
  if (end < value.length && end > 0 && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--;
  return value.slice(0, end);
}

/** 逐项编码有限列表；长项也先限输入，避免先生成完整大列表再截断。 */
function listProperty(source: string, values: string[]): ExplainProperty {
  let text = '[', truncated = values.length > explainLimits.propertyItems;
  const count = Math.min(values.length, explainLimits.propertyItems);
  for (let index = 0; index < count; index++) {
    const item = (index ? ',' : '') + JSON.stringify(propertyPrefix(values[index], explainLimits.property + 1));
    const remaining = explainLimits.property - text.length;
    if (item.length + 1 > remaining || values[index].length > explainLimits.property + 1) {
      text += propertyPrefix(item, remaining); truncated = true;
      return { source, value: text, truncated };
    }
    text += item;
  }
  return { source, value: text + ']', ...(truncated ? { truncated: true } : {}) };
}

/** 只展示本节点自有且类型匹配的原始字段；缺项、异常类型与 false 均不推断。 */
function nodeProperties(value: unknown): ExplainProperty[] {
  if (!object(value)) return [];
  const properties: ExplainProperty[] = [];
  const own = (key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
  for (const source of propertyLists) {
    const item = own(source);
    if (Array.isArray(item) && item.every(entry => typeof entry === 'string')) properties.push(listProperty(source, item));
  }
  for (const source of propertyTexts) {
    const item = own(source);
    if (typeof item === 'string') properties.push({ source, value: propertyPrefix(item), ...(item.length > explainLimits.property ? { truncated: true } : {}) });
  }
  for (const source of propertyBooleans) {
    const item = own(source);
    if (typeof item === 'boolean') properties.push({ source, value: item ? 'true' : 'false' });
  }
  return properties.slice(0, 18);
}

/** MySQL 使用每次扫描行数及 cost_info，不能把 MariaDB 的 rows 猜作同一字段。 */
function mysqlMetrics(value: Record<string, unknown>): Pick<ExplainNode, 'rows' | 'produced' | 'filtered' | 'costs'> {
  const costs = object(value.cost_info) ? value.cost_info : {};
  return { rows: metric(value, 'rows_examined_per_scan'), produced: metric(value, 'rows_produced_per_join'), filtered: metric(value, 'filtered'), costs: ['query_cost','read_cost','eval_cost','prefix_cost','sort_cost'].flatMap(key => { const item = metric(costs, key); return item ? [{ ...item, source: 'cost_info.' + key }] : []; }) };
}
/** MariaDB 只显示它实际提供的 rows/filtered/cost，不借用 MySQL 的成本模型。 */
function mariaMetrics(value: Record<string, unknown>): Pick<ExplainNode, 'rows' | 'produced' | 'filtered' | 'costs'> {
  return { rows: metric(value, 'rows'), filtered: metric(value, 'filtered'), costs: ['cost'].flatMap(key => { const item = metric(value, key); return item ? [item] : []; }) };
}

/** 保持 JSON 包含关系及数组顺序；未知对象也保留节点和 JSON Pointer，完整原文独立可见。 */
export function parseExplainPlan(raw: string, dialect: ExplainDialect, version: string): ExplainPlan {
  const plan: ExplainPlan = { dialect, version, format: 'json', raw, rawTruncated: false, nodes: [], warnings: [] };
  try {
    const document = readExplainJson(raw);
    if (!object(document)) throw Error('计划 JSON 根节点不是对象，未生成树');
    // 指标树把数值转为精确文本；属性另读原类型，避免误把数值字段当作字符串属性。
    const originalDocument: unknown = JSON.parse(raw);
    let limited = false;
    const visit = (kind: string, value: unknown, path: string, parent?: ExplainNode, original?: unknown, arrayEntry?: ExplainArrayEntry): void => {
      if (plan.nodes.length >= explainLimits.nodes) { limited = true; return; }
      const record = object(value) ? value : {};
      // 极长公共键会在每个子节点路径中重复，必须限制跨进程表示的累计放大。
      const node: ExplainNode = { id: String(plan.nodes.length), parent: parent?.id, depth: parent ? parent.depth + 1 : 0, path: path.slice(0, explainLimits.path), ...(path.length > explainLimits.path ? { pathTruncated: true } : {}), kind: kind.slice(0, explainLimits.label), name: scalar(record.table_name ?? record.select_id ?? (kind === 'window' ? record.name : undefined))?.slice(0, explainLimits.label), unknown: !arrayEntry && !commonKinds.has(kind), ...(arrayEntry ? { arrayEntry } : {}), access: scalar(record.access_type)?.slice(0, explainLimits.label), index: scalar(record.key)?.slice(0, explainLimits.label), ...(dialect === 'mysql' ? mysqlMetrics(record) : mariaMetrics(record)) };
      node.properties = nodeProperties(original);
      plan.nodes.push(node);
      const children = Array.isArray(value) ? value.map((item, i) => [String(i), item] as const) : Object.entries(record);
      const queryArray = Array.isArray(value) && queryArrayKinds.has(kind);
      for (const [key, child] of children) {
        const childPath = path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1');
        const originalChild = original && typeof original === 'object' ? Object.getOwnPropertyDescriptor(original, key)?.value : undefined;
        // 查询数组逐项保留真实层级；非法标量、null 和数组也留下未知索引节点，不能静默跳过。
        if (queryArray) {
          const entry = object(child) && object(Object.getOwnPropertyDescriptor(child, 'query_block')?.value)
            ? { container: kind as ExplainArrayEntry['container'], index: Number(key) } : undefined;
          visit(key, child, childPath, node, originalChild, entry); continue;
        }
        if (!child || typeof child !== 'object' || dataKeys.has(key)) continue;
        // 普通数组中的包装对象常只含一个操作；保留包装路径，避免虚构额外的连接操作。
        if (Array.isArray(value) && object(child) && Object.keys(child).length === 1) {
          const [operation, body] = Object.entries(child)[0];
          if (body && typeof body === 'object') { visit(operation, body, childPath + '/' + operation.replaceAll('~', '~0').replaceAll('/', '~1'), node, originalChild && typeof originalChild === 'object' ? Object.getOwnPropertyDescriptor(originalChild, operation)?.value : undefined); continue; }
        }
        // 已知查询容器即使为空或仅含标量也保留；其他纯标量数组仍沿用原有数据过滤规则。
        if (Array.isArray(child) && !queryArrayKinds.has(key) && child.every(item => item === null || typeof item !== 'object')) continue;
        visit(kind === 'windows' && Array.isArray(value) ? 'window' : key, child, childPath, node, originalChild);
      }
    };
    visit('plan', document, '', undefined, originalDocument);
    if (limited) plan.warnings.push('树形展示达到 300 个节点上限，其余内容请查看原始输出');
    if (plan.nodes.some(node => node.unknown)) plan.warnings.push('存在未知计划节点，已保留其名称、位置和原始数据');
    if (plan.nodes.some(node => node.pathTruncated)) plan.warnings.push('部分节点路径超过 2048 字符，已限制路径展示，详情请查看原始输出');
  } catch (error) { plan.nodes = []; plan.warnings.push(error instanceof Error ? error.message : '计划 JSON 解析失败'); }
  return plan;
}

/** 详情只读取自身属性，原型同名键也按真实 JSON 处理；截断仅作用于展示。 */
export function explainNodeDetail(raw: string, path: string): string {
  try {
    let value = readExplainJson(raw);
    for (const segment of path.split('/').slice(1)) {
      const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return '';
      value = (value as Record<string, unknown>)[key];
    }
    const text = JSON.stringify(value, null, 2);
    return text.length > explainLimits.detail ? text.slice(0, explainLimits.detail) + '\n…详情展示已截断，请查看原始输出' : text;
  } catch { return ''; }
}
