import { expect, it } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { captureQueryResultMemory, queryResultMemoryMatches, queryResultMemoryLimits } from '../../src/renderer/queryResultMemory';
import { prepareQueryResultOrganization, type QueryResultOrganization } from '../../src/renderer/queryResultHistory';

/** 含重名列及精确值；暂存不依赖SQL或旧行，只在显式应用时验证新结果。 */
function fixture() {
  const result: QueryResult = { columns: [{ key: 'id', name: '同名', type: 'BIGINT' }, { key: 'value', name: '同名', type: 'TEXT' }], rows: [{ id: '9007199254740993', value: '甲' }, { id: '2', value: null }], truncated: true, elapsedMs: 1, statement: '禁止存入暂存的SQL' };
  const configuration: QueryResultOrganization = { expression: { mode: 'OR', children: [{ column: 'id', operator: 'in', value: '', values: ['2', '9007199254740993'] }, { mode: 'AND', children: [{ column: 'value', operator: 'eq', value: '停用原文', enabled: false }] }] }, sort: [{ column: 'value', direction: 'DESC', nulls: 'FIRST', ignoreCase: true }, { column: 'id', direction: 'ASC' }] };
  return { result, configuration };
}

it('完整独立深冻结，保留嵌套/停用/列表及NULL/大小写，不存行或SQL', () => {
  const { result, configuration } = fixture(), before = structuredClone(result);
  const saved = captureQueryResultMemory(result, result.columns, configuration);
  expect(saved.configuration).toEqual(configuration); expect(saved.configuration).not.toBe(configuration);
  expect(Object.isFrozen(saved.configuration.expression.children[1])).toBe(true);
  expect(Object.keys(saved).sort()).toEqual(['columns', 'configuration', 'visible']);
  expect(JSON.stringify(saved)).not.toContain(result.statement); expect(JSON.stringify(saved)).not.toContain('rows');
  (configuration.sort[0] as any).direction = 'ASC'; result.columns[0].name = '后来改名';
  expect(saved.configuration.sort[0].direction).toBe('DESC'); expect(saved.columns[0].name).toBe('同名');
  result.columns[0].name = before.columns[0].name; expect(result).toEqual(before);
});

it.each(['key', 'name', 'type', 'order', 'extra', 'visible'] as const)('匹配完整有序元数据：%s变化整份拒绝', change => {
  const { result, configuration } = fixture(), saved = captureQueryResultMemory(result, result.columns, configuration), next = structuredClone(result);
  let visible = next.columns;
  if (change === 'order') next.columns.reverse();
  else if (change === 'extra') next.columns.push({ key: 'extra', name: '额外列', type: 'TEXT' });
  else if (change === 'visible') visible = next.columns.slice(1);
  else next.columns[0][change] = '不同';
  expect(queryResultMemoryMatches(saved, next, visible)).toBe(false);
  expect(queryResultMemoryMatches(saved, undefined, [])).toBe(false);
});

it('新结果允许相同元数据的新对象和新行，精确排序保持原引用；空筛选不回退全集', () => {
  const { result, configuration } = fixture(), saved = captureQueryResultMemory(result, result.columns, configuration), next = structuredClone(result);
  next.statement = '另一个明确由用户选择的SQL'; next.rows = [{ id: '2', value: '乙' }, { id: '9007199254740993', value: null }];
  expect(queryResultMemoryMatches(saved, next, next.columns)).toBe(true);
  const ready = prepareQueryResultOrganization(next, [], next.columns, saved.configuration);
  expect(ready.sorter.view(ready.sortBinding)!.result.rows).toEqual([next.rows[1], next.rows[0]]);
  expect(ready.sorter.view(ready.sortBinding)!.result.rows[0]).toBe(next.rows[1]);
  next.rows = [{ id: '3', value: '不匹配' }];
  const empty = prepareQueryResultOrganization(next, [], next.columns, saved.configuration);
  expect(empty.sorter.view(empty.sortBinding)!.result.rows).toEqual([]);
  expect(empty.sorter.view(empty.sortBinding)!.result.truncated).toBe(true);
});

it('新行内容与规则不兼容时拒绝完整试算，不改新原行或原配置', () => {
  const { result, configuration } = fixture(), saved = captureQueryResultMemory(result, result.columns, configuration), next = structuredClone(result);
  next.rows[0].id = '非整数'; const before = structuredClone(next);
  expect(() => prepareQueryResultOrganization(next, [], next.columns, saved.configuration)).toThrow();
  expect(next).toEqual(before); expect(saved.configuration).toEqual(configuration);
});

it('配置与元数据共用容量，超限不截断；只复制正式控制器的规则字段', () => {
  const { result, configuration } = fixture();
  (configuration as any).sql = '额外正文'; (configuration.sort[0] as any).rows = result.rows;
  const saved = captureQueryResultMemory(result, result.columns, configuration);
  expect(JSON.stringify(saved)).not.toContain('额外正文'); expect(JSON.stringify(saved)).not.toContain('rows');
  result.columns[0].name = '字'.repeat(queryResultMemoryLimits.units);
  expect(() => captureQueryResultMemory(result, result.columns, configuration)).toThrow('容量');
  expect(saved.columns[0].name).toBe('同名');
});
