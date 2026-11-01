import { expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteTableQuery } from '../../src/renderer/sqliteTableBrowser';
import { SqliteFilteredSelectIntent } from '../../src/renderer/sqliteFilteredSelectUi';

/** 真实冻结、编译与opaque计划；page.result/edit为抛错getter，证明不是用当前样本生成SQL。 */
function fixture() {
  const page: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: '表?"🚢', kind: 'view' }, schemaKey: 'b'.repeat(64), columns: [{ name: 'id', declaredType: 'INTEGER' }, { name: 'memo', declaredType: 'TEXT' }], offset: 200, limit: 100, hasMore: true, result: {} as SqliteTablePage['result'] };
  const rows = vi.fn(() => { throw Error('不得读取原行或原编辑快照'); }); Object.defineProperties(page, { result: { enumerable: true, get: rows }, edit: { enumerable: true, get: rows } });
  const query: SqliteTableQuery = { limit: 100, mode: 'or', filters: [{ column: 'id', operator: 'gte', value: { kind: 'integer', value: '9007199254740993' } }], sort: [{ column: 'memo', direction: 'asc' }, { column: 'id', direction: 'desc' }] }, alive = { value: true }, guard = vi.fn(() => alive.value), intent = new SqliteFilteredSelectIntent(page, query, guard);
  return { page, query, alive, guard, intent, rows };
}
it('构造不调用外层尚未登记guard，不读原页；只冻结元数据／applied且默认无分页', () => {
  const f = fixture(); expect(f.guard).not.toHaveBeenCalled(); const plan = f.intent.compile(['memo', 'id']); expect(plan.sql).toContain('9007199254740993'); expect(plan.sql).not.toMatch(/OFFSET|LIMIT/); expect(f.intent.defaultLimit).toBe(100); expect(f.rows).not.toHaveBeenCalled(); expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.columns)).toBe(true); expect(Object.isFrozen(f.intent.target)).toBe(true); expect(f.intent.consume(plan)).toBe(true); expect(f.intent.current()).toBe(false); expect(f.intent.consume(plan)).toBe(false);
});
it('最新计划单次消费，复制或跨Intent以及旧预览都拒绝但不消费合法新plan', () => {
  const f = fixture(), old = f.intent.compile(['id']), plan = f.intent.compile(['memo'], 10), other = fixture(); expect(f.intent.consume(old)).toBe(false); expect(f.intent.consume({ ...plan })).toBe(false); expect(other.intent.consume(plan)).toBe(false); expect(f.intent.consume(plan)).toBe(true); expect(() => f.intent.compile(['id'])).toThrow(); expect(f.rows).not.toHaveBeenCalled();
});
it.each(['guard', 'target', 'target-ref', 'column-name', 'column-ref', 'columns-ref', 'schema', 'query-mode', 'filter-value', 'filter-ref', 'filters-ref', 'sort-direction', 'sort-ref', 'sorts-ref', 'query-limit'] as const)('%s变化留下永久墓碑，原对象恢复不复活', change => {
  const f = fixture(), plan = f.intent.compile(['id']), oldTarget = f.page.target, oldColumns = f.page.columns, filter = f.query.filters[0], sorts = f.query.sort;
  if (change === 'guard') f.alive.value = false;
  if (change === 'target') f.page.target.table = 'later';
  if (change === 'target-ref') f.page.target = { ...f.page.target };
  if (change === 'column-name') f.page.columns[0].name = 'later';
  if (change === 'column-ref') f.page.columns[0] = { ...f.page.columns[0] };
  if (change === 'columns-ref') f.page.columns = [...f.page.columns];
  if (change === 'schema') f.page.schemaKey = 'c'.repeat(64);
  if (change === 'query-mode') f.query.mode = 'and';
  if (change === 'filter-value') f.query.filters[0].value!.value = '1';
  if (change === 'filter-ref') f.query.filters[0] = { ...filter };
  if (change === 'filters-ref') f.query.filters = [...f.query.filters];
  if (change === 'sort-direction') f.query.sort[0].direction = 'desc';
  if (change === 'sort-ref') f.query.sort[0] = { ...f.query.sort[0] };
  if (change === 'sorts-ref') f.query.sort = [...f.query.sort];
  if (change === 'query-limit') f.query.limit = 1;
  expect(f.intent.current()).toBe(false); f.alive.value = true; f.page.target = oldTarget; f.page.columns = oldColumns; f.query.filters[0] = filter; f.query.sort = sorts; expect(f.intent.current()).toBe(false); expect(f.intent.consume(plan)).toBe(false); expect(() => f.intent.compile(['id'])).toThrow(); expect(f.rows).not.toHaveBeenCalled();
});
it.each(['', '\0', '\ud800'])('非法目录字段%s在构造时拒绝', name => { const f = fixture(); f.page.columns[0].name = name; expect(() => new SqliteFilteredSelectIntent(f.page, f.query, () => true)).toThrow(); });
it.each(['table', 'column'])('含换行%s名称不能在编辑器中变成另一个对象，明确拒绝打开', target => { const f = fixture(); if (target === 'table') f.page.target.table = 'a\nb'; else f.page.columns[0].name = 'a\rb'; expect(() => new SqliteFilteredSelectIntent(f.page, f.query, () => true)).toThrow(/标识符/); });
it('无效投影/limit撤销旧计划，原意图可经明确修正生成新plan', () => {
  const f = fixture(), old = f.intent.compile(['id']); expect(() => f.intent.compile([])).toThrow(); expect(f.intent.consume(old)).toBe(false); expect(f.intent.current()).toBe(true); expect(() => f.intent.compile(['memo'], 1.5)).toThrow(); expect(f.intent.consume(f.intent.compile(['id'], 3))).toBe(true);
});
it('字段或条件getter不得执行，巨量投影长度先拒，guard异常整份撤销', () => {
  const f = fixture(), getter = vi.fn(() => 'id'), columns = ['id']; Object.defineProperty(columns, 0, { enumerable: true, get: getter }); expect(() => f.intent.compile(columns)).toThrow(); expect(getter).not.toHaveBeenCalled(); const huge: string[] = []; huge.length = 10000000; expect(() => f.intent.compile(huge)).toThrow(); f.guard.mockImplementation(() => { throw Error('原来源异常'); }); expect(f.intent.current()).toBe(false); expect(f.rows).not.toHaveBeenCalled();
});
it('同步guard编译重入时旧compile不发布计划，原source失败仍永久撤权', () => {
  const f = fixture(); let first = true; f.guard.mockImplementation(() => { if (first) { first = false; f.intent.compile(['memo']); } return true; }); expect(() => f.intent.compile(['id'])).toThrow();
});
