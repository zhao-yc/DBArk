import { describe, expect, it } from 'vitest';
import { parseQueryAnalyzePlan, queryAnalyzeCapability, queryAnalyzeLimits } from '../../src/shared/queryAnalyze';

const tree = [
  '-> Nested loop inner join  (cost=12.0000000000000000001 rows=9007199254740993) (actual time=0.01234567890123456789..1.23e+2 rows=2.5 loops=3)',
  '    -> Table scan on customer  (cost=1.1 rows=8) (actual time=0..0.002 rows=8 loops=1)',
  '    -> Filter: (orders.id = customer.id)  (cost=0.1 rows=0) (never executed)',
  '        -> Index lookup on orders using PRIMARY  (cost=0..0 rows=1) (never executed)',
].join('\n');

describe('实际执行分析能力只依赖明确版本', () => {
  it.each(['5.7.44', '8.0.17', '未知', '8.0', '8.0.21x', '', '5.5.5-10.11.2-MariaDB'])('MySQL拒绝不支持或不明确版本 %s', version => {
    const result = queryAnalyzeCapability({ dialect: 'mysql', version });
    expect(result.supported).toBe(false); expect(result.sqlPrefix).toBeUndefined(); expect(result.reason).toBeTruthy();
  });
  it.each(['8.0.18', '8.0.19-debug', '8.0.20'])('早期MySQL8只用其支持的语法 %s', version => {
    expect(queryAnalyzeCapability({ dialect: 'mysql', version })).toEqual({ supported: true, sqlPrefix: 'EXPLAIN ANALYZE', format: 'tree' });
  });
  it.each(['8.0.21', '8.0.46-0ubuntu0.22.04.1', '8.4.11', '9.0.0'])('MySQL显式TREE不受会话explain_format影响 %s', version => {
    expect(queryAnalyzeCapability({ dialect: 'mysql', version })).toEqual({ supported: true, sqlPrefix: 'EXPLAIN ANALYZE FORMAT=TREE', format: 'tree' });
  });
  it.each(['10.1.0-MariaDB', '10.11.15-MariaDB', '5.5.5-10.11.15-MariaDB', '11.4.13-MariaDB'])('MariaDB明确JSON语法 %s', version => {
    expect(queryAnalyzeCapability({ dialect: 'mariadb', version })).toEqual({ supported: true, sqlPrefix: 'ANALYZE FORMAT=JSON', format: 'json' });
  });
  it.each(['10.0.38-MariaDB', '5.5.5', '8.0.46', '未知'])('MariaDB拒绝不支持版本 %s', version => {
    expect(queryAnalyzeCapability({ dialect: 'mariadb', version }).supported).toBe(false);
  });
});

