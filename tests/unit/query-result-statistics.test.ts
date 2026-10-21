import { describe, expect, it, vi } from 'vitest';
import type { DataRow, ResultColumn } from '../../src/shared/contracts';
import { captureQueryResultStatistics, currentQueryResultStatistics, QueryResultStatisticsScan, type QueryResultStatisticsCapture } from '../../src/renderer/queryResultStatistics';
import { queryResultStatisticsZh as text } from '../../src/renderer/locales/queryResultStatistics.zh-CN';

/** 所有统计均运行真实捕获器和分批扫描器，不模拟成功结果或数据库。 */
function fixture(type: string, values: readonly unknown[], indices?: ReadonlySet<number>) {
  const columns: ResultColumn[] = [{ key: 'k', name: '同名', type }, { key: 'other', name: '同名', type: 'TEXT' }];
  const rows = values.map((k, index) => ({ k, other: String(index) })) as DataRow[];
  const capture = captureQueryResultStatistics(columns, rows, columns[0], indices);
  return { columns, rows, capture, scan: new QueryResultStatisticsScan(capture) };
}
/** 持续调用正式step至完成；任何未完成批次都不得读取部分结果。 */
function finish(scan: QueryResultStatisticsScan, initialProcessed = 0) {
  let previous = initialProcessed;
  for (;;) {
    const progress = scan.step();
    expect(progress.processed - previous).toBeLessThanOrEqual(512); expect(progress.processed).toBeGreaterThanOrEqual(previous);
    previous = progress.processed;
    if (progress.done) return scan.result()!;
    expect(scan.result()).toBeUndefined();
  }
}

describe('当前结果列的精确数值统计', () => {
  it.each(['LONGLONG', 'BIGINT', 'BIGINT UNSIGNED', 'NEWDECIMAL', 'DECIMAL(65,0)'])('%s不经过Number，保留20位整数合计与循环平均', type => {
    const f = fixture(type, ['18446744073709551615', '2', '9007199254740993', null]), before = structuredClone(f.rows), result = finish(f.scan);
    expect(result).toEqual({ count: 4, nonNull: 3, nulls: 1, distinct: 3, min: '2', max: '18446744073709551615', sum: '18455751272964292610', average: '6151917090988097536.666666666666666667', approximate: true, floatInput: false, averageRounded: true });
    expect(f.rows).toEqual(before); expect(Object.isFrozen(f.rows)).toBe(false); expect(Object.isFrozen(f.rows[0])).toBe(false); expect(Object.isFrozen(result)).toBe(true);
  });
  it('20位DECIMAL保留原尺度并half-away舍入，勾选范围独立且不丢低位', () => {
    const values = ['0.12345678901234567890', '2.00000000000000000000', '1.00000000000000000001'];
    expect(finish(fixture('DECIMAL(65,20)', values).scan)).toMatchObject({ sum: '3.12345678901234567891', average: '1.04115226300411522630', averageRounded: true, floatInput: false });
    const f = fixture('DECIMAL(65,20)', values, new Set([1, 0]));
    expect(f.capture).toEqual({ column: { key: 'k', name: '同名', type: 'DECIMAL(65,20)' }, rowCount: 2, selected: true });
    expect(finish(f.scan)).toMatchObject({ count: 2, sum: '2.12345678901234567890', average: '1.06172839450617283945', approximate: false, averageRounded: false });
  });
  it.each([['0.00000000000000000001', '0.000000000000000000005'], ['-0.00000000000000000001', '-0.000000000000000000005']])('有限平均%s精确扩展第21位，不当作舍入半值丢失', (value, average) => {
    expect(finish(fixture('DECIMAL(65,20)', [value, '0']).scan)).toMatchObject({ sum: value, average, averageRounded: false, approximate: false });
  });
  it.each([['2', '0.666666666666666667'], ['-2', '-0.666666666666666667']])('正负循环平均%s只在必要时舍入，方向远离零', (value, average) => {
    expect(finish(fixture('INT', [value, '0', '0']).scan)).toMatchObject({ average, averageRounded: true, approximate: true });
  });
  it('原尺度20的有限AVG扩展与循环AVG20位舍入分别标记', () => {
    expect(finish(fixture('DECIMAL(65,20)', ['0.12345678901234567890', '1.00000000000000000001']).scan)).toMatchObject({ sum: '1.12345678901234567891', average: '0.561728394506172839455', approximate: false, averageRounded: false });
    expect(finish(fixture('DECIMAL(65,20)', ['0.00000000000000000001', '0', '0']).scan)).toMatchObject({ average: '0.00000000000000000000', approximate: true, averageRounded: true });
  });
  it('数值不同值与排序键一致，前导零、尾零和正负零归一，原极值文本保留', () => {
    const f = fixture('DECIMAL', ['-0.00', '000', '+0', '01.00', '1', null]);
    expect(finish(f.scan)).toMatchObject({ distinct: 2, min: '-0.00', max: '01.00', sum: '2.00', average: '0.40', approximate: false });
  });
  it('精确类型仅接纳安全整数number，带小数必须为原字符串', () => {
    expect(finish(fixture('DECIMAL', [Number.MAX_SAFE_INTEGER, -1, 0]).scan)).toMatchObject({ sum: '9007199254740990', average: '3002399751580330', approximate: false });
    for (const value of [0.1, Number.MAX_SAFE_INTEGER + 1]) {
      const result = finish(fixture('DECIMAL', ['1', value, null]).scan);
      expect(result).toMatchObject({ count: 3, nonNull: 2, nulls: 1, reason: text.value });
      for (const key of ['distinct', 'min', 'max', 'sum', 'average'] as const) expect(result[key]).toBeUndefined();
    }
  });
  it('FLOAT按已返回number的十进制计算，明确原值近似且不叠加二进制求和误差', () => {
    expect(finish(fixture('DOUBLE', [0.1, 0.2, null]).scan)).toMatchObject({ sum: '0.3', average: '0.15', approximate: true, floatInput: true, averageRounded: false });
    expect(finish(fixture('FLOAT', [1e-7, 2e-7]).scan)).toMatchObject({ sum: '0.0000003', average: '0.00000015', floatInput: true });
    const result = finish(fixture('DOUBLE', [1e308, 1e308]).scan);
    expect(result.sum).toBe('2' + '0'.repeat(308)); expect(result.average).toBe('1' + '0'.repeat(308)); expect(result.approximate).toBe(true);
  });
  it.each([['INT', ['1', '1.0']], ['BIGINT UNSIGNED', ['0', '-1']], ['DOUBLE', [1, '2']], ['DOUBLE', [1, Infinity]], ['DOUBLE', [1, NaN]], ['TEXT', ['a', true]], ['INT', ['1', undefined]]])('坏原值%s只发布可靠计数，绝无前段合计或极值', (type, values) => {
    const result = finish(fixture(type as string, [...values, null]).scan);
    expect(result.count).toBe(3); expect(result.nonNull).toBe(2); expect(result.nulls).toBe(1); expect(result.reason).toBe(text.value);
    for (const key of ['distinct', 'min', 'max', 'sum', 'average'] as const) expect(result[key]).toBeUndefined();
  });
});

