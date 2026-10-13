import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { pinLimits, snapshotQueryResult } from '../../src/renderer/queryPins';

/** 用调用方后续修改模拟新执行及结果网格操作，确保固定结果不跟随变动。 */
function result(): QueryResult {
  return { columns: [{ key: 'id', name: '编号', type: 'BIGINT' }, { key: 'value', name: '内容', type: 'TEXT' }], rows: [{ id: '18446744073709551615', value: null }, { id: '2', value: { type: 'binary', base64: 'AP+A' } }], elapsedMs: 12, truncated: true, statement: 'SELECT id, value FROM sample' };
}

describe('查询结果固定快照', () => {
  it('新执行或网格操作不改变原行、精确值、列和原SQL', () => {
    const source = result(); const pin = snapshotQueryResult([], source, 'pin', '固定 1');
    source.rows[0].id = '3'; source.columns[0].name = '新列'; source.rows.pop(); source.statement = 'DELETE FROM sample';
    expect(pin.result.rows).toEqual([{ id: '18446744073709551615', value: null }, { id: '2', value: { type: 'binary', base64: 'AP+A' } }]);
    expect(pin.result.columns[0].name).toBe('编号'); expect(pin.result.statement).toBe('SELECT id, value FROM sample');
    expect(pin.result.truncated).toBe(true);
  });
  it('总容量和个数超限时保留原快照，释放后可再次固定', () => {
    const first = snapshotQueryResult([], result(), 'one', '固定 1'); const pins = [first];
    expect(() => snapshotQueryResult(Array(pinLimits.count).fill(first), result(), 'two', '固定 2')).toThrow('最多');
    expect(() => snapshotQueryResult([{ ...first, bytes: pinLimits.bytes }], result(), 'two', '固定 2')).toThrow('16 MiB');
    expect(pins).toEqual([first]); expect(snapshotQueryResult([], result(), 'two', '固定 2').result.rows).toHaveLength(2);
  });
  it('无列的写语句结果不能固定，有列但零行的查询可以固定', () => {
    expect(() => snapshotQueryResult([], { ...result(), columns: [], rows: [], affectedRows: 1 }, 'pin', '固定')).toThrow('查询结果');
    expect(snapshotQueryResult([], { ...result(), rows: [] }, 'pin', '固定').result.rows).toEqual([]);
  });
  it('中文字节按UTF8计算，容量拒绝不会静默截断结果', () => {
    const source = { ...result(), rows: [{ id: '1', value: '甲'.repeat(200) }] };
    const pin = snapshotQueryResult([], source, 'pin', '固定');
    expect(pin.bytes).toBe(Buffer.byteLength(JSON.stringify(source), 'utf8'));
    expect(() => snapshotQueryResult([{ ...pin, bytes: pinLimits.bytes - pin.bytes + 1 }], source, 'two', '固定 2')).toThrow('16 MiB');
  });
});
