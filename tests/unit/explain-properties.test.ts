import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { explainLimits, explainNodeDetail, parseExplainPlan, type ExplainNode } from '../../src/shared/explain';

/** 从真实解析结果读取指定节点，测试不绕过公共计划入口。 */
function node(raw: string, kind = 'table', dialect: 'mysql' | 'mariadb' = 'mysql'): ExplainNode {
  const plan = parseExplainPlan(raw, dialect, dialect === 'mysql' ? '8.4.0' : '10.11.0');
  expect(plan.nodes.length).toBeGreaterThan(0);
  return plan.nodes.find(item => item.kind === kind)!;
}

/** 构造合法 JSON，数值异常用例另写原始字面量以免先失去类型证据。 */
function table(value: Record<string, unknown>): string {
  return JSON.stringify({ query_block: { table: value } });
}

describe('执行计划节点原始属性', () => {
  it('MySQL 保留候选索引、键片段、列、引用和分区的原数组含义', () => {
    const properties = node(table({
      table_name: 'orders', access_type: 'ref', key: 'idx_customer',
      possible_keys: ['PRIMARY', 'idx_customer'], used_key_parts: ['customer_id', 'status'],
      used_columns: ['id', 'customer_id', '说明"列'], ref: ['const', 'db.customer.id'], partitions: ['p0', 'p1'],
      attached_condition: 'orders.status = 1', index_condition: 'orders.customer_id > 0',
      using_index: true, dependent: false, cacheable: true
    })).properties;
    expect(properties).toEqual([
      { source: 'possible_keys', value: '["PRIMARY","idx_customer"]' },
      { source: 'used_key_parts', value: '["customer_id","status"]' },
      { source: 'used_columns', value: '["id","customer_id","说明\\"列"]' },
      { source: 'ref', value: '["const","db.customer.id"]' },
      { source: 'partitions', value: '["p0","p1"]' },
      { source: 'attached_condition', value: 'orders.status = 1' },
      { source: 'index_condition', value: 'orders.customer_id > 0' },
      { source: 'using_index', value: 'true' }, { source: 'dependent', value: 'false' }, { source: 'cacheable', value: 'true' }
    ]);
  });

  it('MariaDB 直接显示连接缓冲、排序键、临时表和文件排序，不推断其他节点', () => {
    const raw = JSON.stringify({ query_block: { read_sorted_file: { filesort: {
      sort_key: 'orders.created_at desc', using_filesort: true, using_temporary_table: false,
      'block-nl-join': { using_join_buffer: 'Block Nested Loop', table: { table_name: 'orders', rows: 42, attached_condition: 'orders.active = 1' } }
    } } } });
    const plan = parseExplainPlan(raw, 'mariadb', '10.11.0');
    expect(plan.nodes.find(item => item.kind === 'filesort')?.properties).toEqual([
      { source: 'sort_key', value: 'orders.created_at desc' },
      { source: 'using_temporary_table', value: 'false' }, { source: 'using_filesort', value: 'true' }
    ]);
    expect(plan.nodes.find(item => item.kind === 'block-nl-join')?.properties).toEqual([{ source: 'using_join_buffer', value: 'Block Nested Loop' }]);
    expect(plan.nodes.find(item => item.kind === 'query_block')?.properties).toEqual([]);
    expect(plan.nodes.find(item => item.kind === 'table')?.rows).toEqual({ source: 'rows', value: '42' });
  });

  it('保留 false、空串和空列表，数字形状字符串不做数值转换', () => {
    expect(node(table({ possible_keys: [], attached_condition: '', message: '001.2300', using_index: false, cacheable: false })).properties).toEqual([
      { source: 'possible_keys', value: '[]' }, { source: 'attached_condition', value: '' },
      { source: 'message', value: '001.2300' }, { source: 'using_index', value: 'false' }, { source: 'cacheable', value: 'false' }
    ]);
  });

  it('异常类型、null 和数值原始字面量不能伪装成字符串字段', () => {
    const raw = '{"query_block":{"table":{"possible_keys":[1],"used_key_parts":["ok",null],"used_columns":"id","ref":[true],"partitions":null,"attached_condition":123,"index_condition":false,"using_join_buffer":{},"sort_key":[],"message":0,"using_index":"false","using_temporary_table":0,"using_filesort":null,"dependent":{},"cacheable":[]}}}';
    expect(node(raw).properties).toEqual([]);
  });

  it('异常项即使位于列表预算之后仍使字段无效', () => {
    const values: unknown[] = Array.from({ length: 50 }, () => 'idx'); values.push(7);
    expect(node(table({ possible_keys: values })).properties).toEqual([]);
  });

  it('只读取自身字段，不继承原型上的同名值', () => {
    const keys = ['possible_keys', 'attached_condition', 'using_index'] as const;
    const originals = keys.map(key => Object.getOwnPropertyDescriptor(Object.prototype, key));
    try {
      Object.defineProperty(Object.prototype, 'possible_keys', { value: ['inherited'], configurable: true });
      Object.defineProperty(Object.prototype, 'attached_condition', { get: () => { throw Error('不应读取原型 getter'); }, configurable: true });
      Object.defineProperty(Object.prototype, 'using_index', { value: true, configurable: true });
      expect(node('{"query_block":{"table":{"message":"own"}}}').properties).toEqual([{ source: 'message', value: 'own' }]);
    } finally {
      for (const [index, key] of keys.entries()) {
        const original = originals[index];
        if (original) Object.defineProperty(Object.prototype, key, original); else Reflect.deleteProperty(Object.prototype, key);
      }
    }
  });

  it.each(['mysql57', 'mysql80', 'mysql84', 'maria1011', 'maria114'])('兼容既有静态形状 %s，原文与指标不改写', name => {
    const raw = readFileSync(new URL('../fixtures/explain/' + name + '.json', import.meta.url), 'utf8');
    const plan = parseExplainPlan(raw, name.startsWith('maria') ? 'mariadb' : 'mysql', '静态形状');
    expect(plan.raw).toBe(raw); expect(plan.nodes.length).toBeGreaterThan(4);
    expect(plan.nodes.every(item => Array.isArray(item.properties) && item.properties.length <= 18)).toBe(true);
    if (name === 'maria1011') {
      expect(plan.nodes.find(item => item.kind === 'filesort')?.properties).toEqual([{ source: 'sort_key', value: 'customer.id' }]);
      expect(plan.nodes.find(item => item.name === 'customer')?.properties).toContainEqual({ source: 'attached_condition', value: 'customer.active = 1' });
    }
    if (name === 'mysql80') expect(plan.nodes.find(item => item.kind === 'materialized_from_subquery')?.properties).toEqual([{ source: 'using_temporary_table', value: 'true' }]);
  });

  it('数组包装与带转义键的未知节点仍绑定原节点属性，顺序和精确指标不变', () => {
    const raw = '{"query_block":{"nested_loop":[{"table":{"table_name":"a","rows_examined_per_scan":900719925474099312345,"filtered":0.0000000000000000001,"cost_info":{"read_cost":0.123456789012345678901},"ref":["const"],"using_index":false}},{"future/op~kind":{"message":"future","dependent":true}}]}}';
    const plan = parseExplainPlan(raw, 'mysql', '8.4.0');
    expect(plan.nodes.map(item => [item.kind, item.path])).toEqual([
      ['plan', ''], ['query_block', '/query_block'], ['nested_loop', '/query_block/nested_loop'],
      ['table', '/query_block/nested_loop/0/table'], ['future/op~kind', '/query_block/nested_loop/1/future~1op~0kind']
    ]);
    const first = plan.nodes[3], unknown = plan.nodes[4];
    expect(first.rows?.value).toBe('900719925474099312345'); expect(first.filtered?.value).toBe('0.0000000000000000001');
    expect(first.costs).toEqual([{ source: 'cost_info.read_cost', value: '0.123456789012345678901' }]);
    expect(first.properties).toEqual([{ source: 'ref', value: '["const"]' }, { source: 'using_index', value: 'false' }]);
    expect(unknown.unknown).toBe(true); expect(unknown.properties).toEqual([{ source: 'message', value: 'future' }, { source: 'dependent', value: 'true' }]);
    expect(explainNodeDetail(raw, unknown.path)).toContain('future'); expect(plan.warnings).toHaveLength(1);
  });

  it('长条件按 UTF-16 限额截断，完整 Unicode 代理对不被截开，原文仍保留', () => {
    const value = 'a'.repeat(2047) + '😀条件', raw = table({ attached_condition: value });
    expect(node(raw).properties).toEqual([{ source: 'attached_condition', value: 'a'.repeat(2047), truncated: true }]);
    const emoji = node(table({ message: '😀'.repeat(2000) })).properties![0];
    expect(emoji.value).toBe('😀'.repeat(1024)); expect(emoji.truncated).toBe(true);
    expect(parseExplainPlan(raw, 'mysql', '8.4.0').raw).toBe(raw);
  });

  it('等于字符预算时不虚报截断', () => {
    const message = '中'.repeat(explainLimits.property);
    expect(node(table({ message })).properties).toEqual([{ source: 'message', value: message }]);
  });

  it('列表先限 32 项，显示 JSON 字符串且标出项数截断', () => {
    const entries = Array.from({ length: 40 }, (_, index) => 'idx_' + index);
    expect(node(table({ possible_keys: entries })).properties).toEqual([
      { source: 'possible_keys', value: JSON.stringify(entries.slice(0, explainLimits.propertyItems)), truncated: true }
    ]);
    expect(node(table({ possible_keys: entries.slice(0, 32) })).properties![0]).toEqual({ source: 'possible_keys', value: JSON.stringify(entries.slice(0, 32)) });
  });

  it('超长列表和转义字符串逐项有界编码，不拼接完整大数组', () => {
    const entries = Array.from({ length: 1000 }, () => '\\"\n' + '😀'.repeat(30)), raw = table({ used_columns: entries });
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      const property = node(raw).properties![0];
      expect(property.value.length).toBeLessThanOrEqual(explainLimits.property); expect(property.truncated).toBe(true);
      expect(property.value).toMatch(/^\["/);
      expect(stringify.mock.calls.every(([input]) => typeof input === 'string' && input.length <= explainLimits.property + 1)).toBe(true);
      expect(stringify).toHaveBeenCalled(); expect(stringify.mock.calls.length).toBeLessThanOrEqual(explainLimits.propertyItems);
    } finally { stringify.mockRestore(); }
  });

  it('单个巨大列表项先限制编码输入，所有属性值均不超过 2048 字符', () => {
    const raw = table({ ref: ['\n'.repeat(15000)], message: 'a'.repeat(10000), using_index: true });
    const properties = node(raw).properties!;
    expect(properties.map(item => item.source)).toEqual(['ref', 'message', 'using_index']);
    expect(properties.every(item => item.value.length <= explainLimits.property)).toBe(true);
    expect(properties.slice(0, 2).every(item => item.truncated)).toBe(true);
    expect(properties[2]).toEqual({ source: 'using_index', value: 'true' });
  });

  it('损坏或超预算 JSON 仍沿用整计划回退，不能生成不可靠属性树', () => {
    for (const raw of ['{"query_block":', table({ message: '中'.repeat(70000) })]) {
      const plan = parseExplainPlan(raw, 'mysql', '8.4.0');
      expect(plan.nodes).toEqual([]); expect(plan.raw).toBe(raw); expect(plan.warnings).toHaveLength(1);
    }
  });
});
