import { describe, expect, it } from 'vitest';
import type { AppSettings } from '../../src/shared/contracts';
import { TabOrderRegistry, type TabOrderMove } from '../../src/renderer/tabOrder';

type Tab = AppSettings['tabs'][number];
const query = (id: string, patch: Partial<Tab> = {}): Tab => ({ id, kind: 'query', title: '同名查询', connectionId: 'c', sql: '原SQL', ...patch });
const table = (id: string, database = 'db', connectionId = 'c'): Tab => ({ id, kind: 'table', title: '同名表', connectionId, database, table: 'subject' });

describe('标签重排的本地身份与纯顺序模型', () => {
  it('按strip顺序移动准确原对象，同名跨连接/库不按名称回退', () => {
    const a = query('a'), b = query('b', { connectionId: 'other' }), c = table('c'), d = table('d', 'other', 'other');
    const tabs = [a, b, c, d], registry = new TabOrderRegistry(), refs = registry.snapshot(tabs);
    const moved = registry.move(refs[2], { kind: 'relative', target: refs[0], placement: 'before' }, tabs)!;
    expect(moved).toEqual([c, a, b, d]); expect(moved[0]).toBe(c); expect(moved[2]).toBe(b); expect(tabs).toEqual([a, b, c, d]); expect(registry.resolve(refs[2], moved)).toBe(c);
  });
  it.each([
    ['left', ['b', 'a', 'c']], ['right', ['a', 'c', 'b']], ['first', ['b', 'a', 'c']], ['last', ['a', 'c', 'b']],
  ] as const)('方向%s从当前数组移动，不携带旧列表', (direction, ids) => {
    const tabs = [query('a'), query('b'), query('c')], registry = new TabOrderRegistry(), ref = registry.snapshot(tabs)[1];
    expect(registry.move(ref, { kind: 'direction', direction }, tabs)?.map(tab => tab.id)).toEqual(ids);
  });
  it('相对after正确扣除来源原位置，邻位同位/自身/边界均不产生数组', () => {
    const tabs = [query('a'), query('b'), query('c')], registry = new TabOrderRegistry(), refs = registry.snapshot(tabs);
    expect(registry.move(refs[0], { kind: 'relative', target: refs[2], placement: 'after' }, tabs)).toEqual([tabs[1], tabs[2], tabs[0]]);
    expect(registry.move(refs[0], { kind: 'relative', target: refs[1], placement: 'before' }, tabs)).toBeUndefined();
    expect(registry.move(refs[1], { kind: 'relative', target: refs[0], placement: 'after' }, tabs)).toBeUndefined();
    expect(registry.move(refs[1], { kind: 'relative', target: refs[1], placement: 'before' }, tabs)).toBeUndefined();
    expect(registry.move(refs[0], { kind: 'direction', direction: 'left' }, tabs)).toBeUndefined(); expect(registry.move(refs[2], { kind: 'direction', direction: 'last' }, tabs)).toBeUndefined();
  });
  it('仅正式continuation允许SQL/标题及同源摘要/修订编辑沿用令牌，解析始终返回最新对象', () => {
    const registry = new TabOrderRegistry(), a = query('a', { sourceBinding: { id: 'saved', digest: 'a'.repeat(64), context: { state: 'known', database: null } } }), ref = registry.snapshot([a])[0];
    const b = { ...a, title: '修改标题', sql: '最新SQL', sourceBinding: { ...a.sourceBinding!, digest: 'b'.repeat(64) } };
    const release = registry.continueUpdate(a, b); registry.observe([b]); release(); expect(registry.resolve(ref, [b])).toBe(b);
    const file = query('file', { fileSourceBinding: { id: '11111111-1111-4111-8111-111111111111', revision: 1 } }), fileRef = registry.snapshot([b, file])[1];
    const newer = { ...file, sql: '最新文件正文', fileSourceBinding: { ...file.fileSourceBinding!, revision: 2 } }; registry.continueUpdate(file, newer); registry.observe([b, newer]); expect(registry.resolve(fileRef, [b, newer])).toBe(newer);
  });
  it('generic同id新对象即使SQL/标题相同也不能复用令牌，删除后同对象重加也拒旧ref', () => {
    const registry = new TabOrderRegistry(), a = query('a'), ref = registry.snapshot([a])[0], same = { ...a };
    expect(registry.resolve(ref, [same])).toBeUndefined(); const second = registry.snapshot([same])[0]; registry.observe([]); registry.observe([same]); expect(registry.resolve(second, [same])).toBeUndefined();
    const third = registry.snapshot([same])[0]; registry.reset(); expect(registry.resolve(third, [same])).toBeUndefined();
  });
  it('未完成更新的continuation撤销后不能借未来泛设置复用旧令牌', () => {
    const registry = new TabOrderRegistry(), original = query('a'), ref = registry.snapshot([original])[0], next = { ...original, sql: '尚未提交' };
    const release = registry.continueUpdate(original, next); release(); expect(registry.resolve(ref, [next])).toBeUndefined();
  });
  it.each([
    { connectionId: 'other' }, { database: 'other' }, { databaseContext: { state: 'known', database: null } }, { databaseContext: { state: 'unknown' } },
    { sourceBinding: { id: 'other-saved', digest: 'a'.repeat(64), context: { state: 'legacy' } } }, { fileSourceBinding: { id: '22222222-2222-4222-8222-222222222222', revision: 1 } },
  ] as Partial<Tab>[])('正式update也不能让换绑%j后的A→B→A复活', patch => {
    const registry = new TabOrderRegistry(), a = query('a'), ref = registry.snapshot([a])[0], b = { ...a, ...patch };
    registry.continueUpdate(a, b); registry.observe([b]); registry.continueUpdate(b, a); registry.observe([a]); expect(registry.resolve(ref, [a])).toBeUndefined();
  });
  it('表database/table和kind变更是新目标，准确相对目标旧ref也会拒绝', () => {
    const registry = new TabOrderRegistry(), a = query('a'), b = table('b'), [source, target] = registry.snapshot([a, b]);
    const replaced = { ...b, table: 'other' }; registry.continueUpdate(b, replaced); registry.observe([a, replaced]);
    expect(registry.move(source, { kind: 'relative', target, placement: 'after' }, [a, replaced])).toBeUndefined();
    const newRef = registry.snapshot([a, replaced])[1]; const different = query('b'); registry.continueUpdate(replaced, different); expect(registry.resolve(newRef, [a, different])).toBeUndefined();
  });
  it('100混合标签完整有界；超限、重复或稀疏组先撤销旧ref且不返回部分列表', () => {
    const registry = new TabOrderRegistry(), tabs = Array.from({ length: 100 }, (_, index) => index % 2 ? query(String(index)) : table(String(index))), first = registry.snapshot(tabs)[0];
    expect(registry.snapshot(tabs)).toHaveLength(100); expect(() => registry.snapshot([...tabs, query('extra')])).toThrow(); expect(registry.resolve(first, tabs)).toBeUndefined();
    const next = registry.snapshot(tabs)[0]; expect(() => registry.snapshot([tabs[0], tabs[0]])).toThrow(); expect(registry.resolve(next, tabs)).toBeUndefined();
    const sparse = new Array<Tab>(2); sparse[0] = tabs[0]; expect(() => registry.snapshot(sparse)).toThrow();
  });
  it('不读取或hash SQL/title/摘要getter，也不执行数组自定义迭代器', () => {
    let reads = 0; const a = query('__proto__'); Object.defineProperty(a, 'sql', { enumerable: true, get() { reads++; throw Error('禁止读取正文'); } }); Object.defineProperty(a, 'title', { enumerable: true, get() { reads++; throw Error('禁止读取标题'); } });
    const binding = { id: 'constructor', digest: 'a'.repeat(64), context: { state: 'legacy' as const } }; Object.defineProperty(binding, 'digest', { enumerable: true, get() { reads++; throw Error('禁止摘要'); } }); a.sourceBinding = binding;
    const tabs = [a, query('constructor')]; Object.defineProperty(tabs, Symbol.iterator, { value() { reads++; throw Error('禁止自定义迭代器'); } });
    const registry = new TabOrderRegistry(), refs = registry.snapshot(tabs); expect(refs.map(ref => Object.keys(ref))).toEqual([['id', 'token'], ['id', 'token']]); expect(registry.resolve(refs[0], tabs)).toBe(a); expect(registry.move(refs[0], { kind: 'direction', direction: 'last' }, tabs)?.[1]).toBe(a); expect(reads).toBe(0);
  });
  it('ref与move的访问器/伪造token无权消费真实目标', () => {
    const registry = new TabOrderRegistry(), tabs = [query('a'), query('b')], refs = registry.snapshot(tabs); let reads = 0;
    const bad = Object.defineProperty({ token: refs[0].token }, 'id', { enumerable: true, get() { reads++; return 'a'; } });
    expect(registry.resolve(bad as typeof refs[0], tabs)).toBeUndefined(); expect(registry.resolve({ id: 'a', token: {} }, tabs)).toBeUndefined();
    const move = Object.defineProperty({ kind: 'direction' }, 'direction', { enumerable: true, get() { reads++; return 'last'; } }); expect(registry.move(refs[0], move as TabOrderMove, tabs)).toBeUndefined(); expect(reads).toBe(0);
  });
});
