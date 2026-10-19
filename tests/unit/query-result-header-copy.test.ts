import { describe, expect, it, vi } from 'vitest';
import type { DataRow, ResultColumn } from '../../src/shared/contracts';
import { encodeQueryResultWithHeaders, writeQueryResultWithHeaders } from '../../src/renderer/queryResultHeaderCopy';
import { decodeClipboard, encodeClipboard, maxClipboardCells, parseTabularText } from '../../src/renderer/gridClipboard';

const columns: ResultColumn[] = [
  { key: '__proto__', name: '同名', type: 'BIGINT' }, { key: 'decimal', name: '同名', type: 'DECIMAL' },
  { key: 'nil', name: '', type: 'TEXT' }, { key: 'empty', name: '含\tTab\r\n和"引号"', type: 'TEXT' },
  { key: 'date', name: '日期', type: 'DATE' }, { key: 'bytes', name: '二进制', type: 'BLOB' }, { key: 'hidden', name: '隐藏列', type: 'TEXT' },
];
const row = (): DataRow => JSON.parse('{"__proto__":"18446744073709551615","decimal":"0.12345678901234567890","nil":null,"empty":"","date":"2026-10-19 01:02:03.123456","bytes":{"type":"binary","base64":"AP8="},"hidden":"不可复制的隐藏值"}');

describe('可见结果含表头复制沿原编码与源身份', () => {
  it('只按可见顺序投影所选矩阵，重复/空/特殊列名及精确原值均保持', () => {
    const rows = [row(), row()], before = structuredClone(rows), visible = [columns[5], columns[1], columns[0], columns[2], columns[3], columns[4]];
    rows[1].decimal = '99999999999999999999.000000000000000001'; before[1].decimal = rows[1].decimal;
    const content = encodeQueryResultWithHeaders(visible, rows, new Set([1, 0]));
    const matrix = [visible.map(c => c.name), ...rows.map(r => visible.map(c => r[c.key]))];
    expect(content).toEqual(encodeClipboard(matrix)); expect(decodeClipboard(content.typed, content.text)).toEqual(matrix);
    expect(parseTabularText(content.text)[0]).toEqual(visible.map(c => c.name));
    expect(content.text).toContain('0x00ff'); expect(content.text).toContain('18446744073709551615'); expect(content.text).not.toContain('不可复制');
    expect(rows).toEqual(before); expect(visible[0]).toBe(columns[5]);
  });
  it('活动单元格只带对应真源列；活动整行使用全部可见列，重复行引用仍按实际位置', () => {
    const r = row(), rows = [r, r], visible = [columns[1], columns[0]];
    const content = encodeQueryResultWithHeaders(visible, rows, new Set(), { index: 1, row: r, column: columns[0] });
    expect(decodeClipboard(content.typed, content.text)).toEqual([['同名'], ['18446744073709551615']]);
    expect(JSON.parse(encodeQueryResultWithHeaders(visible, rows, new Set(), { index: 1, row: r }).typed).rows).toEqual([['同名', '同名'], [r.decimal, r.__proto__]]);
  });
  it('不借显示别名、继承字段、访问器、缺失值或过期行/列回退全结果', () => {
    const r = row(), getter = vi.fn(() => '不得读取'), accessor = Object.defineProperty({}, '__proto__', { get: getter });
    for (const action of [
      () => encodeQueryResultWithHeaders(columns, [r], new Set()),
      () => encodeQueryResultWithHeaders(columns, [r], new Set([-1])),
      () => encodeQueryResultWithHeaders(columns, [r], new Set([1])),
      () => encodeQueryResultWithHeaders(columns, [r], new Set(), { index: 0, row: row(), column: columns[0] }),
      () => encodeQueryResultWithHeaders(columns, [r], new Set(), { index: 0, row: r, column: { ...columns[0] } }),
      () => encodeQueryResultWithHeaders([columns[0], columns[0]], [r], new Set([0])),
      () => encodeQueryResultWithHeaders([columns[0]], [Object.create(r)], new Set([0])),
      () => encodeQueryResultWithHeaders([columns[0]], [accessor], new Set([0])),
      () => encodeQueryResultWithHeaders([columns[0]], [{}], new Set([0])),
    ]) expect(action).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it('表头计入原总预算，并在读取行之前拒绝过大的矩阵', () => {
    const read = vi.fn(() => { throw Error('预算先拒绝'); }), rows: DataRow[] = Array(maxClipboardCells).fill(Object.defineProperty({}, 'x', { get: read }));
    expect(() => encodeQueryResultWithHeaders([{ key: 'x', name: '值', type: 'TEXT' }], rows, new Set(rows.map((_, i) => i)))).toThrow('复制');
    expect(read).not.toHaveBeenCalled();
  });
});

describe('显式含列名按钮的同步剪贴板端口', () => {
  it.each(['ok', 'late', 'refused', 'no-event', 'throws'] as const)('%s始终解绑临时copy观察，不触碰其它复制入口', mode => {
    const values = new Map<string, string>(), listeners = new Set<EventListener>(); let allowed = true;
    const event = { preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), clipboardData: { setData: (key: string, value: string) => values.set(key, value) } };
    const target = { addEventListener: (_: string, listener: EventListener) => listeners.add(listener), removeEventListener: (_: string, listener: EventListener) => listeners.delete(listener), execCommand: vi.fn(() => {
      if (mode === 'throws') throw Error('拒绝系统端口'); if (mode === 'late') allowed = false;
      if (mode !== 'no-event' && mode !== 'refused') for (const listener of listeners) listener(event as unknown as Event);
      return mode !== 'refused';
    }) } as unknown as Document;
    const content = encodeClipboard([['列名'], [null]]), action = () => writeQueryResultWithHeaders(content, () => allowed, target);
    if (mode === 'ok') { expect(action).not.toThrow(); expect(values.get('text/plain')).toBe('列名\nNULL'); expect(values.get('application/x-dbark-cells')).toBe(content.typed); }
    else { expect(action).toThrow(); expect(values.size).toBe(0); }
    expect(listeners.size).toBe(0);
  });
});
