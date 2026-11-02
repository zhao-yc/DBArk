import { describe, expect, it, vi } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import { captureQueryResultComparison, currentQueryResultComparison, queryResultComparisonKeyReason, queryResultComparisonValues, QueryResultComparisonScan } from '../../src/renderer/queryResultComparison';
import { queryResultComparisonZh as text } from '../../src/renderer/locales/queryResultComparison.zh-CN';

const bytes = (base64: string): CellValue => ({ type: 'binary', base64 });
/** 所有逐格类型都由用例明确给出，不根据值猜测；列名故意重复，SQL不是比较输入。 */
function source(values: CellValue[][], codes: string[], keys = ['id', 'v', 'b']): QueryResult {
  return { columns: keys.map(key => ({ key, name: '同名', type: 'SQLITE' })), rows: values.map(row => Object.fromEntries(keys.map((key, index) => [key, row[index]]))), sqliteStorage: { version: 1, rows: codes }, elapsedMs: 0, truncated: true, statement: '不执行或读取SQL' };
}
/** 每批沿原512行门，扫描完成前绝不发布部分差异。 */
function compare(left: QueryResult, right: QueryResult, keys = ['id']) {
  const capture = captureQueryResultComparison(left, right, keys), scan = new QueryResultComparisonScan(capture);
  let previous = 0;
  for (;;) { const progress = scan.step(); expect(progress.processed - previous).toBeLessThanOrEqual(512); previous = progress.processed; if (progress.done) break; expect(scan.result()).toBeUndefined(); }
  return { capture, scan, result: scan.result()! };
}

