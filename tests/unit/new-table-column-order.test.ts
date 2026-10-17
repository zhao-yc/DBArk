import { describe, expect, it } from 'vitest';
import { NewTableColumnOrder } from '../../src/renderer/newTableColumnOrder';

describe('新建表相邻字段重排（纯草稿）', () => {
  it('交换真实列对象，全部属性和按名索引／外键引用保持原值，原数组不变', () => {
    const a = Object.freeze({ name: 'a', type: 'varchar(64)', nullable: true, defaultValue: '', autoIncrement: false, comment: '空串' });
    const b = Object.freeze({ name: 'b', type: 'timestamp(6)', nullable: false, defaultValue: 'CURRENT_TIMESTAMP(6)', autoIncrement: false, comment: '时间' });
    const columns = Object.freeze([a,b]), keys = Object.freeze([{ columns: ['a'] }]), foreign = Object.freeze([{ columns: ['b'], referencedColumns: ['id'] }]);
    const rows = new NewTableColumnOrder<(typeof columns)[number]>(), next = rows.move(columns,b,-1)!;
    expect(next).toEqual([b,a]); expect(next[0]).toBe(b); expect(next[1]).toBe(a); expect(columns).toEqual([a,b]); expect(keys[0].columns).toEqual(['a']); expect(foreign[0].columns).toEqual(['b']);
  });
  it('同名列或编辑中的空列依然有不同身份，改名不重建行身份', () => {
    const rows = new NewTableColumnOrder<{name:string}>(), a={name:''}, b={name:''};
    expect(rows.key(a)).not.toBe(rows.key(b)); const next=rows.patch([a,b],a,{name:'renamed'})!;
    expect(rows.key(next[0])).toBe(rows.key(a)); expect(next[1]).toBe(b); expect(rows.patch(next,a,{name:'迟到'})).toBeUndefined();
  });
  it('首末边界、未包含的列对象和非法方向不生成新列表', () => {
    const rows=new NewTableColumnOrder<{name:string}>(), a={name:'a'}, b={name:'b'}, columns=[a,b];
    expect(rows.move(columns,a,-1)).toBeUndefined(); expect(rows.move(columns,b,1)).toBeUndefined(); expect(rows.move(columns,{name:'a'},1)).toBeUndefined(); expect(rows.move(columns,a,2 as 1)).toBeUndefined(); expect(columns).toEqual([a,b]);
  });
});
