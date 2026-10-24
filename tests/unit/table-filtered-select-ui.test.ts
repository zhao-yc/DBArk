import { describe, expect, it } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { TableFilteredSelectIntent } from '../../src/renderer/tableFilteredSelectUi';

const info = (): TableInfo => ({ database: '库`?', name: '表\n?', objectKind: 'table', engine: 'InnoDB', columns: [{ name: 'id', type: 'BIGINT UNSIGNED', nullable: false, generated: false, defaultValue: null, extra: '', comment: '' }, { name: '__proto__', type: 'TEXT', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' }], indexes: [], primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], ddl: '' });

describe('筛选SELECT原范围租约（纯本地，无IPC）', () => {
  it('完整深快照保原值与字段顺序，不从行草稿取参数', () => {
    const source = info(), scope = { filters: [{ column: 'id', operator: '>=' as const, value: '9007199254740993' }], filterMode: 'all' as const, sort: [{ column: 'id', direction: 'DESC' as const }] };
    const intent = new TableFilteredSelectIntent(source, scope, 123, [source, scope], () => true);
    scope.filters[0].value = '0'; source.columns[0].type = 'TEXT';
    const result = intent.compile(['__proto__', 'id']); expect(result.parameters).toBe(0); expect(result.sql).toContain('SELECT `__proto__`, `id`'); expect(result.sql).toContain('`库``?`.`表\n?`'); expect(result.sql).toContain('UNSIGNED'); expect(result.sql).toContain('LIMIT 123;'); expect(result.sql).not.toContain('OFFSET');
    expect(Object.isFrozen(intent.readScope.filters[0])).toBe(true); expect(Object.isFrozen(intent.info.columns)).toBe(true);
  });
  it('来源与观察身份变化永久失效，ABA不复活；只有一次consume', () => {
    let valid = true; const source = info(), identity = {}, intent = new TableFilteredSelectIntent(source, { filters: [], sort: [] }, 1000, [identity], () => valid);
    expect(intent.current()).toBe(true); valid = false; expect(intent.current()).toBe(false); valid = true; expect(() => intent.compile(['id'])).toThrow('变化'); expect(intent.consume()).toBe(false);
    const second = new TableFilteredSelectIntent(source, { filters: [], sort: [] }, 1000, [identity], () => true); second.observe([{}]); second.observe([identity]); expect(second.current()).toBe(false);
    const third = new TableFilteredSelectIntent(source, { filters: [], sort: [] }, 1000, [], () => true); expect(third.consume()).toBe(true); expect(third.consume()).toBe(false); expect(() => third.compile(['id'])).toThrow();
  });
  it('字段、上限和完整条件由真实共享编译器拒绝，不静默裁剪', () => {
    const source = info(), intent = new TableFilteredSelectIntent(source, { filters: [], sort: [] }, 100000, [], () => true);
    expect(() => intent.compile([])).toThrow(); expect(() => intent.compile(['id', 'id'])).toThrow(); expect(() => intent.compile(['missing'])).toThrow();
    expect(() => new TableFilteredSelectIntent(source, { filters: [], sort: [] }, 100001, [], () => true)).toThrow();
    expect(() => new TableFilteredSelectIntent(source, { filters: [{ column: 'missing', operator: '=', value: '1', enabled: false }], sort: [] }, 1000, [], () => true)).toThrow();
  });
});
