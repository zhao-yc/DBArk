import { explainLimits, readExplainJson, type ExplainNode, type ExplainPlan } from './explain';
import { currentPostgresStatement, splitPostgresSql } from './postgresSql';

const supported = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'VALUES', 'TABLE',
  'EXECUTE', 'DECLARE', 'CREATE']);
const properties = ['Schema', 'Alias', 'Plan Width', 'Join Type', 'Parent Relationship', 'Subplan Name', 'Scan Direction',
  'Strategy', 'Filter', 'Index Cond', 'Recheck Cond', 'Hash Cond', 'Merge Cond', 'Join Filter', 'Sort Key', 'Group Key', 'Output'];

/** 选区只接受一条语句，光标位置按实际会话的字符串设置解析。 */
export function postgresExplainSql(source: string, options: { standardStrings: boolean; version: string; format: 'auto' | 'text'; offset?: number }) {
  const { standardStrings, version, format, offset } = options;
  const statements = offset === undefined ? splitPostgresSql(source, standardStrings)
    : [currentPostgresStatement(source, offset, standardStrings)];
  if (statements.length !== 1) throw Error('PostgreSQL执行计划只接受一条语句，请选择单条语句');
  const [statement] = statements;
  if (!supported.has(statement.keyword)) throw Error('当前 PostgreSQL 语句类型不支持估算计划');
  const generic = statement.parameters.length > 0;
  if (generic && !(Number.parseInt(version, 10) >= 16))
    throw Error('带位置参数的估算计划需要 PostgreSQL 16 或更高版本');
  // 实际数据库投递另用扩展协议，服务端也拒绝包含多条命令的请求。
  const sql = 'EXPLAIN (ANALYZE FALSE, VERBOSE TRUE' + (generic ? ', GENERIC_PLAN TRUE' : '') +
    ', FORMAT ' + (format === 'text' ? 'TEXT' : 'JSON') + ')\n' + statement.sql;
  return { sql, generic };
}

/** 保留 PostgreSQL 原始树的节点次序、成本和十进制精度。 */
export function parsePostgresExplain(raw: string, version: string, format: 'json' | 'text', truncated: boolean): ExplainPlan {
  const plan: ExplainPlan = { dialect: 'postgresql', version, format, raw, rawTruncated: truncated, nodes: [], warnings: [] };
  if (truncated) plan.warnings.push('计划输出达到大小上限，请缩小语句范围');
  if (format === 'text' || !raw) return plan;
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const bounded = (value: string, size: number) => value.slice(0, size).replace(/[\uD800-\uDBFF]$/, '');
  try {
    const document = readExplainJson(raw);
    if (!Array.isArray(document)) throw Error('PostgreSQL计划缺少有效的根节点');
    let limited = false;
    /** 按服务器 Plans 数组遍历，详情路径指回同一个原始 JSON。 */
    function visit(node: unknown, path: string, depth: number, parent?: string) {
      if (plan.nodes.length >= explainLimits.nodes) { limited = true; return; }
      if (!record(node) || typeof node['Node Type'] !== 'string') throw Error('PostgreSQL计划包含无效节点');
      const own = (key: string) => Object.getOwnPropertyDescriptor(node, key)?.value;
      const metric = (source: string) => {
        const value = own(source);
        return typeof value === 'string' && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value) ? { source, value } : undefined;
      };
      const label = (key: string) => {
        const value = own(key);
        return typeof value === 'string' ? bounded(value, explainLimits.label) : undefined;
      };
      const item: ExplainNode = { id: String(plan.nodes.length), parent, depth, path, kind: label('Node Type')!,
        name: label('Relation Name') ?? label('CTE Name') ?? label('Function Name'),
        index: label('Index Name'), rows: metric('Plan Rows'), unknown: false,
        costs: ['Startup Cost', 'Total Cost'].flatMap(key => { const cost = metric(key); return cost ? [cost] : []; }),
        properties: properties.flatMap(source => {
          const field = own(source);
          const value = Array.isArray(field) ? JSON.stringify(field) : typeof field === 'string' ? field : undefined;
          return value === undefined ? [] : [{ source, value: bounded(value, explainLimits.property),
            ...(value.length > explainLimits.property ? { truncated: true } : {}) }];
        }) };
      plan.nodes.push(item);
      const children = own('Plans');
      if (Array.isArray(children)) children.forEach((child, index) => visit(child, path + '/Plans/' + index, depth + 1, item.id));
    }
    for (const [index, entry] of document.entries()) {
      if (!record(entry) || !record(entry.Plan)) throw Error('PostgreSQL计划缺少有效的根节点');
      visit(entry.Plan, '/' + index + '/Plan', 0);
    }
    if (!document.length) plan.warnings.push('语句重写后没有可展示的计划节点');
    if (limited) plan.warnings.push('树形展示达到 300 个节点上限，其余内容请查看原始输出');
  } catch (reason) {
    plan.nodes = [];
    plan.warnings.push(reason instanceof Error ? reason.message : 'PostgreSQL计划解析失败');
  }
  return plan;
}
