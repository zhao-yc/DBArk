import { describe, expect, it } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import type { DraftRow } from '../../src/renderer/dataChanges';
import { applyPageReplacement, findPageCells, pageFindLimits, previewPageReplacement, type PageFindOptions } from '../../src/renderer/pageFindReplace';
import { collectChanges } from '../../src/renderer/dataChanges';

const options: PageFindOptions = { kind: 'text', query: 'old', caseSensitive: false, wholeCell: false };
const info: TableInfo = { database: 'CaseDb', name: 'CaseTable', columns: ['id', 'text', '__proto__', 'constructor', 'json', 'amount', 'generated'].map(name => ({ name, type: name === 'id' ? 'BIGINT' : name === 'json' ? 'JSON' : name === 'amount' ? 'DECIMAL(30,10)' : 'TEXT', generated: name === 'generated', nullable: true, defaultValue: null, extra: '', comment: '' })), indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], engine: 'InnoDB', ddl: '' };
/** 数据库同名原型字段必须使用真实自有属性创建测试记录。 */
function row(id: string, value = 'old'): DraftRow { const data = Object.fromEntries([['id', '9007199254740993123'], ['text', value], ['__proto__', 'old'], ['constructor', 'old'], ['json', '{"key":"old"}'], ['amount', '12345678901234567890.1234567890'], ['generated', 'old']]); return { id, data, original: structuredClone(data), inserted: false, deleted: false }; }

