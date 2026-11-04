import { expect, it } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { sqliteRowDetailPageOffset, SqliteRowDetailPageNavigation } from '../../src/renderer/sqliteRowDetailPageNavigation';
import { queryRowDetailsZh as text } from '../../src/renderer/locales/queryRowDetails.zh-CN';

/** 合成只读页不含编辑快照，模型没有数据库、文件或IPC端口。 */
function page(offset = 0, kind: 'table' | 'view' = 'table'): SqliteTablePage {
  return { target: { connectionId: 'c', database: 'main', table: '只读🚢', kind }, schemaKey: 'a'.repeat(64), offset, limit: 2, hasMore: offset < 4,
    columns: [{ name: '数值', declaredType: '' }], storageTypes: ['i', 't'],
    result: { columns: [{ key: 'c0', name: '数值', type: 'SQLITE' }], rows: [{ c0: '9223372036854775807' }, { c0: '2' }], elapsedMs: 0, statement: '', truncated: false } };
}
const view = (page?: SqliteTablePage, busy = false, error = '', stopping = false) => ({ page, busy, error, stopping, columns: page?.columns ?? [] });

it.each(['table', 'view'] as const)('%s只在准确首末行跨页，首页末页与无效位置拒绝', kind => {
  const source = page(2, kind);
  expect(sqliteRowDetailPageOffset(source, 0, -1)).toBe(0); expect(sqliteRowDetailPageOffset(source, 1, 1)).toBe(4);
  expect(sqliteRowDetailPageOffset(source, 0, 1)).toBeUndefined(); expect(sqliteRowDetailPageOffset(source, 1, -1)).toBeUndefined();
  for (const index of [-1, 2, 0.5, NaN]) expect(sqliteRowDetailPageOffset(source, index, 1)).toBeUndefined();
  expect(sqliteRowDetailPageOffset(page(0), 0, -1)).toBeUndefined(); expect(sqliteRowDetailPageOffset(page(4), 1, 1)).toBeUndefined();
  expect(sqliteRowDetailPageOffset(source, 1, NaN as 1)).toBeUndefined();
  source.offset = Number.MAX_SAFE_INTEGER; expect(sqliteRowDetailPageOffset(source, 1, 1)).toBeUndefined();
  source.offset = 0; source.limit = 0; expect(sqliteRowDetailPageOffset(source, 1, 1)).toBeUndefined();
});
it.each([1, -1] as const)('方向%s只消费准确终态新页一次，旧页或同值克隆不冒领', direction => {
  const source = page(2), intent = new SqliteRowDetailPageNavigation(source, direction === 1 ? 1 : 0, direction, () => true), next = page(direction === 1 ? 4 : 0);
  intent.observe(view(undefined, true)); intent.observe(view(next, true)); expect(intent.consume(next)).toBeUndefined();
  intent.observe(view(next)); expect(intent.consume({ ...next })).toBeUndefined();
  expect(intent.consume(next)).toBe(direction === 1 ? 0 : 1); expect(intent.consume(next)).toBeUndefined();
  expect(next.result.rows[0].c0).toBe('9223372036854775807');
});
it.each(['offset', 'limit', 'schema', 'kind', 'target', 'column', 'result-column', 'missing', 'error', 'stopping', 'empty', 'editable'] as const)('%s终态不自动打开、不扫描其它页', mode => {
  const source = page(), intent = new SqliteRowDetailPageNavigation(source, 1, 1, () => true), next = page(2), received = view(next);
  if (mode === 'offset') next.offset = 4; if (mode === 'limit') next.limit = 3; if (mode === 'schema') next.schemaKey = 'b'.repeat(64);
  if (mode === 'kind') next.target.kind = 'view'; if (mode === 'target') next.target.table = '其它表';
  if (mode === 'column') next.columns[0].declaredType = 'TEXT'; if (mode === 'result-column') next.result.columns[0].key = '另一键';
  if (mode === 'missing') received.page = undefined; if (mode === 'error') received.error = '真实错误'; if (mode === 'stopping') received.stopping = true;
  if (mode === 'empty') next.result.rows = []; if (mode === 'editable') next.edit = { kind: 'editable' } as SqliteTablePage['edit'];
  intent.observe(received); expect(intent.current()).toBe(false); expect(intent.consume(next)).toBeUndefined();
  if (mode === 'empty') expect(intent.message).toBe(text.sqlitePageEmpty);
  if (mode === 'error') expect(intent.message).toBe('真实错误');
  if (mode === 'stopping') expect(intent.message).toBe(text.sqlitePageStopped);
});
it('来源与环境ABA永久撤权；可编辑页及空页不能创建只读意图', () => {
  let current = true; const source = page(), intent = new SqliteRowDetailPageNavigation(source, 1, 1, () => current);
  current = false; expect(intent.current()).toBe(false); current = true; expect(intent.current()).toBe(false);
  const changed = new SqliteRowDetailPageNavigation(source, 1, 1, () => true); source.offset = 2; expect(changed.current()).toBe(false); source.offset = 0; expect(changed.current()).toBe(false);
  source.edit = { kind: 'editable' } as SqliteTablePage['edit']; expect(() => new SqliteRowDetailPageNavigation(source, 1, 1, () => true)).toThrow(text.sqlitePageUnavailable);
  delete source.edit; source.result.rows = []; expect(() => new SqliteRowDetailPageNavigation(source, 0, 1, () => true)).toThrow(text.sqlitePageUnavailable);
});
