import { describe, expect, it, vi } from 'vitest';
import { historyDurationInputRange } from '../../src/renderer/historyDurationInput';
import { historyPagesZh as text } from '../../src/renderer/locales/historyPages.zh-CN';

describe('历史耗时草稿仅转换明确的非负安全整数毫秒', () => {
  it.each([['', ''], [' ', '\t\n'], ['\u00a0', ' ']])('双空白端点%s/%s省略整个范围，不生成空对象', (minimum, maximum) => { expect(historyDurationInputRange(minimum, maximum)).toBeUndefined(); });
  it.each([
    ['0', '', { minMs: 0 }], ['', '0', { maxMs: 0 }], ['0', '0', { minMs: 0, maxMs: 0 }],
    ['5', '5', { minMs: 5, maxMs: 5 }], ['0', '15', { minMs: 0, maxMs: 15 }],
    ['9007199254740991', '', { minMs: Number.MAX_SAFE_INTEGER }], ['', '9007199254740991', { maxMs: Number.MAX_SAFE_INTEGER }],
    ['  0012\t', '\n32 ', { minMs: 12, maxMs: 32 }], [' ', '18', { maxMs: 18 }], ['000', '000', { minMs: 0, maxMs: 0 }],
  ])('端点%s/%s保留零、单端和双端包含语义', (minimum, maximum, expected) => { expect(historyDurationInputRange(minimum as string, maximum as string)).toEqual(expected); });
  it.each(['-1', '-0', '+1', '1.0', '0.1', '1e3', '1E3', '0x10', '0b10', '1_000', 'NaN', 'Infinity', '１２', '1 2', '1\n2', '9007199254740992', '9007199254740993', '1'.repeat(65)])('非法端点%s保持错误，不钳制、不取整、不忽略', value => {
    expect(() => historyDurationInputRange(value, '')).toThrow(text.durationInvalid); expect(() => historyDurationInputRange('', value)).toThrow(text.durationInvalid);
  });
  it('倒序不调换端点，恰相等允许，两个端点都完整校验', () => {
    expect(() => historyDurationInputRange('12', '11')).toThrow(text.durationOrder); expect(historyDurationInputRange('12', '12')).toEqual({ minMs: 12, maxMs: 12 }); expect(() => historyDurationInputRange('12', '-1')).toThrow(text.durationInvalid);
  });
  it('非字符串和空对象不能隐式变成空白或数字，也不调用用户转换器', () => {
    const toString = vi.fn(() => '1'); for (const value of [undefined, null, 0, false, {}, [], { toString }]) expect(() => historyDurationInputRange(value as unknown as string, '')).toThrow(text.durationInvalid); expect(toString).not.toHaveBeenCalled();
  });
});
