import { describe, expect, it } from 'vitest';
import * as explain from '../../src/shared/explain';

const containers = ['query_specifications', 'subqueries', 'attached_subqueries', 'optimized_away_subqueries', 'having_subqueries', 'select_list_subqueries'] as const;

/** 通过公共解析入口核对包装层，不用构造节点替代实际 JSON。 */
function plan(document: unknown) {
  return explain.parseExplainPlan(JSON.stringify(document), 'mysql', '8.4.0');
}

describe('执行计划查询数组实际包装层', () => {
  it('公开的查询数组白名单只包含约定的六种容器', () => {
    expect(Reflect.get(explain, 'explainQueryArrayKinds')).toEqual(containers);
  });

  it.each(containers)('%s 保留带标志和单 query_block 键的实际层级', container => {
    const output = plan({ query_block: { [container]: [
      { dependent: false, cacheable: true, query_block: { select_id: 2, message: 'first' } },
      { query_block: { select_id: 3, message: 'second' } }
    ] } });
    const path = '/query_block/' + container;
    expect(output.nodes.map(node => [node.kind, node.path, node.parent, node.depth])).toEqual([
      ['plan', '', undefined, 0], ['query_block', '/query_block', '0', 1], [container, path, '1', 2],
      ['0', path + '/0', '2', 3], ['query_block', path + '/0/query_block', '3', 4],
      ['1', path + '/1', '2', 3], ['query_block', path + '/1/query_block', '5', 4]
    ]);
    const first = output.nodes[3], second = output.nodes[5];
    expect(first).toMatchObject({ unknown: false, arrayEntry: { container, index: 0 }, properties: [{ source: 'dependent', value: 'false' }, { source: 'cacheable', value: 'true' }] });
    expect(second).toMatchObject({ unknown: false, arrayEntry: { container, index: 1 }, properties: [] });
    expect(output.nodes[4]).toMatchObject({ name: '2', properties: [{ source: 'message', value: 'first' }] });
    expect(output.nodes[6]).toMatchObject({ name: '3', properties: [{ source: 'message', value: 'second' }] });
    expect(output.warnings).toEqual([]);
  });

  it('两层多分支沿 JSON 包含顺序呈现，索引各自从零开始', () => {
    const output = plan({ query_block: { query_specifications: [
      { query_block: { select_id: 2, attached_subqueries: [{ query_block: { select_id: 4 } }, { query_block: { select_id: 5 } }] } },
      { query_block: { select_id: 3, subqueries: [{ query_block: { select_id: 6 } }] } }
    ] } });
    expect(output.nodes.filter(node => node.kind === 'query_block').map(node => node.name)).toEqual([undefined, '2', '4', '5', '3', '6']);
    expect(output.nodes.filter(node => Reflect.get(node, 'arrayEntry')).map(node => [node.path, Reflect.get(node, 'arrayEntry')])).toEqual([
      ['/query_block/query_specifications/0', { container: 'query_specifications', index: 0 }],
      ['/query_block/query_specifications/0/query_block/attached_subqueries/0', { container: 'attached_subqueries', index: 0 }],
      ['/query_block/query_specifications/0/query_block/attached_subqueries/1', { container: 'attached_subqueries', index: 1 }],
      ['/query_block/query_specifications/1', { container: 'query_specifications', index: 1 }],
      ['/query_block/query_specifications/1/query_block/subqueries/0', { container: 'subqueries', index: 0 }]
    ]);
    expect(output.warnings).toEqual([]);
  });

  it.each(['mysql', 'mariadb'] as const)('%s 包装指标与子块指标分离，保留原数值精度和原始属性类型', dialect => {
    const raw = '{"query_block":{"subqueries":[{"rows":900719925474099312345,"rows_examined_per_scan":900719925474099312345,"cost":0.123456789012345678901,"cost_info":{"query_cost":0.123456789012345678901},"dependent":false,"cacheable":"true","query_block":{"select_id":900719925474099312346,"rows":4,"rows_examined_per_scan":4,"cost":5,"cost_info":{"query_cost":5},"cacheable":true,"message":7}}]}}';
    const output = explain.parseExplainPlan(raw, dialect, '静态类型用例'), entry = output.nodes[3], child = output.nodes[4];
    expect(entry).toMatchObject({ arrayEntry: { container: 'subqueries', index: 0 }, rows: { value: '900719925474099312345' }, properties: [{ source: 'dependent', value: 'false' }] });
    expect(entry.costs).toEqual([{ source: dialect === 'mysql' ? 'cost_info.query_cost' : 'cost', value: '0.123456789012345678901' }]);
    expect(child).toMatchObject({ name: '900719925474099312346', rows: { value: '4' }, properties: [{ source: 'cacheable', value: 'true' }] });
    expect(child.costs[0].value).toBe('5');
    expect(Reflect.get(child, 'arrayEntry')).toBeUndefined();
    expect(output.raw).toBe(raw); expect(output.rawTruncated).toBe(false); expect(output.warnings).toEqual([]);
  });

  it('JSON Pointer 转义保持可读取包装详情，未知字段仍单独保留并警告', () => {
    const raw = '{"a/b~c":{"query_specifications":[{"dependent":false,"query_block":{"message":"ok"},"future/op~kind":{"message":"future"}}]}}';
    const output = explain.parseExplainPlan(raw, 'mysql', '8.4.0');
    const entry = output.nodes.find(node => node.path === '/a~1b~0c/query_specifications/0')!;
    expect(entry).toMatchObject({ kind: '0', unknown: false, arrayEntry: { container: 'query_specifications', index: 0 } });
    expect(explain.explainNodeDetail(raw, entry.path)).toContain('"dependent": false');
    const unknown = output.nodes.find(node => node.kind === 'future/op~kind')!;
    expect(unknown).toMatchObject({ parent: entry.id, path: entry.path + '/future~1op~0kind', unknown: true });
    expect(Reflect.get(unknown, 'arrayEntry')).toBeUndefined();
    expect(output.warnings).toEqual(['存在未知计划节点，已保留其名称、位置和原始数据']);
  });

  it('未知数组、非数组容器与错类型 query_block 不推断为查询数组项', () => {
    const output = plan({
      future_queries: [{ dependent: false, query_block: { select_id: 1 } }],
      subqueries: { query_block: { select_id: 2 } },
      attached_subqueries: [{ query_block: null }, { query_block: 3 }, { query_block: [] }, { query_block: 'bad' }, { dependent: false }]
    });
    expect(output.nodes.every(node => Reflect.get(node, 'arrayEntry') === undefined)).toBe(true);
    for (const index of [0, 1, 2, 3, 4]) expect(output.nodes.find(node => node.path === '/attached_subqueries/' + index)).toMatchObject({ kind: String(index), unknown: true });
    expect(output.warnings).toContain('存在未知计划节点，已保留其名称、位置和原始数据');
  });

  it('原型 query_block 同名对象不能代替数组项的自有字段', () => {
    const before = Object.getOwnPropertyDescriptor(Object.prototype, 'query_block');
    try {
      Object.defineProperty(Object.prototype, 'query_block', { value: { select_id: 'inherited' }, configurable: true, writable: true });
      const output = plan({ subqueries: [{ dependent: false, cacheable: true }] });
      expect(output.nodes[2]).toMatchObject({ kind: '0', unknown: true });
      expect(Reflect.get(output.nodes[2], 'arrayEntry')).toBeUndefined();
      expect(output.nodes.some(node => node.name === 'inherited')).toBe(false);
    } finally {
      if (before) Object.defineProperty(Object.prototype, 'query_block', before); else Reflect.deleteProperty(Object.prototype, 'query_block');
    }
  });

  it('已知查询数组的 null、标量和数组成员均保留索引、原详情及未知告警', () => {
    const members = [null, false, 0, 'x', [], [1, 2], { query_block: null }];
    const raw = JSON.stringify({ query_block: { subqueries: members } });
    const output = explain.parseExplainPlan(raw, 'mysql', '8.4.0');
    const entries = output.nodes.filter(node => node.parent === '2');
    expect(entries).toHaveLength(members.length);
    expect(entries.map(node => [node.kind, node.path, node.unknown])).toEqual(members.map((_, index) => [String(index), '/query_block/subqueries/' + index, true]));
    for (const [index, node] of entries.entries()) {
      expect(Reflect.get(node, 'arrayEntry')).toBeUndefined();
      expect(node.properties).toEqual([]); expect(node.costs).toEqual([]);
      expect(node.rows).toBeUndefined(); expect(node.produced).toBeUndefined();
      expect(JSON.parse(explain.explainNodeDetail(raw, node.path))).toEqual(explain.readExplainJson(JSON.stringify(members[index])));
    }
    expect(output.raw).toBe(raw);
    expect(output.warnings).toEqual(['存在未知计划节点，已保留其名称、位置和原始数据']);
  });

  it.each([[null], [false], [0], ['x'], []])('纯标量或空的已知查询数组容器也不会被通用过滤跳过：%j', (...members) => {
    const output = plan({ query_block: { subqueries: members } });
    expect(output.nodes[2]).toMatchObject({ kind: 'subqueries', path: '/query_block/subqueries', unknown: false });
    expect(output.nodes.filter(node => node.parent === '2')).toHaveLength(members.length);
    expect(output.warnings).toEqual(members.length ? ['存在未知计划节点，已保留其名称、位置和原始数据'] : []);
  });

  it('普通 nested_loop 和 windows 数组保持原展开行为', () => {
    const output = plan({ query_block: { nested_loop: [{ table: { table_name: 'first' } }, { table: { table_name: 'second' } }], windows: [{ name: 'w', using_temporary_table: false }] } });
    expect(output.nodes.filter(node => node.kind === 'table').map(node => [node.name, node.path])).toEqual([['first', '/query_block/nested_loop/0/table'], ['second', '/query_block/nested_loop/1/table']]);
    expect(output.nodes.find(node => node.kind === 'window')).toMatchObject({ name: 'w', path: '/query_block/windows/0' });
    expect(output.nodes.every(node => Reflect.get(node, 'arrayEntry') === undefined)).toBe(true); expect(output.warnings).toEqual([]);
  });

  it('300 节点截断保留已生成包装的元数据，完整原文不变', () => {
    const raw = JSON.stringify({ query_block: { query_specifications: Array.from({ length: 200 }, (_, index) => ({ query_block: { select_id: index + 1 } })) } });
    const output = explain.parseExplainPlan(raw, 'mysql', '8.4.0');
    expect(output.nodes).toHaveLength(explain.explainLimits.nodes); expect(output.raw).toBe(raw); expect(output.rawTruncated).toBe(false);
    const entries = output.nodes.filter(node => Reflect.get(node, 'arrayEntry'));
    expect(entries).toHaveLength(149); expect(entries.at(-1)).toMatchObject({ kind: '148', arrayEntry: { container: 'query_specifications', index: 148 } });
    expect(output.warnings).toEqual(['树形展示达到 300 个节点上限，其余内容请查看原始输出']);
  });

  it('长路径仅截断路径展示，不丢失原索引、容器和标志', () => {
    const raw = JSON.stringify({ ['x'.repeat(2050)]: { select_list_subqueries: [{ dependent: false, query_block: { select_id: 2 } }] } });
    const output = explain.parseExplainPlan(raw, 'mysql', '8.4.0'), entry = output.nodes.find(node => Reflect.get(node, 'arrayEntry'))!;
    expect(entry).toMatchObject({ kind: '0', pathTruncated: true, arrayEntry: { container: 'select_list_subqueries', index: 0 }, properties: [{ source: 'dependent', value: 'false' }] });
    expect(entry.path.length).toBe(explain.explainLimits.path); expect(output.raw).toBe(raw);
    expect(output.warnings).toContain('部分节点路径超过 2048 字符，已限制路径展示，详情请查看原始输出');
  });
});
