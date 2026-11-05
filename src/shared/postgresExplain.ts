import { explainLimits, readExplainJson, type ExplainNode, type ExplainPlan } from './explain';
import { currentPostgresStatement, splitPostgresSql } from './postgresSql';
import type { QueryAnalyzeMetric, QueryAnalyzePlan } from './queryAnalyze';

const supported = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'VALUES', 'TABLE',
  'EXECUTE', 'DECLARE', 'CREATE']);
const properties = ['Schema', 'Alias', 'Plan Width', 'Join Type', 'Parent Relationship', 'Subplan Name', 'Scan Direction',
  'Strategy', 'Filter', 'Index Cond', 'Recheck Cond', 'Hash Cond', 'Merge Cond', 'Join Filter', 'Sort Key', 'Group Key', 'Output'];

/** 选区只接受一条语句，光标位置按实际会话的字符串设置解析。 */
function planStatement(source: string, standardStrings: boolean, offset?: number) {
  const statements = offset === undefined ? splitPostgresSql(source, standardStrings)
    : [currentPostgresStatement(source, offset, standardStrings)];
  if (statements.length !== 1) throw Error('PostgreSQL执行计划只接受一条语句，请选择单条语句');
  return statements[0];
}

/** 估算入口可使用无绑定值的通用计划。 */
export function postgresExplainSql(source: string, options: { standardStrings: boolean; version: string; format: 'auto' | 'text'; offset?: number }) {
  const { standardStrings, version, format, offset } = options;
  const statement = planStatement(source, standardStrings, offset);
  if (!supported.has(statement.keyword)) throw Error('当前 PostgreSQL 语句类型不支持估算计划');
  const generic = statement.parameters.length > 0;
  if (generic && !(Number.parseInt(version, 10) >= 16))
    throw Error('带位置参数的估算计划需要 PostgreSQL 16 或更高版本');
  // 实际数据库投递另用扩展协议，服务端也拒绝包含多条命令的请求。
  const sql = 'EXPLAIN (ANALYZE FALSE, VERBOSE TRUE' + (generic ? ', GENERIC_PLAN TRUE' : '') +
    ', FORMAT ' + (format === 'text' ? 'TEXT' : 'JSON') + ')\n' + statement.sql;
  return { sql, generic };
}

/** 确认弹窗冻结实际发送的单条 SQL。原语句和计划命令分开，不能嵌套执行 EXPLAIN。 */
export function postgresAnalyzeSql(source: string, standardStrings: boolean, offset?: number) {
  const statement = planStatement(source, standardStrings, offset);
  if (!supported.has(statement.keyword)) throw Error('当前 PostgreSQL 语句类型不支持实际执行分析');
  if (statement.parameters.length) throw Error('实际执行分析需要完整的参数值，请使用已有的 EXECUTE 语句或无占位符的 SQL');
  return { source: statement.sql, sql: 'EXPLAIN (ANALYZE TRUE, VERBOSE TRUE, BUFFERS TRUE, FORMAT JSON)\n' + statement.sql };
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: string, size: number) => value.slice(0, size).replace(/[\uD800-\uDBFF]$/, '');

/** PostgreSQL 的 Plans 顺序和多根计划结构由同一遍历保留。 */
export function visitPostgresPlans(raw: string, visit: (node: Record<string, unknown>, position: Pick<ExplainNode, 'id' | 'path' | 'depth' | 'parent'>,
  entry: Record<string, unknown>) => void): string[] {
  const document = readExplainJson(raw);
  if (!Array.isArray(document)) throw Error('PostgreSQL计划缺少有效的根节点');
  let count = 0, limited = false;
  function walk(node: unknown, path: string, depth: number, entry: Record<string, unknown>, parent?: string) {
    if (count >= explainLimits.nodes) { limited = true; return; }
    if (!record(node) || typeof node['Node Type'] !== 'string') throw Error('PostgreSQL计划包含无效节点');
    const id = String(count++);
    visit(node, { id, path, depth, parent }, entry);
    if (Array.isArray(node.Plans)) node.Plans.forEach((child, index) => walk(child, path + '/Plans/' + index, depth + 1, entry, id));
  }
  for (const [index, entry] of document.entries()) {
    if (!record(entry) || !record(entry.Plan)) throw Error('PostgreSQL计划缺少有效的根节点');
    walk(entry.Plan, '/' + index + '/Plan', 0, entry);
  }
  return !document.length ? ['语句重写后没有可展示的计划节点']
    : limited ? ['树形展示达到 300 个节点上限，其余内容请查看原始输出'] : [];
}

