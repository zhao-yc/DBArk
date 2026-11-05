import { expect, it, vi } from 'vitest';
import { sqliteLayoutPreferencesSchema, sqliteLayoutDocumentSchema, reconcileSqliteLayout, sqliteLayoutProjection } from '../../src/shared/sqliteTableLayout';
import { setTableFrozenThrough } from '../../src/renderer/tableColumnPreferences';
import { SqliteTableLayoutController } from '../../src/renderer/sqliteTableLayout';
import type { SqliteLayoutSnapshot } from '../../src/shared/sqliteTableLayout';

const preferences = { version: 1 as const, columns: [{ name: 'B', hidden: false, width: 200 }, { name: 'A', hidden: true }, { name: '__proto__', hidden: false }], frozenThrough: 'B' };
const target = { connectionId: 'sqlite', database: 'main' as const, table: '对象' }, snapshot: SqliteLayoutSnapshot = { version: 1, target, revision: 0, preferences, connectionDigest: 'a'.repeat(64), source: { connectionRevision: 1, connectionDigest: 'a'.repeat(64) }, bindingToken: '11111111-1111-4111-8111-111111111111' };
it('准确名称调和、隐藏、新增字段和冻结显示映射，不改变原字段次序或行数据', () => {
  const names = ['A', 'B', '__proto__', '新列']; expect(sqliteLayoutProjection(names, preferences)).toEqual([{ index: 1, width: 200, frozen: true }, { index: 2, frozen: false }, { index: 3, frozen: false }]);
  expect(reconcileSqliteLayout(['b', '__proto__'], preferences)).toEqual({ version: 1, columns: [{ name: '__proto__', hidden: false }, { name: 'b', hidden: false }] });
  expect(names).toEqual(['A', 'B', '__proto__', '新列']);
});
it('512字符Unicode名称和明确宽度，旧MySQL冻结长度门保持256', () => {
  const name = '列'.repeat(512), p = { version: 1 as const, columns: [{ name, hidden: false, width: 64 }] };
  expect(() => sqliteLayoutPreferencesSchema.parse({ ...p, frozenThrough: name })).not.toThrow(); expect(() => setTableFrozenThrough(p, name)).toThrow(); expect(setTableFrozenThrough(p, name, 512).frozenThrough).toBe(name);
  for (const value of [{ ...p, columns: [{ name: '\ud800', hidden: false }] }, { ...p, columns: [{ name: 'a', hidden: true }] }, { ...p, frozenThrough: 'missing' }, { ...p, columns: [{ name, hidden: false, width: 63 }] }]) expect(() => sqliteLayoutPreferencesSchema.parse(value)).toThrow();
});
it('自有描述符和稠密预算在getter执行前拒绝，不接受SQL或路径字段', () => {
  const getter = vi.fn(() => preferences.columns), bad = { version: 1, get columns() { return getter(); } }; expect(() => sqliteLayoutPreferencesSchema.parse(bad)).toThrow(); expect(getter).not.toHaveBeenCalled();
  expect(() => sqliteLayoutDocumentSchema.parse({ ...snapshot, source: undefined, bindingToken: undefined })).toThrow();
  for (const extra of [{ sql: 'SELECT 1' }, { filePath: 'private.sqlite' }]) expect(() => sqliteLayoutPreferencesSchema.parse({ ...preferences, ...extra })).toThrow();
});
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
/** 仅RAM异步端口；真实SQLite/IPC/窗口另验，不模拟保存成功来证明落盘。 */
function fixture() {
  const state = { key: {}, active: true, names: ['A', 'B', '__proto__'] }, release = vi.fn(), changed = vi.fn(), get = vi.fn(async () => structuredClone(snapshot)), save = vi.fn(async (_input: unknown) => ({ ...structuredClone(snapshot), revision: 1 })), reset = vi.fn(async (_input: unknown) => ({ ...structuredClone(snapshot), revision: 1, preferences: null, connectionDigest: undefined }));
  const controller = new SqliteTableLayoutController({ scope: () => ({ key: state.key, target, names: state.names, current: () => state.active }), changed, get, save, reset, acquire: () => ({ release }) });
  return { controller, state, get, save, reset, release, changed };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
it('方案布局只改当前显示，按新页字段调和并可重读独立布局', async () => {
  const f = fixture(); f.controller.activate(); await flush();
  f.controller.set({ version: 1, columns: preferences.columns });
  f.controller.applyPreset({ version: 1, columns: [{ name: 'B', hidden: false, width: 305 }, { name: '已删', hidden: false }], frozenThrough: 'B' }, ['B', '新增']);
  expect(f.controller.view).toMatchObject({ fromPreset: true, dirty: false, preferences: { columns: [{ name: 'B', hidden: false, width: 305 }, { name: '新增', hidden: false }], frozenThrough: 'B' } });
  expect(f.save).not.toHaveBeenCalled();
  await f.controller.reload();
  expect(f.controller.view.fromPreset).toBeUndefined();
  expect(f.controller.view.preferences).toEqual(preferences);
});
it('自动恢复只get一次，分页不重置；调整、保存、重置只操作本机并释放准确租约', async () => {
  const f = fixture(); f.controller.activate(); await flush(); expect(f.get).toHaveBeenCalledTimes(1); expect(f.controller.view).toMatchObject({ ready: true, dirty: false, preferences });
  f.controller.sync(); expect(f.get).toHaveBeenCalledTimes(1); f.controller.set({ version: 1, columns: preferences.columns });
  await f.controller.persist(); expect(f.save.mock.calls[0][0]).toMatchObject({ ...target, expectedRevision: 0, bindingToken: snapshot.bindingToken }); expect(f.release).toHaveBeenCalledOnce(); expect(f.controller.view.dirty).toBe(false);
  await f.controller.persist(true); expect(f.controller.view.preferences.columns.every(column => !column.hidden)).toBe(true); expect(f.release).toHaveBeenCalledTimes(2);
});
it('连接摘要变化不自动套用旧布局，显示错误且明确保存才能重签来源', async () => {
  const f = fixture(); f.get.mockResolvedValueOnce({ ...snapshot, source: { ...snapshot.source, connectionDigest: 'b'.repeat(64) } }); f.controller.activate(); await flush();
  expect(f.controller.view.preferences.columns.map(column => column.name)).toEqual(f.state.names); expect(f.controller.view.preferences.columns.every(column => !column.hidden)).toBe(true); expect(f.controller.view.error).toContain('连接文件');
});
it('分页和刷新过渡的空字段列表保原布局及dirty，回到同结构不重读本机或恢复默认', async () => {
  const f = fixture(); f.controller.activate(); await flush(); const saved = f.controller.view.preferences;
  f.state.names = []; f.controller.sync(); expect(f.controller.view.preferences).toBe(saved); expect(f.controller.view.ready).toBe(true);
  f.state.names = ['A', 'B', '__proto__']; f.controller.sync(); expect(f.controller.view.preferences).toBe(saved); expect(f.get).toHaveBeenCalledTimes(1);
  f.controller.set({ version: 1, columns: preferences.columns }); const dirty = f.controller.view.preferences; f.state.names = []; f.controller.sync(); expect(f.controller.view.preferences).toBe(dirty); expect(f.controller.view.dirty).toBe(true);
});
it.each(['route', 'unmount'] as const)('%s后原读取不覆盖后继布局', async mode => {
  const f = fixture(), pending = deferred<SqliteLayoutSnapshot>(); f.get.mockImplementationOnce(() => pending.promise); f.controller.activate();
  if (mode === 'route') { f.state.key = {}; f.controller.sync(); await flush(); } else f.controller.dispose();
  const count = f.changed.mock.calls.length; pending.resolve({ ...snapshot, preferences: { version: 1, columns: [{ name: 'A', hidden: false }] } }); await flush(); expect(f.changed.mock.calls.length).toBe(count);
});
it('保存冲突保持原显示和dirty，不自动重试；结构调和保新字段与全隐藏回退', async () => {
  const f = fixture(); f.controller.activate(); await flush(); f.controller.set({ version: 1, columns: [...preferences.columns] }); f.save.mockRejectedValueOnce(Error('CAS冲突')); await f.controller.persist(); expect(f.save).toHaveBeenCalledTimes(1); expect(f.controller.view).toMatchObject({ dirty: true, error: 'CAS冲突' });
  f.state.names = ['新字段']; f.controller.sync(); expect(f.controller.view.preferences.columns).toEqual([{ name: '新字段', hidden: false }]);
});
