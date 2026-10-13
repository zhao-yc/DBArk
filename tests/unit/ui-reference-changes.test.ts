import { describe, expect, it } from 'vitest';
import type { ForeignKeyInfo, TableInfo } from '../../src/shared/contracts';
import type { DraftRow } from '../../src/renderer/dataChanges';
import { collectChanges } from '../../src/renderer/dataChanges';
import { patchReferenceRow, referenceClearable, referenceTuple, referenceWritable, referencesForColumn, referenceSignature, sourceReference, type ReferenceSnapshot } from '../../src/renderer/referenceChanges';

const key: ForeignKeyInfo = { name: '关联键', columns: ['parent_id', 'code'], referencedDatabase: '另一库', referencedTable: '父表', referencedColumns: ['id', 'code'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' };
const info: TableInfo = { database: '源库', name: '子表', columns: ['id', 'parent_id', 'code', 'note'].map(name => ({ name, type: 'varchar(100)', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' })), indexes: [], foreignKeys: [key], primaryKey: ['id'], editableKey: ['id'], engine: 'InnoDB', ddl: '' };
const original = { id: '1', parent_id: '9007199254740993', code: '0.10000000000000000001', note: '原说明' };
const row: DraftRow = { id: 'row-1', data: { ...original, note: '现有草稿' }, original, inserted: false, deleted: false };
const snapshot: ReferenceSnapshot = { rowId: row.id, data: structuredClone(row.data), foreignKey: key, source: info, generation: 7 };

describe('外键整组草稿与关联元组', () => {
  it('复合键一次更新，保留精度、原快照、其他草稿及其他行，仍只产生一条待提交变更', () => {
    const other = { ...row, id: '另一行' }; const rows = [row, other];
    const next = patchReferenceRow(rows, snapshot, 7, info, key, ['18446744073709551615', '12.00000000000000000001']);
    expect(next[0].data).toEqual({ ...row.data, parent_id: '18446744073709551615', code: '12.00000000000000000001' });
    expect(next[0].original).toBe(original); expect(next[1]).toBe(other); expect(row.data.parent_id).toBe(original.parent_id);
    expect(collectChanges(next.slice(0, 1))).toEqual([{ kind: 'update', before: original, values: { parent_id: '18446744073709551615', code: '12.00000000000000000001', note: '现有草稿' } }]);
  });
  it('任何部分NULL、缺省或缺列都不产生无条件关联元组，空文本与二进制按原值保留', () => {
    expect(referenceTuple({ parent_id: null, code: 'x' }, key.columns)).toBeNull(); expect(referenceTuple({ code: 'x' }, key.columns)).toBeNull();
    const binary = { type: 'binary' as const, base64: 'AP8=' };
    expect(referenceTuple({ parent_id: '', code: binary }, key.columns)).toEqual(['', binary]);
    expect(referenceTuple(row.data, key.columns)).toEqual([original.parent_id, original.code]);
  });
  it('清空仅在整组可空且可写时成立，保持插入行及其他列状态', () => {
    const inserted = { ...row, inserted: true, original: undefined }; const next = patchReferenceRow([inserted], snapshot, 7, info, key, [null, null], true);
    expect(next[0].inserted).toBe(true); expect(next[0].original).toBeUndefined(); expect(next[0].data).toEqual({ ...row.data, parent_id: null, code: null });
    const required = { ...info, columns: info.columns.map(column => column.name === 'code' ? { ...column, nullable: false } : column) };
    expect(referenceClearable(required, key)).toBe(false); expect(() => patchReferenceRow([row], snapshot, 7, required, key, [null, null], true)).toThrow();
    expect(() => patchReferenceRow([row], snapshot, 7, info, key, [null, 'x'])).toThrow();
  });
  it('页代次、行草稿、删除或映射变化拒绝修改，所有原数据不受影响', () => {
    const before = JSON.stringify([row]);
    for (const attempt of [() => patchReferenceRow([row], snapshot, 8, info, key, ['2', 'a']), () => patchReferenceRow([{ ...row, deleted: true }], snapshot, 7, info, key, ['2', 'a']), () => patchReferenceRow([{ ...row, data: { ...row.data, note: '迟到修改' } }], snapshot, 7, info, key, ['2', 'a']), () => patchReferenceRow([row], snapshot, 7, info, { ...key, referencedTable: '另一个父表' }, ['2', 'a']), () => patchReferenceRow([], snapshot, 7, info, key, ['2', 'a'])]) expect(attempt).toThrow('现有草稿未修改');
    expect(JSON.stringify([row])).toBe(before);
  });
  it('源只读、生成列、字段类型或可靠键变化拒绝回填', () => {
    expect(referenceWritable({ ...info, editableKey: [] }, key)).toBe(false); expect(referenceWritable({ ...info, engine: 'MyISAM' }, key)).toBe(false);
    const generated = { ...info, columns: info.columns.map(column => column.name === 'code' ? { ...column, generated: true } : column) };
    expect(referenceWritable(generated, key)).toBe(false); expect(() => patchReferenceRow([row], snapshot, 7, generated, key, ['2', 'a'])).toThrow();
    expect(() => patchReferenceRow([row], snapshot, 7, { ...info, editableKey: ['code'] }, key, ['2', 'a'])).toThrow();
  });
  it('合法原型同名字段使用自身属性，不污染对象原型，二进制回填独立复制', () => {
    const specialKey = { ...key, columns: ['__proto__', 'constructor'] }; const source = { ...info, foreignKeys: [specialKey], columns: [...info.columns, ...specialKey.columns.map(name => ({ ...info.columns[0], name }))] };
    const data = Object.fromEntries([['__proto__', 'old'], ['constructor', 'old-c']]); const specialRow = { ...row, data }; const captured = { ...snapshot, data, source, foreignKey: specialKey };
    const binary = { type: 'binary' as const, base64: 'AP8=' }; const next = patchReferenceRow([specialRow], captured, 7, source, specialKey, [binary, 'new-c']);
    expect(Object.hasOwn(next[0].data, '__proto__')).toBe(true); expect(next[0].data.__proto__).toEqual(binary); expect(next[0].data.__proto__).not.toBe(binary); expect(Object.getPrototypeOf(next[0].data)).toBe(Object.prototype);
  });
  it('声明列名大小写不同仍有入口，快照与回填使用实际源列名，父列大小写等价不误报变化', () => {
    const mixedInfo = { ...info, columns: info.columns.map(column => ({ ...column, name: column.name === 'parent_id' ? 'Parent_ID' : column.name === 'code' ? 'Code' : column.name })), foreignKeys: [{ ...key, columns: ['PARENT_ID', 'CODE'], referencedColumns: ['ID', 'CODE'] }] };
    const entry = referencesForColumn(mixedInfo, 'Parent_ID'); expect(entry.error).toBe(''); expect(entry.keys[0].columns).toEqual(['Parent_ID', 'Code']);
    expect(referenceWritable(mixedInfo, entry.keys[0])).toBe(true); expect(referenceClearable(mixedInfo, entry.keys[0])).toBe(true);
    const mixedRow = { ...row, data: { id: '1', Parent_ID: original.parent_id, Code: original.code, note: '现有草稿' } };
    const captured = { ...snapshot, data: structuredClone(mixedRow.data), foreignKey: sourceReference(mixedInfo, mixedInfo.foreignKeys[0]), source: mixedInfo };
    const canonical = { ...entry.keys[0], referencedColumns: ['id', 'code'] };
    expect(referenceSignature(canonical)).toBe(referenceSignature(captured.foreignKey));
    const next = patchReferenceRow([mixedRow], captured, 7, mixedInfo, canonical, ['2', '3']); expect(next[0].data).toEqual({ ...mixedRow.data, Parent_ID: '2', Code: '3' }); expect(next[0].data).not.toHaveProperty('PARENT_ID');
    for (const changed of [{ ...canonical, columns: [...canonical.columns].reverse() }, { ...canonical, referencedColumns: [...canonical.referencedColumns].reverse() }, { ...canonical, referencedTable: '父表不同' }, { ...canonical, referencedDatabase: '另一库不同' }, { ...canonical, onDelete: 'CASCADE' }]) expect(() => patchReferenceRow([mixedRow], captured, 7, mixedInfo, changed, ['2', '3'])).toThrow();
    expect(referenceSignature({ ...canonical, referencedTable: 'Parent' })).not.toBe(referenceSignature({ ...canonical, referencedTable: 'parent' }));
  });
  it('缺列和大小写重名不让渲染抛异常，只读并返回合理字段错误；列类型变化仍拒绝回填', () => {
    const missing = { ...info, columns: info.columns.filter(column => column.name !== 'code') }; const ambiguous = { ...info, columns: [...info.columns, { ...info.columns[2], name: 'CODE' }] };
    for (const source of [missing, ambiguous]) { expect(referencesForColumn(source, 'parent_id').keys).toEqual([]); expect(referencesForColumn(source, 'parent_id').error).toContain('关联字段'); expect(referenceWritable(source, key)).toBe(false); expect(referenceClearable(source, key)).toBe(false); }
    expect(() => patchReferenceRow([row], snapshot, 7, { ...info, columns: info.columns.map(column => column.name === 'code' ? { ...column, type: 'bigint' } : column) }, key, ['2', '3'])).toThrow();
  });
  it('FLOAT/DOUBLE 原数值直接回填，BIGINT/DECIMAL 仍为字符串，不混淆两类精度语义', () => {
    const floating = 0.10000000000000002; const next = patchReferenceRow([row], snapshot, 7, info, key, [floating, '18446744073709551615']);
    expect(next[0].data.parent_id).toBe(floating); expect(typeof next[0].data.parent_id).toBe('number'); expect(next[0].data.code).toBe('18446744073709551615'); expect(typeof next[0].data.code).toBe('string');
  });
});