describe('MySQL TREE的服务器原始缩进与精确指标', () => {
  it('保留估算与实测、科学计数、小数和never executed，不相乘或求和', () => {
    const plan = parseQueryAnalyzePlan(tree, 'mysql', '8.4.11', 'tree');
    expect(plan.raw).toBe(tree); expect(plan.rawTruncated).toBe(false); expect(plan.warnings).toEqual([]);
    expect(plan.nodes.map(node => [node.parent, node.depth, node.label])).toEqual([
      [undefined, 0, 'Nested loop inner join'], ['0', 1, 'Table scan on customer'], ['0', 1, 'Filter: (orders.id = customer.id)'], ['2', 2, 'Index lookup on orders using PRIMARY'],
    ]);
    expect(plan.nodes[0].metrics).toEqual([
      { source: 'actual.first_row_time_ms', value: '0.01234567890123456789', kind: 'actual', unit: 'ms' },
      { source: 'actual.last_row_time_ms', value: '1.23e+2', kind: 'actual', unit: 'ms' },
      { source: 'actual.rows', value: '2.5', kind: 'actual', unit: 'rows' },
      { source: 'actual.loops', value: '3', kind: 'actual', unit: 'loops' },
      { source: 'cost', value: '12.0000000000000000001', kind: 'estimate', unit: 'cost' },
      { source: 'rows', value: '9007199254740993', kind: 'estimate', unit: 'rows' },
    ]);
    expect(plan.nodes[2].neverExecuted).toBe(true); expect(plan.nodes[2].metrics.every(metric => metric.kind === 'estimate')).toBe(true);
    expect(plan.nodes[3].metrics.map(metric => metric.source)).toEqual(['cost.first', 'cost.last', 'rows']);
    expect(plan.nodes[0].path).toBe('line:1');
  });
  it('描述内的指标样式文字不能冒充尾部实测分组，未知行不推测父子', () => {
    const raw = '-> Filter: (x = "(actual time=1..2 rows=3 loops=4)")  (cost=1 rows=2) (actual time=0..1 rows=1 loops=1)';
    const plan = parseQueryAnalyzePlan(raw, 'mysql', '8.0.46', 'tree');
    expect(plan.nodes[0].label).toContain('actual time=1..2'); expect(plan.nodes[0].metrics[0].value).toBe('0');
    const unconfirmed = parseQueryAnalyzePlan(tree + '\nunknown continuation\n    -> sibling', 'mysql', '8.4.11', 'tree');
    expect(unconfirmed.nodes).toEqual([]); expect(unconfirmed.raw).toContain('unknown continuation'); expect(unconfirmed.warnings.join()).toContain('无法确认');
  });
  it('缺失或未知实测指标保持缺失，估算成本不能当耗时', () => {
    for (const raw of ['-> Constant row  (cost=0 rows=1)', '-> Unknown iterator (actual time=unknown rows=1 loops=1)']) {
      const plan = parseQueryAnalyzePlan(raw, 'mysql', '8.4.11', 'tree');
      expect(plan.nodes).toHaveLength(1); expect(plan.nodes[0].metrics.every(metric => metric.kind === 'estimate')).toBe(true); expect(plan.warnings.length).toBeGreaterThan(0);
    }
  });
  it('根节点缩进不猜固定宽度，前后根与兄弟按原顺序保留', () => {
    const plan = parseQueryAnalyzePlan('  -> root\n    -> child\n       -> leaf\n    -> sibling\n  -> second root\n', 'mysql', '8.4.11', 'tree');
    expect(plan.nodes.map(node => [node.label, node.parent])).toEqual([['root', undefined], ['child', '0'], ['leaf', '1'], ['sibling', '0'], ['second root', undefined]]);
  });
  it('只含完整指标组的换行归属原箭头，原始行号和Hash无指标节点仍保持', () => {
    const raw = '-> join (cost=12 rows=2)\n(actual time=0.1..0.2 rows=2 loops=1)\n    -> Hash\n        -> table\n(cost=1 rows=2) (actual time=0.01..0.02 rows=2 loops=1)';
    const plan = parseQueryAnalyzePlan(raw, 'mysql', '8.4.11', 'tree');
    expect(plan.nodes.map(node => [node.label, node.parent, node.path])).toEqual([['join', undefined, 'line:1'], ['Hash', '0', 'line:3'], ['table', '1', 'line:4']]);
    expect(plan.nodes[0].metrics).toContainEqual({ source: 'actual.last_row_time_ms', value: '0.2', kind: 'actual', unit: 'ms' });
    expect(plan.nodes[1].metrics).toEqual([]);
    expect(plan.nodes[2].metrics).toContainEqual({ source: 'cost', value: '1', kind: 'estimate', unit: 'cost' });
    expect(plan.raw).toBe(raw); expect(plan.warnings).toEqual([]);
    expect(parseQueryAnalyzePlan('(actual time=0..1 rows=1 loops=1)', 'mysql', '8.4.11', 'tree').nodes).toEqual([]);
  });
});

describe('MariaDB JSON的自身字段和实测语义', () => {
  it('保留平均行数、循环和包含子节点的时间，不混用MySQL成本模型', () => {
    const raw = '{"query_block":{"select_id":1,"r_total_time_ms":12.3456789012345678901,"r_loops":1,"nested_loop":[{"table":{"table_name":"t","access_type":"ALL","rows":9007199254740993,"filtered":50,"r_rows":2.5,"r_loops":3,"r_filtered":0,"r_table_time_ms":1.23e-12,"r_other_time_ms":0}}]}}';
    const plan = parseQueryAnalyzePlan(raw, 'mariadb', '10.11.15-MariaDB', 'json');
    expect(plan.raw).toBe(raw); expect(plan.rawTruncated).toBe(false);
    const block = plan.nodes.find(node => node.path === '/query_block')!, tableNode = plan.nodes.find(node => node.label === 'table · t')!;
    expect(block.metrics).toContainEqual({ source: 'r_total_time_ms', value: '12.3456789012345678901', kind: 'actual', unit: 'ms' });
    expect(tableNode.metrics).toContainEqual({ source: 'rows', value: '9007199254740993', kind: 'estimate', unit: 'rows' });
    expect(tableNode.metrics).toContainEqual({ source: 'r_rows', value: '2.5', kind: 'actual', unit: 'rows' });
    expect(tableNode.metrics).toContainEqual({ source: 'r_loops', value: '3', kind: 'actual', unit: 'loops' });
    expect(tableNode.metrics).toContainEqual({ source: 'r_filtered', value: '0', kind: 'actual', unit: 'percent' });
    expect(tableNode.metrics).toContainEqual({ source: 'r_table_time_ms', value: '1.23e-12', kind: 'actual', unit: 'ms' });
    expect(tableNode.metrics.filter(metric => metric.unit === 'cost')).toEqual([]);
  });
  it('原型同名、JSON Pointer转义、零值与缺项按真实自身字段处理', () => {
    const raw = '{"__proto__":{"a/b~c":{"r_total_time_ms":0,"r_rows":0,"rows":7}},"constructor":{"r_loops":2}}';
    const plan = parseQueryAnalyzePlan(raw, 'mariadb', '11.4.13', 'json');
    expect(plan.nodes.find(node => node.path === '/__proto__/a~1b~0c')?.metrics).toContainEqual({ source: 'r_total_time_ms', value: '0', kind: 'actual', unit: 'ms' });
    expect(plan.nodes.find(node => node.path === '/constructor')?.metrics).toEqual([{ source: 'r_loops', value: '2', kind: 'actual', unit: 'loops' }]);
    expect(plan.nodes[0].metrics).toEqual([]);
  });
  it('字符串、布尔、null和无穷样式不能伪造数值，未知节点仍有原文', () => {
    const raw = '{"future_node":{"r_rows":null,"r_loops":true,"r_total_time_ms":"NaN","other":99}}';
    const plan = parseQueryAnalyzePlan(raw, 'mariadb', '11.4.13', 'json');
    expect(plan.nodes.flatMap(node => node.metrics)).toEqual([]); expect(plan.warnings.join()).toContain('实测指标'); expect(plan.raw).toBe(raw);
  });
});

