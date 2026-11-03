import { expect, it } from 'vitest';
import { gridRowIndex } from '../../src/renderer/components/GridRowJump';

it('行号只接受当前网格内的一基十进制整数', () => {
  expect(gridRowIndex('1', 200)).toBe(0);
  expect(gridRowIndex('200', 200)).toBe(199);
  for (const value of ['', '0', '-1', '1.5', '1e2', '01', '201', '9007199254740993']) {
    expect(gridRowIndex(value, 200)).toBeUndefined();
  }
  expect(gridRowIndex('1', 0)).toBeUndefined();
});
