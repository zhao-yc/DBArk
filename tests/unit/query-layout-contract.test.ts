import { expect, it } from 'vitest';
import { assertQueryLayoutWrite, queryLayoutLimits, readQueryEditorHeight } from '../../src/shared/queryLayout';

it('查询高度合同固定像素范围与缺省值，缺项保持旧调用兼容', () => {
  expect(queryLayoutLimits).toEqual({ minEditorHeight: 130, maxEditorHeight: 8192, defaultEditorHeight: 300 });
  expect(readQueryEditorHeight(undefined)).toBe(300);
  expect(() => assertQueryLayoutWrite({ tabs: [{ kind: 'query' }, { kind: 'table' }] })).not.toThrow();
});
it.each([130, 300, 8192])('合法自有高度%s保持原整数', value => {
  expect(readQueryEditorHeight(value)).toBe(value);
  expect(() => assertQueryLayoutWrite({ tabs: [{ kind: 'query', queryEditorHeight: value }] })).not.toThrow();
});
it.each([undefined, null, '300', 129, 8193, 130.5, NaN, Infinity, -Infinity, true, {}, []])('显式坏高度%s读取回退、写入拒绝', value => {
  expect(readQueryEditorHeight(value)).toBe(300);
  expect(() => assertQueryLayoutWrite({ tabs: [{ kind: 'query', queryEditorHeight: value }] })).toThrow('整数');
});
it.each([130, undefined, null])('表标签不能带高度%s，即使为空或数值合法', value => {
  expect(() => assertQueryLayoutWrite({ tabs: [{ kind: 'table', queryEditorHeight: value }] })).toThrow('只有查询');
});
it('继承的高度不能被转成可写字段；合同验证不修改原标签和SQL', () => {
  const inherited = Object.assign(Object.create({ queryEditorHeight: 400 }), { kind: 'query' });
  expect(() => assertQueryLayoutWrite({ tabs: [inherited] })).toThrow('自有');
  const settings = Object.freeze({ tabs: Object.freeze([Object.freeze({ kind: 'query', sql: '原文\t🚢', queryEditorHeight: 450 })]) });
  assertQueryLayoutWrite(settings); expect(settings.tabs[0]).toEqual({ kind: 'query', sql: '原文\t🚢', queryEditorHeight: 450 });
});
