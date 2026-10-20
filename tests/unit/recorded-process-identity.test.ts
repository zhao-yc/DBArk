import { describe, expect, it, vi } from 'vitest';
import { compareRecordedProcessIdentity as compare, parseRecordedProcessTime as parse } from '../../scripts/testing/recordedProcessIdentity';

describe('封存进程身份的离线时间证据', () => {
  it('真实PID复用反例按旧缺席和新CIM创建时间证明，不改原纯PID失败', () => {
    const original = Object.freeze({ pid: 17780, lastAbsentAt: '2026-10-20T21:14:11.1536686Z' });
    const observed = Object.freeze({ pid: 17780, createdAt: '/Date(1792533601630)/' });
    const result = compare(original, observed, '2026-10-20T22:01:24.819Z');
    expect(result.kind).toBe('reused');expect(result.reason).toBe('created-after-recorded-absence');
    expect(result.observedCreation?.earliestNs).toBe('1792533601630000000');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);expect(result).not.toHaveProperty('passed');
    expect(original.lastAbsentAt).toBe('2026-10-20T21:14:11.1536686Z');
  });
  it('不同时区和CIM格式表示同一毫秒时不能因为字符串不同断言复用', () => {
    const iso = '2026-10-21T06:00:01.630+08:00', cim = '/Date(1792533601630)/';
    expect(parse(iso)).toEqual(parse(cim));
    expect(compare({ pid: 9, createdAt: iso }, { pid: 9, createdAt: cim }, '2026-10-20T22:01:24.819Z').kind).toBe('possibly-original');
  });
  it('100ns创建时间落在CIM毫秒区间内时保持可能是原身份', () => {
    expect(compare({ pid: 9, createdAt: '2026-10-20T22:00:01.6301234Z' }, { pid: 9, createdAt: '/Date(1792533601630)/' }, '2026-10-20T22:01:24.819Z').kind).toBe('possibly-original');
    expect(parse('2026-10-20T22:00:01.6301234Z')).toEqual({ earliestNs: '1792533601630123400', latestNs: '1792533601630123499', precisionNs: 100 });
  });
  it('明确不同的创建区间可证明不同身份，等精度区间重叠仍不能放行', () => {
    expect(compare({ pid: 9, createdAt: '2026-10-20T22:00:00.9999999Z' }, { pid: 9, createdAt: '2026-10-20T22:00:01.0000000Z' }, '2026-10-20T22:01:00Z').kind).toBe('reused');
    expect(compare({ pid: 9, createdAt: '2026-10-20T22:00:01Z' }, { pid: 9, createdAt: '2026-10-20T22:00:01.6301234Z' }, '2026-10-20T22:01:00Z').kind).toBe('possibly-original');
  });
  it.each([
    ['缺少旧代次证据', { pid: 9 }, { pid: 9, createdAt: '2026-10-20T22:00:01Z' }, '2026-10-20T22:01:00Z'],
    ['无效旧时间', { pid: 9, createdAt: '错误' }, { pid: 9, createdAt: '2026-10-20T22:00:01Z' }, '2026-10-20T22:01:00Z'],
    ['未来创建', { pid: 9 }, { pid: 9, createdAt: '2026-10-20T22:02:00Z' }, '2026-10-20T22:01:00Z'],
    ['同刻观察精度重叠', { pid: 9, createdAt: '2026-10-20T22:00:00Z' }, { pid: 9, createdAt: '2026-10-20T22:01:00.000Z' }, '2026-10-20T22:01:00.000Z'],
    ['未来缺席', { pid: 9, lastAbsentAt: '2026-10-20T22:02:00Z' }, { pid: 9, createdAt: '2026-10-20T22:00:01Z' }, '2026-10-20T22:01:00Z'],
    ['原创建晚于缺席', { pid: 9, createdAt: '2026-10-20T22:00:02Z', lastAbsentAt: '2026-10-20T22:00:00Z' }, { pid: 9, createdAt: '2026-10-20T22:00:03Z' }, '2026-10-20T22:01:00Z'],
    ['新创建未晚于旧缺席', { pid: 9, lastAbsentAt: '2026-10-20T22:00:01.6301234Z' }, { pid: 9, createdAt: '/Date(1792533601630)/' }, '2026-10-20T22:01:00Z'],
  ])('%s不能算补证通过', (_label, original, observed, snapshot) => {
    expect(compare(original, observed, snapshot).kind).toBe('indeterminate');
  });
  it('其它PID只标记不相关，不能据此判断原进程或直接子进程缺席', () => {
    expect(compare({ pid: 9 }, { pid: 10 }, undefined)).toEqual({ kind: 'unrelated', reason: 'different-pid' });
  });
  it.each([0, -1, 1.5, 0x100000000, '9', null])('无效PID %s保守拒绝', pid => {
    expect(compare({ pid }, { pid }, '2026-10-20T22:01:00Z').kind).toBe('indeterminate');
  });
  it('记录字段访问器不执行；时间对象也不调用其转换方法', () => {
    const getter = vi.fn(() => 9), conversion = vi.fn(() => '/Date(0)/');
    expect(compare(Object.defineProperty({}, 'pid', { get: getter }), { pid: 9 }, 1000).kind).toBe('indeterminate');
    expect(parse({ toString: conversion })).toBeUndefined();expect(getter).not.toHaveBeenCalled();expect(conversion).not.toHaveBeenCalled();
  });
  it.each(['2026-02-31T00:00:00Z', '2023-02-29T00:00:00Z', '2026-10-20T24:00:00Z', '2026-10-20T22:00:00', '2026-10-20T22:00:60Z', '2026-10-20T22:00:00+14:01', '/Date(9007199254740993)/', ' '.repeat(65), Number.NaN, 1.5])('非法时间 %s不自动滚动或丢失精度', value => {
    expect(parse(value)).toBeUndefined();
  });
  it('闰日、负纪元及纳秒保留精度，返回值可序列化', () => {
    expect(parse('2024-02-29T00:00:00Z')).toBeDefined();
    expect(parse('/Date(-1)/')).toEqual({ earliestNs: '-1000000', latestNs: '-1', precisionNs: 1000000 });
    expect(parse('1970-01-01T00:00:00.000000001Z')).toEqual({ earliestNs: '1', latestNs: '1', precisionNs: 1 });
  });
});
