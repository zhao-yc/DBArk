import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { QueryRowDetails, queryRowDetailPrefix, queryRowDetailValue, queryRowDetailsLimits as limits } from '../../src/renderer/queryRowDetails';

/** 保留真实驱动契约的精确文本、原型同名key和显式字节，不依赖数据库端口。 */
function result(): QueryResult {
  const row = JSON.parse('{"__proto__":"18446744073709551615","constructor":"0.12345678901234567890","json":"{\\"a\\":1,\\"a\\":2}","nil":null,"empty":"","bytes":{"type":"binary","base64":"AP8="},"zero":{"type":"binary","base64":""}}');
  return { columns: Object.keys(row).map(key => ({ key, name: '同名', type: 'TEXT' })), rows: [row, { ...row, json: '<script>原文本</script>' }], statement: '仅RAM', elapsedMs: 0, truncated: true };
}

describe('只读整行原值与预算', () => {
  it('按原完整列序及唯一key读取，保留精确文本、NULL、空串和空字节，原数据不变', () => {
    const source = result(), before = structuredClone(source), controller = new QueryRowDetails(), binding = controller.bind(source, ['q', 1])!;
    const view = controller.open(binding, 0);
    expect(view.values).toEqual(['18446744073709551615', '0.12345678901234567890', '{"a":1,"a":2}', null, '', { type: 'binary', base64: 'AP8=' }, { type: 'binary', base64: '' }]);
    expect(binding.metadata.map(column => column.key)).toEqual(source.columns.map(column => column.key));
    expect(queryRowDetailValue(view.values[3]).kind).toBe('null');
    expect(queryRowDetailValue(view.values[4]).kind).toBe('empty');
    expect(queryRowDetailValue(view.values[6])).toEqual({ kind: 'binary', text: '', units: 0, clipped: false });
    expect(Object.isFrozen(binding.metadata)).toBe(true); expect(Object.isFrozen(binding.metadata[0])).toBe(true);
    expect(Object.isFrozen(binding.rowRefs)).toBe(true); expect(Object.isFrozen(binding.context)).toBe(true);
    expect(source).toEqual(before); expect(controller.valid(view)).toBe(true);
  });
  it('不会执行getter或继承同名属性；缺失、不支持值和重复key拒绝', () => {
    for (const kind of ['getter', 'inherited', 'undefined', 'binaryGetter'] as const) {
      const source = result(), getter = () => { throw Error('不能执行getter'); };
      if (kind === 'getter') Object.defineProperty(source.rows[0], '__proto__', { get: getter });
      if (kind === 'inherited') { delete source.rows[0].__proto__; Object.setPrototypeOf(source.rows[0], { __proto__: '继承值' }); }
      if (kind === 'undefined') Object.defineProperty(source.rows[0], '__proto__', { value: undefined });
      if (kind === 'binaryGetter') Object.defineProperty(source.rows[0].bytes, 'base64', { get: getter });
      const controller = new QueryRowDetails(), binding = controller.bind(source, []);
      expect(() => controller.open(binding, 0)).toThrow('结果行详情已失效');
    }
    const source = result(); source.columns[1].key = source.columns[0].key;
    expect(new QueryRowDetails().bind(source, [])).toBeUndefined();
  });
  it('长值预览256、展开65536且不拆代理对；JSON和HTML保持普通文本', () => {
    const raw = 'x'.repeat(limits.expanded + 1);
    expect(queryRowDetailValue(raw).text.length).toBe(limits.preview);
    expect(queryRowDetailValue(raw, true)).toEqual({ kind: 'text', text: raw.slice(0, limits.expanded), units: raw.length, clipped: true });
    expect(queryRowDetailPrefix('a😀b', 2)).toBe('a');
    expect(queryRowDetailValue('<img onerror="x">')).toMatchObject({ text: '<img onerror="x">', clipped: false });
    expect(queryRowDetailValue('{"n":9007199254740993}').text).toBe('{"n":9007199254740993}');
    expect(queryRowDetailValue(0).text).toBe('0'); expect(queryRowDetailValue(false).text).toBe('false');
  });
  it('只在已返回行内移动，重复行对象仍按原位置定位；空结果和超预算拒绝', () => {
    const source = result(); source.rows[1] = source.rows[0];
    const controller = new QueryRowDetails(), binding = controller.bind(source, [])!, first = controller.open(binding, 0), second = controller.move(first, 1);
    expect(second.index).toBe(1); expect(second.row).toBe(first.row);
    for (const index of [-1, 2, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => controller.open(binding, index)).toThrow();
    source.rows = []; const empty = controller.bind(source, []); expect(() => controller.open(empty, 0)).toThrow();
    source.rows = Array(limits.rows + 1).fill({}); expect(controller.bind(source, [])).toBeUndefined();
    source.rows = []; source.columns = Array.from({ length: limits.columns + 1 }, (_, i) => ({ key: String(i), name: '列', type: '' }));
    expect(controller.bind(source, [])).toBeUndefined();
  });
});

describe('单向失效与ABA', () => {
  it.each(['result', 'context', 'invalidate'] as const)('%s变化再恢复也不能复活旧视图或旧关闭动作', kind => {
    const source = result(), controller = new QueryRowDetails(), binding = controller.bind(source, ['q', 1])!, old = controller.open(binding, 0);
    if (kind === 'result') controller.bind(result(), ['q', 1]);
    if (kind === 'context') controller.bind(source, ['q', 2]);
    if (kind === 'invalidate') controller.invalidate();
    const next = controller.bind(source, ['q', 1])!, current = controller.open(next, 1);
    expect(next).not.toBe(binding); expect(controller.current(binding)).toBe(false); expect(controller.valid(old)).toBe(false);
    expect(() => controller.move(old, 1)).toThrow(); expect(controller.close(old)).toBe(false); expect(controller.valid(current)).toBe(true);
  });
  it.each(['rows', 'columns', 'rowOrder', 'columnOrder', 'metadata', 'truncated', 'value', 'bytes'] as const)('%s原地漂移一经观察即永久撤销', kind => {
    const source = result(), controller = new QueryRowDetails(), binding = controller.bind(source, [])!, view = controller.open(binding, 0);
    const rows = source.rows, columns = source.columns, name = columns[0].name, cell = rows[0].json;
    if (kind === 'rows') source.rows = [...rows];
    if (kind === 'columns') source.columns = [...columns];
    if (kind === 'rowOrder') rows.reverse();
    if (kind === 'columnOrder') columns.reverse();
    if (kind === 'metadata') columns[0].name = '已改';
    if (kind === 'truncated') source.truncated = false;
    if (kind === 'value') rows[0].json = '已改';
    if (kind === 'bytes') (rows[0].bytes as { base64: string }).base64 = 'AA==';
    expect(controller.valid(view)).toBe(false);
    source.rows = rows; source.columns = columns;
    if (kind === 'rowOrder') rows.reverse(); if (kind === 'columnOrder') columns.reverse();
    columns[0].name = name; source.truncated = true; rows[0].json = cell;
    if (kind === 'bytes') (rows[0].bytes as { base64: string }).base64 = 'AP8=';
    expect(controller.valid(view)).toBe(false); expect(controller.current(binding)).toBe(false);
    const fresh = controller.open(controller.bind(source, []), 0); expect(controller.valid(fresh)).toBe(true);
  });
  it('同绑定翻行、关闭重开后，旧回调不作用于较新视图', () => {
    const controller = new QueryRowDetails(), binding = controller.bind(result(), [])!, old = controller.open(binding, 0), current = controller.move(old, 1);
    expect(controller.close(old)).toBe(false); expect(() => controller.move(old, 0)).toThrow(); expect(controller.valid(current)).toBe(true);
    expect(controller.close(current)).toBe(true); const reopened = controller.open(binding, 1);
    expect(controller.close(current)).toBe(false); expect(controller.valid(reopened)).toBe(true);
  });
});
