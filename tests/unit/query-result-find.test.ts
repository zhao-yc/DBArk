import { describe, expect, it, vi } from 'vitest';
import type { DataRow, ResultColumn } from '../../src/shared/contracts';
import { QueryResultFindScan, queryResultFindLimits as limits } from '../../src/renderer/queryResultFind';
const columns: ResultColumn[] = [{ key: 'a', name: '重复别名', type: 'TEXT' }, { key: 'b', name: '重复别名', type: 'TEXT' }];
/** 仅RAM批次完成；保护测试本身不会在失控实现上无限循环。 */
function finish(scan: QueryResultFindScan) { for (let n = 0; n < 1000 && scan.progress().phase === 'searching'; n++) scan.step(); return scan.progress(); }
function positions(scan: QueryResultFindScan) { return Array.from({ length: scan.progress().count }, (_, index) => scan.match(index)); }

describe('已返回结果的有界字面查找', () => {
  it('只读可见唯一键和原自有值；重复出现按单元格计数，不读隐藏列或原型', () => {
    const rows: DataRow[] = [JSON.parse('{"a":"same same","b":"same","__proto__":"same"}'), { a: 'other', b: 'same' }];
    Object.defineProperty(rows[0], 'hidden', { get() { throw Error('不得读隐藏列'); } });
    const before = JSON.stringify(rows), clone = vi.spyOn(globalThis, 'structuredClone');
    const scan = new QueryResultFindScan(rows, columns, 'same', true, () => true);
    expect(finish(scan)).toMatchObject({ phase: 'complete', count: 3, scannedCells: 4 });
    expect(positions(scan)).toEqual([{ row: 0, column: 0 }, { row: 0, column: 1 }, { row: 1, column: 1 }]);
    expect(JSON.stringify(rows)).toBe(before); expect(clone).not.toHaveBeenCalled(); clone.mockRestore();
    const proto = new QueryResultFindScan(rows, [{ key: '__proto__', name: '原键', type: 'TEXT' }], 'same', true, () => true);
    expect(finish(proto).count).toBe(1);
  });

  it('精确大整数/小数不数值化，NULL与空串保持显示语义，二进制只查预览', () => {
    const rows: DataRow[] = [{ a: '18446744073709551615', b: '0.12345678901234567890' }, { a: null, b: '' }, { a: { type: 'binary', base64: 'AP8=' }, b: { type: 'binary', base64: '' } }];
    for (const [query, expected] of [['18446744073709551615', 1], ['0.12345678901234567890', 1], ['NULL', 1], ['', 0], ['0x', 2], ['00ff', 1], ['AP8=', 0]] as const) {
      expect(finish(new QueryResultFindScan(rows, columns, query, true, () => true)).count).toBe(expected);
    }
    const bytes = { type: 'binary' as const, base64: btoa('a'.repeat(200) + 'z') };
    expect(finish(new QueryResultFindScan([{ a: bytes }], columns.slice(0, 1), '7a', true, () => true)).count).toBe(0);
  });

  it('大小写可切换；正则符号、多行和Unicode全部按字面匹配', () => {
    const rows = [{ a: 'AbC [x].*\n你好😀', b: 'abc' }];
    expect(finish(new QueryResultFindScan(rows, columns, 'ABC', false, () => true)).count).toBe(2);
    expect(finish(new QueryResultFindScan(rows, columns, 'AbC', true, () => true)).count).toBe(1);
    expect(finish(new QueryResultFindScan(rows, columns, '[x].*\n你好😀', false, () => true)).count).toBe(1);
    expect(finish(new QueryResultFindScan(rows, columns, '^.*$', false, () => true)).count).toBe(0);
  });

  it('长原文本超出预览仍可命中，跨8192字符边界不漏；单批不会扫描完大值', () => {
    const scan = new QueryResultFindScan([{ a: 'x'.repeat(100000) + 'tail' }], columns.slice(0, 1), 'tail', true, () => true);
    expect(scan.step()).toMatchObject({ phase: 'searching', count: 0, scannedCells: 0 });
    expect(finish(scan)).toMatchObject({ phase: 'complete', count: 1 });
    const boundary = new QueryResultFindScan([{ a: 'x'.repeat(limits.chunkUnits - 2) + 'BOUNDARY' }], columns.slice(0, 1), 'boundary', false, () => true);
    expect(finish(boundary).count).toBe(1);
    const many = new QueryResultFindScan(Array.from({ length: 300 }, () => ({ a: 'miss' })), columns.slice(0, 1), 'absent', true, () => true);
    expect(many.step()).toMatchObject({ phase: 'searching', scannedCells: limits.batchCells });
  });

  it('5000命中硬上限且不读取后续格；过长查询在扫描前拒绝', () => {
    let read = 0;
    const rows: DataRow[] = Array.from({ length: limits.hits + 1 }, () => Object.defineProperty({}, 'a', { get() { read++; return 'hit'; } }));
    const scan = new QueryResultFindScan(rows, columns.slice(0, 1), 'hit', true, () => true);
    expect(finish(scan)).toMatchObject({ phase: 'limited', count: limits.hits }); expect(read).toBe(limits.hits);
    expect(scan.match(limits.hits)).toBeUndefined();
    const invalid = new QueryResultFindScan(rows, columns, 'x'.repeat(limits.queryUnits + 1), false, () => true);
    expect(invalid.step()).toMatchObject({ phase: 'invalid', count: 0 }); expect(read).toBe(limits.hits);
  });

  it('归属或数组结构失效永久撤销；恢复或迟到step/match不能复活', () => {
    let valid = true; const rows = [{ a: 'hit' }];
    const scan = new QueryResultFindScan(rows, columns.slice(0, 1), 'hit', true, () => valid); finish(scan);
    valid = false; expect(scan.match(0)).toBeUndefined(); valid = true;
    expect(scan.step()).toMatchObject({ phase: 'stopped', count: 0 }); expect(scan.match(0)).toBeUndefined();
    const structural = new QueryResultFindScan(rows, columns.slice(0, 1), 'hit', true, () => true); rows.push({ a: 'new' }); expect(structural.current()).toBe(false); rows.pop(); expect(structural.current()).toBe(false);
  });
});


it('混合短长格的主片实际处理量不超过32768，余量不足时保留原offset到下一批', () => {
  const short = 'q'.repeat(limits.chunkUnits - 1), long = 'r'.repeat(90000), query = 'missing';
  let units = 0;
  const slice = String.prototype.slice;
  const spy = vi.spyOn(String.prototype, 'slice').mockImplementation(function (this: string, start = 0, end?: number) {
    if (String(this) === short) units += Math.min(short.length, end ?? short.length) - start;
    // 长格离尾部尚远，切片尾部重叠恰为查询长度；只计主片，不把重叠预算混进去。
    if (String(this) === long) units += (end ?? long.length) - start - query.length;
    return slice.call(this, start, end);
  });
  const scan = new QueryResultFindScan([{ a: short }, { a: long }], columns.slice(0, 1), query, true, () => true);
  try { expect(scan.step().phase).toBe('searching'); } finally { spy.mockRestore(); }
  expect(units).toBeLessThanOrEqual(limits.batchUnits); expect(units).toBe(32767);
  expect(finish(scan)).toMatchObject({ phase: 'complete', count: 0, scannedCells: 2 });
});
