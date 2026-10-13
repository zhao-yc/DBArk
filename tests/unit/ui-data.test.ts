import { describe, expect, it } from 'vitest';
import { collectChanges, type DraftRow } from '../../src/renderer/dataChanges';
import { cellPreview, cellText, identifier, parseCell } from '../../src/renderer/lib';

describe('数据表编辑正确性', () => {
  it('精确整数和金额不会在单元格编辑时转换成浮点数', () => {
    expect(parseCell('18446744073709551615', 'text')).toBe('18446744073709551615');
    expect(parseCell('999999999999999.123456789', 'text')).toBe('999999999999999.123456789');
    expect(parseCell('', 'text')).toBe('');
    expect(parseCell('', 'null')).toBeNull();
  });
  it('二进制往返保持零字节与高位字节，拒绝不完整字节', () => {
    const value = parseCell('00 FF 7f 80', 'binary');
    expect(cellText(value)).toBe('0x00ff7f80');
    expect(() => parseCell('123', 'binary')).toThrow('完整字节');
    expect(() => parseCell('00xz', 'binary')).toThrow();
  });
  it('JSON 校验不会改变原文本，错误 JSON 无法暂存', () => {
    const text = '{ "id": 18446744073709551615 }';
    expect(parseCell(text, 'json')).toBe(text);
    expect(() => parseCell('{bad}', 'json')).toThrow();
  });
  it('改变主键时保留原始行用于定位和并发检查', () => {
    const before = { id: '18446744073709551615', amount: '1.0000', content: null };
    const after = { ...before, id: '17', content: '' };
    const row: DraftRow = { id: 'row', data: after, original: before, inserted: false, deleted: false };
    expect(collectChanges([row])).toEqual([{ kind: 'update', before, values: { id: '17', content: '' } }]);
    expect(before.id).toBe('18446744073709551615');
  });
  it('取消新增不发请求，删除使用原始快照，回改原值不发更新', () => {
    const before = { id: '1', value: '原值' };
    expect(collectChanges([
      { id: '1', original: before, data: { ...before }, inserted: false, deleted: false },
      { id: '2', data: { id: '2' }, inserted: true, deleted: true },
      { id: '3', original: before, data: { ...before, value: '改后' }, inserted: false, deleted: true },
      { id: '4', data: {}, inserted: true, deleted: false }
    ])).toEqual([{ kind: 'delete', before }, { kind: 'insert', values: {} }]);
  });
  it('对象名称保留特殊符号并转义反引号', () => { expect(identifier('账`目')).toBe('`账``目`'); });
  it('网格限制大文本与二进制预览，原始数据保持完整', () => {
    const text = '甲'.repeat(10000); const binary = { type: 'binary' as const, base64: btoa('a'.repeat(10000)) };
    expect(cellPreview(text)).toHaveLength(241); expect(cellPreview(binary)).toHaveLength(241);
    expect(cellText(text)).toHaveLength(10000); expect(cellText(binary)).toHaveLength(20002);
  });
});
