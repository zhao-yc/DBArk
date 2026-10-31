import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { buildSqliteExplainPlan, sqliteExplainLimits as limits, sqliteExplainMessages as text } from '../../src/shared/sqliteExplain';

/** 四列原值直接来自给定夹具，测试不调用产品的父关系重建函数生成期望。 */
function result(rows: unknown[][], truncated = false): QueryResult {
  return { columns: ['id', 'parent', 'notused', 'detail'].map((name, index) => ({ key: 'c' + index, name, type: 'SQLITE' })), rows: rows.map(values => Object.fromEntries(values.map((value, index) => ['c' + index, value]))), truncated, elapsedMs: 0, statement: 'EXPLAIN QUERY PLAN SELECT 1' } as QueryResult;
}
describe('SQLite原始执行计划关系与预算', () => {
  it('父行迟到、多个根和兄弟仍准确建树；不把说明中的SEARCH/索引/数字猜作指标', () => {
    const input = result([['9', '4', '0', 'SEARCH "中文🚢" USING INDEX i (n=?)'], ['4', '0', '7', 'MATERIALIZE x'], ['10', '4', '-1', 'SCAN x 9223372036854775807'], ['20', '0', '0', 'USE TEMP B-TREE FOR ORDER BY']]);
    const before = structuredClone(input), plan = buildSqliteExplainPlan(input, '3.53.4');
    expect(plan.nodes).toEqual([{ id: '4', depth: 0, detail: 'MATERIALIZE x', auxiliary: '7' }, { id: '9', parent: '4', depth: 1, detail: 'SEARCH "中文🚢" USING INDEX i (n=?)', auxiliary: '0' }, { id: '10', parent: '4', depth: 1, detail: 'SCAN x 9223372036854775807', auxiliary: '-1' }, { id: '20', depth: 0, detail: 'USE TEMP B-TREE FOR ORDER BY', auxiliary: '0' }]);
    expect(plan).toMatchObject({ dialect: 'sqlite', version: '3.53.4', initialView: 'tree', rawTruncated: false, warnings: [] });
    expect(JSON.parse(plan.raw)).toEqual({ columns: ['id', 'parent', 'notused', 'detail'], rows: input.rows.map(row => [row.c0, row.c1, row.c2, row.c3]) }); expect(input).toEqual(before);
    expect(plan.nodes.every(node => !Object.hasOwn(node, 'costs') && !Object.hasOwn(node, 'rows'))).toBe(true);
  });
  it('原生0根和最大整数标识不经Number；空计划不虚构节点', () => {
    expect(buildSqliteExplainPlan(result([['0', '0', '0', 'ROOT'], ['9223372036854775807', '0', '0', 'SCAN t']]), 'v').nodes.map(node => node.id)).toEqual(['0', '9223372036854775807']);
    expect(buildSqliteExplainPlan(result([]), 'v')).toMatchObject({ nodes: [], warnings: [], rawTruncated: false });
    expect(buildSqliteExplainPlan(result([[3, 0, 0, 'SCAN t']]), 'v', 'table')).toMatchObject({ initialView: 'table', nodes: [{ id: '3', auxiliary: '0' }] });
  });
  it.each([
    [['3', '0', '0', 'a'], ['3', '0', '0', 'b']], [['3', '77', '0', '孤儿']], [['3', '3', '0', '自环']], [['3', '4', '0', '环1'], ['4', '3', '0', '环2']],
    [['01', '0', '0', '非规范编号']], [[Number.MAX_SAFE_INTEGER + 1, '0', '0', '失精']], [['9223372036854775808', '0', '0', '溢出']], [['1', '0', 'x', '非整数aux']], [['1', '0', '0', null]],
  ].map(rows => ({ rows })))('无可靠关系$rows保留原始表格，不发布部分树', ({ rows }) => {
    const input = result(rows), plan = buildSqliteExplainPlan(input, 'v'); expect(plan.nodes).toEqual([]); expect(plan.initialView).toBe('table'); expect(plan.warnings).toContain(text.relation); expect(JSON.parse(plan.raw).rows).toHaveLength(rows.length);
  });
  it('关系单元格访问器不执行，异常列名或重复列键不猜格式', () => {
    const input = result([['1', '0', '0', '原说明']]); let called = false; Object.defineProperty(input.rows[0], 'c0', { enumerable: true, get() { called = true; return '1'; } });
    expect(buildSqliteExplainPlan(input, 'v').warnings).toContain(text.relation); expect(called).toBe(false);
    for (const change of ['name', 'key'] as const) { const value = result([['1', '0', '0', '原说明']]); value.columns[0][change] = change === 'name' ? 'future_id' : 'c1'; expect(buildSqliteExplainPlan(value, 'v').warnings).toContain(text.columns); }
  });
  it('截断只保留原表格，不能用缺失父行编造有效关系', () => {
    expect(buildSqliteExplainPlan(result([['2', '1', '0', '原文']], true), 'v')).toMatchObject({ initialView: 'table', nodes: [], warnings: [text.truncated] });
    const rows = Array.from({ length: limits.nodes + 1 }, (_, index) => [String(index + 1), '0', '0', 'SCAN t']); expect(buildSqliteExplainPlan(result(rows), 'v').warnings).toContain(text.nodes);
    expect(buildSqliteExplainPlan(result([...rows, ...rows, ...rows, ...rows]), 'v').warnings).toContain(text.truncated);
  });
  it('64层边界可读，65层整棵树降级且不返回半棵树', () => {
    const rows = Array.from({ length: limits.depth }, (_, index) => [String(index + 1), String(index), '0', 'SCAN t']); const plan = buildSqliteExplainPlan(result(rows), 'v'); expect(plan.nodes.at(-1)?.depth).toBe(63); expect(plan.warnings).toEqual([]);
    rows.push(['65', '64', '0', 'too deep']); expect(buildSqliteExplainPlan(result(rows), 'v')).toMatchObject({ nodes: [], initialView: 'table', warnings: [text.depth] });
  });
  it('300节点与说明预算按原始内容核验；不靠裁剪原说明保留看似完整的树', () => {
    const rows = Array.from({ length: limits.nodes }, (_, index) => [String(index + 1), '0', '0', 'SCAN t']); expect(buildSqliteExplainPlan(result(rows), 'v').nodes).toHaveLength(limits.nodes);
    expect(buildSqliteExplainPlan(result([['1', '0', '0', '字'.repeat(limits.detail)]]), 'v').nodes).toHaveLength(1);
    expect(buildSqliteExplainPlan(result([['1', '0', '0', '字'.repeat(limits.detail + 1)]]), 'v')).toMatchObject({ nodes: [], initialView: 'table', warnings: [text.detail] });
  });
  it.each(['🚢', '字', '\\"\n'])('raw对%j按UTF8字节有界，截断不切断Unicode且不改原始结果', value => {
    const input = result([['1', '0', '0', value.repeat(limits.rawBytes)]]), plan = buildSqliteExplainPlan(input, 'v');
    expect(plan.rawTruncated).toBe(true); expect(Buffer.byteLength(plan.raw)).toBeLessThanOrEqual(limits.rawBytes); expect(plan.warnings).toContain(text.raw); expect(plan.raw).not.toMatch(/[\uD800-\uDBFF]$/); expect(input.rows[0].c3).toBe(value.repeat(limits.rawBytes));
  });
});
