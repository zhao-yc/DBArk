import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import { captureQueryResultStatistics, currentQueryResultStatistics, QueryResultStatisticsScan } from '../../src/renderer/queryResultStatistics';
import { queryResultStatisticsZh as text } from '../../src/renderer/locales/queryResultStatistics.zh-CN';

type Value = bigint | number | string | Uint8Array | null;
/** 同一批原值送入独立SQLite参考库和RAM结果；预期不是从统计器重算。 */
function fixture(values: Value[], selected?: Set<number>) {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY,value);');
  const insert = db.prepare('INSERT INTO subject VALUES(?,?)');
  const codes: string[] = [];
  const rows = values.map((value, index) => {
    insert.run(index, value);
    codes.push(value === null ? 'n' : typeof value === 'bigint' ? 'i' : typeof value === 'number' ? 'r' : typeof value === 'string' ? 't' : 'b');
    const cell: CellValue = value === null ? null : typeof value === 'bigint' ? String(value) : typeof value === 'number' ? Object.is(value, -0) ? '-0' : String(value) : typeof value === 'string' ? value : { type: 'binary', base64: Buffer.from(value).toString('base64') };
    return { value: cell };
  });
  const source: QueryResult = { columns: [{ key: 'value', name: '同名', type: 'SQLITE' }], rows, sqliteStorage: { version: 1, rows: codes }, elapsedMs: 0, truncated: true, statement: '不发送SQL' };
  const capture = captureQueryResultStatistics(source.columns, rows, source.columns[0], selected, source);
  return { db, source, capture, scan: new QueryResultStatisticsScan(capture) };
}
/** 每批保持原512行门；完成前不能获取部分指标。 */
function finish(scan: QueryResultStatisticsScan) {
  let previous = 0;
  for (;;) { const progress = scan.step(); expect(progress.processed - previous).toBeLessThanOrEqual(512); previous = progress.processed; if (progress.done) return scan.result()!; expect(scan.result()).toBeUndefined(); }
}
/** 参考库结果按原存储类型展示；字节完整HEX与统计面板一致。 */
function literal(value: unknown): string { return value instanceof Uint8Array ? `X'${Buffer.from(value).toString('hex')}'` : String(value); }

