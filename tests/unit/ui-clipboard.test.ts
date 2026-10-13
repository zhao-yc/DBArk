import { describe, expect, it } from 'vitest';
import { decodeClipboard, encodeClipboard, parseTabularText, pasteCells } from '../../src/renderer/gridClipboard';
import type { DraftRow } from '../../src/renderer/dataChanges';

describe('网格剪贴板', () => {
  it('识别电子表格中的带引号换行、制表符和引号，不产生末尾空行', () => {
    expect(parseTabularText('名称\t内容\r\n甲\t"第一行\n第二行\t""引号"""\r\n')).toEqual([['名称', '内容'], ['甲', '第一行\n第二行\t"引号"']]);
    expect(parseTabularText('')).toEqual([['']]);
    expect(() => parseTabularText('"未闭合')).toThrow('未闭合');
  });
  it('内部复制保留空字符串、NULL、二进制、大整数和精确小数', () => {
    const values = [['', null, { type: 'binary' as const, base64: 'AP8=' }, '18446744073709551615', '0.12345678901234567890']];
    const encoded = encodeClipboard(values);
    expect(decodeClipboard(encoded.typed, encoded.text)).toEqual(values);
    expect(decodeClipboard('', 'NULL\t18446744073709551615')).toEqual([['NULL', '18446744073709551615']]);
  });
  it('拒绝损坏或伪造的类型化剪贴板', () => {
    expect(() => decodeClipboard('{', '')).toThrow();
    expect(() => decodeClipboard('{"version":1,"rows":[[{"type":"binary","base64":"not-base64"}]]}', '')).toThrow();
    expect(() => decodeClipboard('{"version":1,"rows":[[{"sql":"DROP TABLE x"}]]}', '')).toThrow();
  });
  const rows: DraftRow[] = [
    { id: 'r1', original: { id: '1', text: '原文' }, data: { id: '1', text: '原文' }, inserted: false, deleted: false },
    { id: 'r2', data: {}, inserted: true, deleted: false }
  ];
  it('矩阵粘贴只更新草稿，保留原始记录和原数组', () => {
    const updated = pasteCells(rows, ['id', 'text'], 'r1', 'id', [['3', '甲'], ['4', '乙']], new Set());
    expect(updated.map(row => row.data)).toEqual([{ id: '3', text: '甲' }, { id: '4', text: '乙' }]);
    expect(updated[0].original).toEqual({ id: '1', text: '原文' });
    expect(rows[0].data.text).toBe('原文');
  });
  it('越界、生成列或待删除记录使整个粘贴失败', () => {
    expect(() => pasteCells(rows, ['id', 'text'], 'r1', 'text', [['越界', '列']], new Set())).toThrow('超出');
    expect(() => pasteCells(rows, ['id', 'text'], 'r2', 'id', [['1'], ['2']], new Set())).toThrow('超出');
    expect(() => pasteCells(rows, ['id', 'text'], 'r1', 'id', [['1', '2']], new Set(['text']))).toThrow('生成列');
    expect(() => pasteCells([{ ...rows[0], deleted: true }], ['id'], 'r1', 'id', [['1']], new Set())).toThrow('待删除');
    expect(rows[0].data.text).toBe('原文');
  });
});