/** 数值保留 PostgreSQL 返回的十进制文本。 */
function planMetric(node: Record<string, unknown>, source: string) {
  const value = Object.getOwnPropertyDescriptor(node, source)?.value;
  return typeof value === 'string' && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value) ? { source, value } : undefined;
}

/** 保留 PostgreSQL 原始树的节点次序、成本和十进制精度。 */
export function parsePostgresExplain(raw: string, version: string, format: 'json' | 'text', truncated: boolean): ExplainPlan {
  const plan: ExplainPlan = { dialect: 'postgresql', version, format, raw, rawTruncated: truncated, nodes: [], warnings: [] };
  if (truncated) plan.warnings.push('计划输出达到大小上限，请缩小语句范围');
  if (format === 'text' || !raw) return plan;
  try {
    plan.warnings.push(...visitPostgresPlans(raw, (node, position) => {
      const own = (key: string) => Object.getOwnPropertyDescriptor(node, key)?.value;
      const label = (key: string) => {
        const value = own(key);
        return typeof value === 'string' ? bounded(value, explainLimits.label) : undefined;
      };
      const item: ExplainNode = { ...position, kind: label('Node Type')!,
        name: label('Relation Name') ?? label('CTE Name') ?? label('Function Name'),
        index: label('Index Name'), rows: planMetric(node, 'Plan Rows'), unknown: false,
        costs: ['Startup Cost', 'Total Cost'].flatMap(key => { const cost = planMetric(node, key); return cost ? [cost] : []; }),
        properties: properties.flatMap(source => {
          const field = own(source);
          const value = Array.isArray(field) ? JSON.stringify(field) : typeof field === 'string' ? field : undefined;
          return value === undefined ? [] : [{ source, value: bounded(value, explainLimits.property),
            ...(value.length > explainLimits.property ? { truncated: true } : {}) }];
        }) };
      plan.nodes.push(item);
    }));
  } catch (reason) {
    plan.nodes = [];
    plan.warnings.push(reason instanceof Error ? reason.message : 'PostgreSQL计划解析失败');
  }
  return plan;
}

/** 展示节点的实际指标和估算值，循环为零只标记未执行，不计算跨节点总计。 */
export function parsePostgresAnalyze(raw: string, version: string, truncated: boolean): QueryAnalyzePlan {
  const plan: QueryAnalyzePlan = { dialect: 'postgresql', version, format: 'json', raw, rawTruncated: truncated, nodes: [], warnings: [] };
  if (!raw) return plan;
  try {
    plan.warnings.push(...visitPostgresPlans(raw, (node, position, entry) => {
      const metrics: QueryAnalyzeMetric[] = [];
      const add = (from: Record<string, unknown>, source: string, kind: QueryAnalyzeMetric['kind'], unit: QueryAnalyzeMetric['unit']) => {
        const metric = planMetric(from, source);
        if (metric && metric.value.length <= 80) metrics.push({ ...metric, kind, unit });
      };
      add(node, 'Actual Total Time', 'actual', 'ms');
      add(node, 'Actual Rows', 'actual', 'rows');
      add(node, 'Actual Loops', 'actual', 'loops');
      add(node, 'Actual Startup Time', 'actual', 'ms');
      for (const source of ['Shared Hit Blocks', 'Shared Read Blocks', 'Shared Dirtied Blocks', 'Shared Written Blocks',
        'Local Hit Blocks', 'Local Read Blocks', 'Local Dirtied Blocks', 'Local Written Blocks', 'Temp Read Blocks', 'Temp Written Blocks'])
        add(node, source, 'actual', 'blocks');
      if (!position.parent) for (const source of ['Planning Time', 'Execution Time']) add(entry, source, 'actual', 'ms');
      add(node, 'Plan Rows', 'estimate', 'rows');
      add(node, 'Startup Cost', 'estimate', 'cost');
      add(node, 'Total Cost', 'estimate', 'cost');
      const label = [node['Node Type'], node['Relation Name'] ?? node['CTE Name'], node['Index Name']]
        .filter((value): value is string => typeof value === 'string').join(' · ');
      plan.nodes.push({ ...position, label: bounded(label, 1024), metrics, neverExecuted: planMetric(node, 'Actual Loops')?.value === '0' });
    }));
  } catch (reason) {
    plan.nodes = [];
    plan.warnings.push(reason instanceof Error ? reason.message : 'PostgreSQL实际计划解析失败');
  }
  return plan;
}
