import { describe, expect, it } from 'vitest';
import type { PostgresTableColumn, PostgresTablePage } from '../../src/shared/postgresTable';
import { encodeClipboard } from '../../src/renderer/gridClipboard';
import { postgresGridPasteChanges } from '../../src/renderer/postgresGridPaste';

const base: PostgresTableColumn = { key: 'c0', name: '主键', type: 'bigint', nullable: false, generated: false, defaultValue: false, primary: true, binary: false };
const note = { ...base, key: 'c1', name: '备注', type: 'text', nullable: true, primary: false };
const binary = { ...note, key: 'c2', name: '字节', binary: true };
const generated = { ...note, key: 'c3', name: '生成', generated: true };
const page: PostgresTablePage = {
  columns: [base, note, binary, generated], rows: [{ c0: '1' }, { c0: '2' }], rowKeys: ['row1', 'row2'],
  capabilities: { insert: true, update: true, delete: true }, hasNext: false, truncated: false, order: 'primary', relationKind: 'r',
};

describe('PostgreSQL 网格粘贴', () => {
  it('覆盖从可见列位置开始，保留旧草稿的其他字段与类型', () => {
    const source = encodeClipboard([['9007199254740993', null], ['9007199254740994', '']]);
    expect(postgresGridPasteChanges(page, [binary, base, note], base.key, { typed: source.typed, plain: source.text }, 0, key =>
      key === 'row1' ? { kind: 'update', row: 0, fields: [{ column: 'c2', value: { mode: 'default' } }] } : undefined,
    )).toEqual([
      { kind: 'update', row: 0, fields: [
        { column: 'c2', value: { mode: 'default' } }, { column: 'c0', value: { mode: 'text', value: '9007199254740993' } },
        { column: 'c1', value: { mode: 'null' } },
      ] },
      { kind: 'update', row: 1, fields: [
        { column: 'c0', value: { mode: 'text', value: '9007199254740994' } }, { column: 'c1', value: { mode: 'text', value: '' } },
      ] },
    ]);
  });

  it('追加保留 TSV 中的换行、空串和字面 NULL，类型化包保留字节和 DEFAULT', () => {
    expect(postgresGridPasteChanges(page, [base, note], base.key, { plain: '1\t"a\r\nb"\r\n2\tNULL\n3\t' }))
      .toEqual(['a\r\nb', 'NULL', ''].map((value, index) => ({ kind: 'insert', fields: [
        { column: 'c0', value: { mode: 'text', value: String(index + 1) } },
        { column: 'c1', value: { mode: 'text', value } },
      ] })));
    const source = encodeClipboard([[undefined, { type: 'binary', base64: 'AP8=' }]]);
    expect(postgresGridPasteChanges(page, [note, binary], note.key, { typed: source.typed, plain: source.text }))
      .toEqual([{ kind: 'insert', fields: [
        { column: 'c1', value: { mode: 'default' } }, { column: 'c2', value: { mode: 'binary', value: '00ff' } },
      ] }]);
    expect(postgresGridPasteChanges(page, [note], note.key, { plain: '第一行\n""' }))
      .toEqual(['第一行', ''].map(value => ({ kind: 'insert', fields: [{ column: 'c1', value: { mode: 'text', value } }] })));
  });

  it('拒绝超出页边界、行列形状不一致、待删除记录和生成列', () => {
    expect(() => postgresGridPasteChanges(page, page.columns, base.key, { plain: '1\n2' }, 1)).toThrow('超出');
    expect(() => postgresGridPasteChanges(page, page.columns, base.key, { plain: '1\n2\t值' })).toThrow('相同数量');
    expect(() => postgresGridPasteChanges(page, page.columns, base.key, { plain: '1\n2' }, 0, key =>
      key === 'row2' ? { kind: 'delete', row: 1 } : undefined,
    )).toThrow('待删除');
    expect(() => postgresGridPasteChanges(page, page.columns, binary.key, { plain: '值\t值' })).toThrow('生成列');
  });

  it('拒绝非空约束、错误字节列和已丢精度的类型化数字', () => {
    for (const value of [null, { type: 'binary' as const, base64: 'AP8=' }, 2 ** 53, '值\0']) {
      const source = encodeClipboard([[value]]);
      expect(() => postgresGridPasteChanges(page, page.columns, base.key, { typed: source.typed, plain: source.text })).toThrow();
    }
  });
});
