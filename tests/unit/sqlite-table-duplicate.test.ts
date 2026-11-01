import { expect, it } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteDraftRow } from '../../src/renderer/sqliteTableEditor';
import { prepareSqliteDuplicate, sqliteDuplicateSourceCurrent } from '../../src/renderer/sqliteTableDuplicate';

/** 覆盖未声明亲和性、生成列、原非有限REAL与精确字节，准备阶段不授予新输入资格。 */
function fixture() {
  const columns = ['id', 'text', 'blob', 'nullable', 'real', 'g', 'defaulted'].map((name, i) => ({ name, declaredType: '', generated: i === 5 }));
  const row: SqliteDraftRow = { id: 'original-0', index: 0, deleted: false, values: [{ kind: 'integer', value: '9223372036854775807' }, { kind: 'text', value: '文本\0🚢' }, { kind: 'blob', value: '00ff' }, { kind: 'null' }, { kind: 'real', value: 'Infinity' }, { kind: 'text', value: '生成值' }, undefined] }, rows = [row];
  const page: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'table' }, schemaKey: 'a'.repeat(64), columns, offset: 0, limit: 100, hasMore: false, result: { columns: columns.map((c, i) => ({ name: c.name, key: 'c' + i, type: 'SQLITE' })), rows: [{}], statement: '', elapsedMs: 0, truncated: false }, edit: { kind: 'editable', snapshotId: 'snapshot', expiresAt: new Date(Date.now() + 300000).toISOString(), columns: columns.map(c => ({ ...c, nullable: true, hasDefault: true })), rows: [row.values.map(v => v ?? { kind: 'null' })], locator: { kind: 'rowid', columns: [] } } };
  return { page, rows, row, prepare: () => prepareSqliteDuplicate(page, rows, row, 'new-input') };
}
it('独立虚拟行保持typed原文，仅生成列省略；不新增原rows、不清主键、不复用原值对象', () => {
  const f = fixture(), before = structuredClone(f.rows), plan = f.prepare();
  expect(f.rows).toEqual(before); expect(plan.row.index).toBeUndefined(); expect(plan.row.deleted).toBe(false); expect(plan.row.id).toBe('new-input'); expect(plan.row.values).toEqual(f.row.values.map((v, i) => i === 5 ? undefined : v)); expect(plan.row.values[0]).not.toBe(f.row.values[0]);
  expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.row)).toBe(true); expect(Object.isFrozen(plan.row.values)).toBe(true); expect(Object.isFrozen(plan.row.values[0])).toBe(true); expect(sqliteDuplicateSourceCurrent(plan, f.page, f.rows)).toBe(true);
});
it('本地新增行也能复制，并保原DEFAULT槽而不填NULL；超过新输入长度的原文可显示供修改', () => {
  const f = fixture(); delete f.row.index; f.row.values[1] = { kind: 'text', value: 'x'.repeat(65537) }; const plan = f.prepare();
  expect(plan.row.values[1]).toEqual(f.row.values[1]); expect(plan.row.values[6]).toBeUndefined(); expect(sqliteDuplicateSourceCurrent(plan, f.page, f.rows)).toBe(true);
});
it.each(['page', 'rows', 'row', 'values', 'deleted', 'id', 'index', 'snapshot', 'expiry', 'schema', 'column', 'generated', 'value-content', 'extra-value'] as const)('来源%s变化撤销资格，名字相同也不能借克隆授权', change => {
  const f = fixture(), plan = f.prepare(); let page = f.page, rows = f.rows;
  if (change === 'page') page = { ...f.page };
  if (change === 'rows') rows = [...f.rows];
  if (change === 'row') f.rows[0] = { ...f.row };
  if (change === 'values') f.row.values = [...f.row.values];
  if (change === 'deleted') f.row.deleted = true;
  if (change === 'id') f.row.id = 'other';
  if (change === 'index') f.row.index = 1;
  if (f.page.edit?.kind === 'editable') { if (change === 'snapshot') f.page.edit.snapshotId = 'other'; if (change === 'expiry') f.page.edit.expiresAt = new Date(0).toISOString(); if (change === 'generated') f.page.edit.columns[1].generated = true; }
  if (change === 'schema') f.page.schemaKey = 'b'.repeat(64);
  if (change === 'column') f.page.columns[0].name = 'other';
  if (change === 'value-content') (f.row.values[1] as { value: string }).value = '后来修改';
  if (change === 'extra-value') Object.defineProperty(f.row.values[1], 'extra', { value: true, enumerable: true });
  expect(sqliteDuplicateSourceCurrent(plan, page, rows)).toBe(false); expect(sqliteDuplicateSourceCurrent({ row: plan.row }, f.page, f.rows)).toBe(false);
});
it.each(['readonly', 'deleted', 'missing', 'width', 'sparse', 'generated', 'duplicate-id', 'accessor'] as const)('无效原来源%s在准备阶段拒绝', change => {
  const f = fixture(), getter = () => { throw Error('不应执行访问器'); };
  if (change === 'readonly') f.page.edit = { kind: 'readonly', reason: '只读' };
  if (change === 'deleted') f.row.deleted = true;
  if (change === 'missing') f.rows.length = 0;
  if (change === 'width') f.row.values.pop();
  if (change === 'sparse') delete f.row.values[1];
  if (change === 'generated' && f.page.edit?.kind === 'editable') f.page.edit.columns[1].generated = true;
  if (change === 'duplicate-id') f.row.id = 'new-input';
  if (change === 'accessor') Object.defineProperty(f.row.values, '1', { get: getter, enumerable: true });
  expect(f.prepare).toThrow();
});