describe('页内查找和替换草稿', () => {
  it('完整原值匹配，保留精确数字，排除隐藏列、删除行及二进制', () => {
    const first = row('1', 'x'.repeat(300) + 'old'); first.data.binary = { type: 'binary', base64: 'b2xk' }; const deleted = { ...row('2'), deleted: true };
    expect(findPageCells([first, deleted], ['text', 'binary'], options)).toEqual([{ rowId: '1', key: 'text', ranges: [{ start: 300, end: 303 }] }]);
    expect(findPageCells([first], ['amount'], { ...options, query: '12345678901234567890.1234567890', wholeCell: true })).toHaveLength(1);
    expect(findPageCells([first], ['text'], { ...options, column: 'amount' })).toHaveLength(0);
  });
  it('文字 NULL、真正 NULL、空串和新增 DEFAULT 不混淆或继承原型值', () => {
    const draft: DraftRow = { id: 'new', data: { text: 'NULL', empty: '', nullable: null }, inserted: true, deleted: false };
    const keys = ['text', 'empty', 'nullable', '__proto__', 'constructor'];
    expect(findPageCells([draft], keys, { ...options, query: 'NULL' }).map(match => match.key)).toEqual(['text']);
    expect(findPageCells([draft], keys, { ...options, kind: 'null' }).map(match => match.key)).toEqual(['nullable']);
    expect(findPageCells([draft], keys, { ...options, kind: 'default' }).map(match => match.key)).toEqual(['__proto__', 'constructor']);
  });
  it('Unicode匹配用原串坐标，前缀İ不会导致替换错位', () => {
    const rows = [row('1', 'İ前缀 OLD 尾部😀')];
    const plan = previewPageReplacement(rows, ['text'], options, '新', info, 4);
    expect(plan.patches[0].after).toBe('İ前缀 新 尾部😀');
    expect(findPageCells(rows, ['text'], { ...options, caseSensitive: true })).toHaveLength(0);
    expect(findPageCells(rows, ['text'], { ...options, wholeCell: true })).toHaveLength(0);
  });
  it('查找正则符号与替换$&/$1均是字面文字，不解释用户表达式', () => {
    const rows = [row('1', '前.*[old]后.*[old]')]; const plan = previewPageReplacement(rows, ['text'], { ...options, query: '.*[old]' }, '$&/$1', info, 1);
    expect(plan.patches[0].after).toBe('前$&/$1后$&/$1');
  });
  it('只替换可写文本，自有原型同名列安全，原始快照及其他精确值保持', () => {
    const rows = [row('1')]; const plan = previewPageReplacement(rows, ['__proto__', 'constructor', 'json', 'generated', 'amount'], options, 'new', info, 2);
    expect(plan.patches.map(patch => patch.key)).toEqual(['__proto__', 'constructor']);
    const next = applyPageReplacement(rows, plan, info, 2);
    expect(Object.getPrototypeOf(next[0].data)).toBe(Object.prototype); expect(Object.hasOwn(next[0].data, '__proto__')).toBe(true); expect(next[0].data.__proto__).toBe('new');
    expect(next[0].original).toBe(rows[0].original); expect(next[0].data.amount).toBe(rows[0].data.amount);
    expect(collectChanges(next)[0]).toEqual({ kind: 'update', before: rows[0].original, values: Object.fromEntries([['__proto__', 'new'], ['constructor', 'new']]) });
    for (const changedInfo of [{ ...info, editableKey: [] }, { ...info, engine: 'MyISAM' }]) expect(() => previewPageReplacement(rows, ['text'], options, 'new', changedInfo, 2)).toThrow();
  });
  it('本地受影响行变化、代次、可靠key、列类型或表名变化整批拒绝', () => {
    const rows = [row('1'), row('2')]; const plan = previewPageReplacement(rows, ['text'], options, 'new', info, 2);
    for (const changed of [{ ...rows[0], data: { ...rows[0].data, amount: 'different' } }, { ...rows[0], deleted: true }, { ...rows[0], inserted: true }]) expect(() => applyPageReplacement([changed, rows[1]], plan, info, 2)).toThrow();
    expect(() => applyPageReplacement(rows, plan, info, 3)).toThrow();
    for (const changedInfo of [{ ...info, name: 'casetable' }, { ...info, editableKey: ['text'] }, { ...info, columns: info.columns.map(column => column.name === 'text' ? { ...column, type: 'JSON' } : column) }]) expect(() => applyPageReplacement(rows, plan, changedInfo, 2)).toThrow();
    expect(rows[1].data.text).toBe('old');
  });
  it('新增行替换仍是insert，删除行不进入预览', () => {
    const inserted = { ...row('new'), inserted: true, original: undefined }; const deleted = { ...row('deleted'), deleted: true };
    const plan = previewPageReplacement([inserted, deleted], ['text'], options, 'new', info, 1); const next = applyPageReplacement([inserted, deleted], plan, info, 1);
    expect(plan.rows).toHaveLength(1); expect(next[0].inserted).toBe(true); expect(next[0].original).toBeUndefined(); expect(next[1]).toBe(deleted);
  });
  it('输入、累计UTF8扫描、匹配数和替换扩张超预算明确拒绝', () => {
    expect(() => findPageCells([row('1')], ['text'], { ...options, query: 'x'.repeat(513) })).toThrow();
    expect(() => previewPageReplacement([row('1')], ['text'], options, 'x'.repeat(4097), info, 1)).toThrow();
    expect(() => findPageCells([row('1', '中'.repeat(Math.ceil(pageFindLimits.bytes / 3)))], ['text'], options)).toThrow();
    expect(() => findPageCells([row('1', 'a'.repeat(50001))], ['text'], { ...options, query: 'a' })).toThrow();
    expect(() => previewPageReplacement([row('1', 'a'.repeat(5000))], ['text'], { ...options, query: 'a' }, 'x'.repeat(4096), info, 1)).toThrow();
  });
  it('选中文本旁的大BLOB在完整JSON分配及clone前拒绝，已有草稿不变', () => {
    const target = row('1'); const binary = { type: 'binary' as const, base64: 'A'.repeat(pageFindLimits.bytes) }; target.data.blob = binary;
    expect(() => previewPageReplacement([target], ['text'], options, 'new', info, 1)).toThrow();
    expect(target.data.text).toBe('old'); expect(target.data.blob).toBe(binary); expect(target.original!.text).toBe('old');
  });
});
