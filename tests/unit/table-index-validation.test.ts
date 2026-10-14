import { describe, expect, it } from 'vitest';
import { tableIndexPatchLimits, validateIndexPatches } from '../../src/shared/tableIndexPatches';

const added = () => ({ op: 'add', clientKey: 'new', definition: { kind: 'ordinary', name: '__proto__', method: 'BTREE', keyParts: [{ columnRef: 'c1', direction: 'asc' }], comment: '' } });
describe('索引补丁不可信输入边界', () => {
  it('合法原型敏感名称与 Unicode 是值，严格保留', () => {
    const value = added(); value.definition.comment = "中文😀'\\\n";
    expect(validateIndexPatches([value])).toEqual([value]);
  });
  it('拒绝 getter/toJSON，不能在预算检查前调用用户代码', () => {
    let called = 0;
    const getter = Object.defineProperty(added(), 'extra', { enumerable: true, get() { called++; return 'x'; } });
    const json = { ...added(), toJSON() { called++; return added(); } };
    expect(() => validateIndexPatches([getter])).toThrow(); expect(() => validateIndexPatches([json])).toThrow(); expect(called).toBe(0);
  });
  it('先有界处理巨大值、Unicode JSON 转义的精确 512 KiB 边界', () => {
    const value = added(); value.definition.comment = '\u0001汉😀';
    const base = new TextEncoder().encode(JSON.stringify([value])).length;
    value.definition.comment += 'a'.repeat(tableIndexPatchLimits.patchBytes - base);
    expect(validateIndexPatches([value])).toHaveLength(1);
    value.definition.comment += 'a'; expect(() => validateIndexPatches([value])).toThrow('512 KiB');
    expect(() => validateIndexPatches([{ ...added(), extra: 'a'.repeat(2 * 1024 * 1024) }])).toThrow('512 KiB');
  });
  it('拒绝循环、稀疏数组、额外字段、符号和显式 undefined', () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    const symbol = { ...added(), [Symbol('隐藏')]: true };
    for (const value of [cycle, Array(1), [symbol], [{ ...added(), extra: 1 }], [{ op: 'alter', indexRef: 'i', changes: { comment: undefined } }], [new Date()], new Map()]) expect(() => validateIndexPatches(value)).toThrow();
  });
  it('拒绝非法 Unicode、空变更、重复引用、重复列和保留名', () => {
    const bad = added(); bad.definition.comment = '\ud800';
    expect(() => validateIndexPatches([bad])).toThrow('Unicode');
    expect(() => validateIndexPatches([{ op: 'alter', indexRef: 'i', changes: {} }])).toThrow('不能为空');
    expect(() => validateIndexPatches([{ op: 'drop', indexRef: 'i' }, { op: 'alter', indexRef: 'i', changes: { comment: 'x' } }])).toThrow('重复');
    const duplicate = added(); duplicate.definition.keyParts.push({ ...duplicate.definition.keyParts[0] }); expect(() => validateIndexPatches([duplicate])).toThrow('重复');
    const reserved = added(); reserved.definition.name = 'primary'; expect(() => validateIndexPatches([reserved])).toThrow('保留名');
    reserved.definition.name = 'gen_clust_index'; expect(() => validateIndexPatches([reserved])).toThrow('保留名');
  });
  it('仅受控 BTREE 和最多 100 补丁/32 key part', () => {
    const method = added(); method.definition.method = 'HASH'; expect(() => validateIndexPatches([method])).toThrow();
    expect(() => validateIndexPatches(Array.from({ length: 101 }, (_, i) => ({ op: 'drop', indexRef: String(i) })))).toThrow();
    const parts = added(); parts.definition.keyParts = Array.from({ length: 33 }, (_, i) => ({ columnRef: String(i), direction: 'asc' })); expect(() => validateIndexPatches([parts])).toThrow();
  });
});
