import { describe, expect, it, vi } from 'vitest';
import type { SQLInputValue } from 'node:sqlite';
import { SqliteRawStatement, SqliteRawStatementError, type SqliteRawInvoke } from '../../src/engine/sqlite/rawStatement';
import { sqliteDriverLimits } from '../../src/engine/sqlite/protocol';

/** 只构造受控损坏回包及生命周期信号；SQL语义和真实绑定另由原生三编码探针验证。 */
function control(sql = 'SELECT 1', names: (string | null)[] = [], override: (op: number, value: SQLInputValue) => unknown = () => undefined) {
  const source = Buffer.from(sql); let received = 0;
  const invoke = vi.fn((op: number, value: SQLInputValue) => {
    const changed = override(op, value); if (changed !== undefined) return changed;
    if (op === 12) { received = 0; return 0; }
    if (op === 2 || op === 6 || op === 7) return 0;
    if (op === 13) return received += (value as Uint8Array).length;
    if (op === 14) return source.length;
    if (op === 11) return source.subarray(Number(value), Number(value) + 65536);
    if (op === 15) return 1;
    if (op === 5) return names.length;
    if (op === 8) return names[Number(value) - 1] === null ? null : Buffer.from(names[Number(value) - 1]!);
    if (op === 10) return 0;
    if (op === 1) return null;
    throw Error('测试未声明回包');
  });
  return { invoke, statement: () => SqliteRawStatement.prepare(invoke as SqliteRawInvoke, sql), mutations: () => invoke.mock.calls.filter(([op]) => [1, 6, 7].includes(op)) };
}

describe('SQLite原字节候选适配器的输入、能力及损坏回包保护', () => {
  it.each(['', 'SELECT \0', 'SELECT \uD800', ' '.repeat(sqliteDriverLimits.sqlBytes + 1)])('非法或超预算原SQL在取得能力前拒绝 %#', sql => {
    const invoke = vi.fn(); expect(() => SqliteRawStatement.prepare(invoke, sql)).toThrow(SqliteRawStatementError); expect(invoke).not.toHaveBeenCalled();
  });
  it('未取得SQL材料阶段的忙错误不能finalize另一个游标', () => {
    const busy = Error('原native游标忙'), invoke = vi.fn(() => { throw busy; });
    expect(() => SqliteRawStatement.prepare(invoke, 'SELECT 1')).toThrow(busy); expect(invoke.mock.calls).toHaveLength(1);
  });
  it('已取得能力后坏分段回执准确收尾一次，不step', () => {
    const fixture = control('SELECT 1', [], op => op === 13 ? 0 : undefined);
    expect(fixture.statement).toThrow(SqliteRawStatementError); expect(fixture.invoke.mock.calls.filter(([op]) => op === 2)).toHaveLength(1); expect(fixture.mutations()).toEqual([]);
  });
  it('准备错误和收尾错误同时保留，不覆盖原错误', () => {
    const primary = Error('原prepare失败'), cleanup = Error('原finalize失败');
    const invoke = vi.fn((op: number) => { if (op === 12) return 0; if (op === 2) throw cleanup; throw primary; });
    try { SqliteRawStatement.prepare(invoke, 'SELECT 1'); throw Error('应拒绝'); }
    catch (error) { expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors).toEqual([primary, cleanup]); }
  });
  it('真实替代字符的原生前缀若截到UTF8中间，严格拒绝而非生成新的替代字符', () => {
    const fixture = control('\uFFFD\uFFFD', [], (op, value) => op === 14 ? 2 : op === 11 ? Buffer.from([0xef, 0xbf]).subarray(Number(value)) : undefined);
    expect(fixture.statement).toThrow(SqliteRawStatementError); expect(fixture.invoke.mock.calls.filter(([op]) => op === 2)).toHaveLength(1);
  });
  it('原生前缀或statement位不匹配时拒绝，不能借错误前缀重放脚本', () => {
    for (const override of [(op: number) => op === 11 ? Buffer.from('SELECT 2') : undefined, (op: number) => op === 15 ? 2 : undefined]) {
      const fixture = control('SELECT 1', [], override); expect(fixture.statement).toThrow(SqliteRawStatementError); expect(fixture.mutations()).toEqual([]);
    }
  });
  it('非法后项、稀疏数组、getter及未用非法具名值都不能留下前项绑定或step', () => {
    const getter = vi.fn(() => 1n), values = Object.defineProperty({}, ':x', { enumerable: true, get: getter });
    const sparse = new Array<SQLInputValue>(2); sparse[0] = 1n;
    for (const parameters of [[1n, NaN], sparse, { ':x': 1n, ':unused': NaN }, values]) {
      const fixture = control('SELECT ?', Array.isArray(parameters) ? [null, null] : [':x']), statement = fixture.statement();
      expect(() => statement.bind(parameters as SQLInputValue[] | Record<string, SQLInputValue>)).toThrow(SqliteRawStatementError); expect(fixture.mutations()).toEqual([]); statement.finish();
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it('位置值不能占用冒号具名槽，多值保留原生RANGE码且零绑定', () => {
    const fixture = control('SELECT :x', [':x']), statement = fixture.statement();
    expect(() => statement.bind([1n])).toThrowError(expect.objectContaining({ errcode: 25 })); expect(fixture.mutations()).toEqual([]); statement.finish();
  });
  it('列目录的坏UTF8或超预算列数在step前拒绝', () => {
    for (const override of [(op: number) => op === 10 ? 1025 : undefined, (op: number) => op === 10 ? 1 : op === 9 ? Buffer.from([0x80]) : undefined]) {
      const fixture = control('SELECT 1', [], override), statement = fixture.statement(); expect(() => statement.columns()).toThrow(SqliteRawStatementError); expect(fixture.mutations()).toEqual([]); statement.finish();
    }
  });
  it('已关闭旧对象不能读、绑定或收尾新的游标，即使旧finalize曾报失败', () => {
    let fail = true;
    const fixture = control('SELECT 1', [], op => { if (op === 2 && fail) { fail = false; throw Error('原finalize失败'); } return undefined; });
    const old = fixture.statement(); expect(() => old.finish()).toThrow('原finalize失败');
    const next = fixture.statement(), before = fixture.invoke.mock.calls.length;
    expect(() => old.next()).toThrow(SqliteRawStatementError); expect(() => old.bind([])).toThrow(SqliteRawStatementError); old.finish(); expect(fixture.invoke.mock.calls.length).toBe(before); next.finish();
  });
  it('原生DONE或坏TEXT后不再step，不能重放或跳过失败行伪造成功', () => {
    const good = control(), ended = good.statement(); expect(ended.next()).toBeNull(); expect(ended.next()).toBeNull(); expect(good.mutations()).toHaveLength(1); ended.finish();
    const bad = control('SELECT 1', [], op => op === 1 ? 1 : op === 3 ? 259 : op === 4 ? Buffer.from([0x80]) : undefined), statement = bad.statement();
    let original: unknown;
    try { statement.next(); } catch (error) { original = error; }
    expect(original).toMatchObject({ code: 'SQLITE_TEXT_ENCODING_UNREPRESENTABLE' });
    expect(() => statement.next()).toThrow(original as Error); expect(bad.mutations()).toHaveLength(1); statement.finish();
  });
});
