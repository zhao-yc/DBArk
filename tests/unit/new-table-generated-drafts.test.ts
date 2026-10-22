import { describe, expect, it } from 'vitest';
import { NewTableGeneratedDrafts } from '../../src/renderer/newTableGeneratedDrafts';
import type { TableCreateDraft } from '../../src/shared/tableCreate';

type Column = TableCreateDraft['columns'][number];
const ordinary = (): Column => ({ name: 'amount', type: 'varchar(255)', nullable: false, autoIncrement: false, comment: '原备注' });
describe('新表生成列模式的原普通草稿备份（仅RAM）', () => {
  it.each(['absent', 'undefined', 'empty', 'null', 'literal-null'] as const)('切回普通准确恢复%s默认键，不混入生成属性', mode => {
    const drafts = new NewTableGeneratedDrafts(), original = ordinary();
    if (mode !== 'absent') original.defaultValue = mode === 'undefined' ? undefined : mode === 'empty' ? '' : mode === 'null' ? null : 'NULL';
    original.onUpdate = undefined;
    const generated = drafts.switch(original, 'VIRTUAL');
    expect(generated).toMatchObject({ type: 'decimal(30,6)', nullable: true, autoIncrement: false, generated: { storage: 'VIRTUAL', expression: '' } });
    expect(Object.hasOwn(generated, 'defaultValue')).toBe(false); expect(Object.hasOwn(generated, 'onUpdate')).toBe(false);
    const edited = { ...generated, name: 'renamed', comment: '新备注', generated: { storage: 'STORED' as const, expression: '2.00 + 3' } };
    drafts.transfer(generated, edited);
    const restored = drafts.switch(edited, 'ordinary');
    expect(restored).toEqual({ ...original, name: 'renamed', comment: '新备注' });
    expect(Object.hasOwn(restored, 'defaultValue')).toBe(mode !== 'absent'); expect(Object.hasOwn(restored, 'onUpdate')).toBe(true); expect(Object.hasOwn(restored, 'generated')).toBe(false);
    expect(drafts.switch(restored, 'VIRTUAL').generated).toEqual({ storage: 'VIRTUAL', expression: '2.00 + 3' });
  });
  it('两列备份独立，普通列类型及时间默认属性不会串行', () => {
    const drafts = new NewTableGeneratedDrafts(), first = { ...ordinary(), type: 'decimal(20,4)', defaultValue: '0.0000' }, second: Column = { ...ordinary(), name: 'clock', type: 'datetime(3)', defaultValue: 'CURRENT_TIMESTAMP(3)', onUpdate: { kind: 'expression', expression: 'current-timestamp', precision: 3 } };
    const a = drafts.switch(first, 'VIRTUAL'), b = drafts.switch(second, 'STORED');
    expect(a.type).toBe('decimal(20,4)'); expect(b.type).toBe('decimal(30,6)');
    expect(drafts.switch(a, 'ordinary')).toEqual(first); expect(drafts.switch(b, 'ordinary')).toEqual(second);
  });
});
