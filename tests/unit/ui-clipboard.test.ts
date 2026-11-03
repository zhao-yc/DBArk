import { describe, expect, it, vi } from 'vitest';
import { decodeClipboard, encodeClipboard, maxClipboardCharacters, parseTabularText, pasteCells } from '../../src/renderer/gridClipboard';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { DraftRow } from '../../src/renderer/dataChanges';

describe('网格剪贴板', () => {
  it('普通文本的表头按 TSV 转义，内部类型化内容只包含数据行', () => {
    const values = [['18446744073709551615', null, undefined]];
    const content = encodeClipboard(values, ['id', '名称\t字段', '默认']);
    expect(parseTabularText(content.text)[0]).toEqual(['id', '名称\t字段', '默认']);
    expect(decodeClipboard(content.typed, content.text)).toEqual(values);
  });
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
  it('转义后的类型化数据恰好到上限时保留原编码，多一字符即拒绝', () => {
    const suffix = '\0\t\r\n\\\"\b\f\u001f\uD800😀\uDC00';
    const overhead = JSON.stringify({ version: 1, rows: [[suffix], ['']] }).length;
    const value = 'x'.repeat(maxClipboardCharacters - overhead);
    const content = encodeClipboard([[suffix], [value]]);
    expect(content.typed.length).toBe(maxClipboardCharacters);
    expect(content.typed.slice(0, 95)).toBe(JSON.stringify({ version: 1, rows: [[suffix], [value]] }).slice(0, 95));
    expect(() => encodeClipboard([[suffix], [value + 'x']])).toThrow(zh.clipboard.copySizeLimit);
  });
  it('大量控制字符、带引号的表头及超限 BLOB 在序列化与字节展开前拒绝', () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    const decode = vi.spyOn(globalThis, 'atob');
    const failures: unknown[] = [];
    const capture = (action: () => unknown) => {
      try { action(); } catch (error) { failures.push(error); }
    };
    let stringifyCalls: number, decodeCalls: number;
    try {
      capture(() => encodeClipboard([['\0'.repeat(2_000_000)]]));
      capture(() => encodeClipboard([], ['"'.repeat(maxClipboardCharacters / 2)]));
      capture(() => encodeClipboard([[{ type: 'binary', base64: 'AAAA'.repeat(1_666_667) }]]));
      stringifyCalls = stringify.mock.calls.length;
      decodeCalls = decode.mock.calls.length;
    } finally { stringify.mockRestore(); decode.mockRestore(); }
    expect(failures.map(error => (error as Error).message)).toEqual(Array(3).fill(zh.clipboard.copySizeLimit));
    expect(stringifyCalls).toBe(0);
    expect(decodeCalls).toBe(0);
  });
  it('可复制跨多个转换块的二进制，十六进制与内部原值保持一致', () => {
    const bytes = '\x00\xff'.repeat(8193), value = { type: 'binary' as const, base64: btoa(bytes) };
    const content = encodeClipboard([[value]]);
    expect(content.text).toBe('0x' + '00ff'.repeat(8193));
    expect(decodeClipboard(content.typed, content.text)).toEqual([[value]]);
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