describe('SQLite已返回列统计', () => {
  it('混合存储的不同值及极值与独立UTF-8 SQLite一致，不猜测文本数值或丢整数低位', () => {
    const f = fixture([9223372036854775807n, 9007199254740993n, 9007199254740992, 2n, 2, '2', '10', -0, 0n, -Infinity, Infinity, '', '\0A', '\0B', '\uE000', '𐀀', Uint8Array.of(0xff), new Uint8Array(), Uint8Array.of(0xff), null]);
    try {
      const before = structuredClone(f.source), stmt = f.db.prepare('SELECT count(*) AS count,count(value) AS nonNull,count(DISTINCT value) AS distinctValues,min(value) AS minimum,max(value) AS maximum FROM subject'); stmt.setReadBigInts(true);
      const reference = stmt.get()!, result = finish(f.scan);
      expect(result).toMatchObject({ count: Number(reference.count), nonNull: Number(reference.nonNull), nulls: 1, distinct: Number(reference.distinctValues), min: literal(reference.minimum), max: literal(reference.maximum), reason: text.sqliteNumericOnly });
      expect(result.sqliteTypes).toEqual({ integer: 4, real: 5, text: 7, blob: 3, null: 1 });
      expect(result.sum).toBeUndefined(); expect(result.average).toBeUndefined(); expect(f.source).toEqual(before); expect(Object.isFrozen(f.source.rows)).toBe(false); expect(Object.isFrozen(result.sqliteTypes)).toBe(true);
    } finally { f.db.close(); }
  });
  it('int64相邻大整数精确求和和有限平均，不按SQLite溢出或REAL舍入丢值', () => {
    const f = fixture([9223372036854775807n, 9007199254740993n, null]);
    try { expect(finish(f.scan)).toMatchObject({ count: 3, distinct: 2, min: '9007199254740993', max: '9223372036854775807', sum: '9232379236109516800', average: '4616189618054758400', approximate: false, sqliteTypes: { integer: 2, real: 0, text: 0, blob: 0, null: 1 } }); } finally { f.db.close(); }
  });
  it('INTEGER与REAL数学相等归一，TEXT及字节保持不同，正负零合并', () => {
    const f = fixture([2n, 2, '2', Uint8Array.of(0x32), 0n, -0, 0]);
    try { expect(finish(f.scan)).toMatchObject({ distinct: 4, min: '0', max: "X'32'", reason: text.sqliteNumericOnly }); } finally { f.db.close(); }
  });
  it('纯数值混合按原数值文本求和，REAL标为近似而不把INTEGER转Number', () => {
    const f = fixture([9007199254740993n, 0.1, 0.2, null]);
    try { expect(finish(f.scan)).toMatchObject({ sum: '9007199254740993.3', average: '3002399751580331.1', floatInput: true, approximate: true, averageRounded: false }); } finally { f.db.close(); }
  });
  it('循环平均按原规则舍入，极小REAL和负零仍有完整类型', () => {
    const f = fixture([2n, 0n, 0n]);
    try { expect(finish(f.scan)).toMatchObject({ sum: '2', average: '0.666666666666666667', averageRounded: true, approximate: true, floatInput: false }); } finally { f.db.close(); }
    const small = fixture([-0, Number.MIN_VALUE]);
    try { const result = finish(small.scan); expect(result.sum).toBe('0.' + '0'.repeat(323) + '5'); expect(result.floatInput).toBe(true); expect(result.distinct).toBe(2); } finally { small.db.close(); }
  });
  it('文本用UTF-8原序与NUL完整不同值，不转数值；BLOB不通过显示字符串比较', () => {
    const f = fixture(['𐀀', '\uE000', '\0B', '\0A', '', '2', '10']);
    try { expect(finish(f.scan)).toMatchObject({ min: '', max: '𐀀', distinct: 7, reason: text.sqliteNumericOnly }); } finally { f.db.close(); }
    const bytes = fixture([Uint8Array.of(0xff), Uint8Array.of(0), Uint8Array.of(0, 0xff), new Uint8Array(), null]);
    try { expect(finish(bytes.scan)).toMatchObject({ distinct: 4, min: "X''", max: "X'ff'", sqliteTypes: { blob: 4, null: 1 } }); } finally { bytes.db.close(); }
  });
  it.each([{ values: [] }, { values: [null, null] }])('空与全NULL范围提供零不同值和真实类型计数：$values', ({ values }) => {
    const f = fixture(values); try { expect(finish(f.scan)).toEqual({ count: values.length, nonNull: 0, nulls: values.length, distinct: 0, approximate: false, floatInput: false, averageRounded: false, sqliteTypes: { integer: 0, real: 0, text: 0, blob: 0, null: values.length } }); } finally { f.db.close(); }
  });
  it('选中范围独立，只读实际选中原格，不执行未选格getter', () => {
    const selected = new Set([1, 0]), f = fixture([9007199254740993n, 9007199254740995n, '不读取']);
    try {
      const getter = vi.fn(() => { throw Error('不应读取'); }); Object.defineProperty(f.source.rows[2], 'value', { get: getter });
      const capture = captureQueryResultStatistics(f.source.columns, f.source.rows, f.source.columns[0], selected, f.source);
      expect(finish(new QueryResultStatisticsScan(capture))).toMatchObject({ count: 2, sum: '18014398509481988', average: '9007199254740994' }); expect(getter).not.toHaveBeenCalled();
      selected.clear(); expect(currentQueryResultStatistics(capture, f.source.columns, f.source.rows)).toBe(false);
    } finally { f.db.close(); }
  });
  it.each(['missing', 'bad-value', 'bad-null'] as const)('未知或不匹配类型%s不发布部分值指标或类型计数', mode => {
    const f = fixture([1n, null]);
    try {
      if (mode === 'missing') delete f.source.sqliteStorage;
      else f.source.sqliteStorage!.rows[mode === 'bad-null' ? 1 : 0] = mode === 'bad-null' ? 'i' : 'b';
      const capture = captureQueryResultStatistics(f.source.columns, f.source.rows, f.source.columns[0], undefined, f.source), result = finish(new QueryResultStatisticsScan(capture));
      expect(result).toMatchObject({ count: 2, nonNull: 1, nulls: 1, reason: text.value });
      for (const key of ['distinct', 'min', 'max', 'sum', 'average', 'sqliteTypes'] as const) expect(result[key]).toBeUndefined();
    } finally { f.db.close(); }
  });
  it('类型对象或代码同原文漂移后永久失效，恢复不能复活；完成后也核原值', () => {
    const f = fixture([2n, 3n]);
    try {
      finish(f.scan); f.source.sqliteStorage!.rows[0] = 't'; expect(f.scan.result()).toBeUndefined(); f.source.sqliteStorage!.rows[0] = 'i'; expect(currentQueryResultStatistics(f.capture, f.source.columns, f.source.rows)).toBe(false); expect(f.scan.result()).toBeUndefined();
    } finally { f.db.close(); }
  });
  it.each(['source-rows', 'storage-object', 'code-array'] as const)('%s替换身份后永久失效，不追认原值相同的新对象', mode => {
    const f = fixture([2n, 3n]);
    try {
      const rows = f.source.rows, storage = f.source.sqliteStorage!, codes = storage.rows;
      if (mode === 'source-rows') f.source.rows = [...rows];
      else if (mode === 'storage-object') f.source.sqliteStorage = { version: 1, rows: [...codes] };
      else storage.rows = [...codes];
      expect(currentQueryResultStatistics(f.capture, f.source.columns, rows)).toBe(false);
      f.source.rows = rows; f.source.sqliteStorage = storage; storage.rows = codes;
      expect(currentQueryResultStatistics(f.capture, f.source.columns, rows)).toBe(false); expect(() => f.scan.step()).toThrow(text.stale);
    } finally { f.db.close(); }
  });
  it('隐藏字段元数据和代码沿完整原列定位，可见重排不串列，原类型访问器零调用', () => {
    const f = fixture([2n, 3n]);
    try {
      const hidden = { key: 'hidden', name: '同名', type: 'SQLITE' }; f.source.columns.push(hidden);
      f.source.rows.forEach(row => { row.hidden = { type: 'binary', base64: 'AP8=' }; }); f.source.sqliteStorage!.rows = ['ib', 'ib'];
      const visible = [hidden, f.source.columns[0]], capture = captureQueryResultStatistics(visible, f.source.rows, visible[0], undefined, f.source);
      expect(finish(new QueryResultStatisticsScan(capture))).toMatchObject({ distinct: 1, min: "X'00ff'", max: "X'00ff'" });
      f.source.columns[0].name = '新名'; expect(currentQueryResultStatistics(capture, visible, f.source.rows)).toBe(false);
      const getter = vi.fn(() => f.source.sqliteStorage); Object.defineProperty(f.source, 'sqliteStorage', { enumerable: true, get: getter });
      expect(() => captureQueryResultStatistics(visible, f.source.rows, visible[0], undefined, f.source)).toThrow(); expect(getter).not.toHaveBeenCalled();
    } finally { f.db.close(); }
  });
  it('全NULL但类型标记错误时也拒绝值指标，不能沿空范围捷径伪报distinct0', () => {
    const f = fixture([null]);
    try {
      f.source.sqliteStorage!.rows[0] = 'i'; const capture = captureQueryResultStatistics(f.source.columns, f.source.rows, f.source.columns[0], undefined, f.source);
      const result = finish(new QueryResultStatisticsScan(capture)); expect(result).toMatchObject({ count: 1, nulls: 1, nonNull: 0, reason: text.value }); expect(result.distinct).toBeUndefined(); expect(result.sqliteTypes).toBeUndefined();
    } finally { f.db.close(); }
  });
  it('分批中已处理格的代码漂移在最终发布前拒绝，取消不能复活', () => {
    const f = fixture(Array.from({ length: 1025 }, () => 1n));
    try {
      expect(f.scan.step()).toEqual({ processed: 512, total: 1025, done: false }); f.source.sqliteStorage!.rows[0] = 't'; expect(f.scan.step().done).toBe(false); expect(() => f.scan.step()).toThrow(text.stale); expect(f.scan.result()).toBeUndefined();
      f.source.sqliteStorage!.rows[0] = 'i'; expect(f.scan.step().done).toBe(true); expect(f.scan.result()).toBeUndefined();
    } finally { f.db.close(); }
  });
  it('非有限REAL保留不同值与极值但不给伪造的有限合计', () => {
    const f = fixture([-Infinity, 1n, Infinity]);
    try { expect(finish(f.scan)).toMatchObject({ distinct: 3, min: '-Infinity', max: 'Infinity', reason: text.sqliteNumericOnly }); expect(f.scan.result()!.sum).toBeUndefined(); } finally { f.db.close(); }
  });
  it('超预算HEX不截断或发布前段值，仍保留完整行计数', () => {
    const f = fixture([Uint8Array.of(1), new Uint8Array(2049), null]);
    try { const result = finish(f.scan); expect(result).toMatchObject({ count: 3, nulls: 1, reason: text.value }); expect(result.distinct).toBeUndefined(); expect(result.sqliteTypes).toBeUndefined(); } finally { f.db.close(); }
  });
});
