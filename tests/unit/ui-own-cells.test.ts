import { describe, expect, it } from 'vitest';
import type { DataRow } from '../../src/shared/contracts';
import { cellPreview, cellText, ownCell } from '../../src/renderer/lib';
import { collectChanges, type DraftRow } from '../../src/renderer/dataChanges';
import { decodeClipboard, encodeClipboard, pasteCells } from '../../src/renderer/gridClipboard';

describe('新增行缺省单元格与原型同名字段', () => {
  it('普通空对象中的原型成员都是未填写 DEFAULT，不进入文本或二进制预览', () => {
    const data: DataRow = {};
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '普通字段']) {
      const value = ownCell(data, key); expect(value).toBeUndefined(); expect(cellText(value)).toBe(''); expect(cellPreview(value)).toBe('');
    }
    const row: DraftRow = { id: '新行', data, inserted: true, deleted: false };
    expect(collectChanges([row])).toEqual([{ kind: 'insert', values: {} }]); expect(Object.keys(row.data)).toEqual([]);
  });
  it('真实自有同名 NULL、BLOB、大整数及小数按原值读取，继承的伪造列被忽略', () => {
    const binary = { type: 'binary' as const, base64: 'AP8=' }; const data = Object.fromEntries([['__proto__', binary], ['constructor', null], ['toString', '18446744073709551615'], ['valueOf', '0.10000000000000000001']]);
    expect(ownCell(data, '__proto__')).toBe(binary); expect(cellPreview(ownCell(data, '__proto__'))).toBe('0x00ff'); expect(ownCell(data, 'constructor')).toBeNull();
    expect(cellText(ownCell(data, 'toString'))).toBe('18446744073709551615'); expect(cellText(ownCell(data, 'valueOf'))).toBe('0.10000000000000000001');
    const inherited = Object.create({ __proto__: null, constructor: binary, inherited: '不能当作数据库值' }) as DataRow;
    expect(ownCell(inherited, 'constructor')).toBeUndefined(); expect(ownCell(inherited, 'inherited')).toBeUndefined();
  });
  it('内部复制分开 DEFAULT、NULL、空文本与同名字段，外部空值仍为文本', () => {
    const row: DataRow = {}; const cells = [[ownCell(row, '__proto__'), ownCell(row, 'constructor'), null, '', '默认值', { type: 'binary' as const, base64: 'AP8=' }]];
    const encoded = encodeClipboard(cells); expect(decodeClipboard(encoded.typed, encoded.text)).toEqual(cells);
    const payload = JSON.parse(encoded.typed); expect(payload.version).toBe(1); expect(payload.rows[0].slice(0, 4)).toEqual([{ type: 'default' }, { type: 'default' }, null, '']);
    expect(encoded.text).toBe('\t\tNULL\t\t默认值\t0x00ff'); expect(decodeClipboard('', encoded.text)[0].slice(0, 4)).toEqual(['', '', 'NULL', '']);
    expect(decodeClipboard('', '\tNULL')).toEqual([['', 'NULL']]); expect(decodeClipboard('', '默认值')).toEqual([['默认值']]);
  });
  it('DEFAULT 粘贴到新增行删除 Own 字段，保留其余值且不触发原型 setter', () => {
    const data = Object.fromEntries([['__proto__', '原自有值'], ['constructor', '原构造列'], ['note', '保留草稿']]);
    const row: DraftRow = { id: '新行', data, inserted: true, deleted: false };
    const next = pasteCells([row], ['__proto__', 'constructor'], row.id, '__proto__', [[undefined, null]], new Set());
    expect(Object.hasOwn(next[0].data, '__proto__')).toBe(false); expect(ownCell(next[0].data, '__proto__')).toBeUndefined(); expect(ownCell(next[0].data, 'constructor')).toBeNull(); expect(next[0].data.note).toBe('保留草稿');
    expect(Object.getPrototypeOf(next[0].data)).toBe(Object.prototype); expect(ownCell(row.data, '__proto__')).toBe('原自有值');
    expect(collectChanges(next)).toEqual([{ kind: 'insert', values: { constructor: null, note: '保留草稿' } }]);
  });
  it('实际同名值粘贴使用安全计算属性，BLOB 独立复制且精准文字保持', () => {
    const row: DraftRow = { id: '新行', data: {}, inserted: true, deleted: false }; const binary = { type: 'binary' as const, base64: 'AP8=' };
    const next = pasteCells([row], ['__proto__', 'constructor', 'valueOf'], row.id, '__proto__', [[binary, '18446744073709551615', '12.00000000000000000001']], new Set());
    expect(Object.hasOwn(next[0].data, '__proto__')).toBe(true); expect(ownCell(next[0].data, '__proto__')).toEqual(binary); expect(ownCell(next[0].data, '__proto__')).not.toBe(binary);
    expect(ownCell(next[0].data, 'constructor')).toBe('18446744073709551615'); expect(ownCell(next[0].data, 'valueOf')).toBe('12.00000000000000000001'); expect(Object.getPrototypeOf(next[0].data)).toBe(Object.prototype); expect(Object.keys(row.data)).toEqual([]);
    binary.base64 = ''; expect(cellText(ownCell(next[0].data, '__proto__'))).toBe('0x00ff');
  });
  it('DEFAULT 覆盖已有行使整块粘贴失败，不留下前一行或已有草稿的部分修改', () => {
    const rows: DraftRow[] = [{ id: '新增', data: { note: '新增草稿' }, inserted: true, deleted: false }, { id: '已有', data: { constructor: '当前草稿' }, original: { constructor: '服务器值' }, inserted: false, deleted: false }];
    const before = JSON.stringify(rows);
    expect(() => pasteCells(rows, ['constructor'], '新增', 'constructor', [['前一行本可更新'], [undefined]], new Set())).toThrow('默认值只能粘贴到新增行'); expect(JSON.stringify(rows)).toBe(before);
  });
  it('伪造 DEFAULT 携带附加值不能被接纳，生成列仍不能部分粘贴', () => {
    expect(() => decodeClipboard('{"version":1,"rows":[[{"type":"default","value":null}]]}', '')).toThrow();
    const row: DraftRow = { id: '新增', data: {}, inserted: true, deleted: false };
    expect(() => pasteCells([row], ['__proto__', 'constructor'], row.id, '__proto__', [['有效值', undefined]], new Set(['constructor']))).toThrow('生成列'); expect(Object.keys(row.data)).toEqual([]);
  });
});
