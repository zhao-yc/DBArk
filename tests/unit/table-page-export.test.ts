import { describe, expect, it } from 'vitest';
import type { TablePage } from '../../src/shared/contracts';
import type { DraftRow } from '../../src/renderer/dataChanges';
import { snapshotTablePageExport } from '../../src/renderer/tablePageExport';
import { resultExportLimits } from '../../src/shared/resultExport';

/** 原页、原始行和编辑副本独立，匹配真实表页的structuredClone行为。 */
function fixture() { const page: TablePage = { columns: ['id', 'amount', 'bin', 'note', 'hidden'].map(key => ({ key, name: key, type: '' })), rows: [{ id: '18446744073709551615', amount: '0.12345678901234567890', bin: { type: 'binary', base64: 'AP8=' }, note: null, hidden: '隐藏原文' }, { id: '9007199254740993', amount: '1.00000000000000000001', bin: { type: 'binary', base64: '' }, note: '', hidden: '隐藏原文' }], hasMore: true, page: 2, pageSize: 2 }; const rows: DraftRow[] = page.rows.map((data, index) => ({ id: 'r' + index, data: structuredClone(data), original: structuredClone(data), inserted: false, deleted: false })); return { page, rows, visible: ['bin', 'id', 'amount', 'note'] }; }

describe('表页及本页勾选导出快照', () => {
  it('按原页显示顺序与可见列顺序导出勾选，精度／NULL／字节保留，打开后原数据变化不影响文件', () => {
    const { page, rows, visible } = fixture(), snapshot = snapshotTablePageExport(page, rows, visible, new Set(['r1', 'r0']));
    expect(snapshot.columns.map(column => column.key)).toEqual(visible); expect(snapshot.rows.map(row => row.id)).toEqual(['18446744073709551615', '9007199254740993']); expect(snapshot.rows[0]).toEqual({ bin: { type: 'binary', base64: 'AP8=' }, id: '18446744073709551615', amount: '0.12345678901234567890', note: null }); expect(snapshot.rows[1].note).toBe(''); expect(snapshot.truncated).toBe(false); expect(JSON.stringify(snapshot)).not.toContain('隐藏原文');
    page.rows[0].id = '后来修改'; (rows[1].data.bin as any).base64 = 'AA=='; expect(snapshot.rows[0].id).toBe('18446744073709551615'); expect(snapshot.rows[1].bin).toEqual({ type: 'binary', base64: '' });
  });
  it('无selected参数才导出全页；空勾选、未知ID或部分旧ID均拒绝，无数据页只保留标题', () => {
    const { page, rows, visible } = fixture(); expect(snapshotTablePageExport(page, rows, visible).rows).toHaveLength(2);
    for (const selection of [new Set<string>(), new Set(['旧页']), new Set(['r0', '旧页'])]) expect(() => snapshotTablePageExport(page, rows, visible, selection)).toThrow();
    expect(snapshotTablePageExport({ ...page, rows: [] }, [], visible).rows).toEqual([]);
  });
  it('不允许未提交、删除、新增、原始行错配或未选中行修改混入导出', () => {
    for (const mutate of [(rows: DraftRow[]) => { rows[1].inserted = true; }, (rows: DraftRow[]) => { rows[1].deleted = true; }, (rows: DraftRow[]) => { rows[1].data.note = '未选中行的未提交修改'; }, (rows: DraftRow[]) => { rows[1].original = undefined; }, (rows: DraftRow[]) => rows.reverse()]) { const { page, rows, visible } = fixture(); mutate(rows); expect(() => snapshotTablePageExport(page, rows, visible, new Set(['r0']))).toThrow(); }
    const { page, rows, visible } = fixture(); (rows[0].data.bin as any).base64 = 'AA=='; expect(() => snapshotTablePageExport(page, rows, visible)).toThrow();
  });
  it('拒绝重复／缺失身份、重复／隐藏键投影、访问器及超限，不调用getter', () => {
    const { page, rows, visible } = fixture(); expect(() => snapshotTablePageExport(page, [rows[0], rows[0]], visible)).toThrow(); expect(() => snapshotTablePageExport(page, rows, ['id', 'id'])).toThrow(); expect(() => snapshotTablePageExport(page, rows, ['缺失'])).toThrow();
    let reads = 0; Object.defineProperty(page.rows[0], 'note', { get() { reads++; throw Error('禁止读取'); } }); expect(() => snapshotTablePageExport(page, rows, visible)).toThrow(); expect(reads).toBe(0);
    const huge = fixture(); for (const row of [huge.page.rows[0], huge.rows[0].data, huge.rows[0].original!]) row.note = 'x'.repeat(resultExportLimits.fieldBytes + 1); expect(() => snapshotTablePageExport(huge.page, huge.rows, huge.visible)).toThrow();
  });
  it('隐藏的大字段不传入文件预算，也不克隆到快照；原型同名字段仍为自有普通值', () => {
    const { page, rows, visible } = fixture(); for (const row of [page.rows[0], rows[0].data, rows[0].original!]) row.hidden = 'x'.repeat(resultExportLimits.fieldBytes + 1); expect(snapshotTablePageExport(page, rows, visible).rows).toHaveLength(2);
    const special: TablePage = { ...page, columns: [{ key: '__proto__', name: '原型同名', type: '' }], rows: [Object.fromEntries([['__proto__', '普通文字']])] }, drafts: DraftRow[] = [{ id: '原型', data: structuredClone(special.rows[0]), original: structuredClone(special.rows[0]), inserted: false, deleted: false }];
    const value = snapshotTablePageExport(special, drafts, ['__proto__']); expect(Object.hasOwn(value.rows[0], '__proto__')).toBe(true); expect(value.rows[0].__proto__).toBe('普通文字');
  });
});
