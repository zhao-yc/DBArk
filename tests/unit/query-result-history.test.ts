import { describe, expect, it } from 'vitest';
import { QueryResultHistory, prepareQueryResultOrganization, queryResultHistoryLimits, type QueryResultOrganization } from '../../src/renderer/queryResultHistory';
import type { QueryResult } from '../../src/shared/contracts';

const empty = (): QueryResultOrganization => ({ expression: { mode: 'AND', children: [] }, sort: [] });
const sorted = (direction: 'ASC' | 'DESC'): QueryResultOrganization => ({ ...empty(), sort: [{ column: 'id', direction, nulls: 'LAST' }] });
/** 行保持高精度原文及原引用；历史只复制配置。 */
function fixture() {
  const source: QueryResult = { columns: [{ key: 'id', name: '编号', type: 'BIGINT' }, { key: 'value', name: '金额', type: 'DECIMAL' }], rows: [{ id: '9007199254740993', value: '0.12345678901234567891' }, { id: '2', value: null }], truncated: true, elapsedMs: 0, statement: '不应进入历史的SQL' };
  const history = new QueryResultHistory(), binding = history.bind(source, source.columns, ['a'], empty())!;
  return { source, history, binding };
}
describe('当前结果排序筛选的有界撤销历史', () => {
  it('整份配置原子应用新控制器后保留历史，旧票据作废，原样应用不丢重做', () => {
    const { source, history, binding } = fixture(); history.record(binding, sorted('ASC'));
    const old = history.target(binding, -1)!, owner = {};
    history.record(binding, sorted('DESC'), owner);
    expect(history.bind(source, source.columns, ['a'], sorted('DESC'), owner)).toBe(binding);
    expect(() => history.commit(old)).toThrow();
    history.commit(history.target(binding, -1)!); expect(history.target(binding, 1)!.configuration).toEqual(sorted('DESC'));
    const nextOwner = {}; history.record(binding, sorted('ASC'), nextOwner);
    expect(history.bind(source, source.columns, ['a'], sorted('ASC'), nextOwner)).toBe(binding);
    expect(history.target(binding, 1)!.configuration).toEqual(sorted('DESC'));
  });
  it('按整次操作往返，票据不提前移动游标，配置副本深冻结', () => {
    const { history, binding } = fixture(), next = sorted('ASC'); history.record(binding, next);
    (next.sort[0] as any).direction = 'DESC'; const undo = history.target(binding, -1)!;
    expect(undo.configuration).toEqual(empty()); expect(history.target(binding, 1)).toBeUndefined(); history.commit(undo);
    const redo = history.target(binding, 1)!; expect(redo.configuration.sort[0].direction).toBe('ASC'); expect(Object.isFrozen(redo.configuration.sort[0])).toBe(true); history.commit(redo);
    expect(() => history.commit(undo)).toThrow();
  });
  it('原样应用保留重做；成功的新步骤丢弃未来分支', () => {
    const { history, binding } = fixture(); history.record(binding, sorted('ASC')); history.commit(history.target(binding, -1)!);
    history.record(binding, empty()); expect(history.target(binding, 1)).toBeDefined(); history.record(binding, sorted('DESC')); expect(history.target(binding, 1)).toBeUndefined();
  });
  it('同来源重绘不复制或清历史；上下文、列身份或控制器变代后拒旧票据', () => {
    const { source, history, binding } = fixture(); history.record(binding, sorted('ASC')); const old = history.target(binding, -1)!;
    expect(history.bind(source, source.columns, ['a'], sorted('ASC'))).toBe(binding);
    const newer = history.bind(source, source.columns, ['b'], empty())!; expect(history.target(binding, -1)).toBeUndefined(); expect(() => history.commit(old)).toThrow();
    history.record(newer, sorted('DESC')); const replaced = history.bind(source, source.columns, ['b'], sorted('DESC'), {}); expect(replaced).not.toBe(newer); expect(history.target(replaced, -1)).toBeUndefined();
  });
  it('提交已验证的新控制器后继续重做；显式失活再返回相同上下文也不复活', () => {
    const { source, history, binding } = fixture(); history.record(binding, sorted('ASC')); const owner = {}; history.commit(history.target(binding, -1)!, owner);
    expect(history.bind(source, source.columns, ['a'], empty(), owner)).toBe(binding); expect(history.target(binding, 1)).toBeDefined();
    history.invalidate(); const later = history.bind(source, source.columns, ['a'], empty(), owner)!; expect(later).not.toBe(binding); expect(history.target(later, -1)).toBeUndefined();
  });
  it('最多20步并按配置字符总量淘汰最旧步骤；超大单项不截断条件', () => {
    const { history, binding } = fixture();
    for (let i = 0; i < 40; i++) history.record(binding, { expression: { mode: 'AND', children: [{ column: 'id', operator: 'eq', value: String(i) }] }, sort: [] });
    let count = 0; while (history.target(binding, -1)) { history.commit(history.target(binding, -1)!); count++; } expect(count).toBe(queryResultHistoryLimits.steps);
    const huge = { expression: { mode: 'AND' as const, children: [{ column: 'id', operator: 'eq' as const, value: 'x'.repeat(queryResultHistoryLimits.entryUnits) }] }, sort: [] };
    history.record(binding, huge); expect(history.limited).toBe(true); expect(history.target(binding, -1)).toBeUndefined(); expect(huge.expression.children[0].value).toHaveLength(queryResultHistoryLimits.entryUnits);
  });
  it('完整试算保持精确值、NULL、截断与原行身份，失败不修改已生效控制器', () => {
    const { source } = fixture(), before = structuredClone(source), current = prepareQueryResultOrganization(source, [], source.columns, sorted('ASC'));
    expect(current.sorter.view(current.sortBinding)!.result.rows).toEqual([source.rows[1], source.rows[0]]);
    expect(() => prepareQueryResultOrganization(source, [], source.columns, { ...empty(), sort: [{ column: 'missing', direction: 'ASC' }] })).toThrow();
    expect(current.sorter.view(current.sortBinding)!.rules).toEqual(sorted('ASC').sort); expect(source).toEqual(before);
    const none = prepareQueryResultOrganization(source, [], source.columns, { expression: { mode: 'AND', children: [{ column: 'id', operator: 'eq', value: '0' }] }, sort: sorted('ASC').sort });
    expect(none.sorter.view(none.sortBinding)!.result.rows).toEqual([]); expect(none.sorter.view(none.sortBinding)!.result.truncated).toBe(true);
  });
  it('多个合法大小的配置共享总容量，不靠20步上限掩盖文本累计', () => {
    const { history, binding } = fixture();
    for (let i = 0; i < 12; i++) history.record(binding, { expression: { mode: 'AND', children: Array.from({ length: 24 }, () => ({ column: 'id', operator: 'eq', value: String(i) + 'x'.repeat(4000), enabled: false })) }, sort: [] });
    let count = 0; while (history.target(binding, -1)) { history.commit(history.target(binding, -1)!); count++; }
    expect(count).toBeGreaterThan(0); expect(count).toBeLessThan(6); expect(history.limited).toBe(false);
  });
});