describe('文本、时间、NULL及未知类型的完整语义', () => {
  it('文本按代码单元比较，空串、NULL和大小写不同，绝不把文本数值求和', () => {
    const result = finish(fixture('TEXT', ['2', '10', '', null, 'A', 'a', 'A']).scan);
    expect(result).toMatchObject({ count: 7, nonNull: 6, nulls: 1, distinct: 5, min: '', max: 'a', approximate: false });
    expect(result.sum).toBeUndefined(); expect(result.average).toBeUndefined();
    expect(finish(fixture('JSON', ['{"n":9007199254740993}', '{"n":9007199254740992}']).scan).min).toBe('{"n":9007199254740992}');
  });
  it.each([
    ['TIME', ['100:00:00.000001', '-100:00:00', '-99:59:59.999999', '00:00:00', '-00:00:00'], '-100:00:00', '100:00:00.000001', 4],
    ['DATE', ['2026-10-22', '0000-00-00', '2026-10-21'], '0000-00-00', '2026-10-22', 3],
    ['DATETIME', ['2026-10-22 12:00:00.1', '2026-10-22T12:00:00.100000', '2026-10-22 12:00:00.000001'], '2026-10-22 12:00:00.000001', '2026-10-22 12:00:00.1', 2],
  ])('%s沿原时间比较与归一键，不创建Date或误求时间合计', (type, values, min, max, distinct) => {
    const result = finish(fixture(type as string, values as string[]).scan);
    expect(result).toMatchObject({ min, max, distinct }); expect(result.sum).toBeUndefined(); expect(result.average).toBeUndefined();
  });
  it.each([['TIME', '839:00:00'], ['DATE', '2026-13-01'], ['TIMESTAMP', '2026-10-22T12:00:00Z']])('%s拒绝原比较器不准入的时间值', (type, value) => {
    expect(finish(fixture(type, [value, null]).scan)).toMatchObject({ nonNull: 1, nulls: 1, reason: text.value });
  });
  it.each(['BLOB', 'TINY_BLOB', 'MEDIUM_BLOB', 'LONG_BLOB', 'BIT', 'GEOMETRY', '未知'])('%s只提供计数，字节不转字符串、不读取toString', type => {
    const value = { type: 'binary', base64: 'AAH/' }, result = finish(fixture(type, [value, null]).scan);
    expect(result).toEqual({ count: 2, nonNull: 1, nulls: 1, reason: text.unsupported, approximate: false, floatInput: false, averageRounded: false });
  });
  it.each(['INT', 'TEXT', 'BLOB', '未知'])('%s的全NULL范围不同值为零，其余值指标缺省', type => {
    expect(finish(fixture(type, [null, null]).scan)).toEqual({ count: 2, nonNull: 0, nulls: 2, distinct: 0, approximate: false, floatInput: false, averageRounded: false });
  });
  it('空结果允许全部范围，但显式空勾选Set不能回退成全部', () => {
    expect(finish(fixture('INT', []).scan)).toEqual({ count: 0, nonNull: 0, nulls: 0, distinct: 0, approximate: false, floatInput: false, averageRounded: false });
    expect(() => fixture('INT', ['1'], new Set())).toThrow(text.invalid);
    expect(() => fixture('INT', ['1'], new Set([1]))).toThrow(); expect(() => fixture('INT', ['1'], new Set([0.5]))).toThrow();
  });
});

