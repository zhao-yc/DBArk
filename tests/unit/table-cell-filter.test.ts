import { describe, expect, it } from 'vitest';
import type { CellValue, ColumnInfo } from '../../src/shared/contracts';
import type { DraftRow } from '../../src/renderer/dataChanges';
import { tableCellFilterDraft } from '../../src/renderer/tableCellFilter';
import { filterRuleFromDraft } from '../../src/renderer/tableFilters';
import { FILTER_LIMITS } from '../../src/shared/filtering';

const columns: ColumnInfo[] = [{ name: '原列`名称', type: 'text', nullable: true, defaultValue: null, extra: '', generated: false, comment: '' }];
/** 合成原行与独立草稿，测试只读准入，不调用数据库。 */
function fixture(value: CellValue) { const key = columns[0].name, row: DraftRow = { id: 'row', data: { [key]: value }, original: { [key]: value }, inserted: false, deleted: false }; return { row, selection: { rowId: row.id, key }, visible: [key] }; }

describe('表格当前单元格带入服务器筛选草稿', () => {
  it.each(['18446744073709551615', '0.12345678901234567890', '', 'NULL', "  引号'\\%_\n🚢  "] )('保留原字符串 %j 且不生成SQL', value => {
    const { row, selection, visible } = fixture(value), before = structuredClone(row);
    for (const exclude of [false, true]) { const draft = tableCellFilterDraft(columns, [row], visible, selection, exclude); expect(filterRuleFromDraft(draft, visible)).toEqual({ column: visible[0], operator: exclude ? '!=' : '=', value }); }
    expect(row).toEqual(before);
  });
  it('NULL使用无参数判断，布尔值与有限数值明确转换；不猜空文本为NULL', () => {
    for (const [value, expected] of [[true, '1'], [false, '0'], [42, '42'], [1.25, '1.25']] as const) { const { row, selection, visible } = fixture(value); expect(tableCellFilterDraft(columns, [row], visible, selection).value).toBe(expected); }
    const { row, selection, visible } = fixture(null);
    expect(filterRuleFromDraft(tableCellFilterDraft(columns, [row], visible, selection), visible)).toEqual({ column: visible[0], operator: 'IS NULL' });
    expect(filterRuleFromDraft(tableCellFilterDraft(columns, [row], visible, selection, true), visible)).toEqual({ column: visible[0], operator: 'IS NOT NULL' });
  });
  it('拒绝二进制、DEFAULT、非有限或已失精度数值、超限原文', () => {
    for (const value of [{ type: 'binary', base64: 'AP8=' }, undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1] as unknown as CellValue[]) { const { row, selection, visible } = fixture(value); expect(() => tableCellFilterDraft(columns, [row], visible, selection)).toThrow(); }
    const { row, selection, visible } = fixture('x'.repeat(FILTER_LIMITS.valueLength + 1)); expect(() => tableCellFilterDraft(columns, [row], visible, selection)).toThrow();
  });
  it('拒绝插入、删除、修改、缺失、隐藏或重复身份，不执行访问器', () => {
    const { row, selection, visible } = fixture('原文');
    for (const changed of [{ ...row, inserted: true }, { ...row, deleted: true }, { ...row, original: undefined }, { ...row, data: { [selection.key]: '修改' } }]) expect(() => tableCellFilterDraft(columns, [changed], visible, selection)).toThrow();
    for (const [metadata, rows, keys, cell] of [[columns, [row], [], selection], [columns, [row, row], visible, selection], [[...columns, ...columns], [row], visible, selection], [columns, [], visible, selection], [columns, [row], visible, undefined]] as const) expect(() => tableCellFilterDraft(metadata, rows, keys, cell)).toThrow();
    let reads = 0; Object.defineProperty(row.data, selection.key, { get() { reads++; throw Error('禁止读取'); } }); expect(() => tableCellFilterDraft(columns, [row], visible, selection)).toThrow(); expect(reads).toBe(0);
  });
});
