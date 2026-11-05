import { describe, expect, it } from 'vitest';
import type { PostgresTableChange, PostgresTableColumn, PostgresTablePage } from '../../src/shared/postgresTable';
import { findPageCells, pageOccurrences } from '../../src/renderer/pageFindReplace';
import { postgresFindPlan, postgresFindRows } from '../../src/renderer/postgresTableFind';

const id: PostgresTableColumn = { key: 'c0', name: 'id', type: 'bigint', nullable: false, defaultValue: false, primary: true, generated: false, binary: false };
const note = { ...id, key: 'c1', name: '备注', type: 'character varying(40)', nullable: true, primary: false };
const generated = { ...note, key: 'c2', name: '计算列', type: 'text', generated: true };
const page: PostgresTablePage = {
  pageToken: 'token', columns: [id, note, generated], rows: [{ c0: '101', c1: 'aA\r\na', c2: 'aa' }, { c0: '102', c1: null }],
  rowKeys: ['one', 'two'], capabilities: { insert: true, update: true, delete: true }, hasNext: false, truncated: false, order: 'primary', relationKind: 'r',
};
const options = { kind: 'text', query: 'a', wholeCell: false, caseSensitive: false } as const;
const empty = () => undefined;

describe('PostgreSQL 表页查找与替换', () => {
  it('使用原文位置替换一处或全部，保留大小写匹配和字面美元符号', () => {
    const rows = postgresFindRows(page, empty);
    const hits = pageOccurrences(findPageCells(rows, ['c1', 'c2'], options));
    expect(hits).toHaveLength(5);
    const one = postgresFindPlan(page, rows, [note, generated], [hits[1]], '$&', empty);
    expect(one.patches[0].after).toBe('a$&\r\na');
    const all = postgresFindPlan(page, rows, [note, generated], hits, 'x', empty);
    expect(all.patches).toEqual([{ row: 0, column: note, before: 'aA\r\na', after: 'xx\r\nx' }]);
  });

  it('搜索已有草稿，合并未命中的暂存字段并跳过待删行', () => {
    const prior = (key: string): PostgresTableChange => key === 'one'
      ? { kind: 'update', row: 0, fields: [{ column: 'c0', value: { mode: 'text', value: '9007199254740993' } },
        { column: 'c1', value: { mode: 'text', value: 'a草稿' } }] } : { kind: 'delete', row: 1 };
    const rows = postgresFindRows(page, prior);
    expect(rows[1].deleted).toBe(true);
    const hits = pageOccurrences(findPageCells(rows, ['c0', 'c1'], options));
    expect(postgresFindPlan(page, rows, [id, note], hits, 'b', prior).changes).toEqual([
      { kind: 'update', row: 0, fields: [{ column: 'c0', value: { mode: 'text', value: '9007199254740993' } },
        { column: 'c1', value: { mode: 'text', value: 'b草稿' } }] },
    ]);
  });

  it('数值可查找，不能替换，空值和替换预算独立校验', () => {
    const rows = postgresFindRows(page, empty);
    const numbers = pageOccurrences(findPageCells(rows, ['c0'], { ...options, query: '10' }));
    expect(numbers).toHaveLength(2);
    expect(() => postgresFindPlan(page, rows, [id], numbers, '11', empty)).toThrow('没有产生');
    expect(findPageCells(rows, ['c1'], { ...options, kind: 'null' })).toEqual([{ rowId: '1', key: 'c1', ranges: [] }]);
    const hits = pageOccurrences(findPageCells(rows, ['c1'], options));
    expect(() => postgresFindPlan(page, rows, [note], hits, 'x'.repeat(65536), empty)).toThrow('预算');
    expect(() => postgresFindPlan(page, rows, [note], hits, '\0', empty)).toThrow('无法传输');
  });
});