describe('解析预算和不完整输出不能冒充完整计划', () => {
  it('UTF8字节上限保留完整代理对，不对截断的有效前缀生成树', () => {
    const raw = tree + '\n' + '😀'.repeat(100000), plan = parseQueryAnalyzePlan(raw, 'mysql', '8.4.11', 'tree');
    expect(new TextEncoder().encode(plan.raw).byteLength).toBeLessThanOrEqual(queryAnalyzeLimits.rawBytes);
    expect(plan.raw.endsWith('\uD83D')).toBe(false); expect(plan.rawTruncated).toBe(true); expect(plan.nodes).toEqual([]);
    expect(plan.warnings.join()).toContain('截断前缀');
  });
  it('驱动已截断的短输出也不解析，即使剩余部分恰好是合法JSON', () => {
    const raw = '{"query_block":{"r_loops":1}}';
    const plan = parseQueryAnalyzePlan(raw, 'mariadb', '11.4.13', 'json', true);
    expect(plan.raw).toBe(raw); expect(plan.rawTruncated).toBe(true); expect(plan.nodes).toEqual([]);
  });
  it('节点、层级、标签和数值都有预算，长数值不截成另一个数字', () => {
    const many = parseQueryAnalyzePlan(Array.from({ length: 400 }, (_, i) => '-> item ' + i).join('\n'), 'mysql', '8.4.11', 'tree');
    expect(many.nodes).toHaveLength(300); expect(many.warnings.join()).toContain('300');
    const deep = parseQueryAnalyzePlan(Array.from({ length: 70 }, (_, i) => ' '.repeat(i) + '-> item').join('\n'), 'mysql', '8.4.11', 'tree');
    expect(deep.nodes).toHaveLength(64); expect(deep.nodes.every(node => node.depth < 64)).toBe(true);
    const value = '9'.repeat(81), long = parseQueryAnalyzePlan('-> ' + '😀'.repeat(800) + ' (cost=' + value + ' rows=1) (actual time=0..1 rows=1 loops=1)', 'mysql', '8.4.11', 'tree');
    expect(long.nodes[0].label.length).toBeLessThanOrEqual(1024); expect(long.nodes[0].metrics.some(metric => metric.source === 'cost')).toBe(false); expect(long.warnings.join()).toContain('80');
  });
  it('非法、超深JSON和格式不一致保留有界原文，不静默回退或重新执行', () => {
    for (const raw of ['{坏JSON}', '[]', '['.repeat(65) + '0' + ']'.repeat(65)]) {
      const plan = parseQueryAnalyzePlan(raw, 'mariadb', '11.4.13', 'json');
      expect(plan.nodes).toEqual([]); expect(plan.raw).toBe(raw); expect(plan.warnings.length).toBeGreaterThan(0);
    }
    expect(parseQueryAnalyzePlan(tree, 'mysql', '8.4.11', 'json').nodes).toEqual([]);
    expect(parseQueryAnalyzePlan('', 'mysql', '8.4.11', 'tree').warnings.join()).toContain('没有返回');
  });
});
