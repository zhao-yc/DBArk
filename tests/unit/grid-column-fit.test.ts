import { expect, it, vi } from 'vitest';
import { fitGridColumnWidths } from '../../src/renderer/gridColumnFit';

it('宽度使用列头和有界预览，最多抽 64 行且跳过隐藏列', () => {
  const cell = vi.fn((row: number, key: string) => key === 'long' && row === 999 ? '字'.repeat(500) : '短');
  const measure = (value: string) => value.length * 8;
  const fitted = fitGridColumnWidths({
    columns: [{ key: '__proto__', name: 'id' }, { key: 'long', name: '内容' }, { key: 'hidden', name: '隐藏' }],
    rowCount: 1000, cell,
  }, new Set(['__proto__', 'long']), measure);
  expect([...fitted]).toEqual([['__proto__', 64], ['long', 640]]);
  expect(cell).toHaveBeenCalledTimes(128);
  expect(cell).toHaveBeenCalledWith(0, 'long');
  expect(cell).toHaveBeenCalledWith(999, 'long');
  expect(cell.mock.calls.some(([, key]) => key === 'hidden')).toBe(false);
});

it('无数据的结果仍按列名和类型计算宽度', () => {
  const cell = vi.fn(() => '');
  expect(fitGridColumnWidths({ columns: [{ key: 'x', name: 'x', type: 'LONG_TYPE' }], rowCount: 0, cell }, new Set(['x']), text => text.length * 8).get('x')).toBe(116);
  expect(cell).not.toHaveBeenCalled();
});