describe('SQLite固定结果按原类型和原值对比', () => {
  it('准确大整数匹配出四类各一行，同显示值类型变化计入修改并保完整字节明细', () => {
    const left = source([['9223372036854775807', '2', bytes('AP8=')], ['-9223372036854775808', '2', bytes('/wA=')], ['9007199254740993', null, bytes('')]], ['iib', 'iib', 'inb']);
    const right = source([['-9223372036854775808', '2', bytes('/wA=')], ['9007199254740992', '', bytes('')], ['9223372036854775807', '2', bytes('AP8=')]], ['itb', 'itb', 'iib']);
    const before = structuredClone({ left, right }), f = compare(left, right);
    expect(f.result).toMatchObject({ equal: 1, changed: 1, added: 1, removed: 1, rows: [{ kind: 'equal', leftIndex: 0, rightIndex: 2 }, { kind: 'changed', leftIndex: 1, rightIndex: 0, changedColumns: ['v'] }, { kind: 'removed', leftIndex: 2 }, { kind: 'added', rightIndex: 1 }] });
    const detail = queryResultComparisonValues(f.capture, f.result.rows[1]);
    expect(detail[1]).toEqual({ column: 'v', name: '同名', left: '2', right: '2', leftType: 'i', rightType: 't', changed: true });
    expect(detail[2]).toEqual({ column: 'b', name: '同名', left: bytes('/wA='), right: bytes('/wA='), leftType: 'b', rightType: 'b', changed: false });
    expect(Object.isFrozen(detail[2].left)).toBe(true); expect({ left, right }).toEqual(before); expect(Object.isFrozen(left.rows[0])).toBe(false);
  });
  it('全部四种非NULL键可选，INTEGER／REAL／TEXT同原文、BLOB及正负零各自匹配', () => {
    const left = source([['2'], ['2'], ['2'], [bytes('Mg==')], ['-0'], ['0']], ['i', 'r', 't', 'b', 'r', 'r'], ['id']);
    const right = source([[bytes('Mg==')], ['0'], ['2'], ['2'], ['-0'], ['2']], ['b', 'r', 't', 'i', 'r', 'r'], ['id']);
    expect(queryResultComparisonKeyReason(left.columns[0])).toBeUndefined();
    expect(compare(left, right).result).toMatchObject({ equal: 6, changed: 0, added: 0, removed: 0, rows: [{ rightIndex: 3 }, { rightIndex: 5 }, { rightIndex: 2 }, { rightIndex: 0 }, { rightIndex: 4 }, { rightIndex: 1 }] });
  });
  it('键的原类型变化是移除与新增，缺少整行不伪造NULL或类型', () => {
    const left = source([['2', null, bytes('')]], ['inb']), right = source([['2', null, bytes('')]], ['tnb']), f = compare(left, right);
    expect(f.result).toMatchObject({ removed: 1, added: 1, changed: 0, equal: 0 });
    expect(queryResultComparisonValues(f.capture, f.result.rows[0])[0]).toEqual({ column: 'id', name: '同名', left: '2', leftType: 'i', changed: false });
    expect(queryResultComparisonValues(f.capture, f.result.rows[1])[0]).toEqual({ column: 'id', name: '同名', right: '2', rightType: 't', changed: false });
  });
  it('非键列的INTEGER／REAL、NULL／空串及字节原值变化均精确识别', () => {
    const left = source([['1', '2', bytes('AP8=')], ['2', null, bytes('')], ['3', '-0', bytes('AA==')]], ['iib', 'inb', 'irb']);
    const right = source([['1', '2', bytes('AP8=')], ['2', '', bytes('')], ['3', '0', bytes('AQ==')]], ['irb', 'itb', 'irb']);
    expect(compare(left, right).result).toMatchObject({ changed: 3, rows: [{ changedColumns: ['v'] }, { changedColumns: ['v'] }, { changedColumns: ['v', 'b'] }] });
  });
  it('复合文本键的分隔符、JSON、NUL、尾空白与大小写不互相碰撞', () => {
    const values = [['a,b', 'c', null], ['a', 'b,c', null], ['["i","2"]', '\0', null], ['A', '', null], ['a', ' ', null]];
    const left = source(values, values.map(() => 'ttn')), right = source([...values].reverse(), values.map(() => 'ttn'));
    expect(compare(left, right, ['id', 'v']).result).toMatchObject({ equal: 5, added: 0, removed: 0 });
  });
  it.each(['left', 'right'] as const)('%s的准确同类型重复键整份拒绝，不发布部分行或四计数', side => {
    const duplicate = source([['2'], ['2']], ['r', 'r'], ['id']), other = source([['2']], ['r'], ['id']);
    const capture = captureQueryResultComparison(side === 'left' ? duplicate : other, side === 'right' ? duplicate : other, ['id']), scan = new QueryResultComparisonScan(capture);
    expect(() => scan.step()).toThrow(text.keyDuplicate(side)); expect(scan.result()).toBeUndefined(); expect(scan.step().done).toBe(true);
  });
  it.each(['left', 'right'] as const)('%s的NULL键拒绝，不把空文本或空BLOB当作NULL', side => {
    const nullKey = source([[null]], ['n'], ['id']), other = source([['']], ['t'], ['id']);
    const capture = captureQueryResultComparison(side === 'left' ? nullKey : other, side === 'right' ? nullKey : other, ['id']), scan = new QueryResultComparisonScan(capture);
    expect(() => scan.step()).toThrow(text.keyNull(side)); expect(scan.result()).toBeUndefined();
    expect(compare(source([[bytes('')]], ['b'], ['id']), source([[bytes('')]], ['b'], ['id'])).result.equal).toBe(1);
  });
  it('REAL无限值保留准确返回表示，不经过JSON的非有限number转NULL路径', () => {
    const left = source([['Infinity'], ['-Infinity'], ['5e-324']], ['r', 'r', 'r'], ['id']);
    const right = source([['5e-324'], ['Infinity'], ['-Infinity']], ['r', 'r', 'r'], ['id']);
    expect(compare(left, right).result).toMatchObject({ equal: 3, added: 0, removed: 0 });
  });
  it.each(['missing', 'version', 'code', 'value', 'binary', 'extra', 'sparse'] as const)('%s类型帧不猜测或部分接纳', mode => {
    const left = source([['1', '2', bytes('AP8=')]], ['iib']), right = structuredClone(left);
    if (mode === 'missing') delete left.sqliteStorage;
    if (mode === 'version') (left.sqliteStorage as any).version = 2;
    if (mode === 'code') left.sqliteStorage!.rows[0] = 'i?b';
    if (mode === 'value') left.sqliteStorage!.rows[0] = 'bib';
    if (mode === 'binary') (left.rows[0].b as any).base64 = 'AP9=';
    if (mode === 'extra') (left.sqliteStorage as any).other = true;
    if (mode === 'sparse') delete left.sqliteStorage!.rows[0];
    expect(() => captureQueryResultComparison(left, right, ['id'])).toThrow();
  });
  it('类型帧访问器零调用，SQL和耗时访问器也不是比较输入', () => {
    const left = source([['1', '2', bytes('')]], ['iib']), right = structuredClone(left), getter = vi.fn(() => { throw Error('不应读取'); });
    Object.defineProperty(left, 'statement', { get: getter }); Object.defineProperty(left, 'elapsedMs', { get: getter });
    expect(compare(left, right).result.equal).toBe(1); expect(getter).not.toHaveBeenCalled();
    Object.defineProperty(left, 'sqliteStorage', { get: getter }); expect(() => captureQueryResultComparison(left, right, ['id'])).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it.each(['code', 'codes-array', 'storage', 'value'] as const)('%s漂移后已发布结果及明细永久撤销，恢复旧对象也不复活', mode => {
    const left = source([['1', '2', bytes('')]], ['iib']), right = structuredClone(left), f = compare(left, right), row = f.result.rows[0];
    const storage = left.sqliteStorage!, codes = storage.rows;
    if (mode === 'code') storage.rows[0] = 'itb'; else if (mode === 'codes-array') storage.rows = [...codes]; else if (mode === 'storage') left.sqliteStorage = structuredClone(storage); else left.rows[0].v = '3';
    expect(f.scan.result()).toBeUndefined(); expect(() => queryResultComparisonValues(f.capture, row)).toThrow(text.stale);
    left.sqliteStorage = storage; storage.rows = codes; codes[0] = 'iib'; left.rows[0].v = '2';
    expect(currentQueryResultComparison(f.capture, left, right)).toBe(false); expect(f.scan.result()).toBeUndefined();
  });
  it('多批次中已处理原值不变但类型变更，在最终发布前整份拒绝', () => {
    const values = Array.from({ length: 1025 }, (_, index) => [String(index), '2', null]);
    const left = source(values, values.map(() => 'iin')), right = structuredClone(left), capture = captureQueryResultComparison(left, right, ['id']), scan = new QueryResultComparisonScan(capture);
    expect(scan.step().processed).toBe(512); left.sqliteStorage!.rows[0] = 'itn';
    expect(() => { while (!scan.step().done) {} }).toThrow(text.stale); expect(scan.result()).toBeUndefined();
  });
  it('取消撤销已发明细行，伪造明细及混合驱动元数据均不接纳', () => {
    const left = source([['1', null, bytes('')]], ['inb']), right = structuredClone(left), f = compare(left, right);
    expect(() => queryResultComparisonValues(f.capture, { ...f.result.rows[0] })).toThrow(text.stale); f.scan.cancel(); expect(() => queryResultComparisonValues(f.capture, f.result.rows[0])).toThrow(text.stale);
    left.columns[1].type = 'TEXT'; right.columns[1].type = 'TEXT'; expect(() => captureQueryResultComparison(left, right, ['id'])).toThrow(text.identity);
  });
});
