import { describe, expect, it } from 'vitest';
import { inspectStructurePatchInput } from '../../src/shared/structurePatchInput';

describe('结构补丁的共用输入边界', () => {
  it('转义、中文和补充字符的计量与真实 JSON UTF-8 字节一致，复制保持原型同名自有键', () => {
    const row = Object.create(null);
    row.__proto__ = '普通名称'; row.constructor = '构造器名称';
    row.value = '\u0000\u0001\b\f\n\r\t"\\汉😀';
    const input = [row, [null, true, false, -123.5, 1e30]];
    const result = inspectStructurePatchInput(input, '索引补丁');
    expect(result.bytes).toBe(Buffer.byteLength(JSON.stringify(input), 'utf8'));
    expect(JSON.stringify(result.value)).toBe(JSON.stringify(input));
    expect(Object.hasOwn((result.value as unknown[])[0]!, '__proto__')).toBe(true);
  });

  it('不会执行 getter、toJSON 或稀疏数组上的访问器', () => {
    let calls = 0;
    const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { calls++; return '秘密'; } });
    const toJSON = { toJSON() { calls++; return '秘密'; } };
    const accessor: unknown[] = []; Object.defineProperty(accessor, '0', { enumerable: true, get() { calls++; return '秘密'; } });
    for (const value of [[getter], [toJSON], [accessor]]) expect(() => inspectStructurePatchInput(value, '索引补丁')).toThrow();
    expect(calls).toBe(0);
  });

  it('拒绝稀疏、数组额外字段、符号和隐藏数据，而不是静默丢弃', () => {
    const extra = Object.assign([1], { other: 2 });
    const symbol = Object.assign([1], { [Symbol('额外')]: 2 });
    const hidden = Object.defineProperty({}, 'value', { value: 1 });
    for (const value of [Array(1), extra, symbol, [hidden]]) expect(() => inspectStructurePatchInput(value, '索引补丁')).toThrow();
  });

  it('拒绝循环、非普通原型、显式 undefined、非有限数及非法 Unicode', () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    for (const value of [cycle, [new Date()], [Object.create({ inherited: 1 })], [{ value: undefined }], [NaN], [Infinity], ['\ud800'], ['\udc00']]) expect(() => inspectStructurePatchInput(value, '索引补丁')).toThrow();
  });

  it('512KiB 按转义后字节判断，精确边界可传，超一字节拒绝', () => {
    const bytes = 512 * 1024;
    expect(inspectStructurePatchInput(['x'.repeat(bytes - 4)], '索引补丁').bytes).toBe(bytes);
    expect(() => inspectStructurePatchInput(['x'.repeat(bytes - 3)], '索引补丁')).toThrow('超过 512 KiB');
    const escaped = '\u0001'.repeat(Math.floor((bytes - 4) / 6));
    expect(inspectStructurePatchInput([escaped], '索引补丁').bytes).toBe(Buffer.byteLength(JSON.stringify([escaped])));
    expect(() => inspectStructurePatchInput([escaped + '\u0001'], '索引补丁')).toThrow('超过 512 KiB');
  });

  it('根补丁数量及深度独立限额，在小字节输入上也生效', () => {
    expect((inspectStructurePatchInput(Array.from({ length: 100 }, () => ({})), '索引补丁').value as unknown[])).toHaveLength(100);
    expect(() => inspectStructurePatchInput(Array.from({ length: 101 }, () => ({})), '索引补丁')).toThrow('数量');
    let deep: unknown = '值'; for (let index = 0; index < 10; index++) deep = [deep];
    expect(() => inspectStructurePatchInput(deep, '索引补丁')).toThrow('结构超出预算');
  });
});