describe('统计来源身份、访问器与单向失效', () => {
  it('公开捕获冻结自有元数据，原列、原行、选择Set均不冻结且同名列按key独立', () => {
    const indices = new Set([0]), f = fixture('INT', ['2', '3'], indices);
    expect(Object.isFrozen(f.capture)).toBe(true); expect(Object.isFrozen(f.capture.column)).toBe(true);
    expect(Object.isFrozen(f.columns[0])).toBe(false); expect(Object.isFrozen(indices)).toBe(false);
    expect(finish(f.scan)).toMatchObject({ count: 1, sum: '2' });
    const columns = [{ key: '__proto__', name: '同名', type: 'INT' }, { key: 'k', name: '同名', type: 'INT' }], rows = [{ ['__proto__']: '3', k: '7' }];
    expect(finish(new QueryResultStatisticsScan(captureQueryResultStatistics(columns, rows, columns[0])))).toMatchObject({ sum: '3' });
  });
  it.each(['cell', 'row-index', 'column-index', 'key', 'name', 'type', 'bytes'])('%s访问器零调用，捕获不执行任何源getter', kind => {
    const columns = [{ key: 'k', name: '列', type: 'INT' }], rows: DataRow[] = [{ k: '1' }], getter = vi.fn(() => '1');
    if (kind === 'cell') Object.defineProperty(rows[0], 'k', { get: getter });
    else if (kind === 'row-index') Object.defineProperty(rows, '0', { get: getter });
    else if (kind === 'column-index') Object.defineProperty(columns, '0', { get: getter });
    else if (kind === 'bytes') { const bytes = { type: 'binary' as const, base64: '' }; Object.defineProperty(bytes, 'base64', { get: getter }); rows[0].k = bytes; }
    else Object.defineProperty(columns[0], kind, { get: getter });
    expect(() => captureQueryResultStatistics(columns, rows, kind === 'column-index' ? {} as ResultColumn : columns[0])).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('Set自定义size与迭代器不执行，内置成员仍精确捕获', () => {
    const indices = new Set([1]), getter = vi.fn(() => { throw Error('不应执行'); });
    Object.defineProperty(indices, 'size', { get: getter }); Object.defineProperty(indices, Symbol.iterator, { value: getter });
    expect(finish(fixture('INT', ['1', '2'], indices).scan)).toMatchObject({ sum: '2' }); expect(getter).not.toHaveBeenCalled();
  });
  it('坏对象不能借toString转换为数值，后加原格getter也零调用并永久撤销', () => {
    const convert = vi.fn(() => '1'), invalid = { toString: convert };
    expect(finish(fixture('INT', [invalid, null]).scan)).toMatchObject({ nonNull: 1, nulls: 1, reason: text.value }); expect(convert).not.toHaveBeenCalled();
    const f = fixture('INT', ['1']), getter = vi.fn(() => '1'); Object.defineProperty(f.rows[0], 'k', { get: getter });
    expect(currentQueryResultStatistics(f.capture, f.columns, f.rows)).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it.each(['rows-array', 'columns-array', 'row', 'row-order', 'column', 'metadata', 'other-metadata', 'value', 'selection', 'bytes'])('%s漂移观测后永久失效，恢复原引用也不复活', kind => {
    const selected = new Set([0]), f = fixture(kind === 'bytes' ? 'BLOB' : 'INT', kind === 'bytes' ? [{ type: 'binary', base64: 'AA==' }, null] : ['1', '2'], selected);
    const row = f.rows[0], column = f.columns[0], value = row.k, saved = f.columns[1].type;
    let rows = f.rows, columns = f.columns;
    if (kind === 'rows-array') rows = [...rows]; else if (kind === 'columns-array') columns = [...columns]; else if (kind === 'row') f.rows[0] = { ...row }; else if (kind === 'row-order') f.rows.reverse(); else if (kind === 'column') f.columns[0] = { ...column }; else if (kind === 'metadata') column.name = '新列'; else if (kind === 'other-metadata') f.columns[1].type = 'INT'; else if (kind === 'value') row.k = '9'; else if (kind === 'selection') { selected.delete(0); selected.add(1); } else (row.k as { base64: string }).base64 = 'AQ==';
    expect(currentQueryResultStatistics(f.capture, columns, rows)).toBe(false);
    if (kind === 'row-order') f.rows.reverse(); f.rows[0] = row; f.columns[0] = column; column.name = '同名'; f.columns[1].type = saved; row.k = value; selected.clear(); selected.add(0); if (kind === 'bytes') (row.k as { base64: string }).base64 = 'AA==';
    expect(currentQueryResultStatistics(f.capture, f.columns, f.rows)).toBe(false); expect(() => f.scan.step()).toThrow(text.stale); expect(f.scan.result()).toBeUndefined();
  });
  it('未选中行引用变更也撤销捕获，未统计列getter则完全不读取', () => {
    const f = fixture('INT', ['1', '2'], new Set([0])), hidden = vi.fn(() => '不读');
    Object.defineProperty(f.rows[0], 'other', { get: hidden }); expect(currentQueryResultStatistics(f.capture, f.columns, f.rows)).toBe(true);
    f.rows[1] = { ...f.rows[1] }; expect(currentQueryResultStatistics(f.capture, f.columns, f.rows)).toBe(false); expect(hidden).not.toHaveBeenCalled();
  });
  it('扫描完但发布前发生原值漂移，result最后核源拒绝旧结果', () => {
    const f = fixture('INT', ['1', '2']); expect(f.scan.step().done).toBe(true); f.rows[0].k = '3'; expect(f.scan.result()).toBeUndefined();
    f.rows[0].k = '1'; expect(f.scan.result()).toBeUndefined();
  });
  it('伪造及克隆capture不能建立扫描，旧捕获不能借新结果数组续租', () => {
    const f = fixture('INT', ['1']);
    for (const fake of [{ ...f.capture }, Object.create(f.capture), {}] as QueryResultStatisticsCapture[]) {
      expect(currentQueryResultStatistics(fake, f.columns, f.rows)).toBe(false); expect(() => new QueryResultStatisticsScan(fake)).toThrow(text.stale);
    }
    expect(currentQueryResultStatistics(f.capture, f.columns, [...f.rows])).toBe(false);
  });
});

describe('完整扫描预算、分批与取消', () => {
  it('每步最多512行，结果只在完整扫描并核源后发布', () => {
    const f = fixture('INT', Array.from({ length: 1025 }, (_, index) => String(index)));
    expect(f.scan.result()).toBeUndefined(); expect(f.scan.step()).toEqual({ processed: 512, total: 1025, done: false }); expect(f.scan.result()).toBeUndefined();
    expect(f.scan.step()).toEqual({ processed: 1024, total: 1025, done: false }); expect(f.scan.result()).toBeUndefined();
    expect(f.scan.step()).toEqual({ processed: 1025, total: 1025, done: true }); expect(f.scan.result()).toMatchObject({ count: 1025, sum: '524800', average: '512' });
  });
  it('后半批坏值仍完成全部计数，不能保留前512行指标', () => {
    const f = fixture('INT', [...Array.from({ length: 512 }, () => '1'), '坏值', null]);
    expect(f.scan.step().done).toBe(false); expect(f.scan.result()).toBeUndefined();
    expect(finish(f.scan, 512)).toEqual({ count: 514, nonNull: 513, nulls: 1, reason: text.value, approximate: false, floatInput: false, averageRounded: false });
  });
  it('取消部分扫描及完成结果都永久不发布，后续step不能恢复', () => {
    const f = fixture('INT', Array.from({ length: 1025 }, () => '1'));
    f.scan.step(); f.scan.cancel(); expect(f.scan.step()).toEqual({ processed: 512, total: 1025, done: true }); expect(f.scan.result()).toBeUndefined();
    const ready = fixture('INT', ['1']); ready.scan.step(); expect(ready.scan.result()).toBeDefined(); ready.scan.cancel(); expect(ready.scan.result()).toBeUndefined();
  });
  it('批间原格变动撤销，最终全量检查也能发现已处理行的迟到变化', () => {
    const f = fixture('INT', Array.from({ length: 513 }, () => '1')); f.scan.step(); f.rows[512].k = '2';
    expect(() => f.scan.step()).toThrow(text.stale); expect(f.scan.result()).toBeUndefined();
    const old = fixture('INT', Array.from({ length: 513 }, () => '1')); old.scan.step(); old.rows[0].k = '2';
    expect(() => old.scan.step()).toThrow(text.stale); expect(old.scan.result()).toBeUndefined();
  });
  it('分批不重复全行核值，10000行的源格描述符读取保持线性', () => {
    const columns = [{ key: 'k', name: '列', type: 'INT' }]; let reads = 0;
    const rows = Array.from({ length: 10000 }, () => new Proxy({ k: '1' }, { getOwnPropertyDescriptor(target, key) { if (key === 'k') reads++; return Reflect.getOwnPropertyDescriptor(target, key); } }));
    const result = finish(new QueryResultStatisticsScan(captureQueryResultStatistics(columns, rows, columns[0])));
    expect(result).toMatchObject({ count: 10000, sum: '10000' }); expect(reads).toBeLessThanOrEqual(8 * rows.length);
  });
  it('100000行与1024列边界完整接纳，超出任一预算整份拒绝', () => {
    const f = fixture('DECIMAL(65,20)', Array.from({ length: 100000 }, (_, index) => index === 0 ? '0.00000000000000000001' : '0'));
    expect(finish(f.scan)).toMatchObject({ count: 100000, sum: '0.00000000000000000001', average: '0.0000000000000000000000001', averageRounded: false, approximate: false });
    expect(() => fixture('INT', Array.from({ length: 100001 }, () => '1'))).toThrow(text.budget);
    const columns = Array.from({ length: 1024 }, (_, index) => ({ key: `k${index}`, name: '同名', type: 'INT' })), rows = [{ k0: '1' }];
    expect(finish(new QueryResultStatisticsScan(captureQueryResultStatistics(columns, rows, columns[0]))).sum).toBe('1');
    expect(() => captureQueryResultStatistics([...columns, { key: 'extra', name: '', type: 'INT' }], rows, columns[0])).toThrow(text.budget);
  });
  it('单值4096和总计8Mi边界不截断，重复值仍完整计入原文预算', () => {
    const value = 'x'.repeat(4096); expect(finish(fixture('TEXT', [value]).scan)).toMatchObject({ distinct: 1, min: value });
    expect(() => fixture('TEXT', [value + 'x'])).toThrow(text.budget);
    const values = Array.from({ length: 2048 }, () => value); expect(finish(fixture('TEXT', values).scan)).toMatchObject({ count: 2048, distinct: 1 });
    expect(() => fixture('TEXT', [...values, 'x'])).toThrow(text.budget);
  });
  it('长值批次按32Ki原文让出，不在单次step同步处理512个4Ki值', () => {
    const f = fixture('TEXT', Array.from({ length: 17 }, () => 'x'.repeat(4096)));
    expect(f.scan.step()).toEqual({ processed: 8, total: 17, done: false });
    expect(f.scan.step()).toEqual({ processed: 16, total: 17, done: false });
    expect(f.scan.step()).toEqual({ processed: 17, total: 17, done: true }); expect(f.scan.result()).toMatchObject({ count: 17, distinct: 1 });
  });
  it('稀疏数组、继承原格、重复原行及重复内部key都不能进入统计', () => {
    const columns = [{ key: 'k', name: '列', type: 'INT' }], row = { k: '1' };
    expect(() => captureQueryResultStatistics(columns, new Array(1), columns[0])).toThrow();
    expect(() => captureQueryResultStatistics(new Array(1), [row], columns[0])).toThrow();
    expect(() => captureQueryResultStatistics(columns, [Object.create(row)], columns[0])).toThrow();
    expect(() => captureQueryResultStatistics(columns, [row, row], columns[0])).toThrow();
    expect(() => captureQueryResultStatistics([...columns, { ...columns[0] }], [row], columns[0])).toThrow();
    expect(() => captureQueryResultStatistics(columns, [row], { ...columns[0] })).toThrow();
  });
});
