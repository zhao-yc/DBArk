import { afterEach, expect, it, vi } from 'vitest';
import { ImportConflictController, importConflictKeyReason, type ImportConflictSource } from '../../src/renderer/importConflict';

const controllers: ImportConflictController[] = [];
afterEach(() => { controllers.splice(0).forEach(controller => controller.dispose()); vi.useRealTimers(); });
const source = (): ImportConflictSource => ({ identity: '原文件/映射/修订', connectionId: 'c', database: 'db', table: 't', connectionVersion: 1, revision: 1, mapping: { tenant: 'tenant', id: 'id', value: 'value' }, rows: [{ tenant: 'a', id: '1', value: '新值' }] });
const catalog = () => ({ connectionId: 'c', database: 'db', table: 't', schemaHash: 'a'.repeat(64), keys: [{ name: 'PRIMARY', columns: ['tenant', 'id'], reliable: true }] });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture(readImplementation: (source: ImportConflictSource, taskId: string) => Promise<unknown> = async () => catalog(), timeoutMs = 15000) {
  const target = source(), publish = vi.fn(), open = vi.fn(async () => {}), read = vi.fn(readImplementation), cancel = vi.fn(async (_id: string) => {}), cancelFailure = vi.fn(), uid = vi.fn(() => '目录任务'); let current = true;
  const controller = new ImportConflictController({ current: value => current && value.identity === target.identity, open, read, cancel, cancelFailure, uid, timeoutMs }, publish); controllers.push(controller);
  return { controller, publish, open, read, cancel, cancelFailure, uid, target, invalidate() { current = false; controller.reset(); } };
}
it('默认不建连或读目录，显式非默认才读取且不自动选首键', async () => {
  const f = fixture(); expect(f.controller.selection(f.target, f.controller.snapshot())).toBeUndefined(); expect(f.read).not.toHaveBeenCalled();
  await f.controller.chooseMode(f.target, 'upsert', f.controller.snapshot()); expect(f.read).toHaveBeenCalledExactlyOnceWith(f.target, '目录任务'); expect(f.controller.canExecute(f.target, f.controller.snapshot())).toBe(false);
  f.controller.chooseKey(f.target, 'PRIMARY', f.controller.snapshot()); expect(f.controller.selection(f.target, f.controller.snapshot())).toEqual({ mode: 'upsert', schemaHash: 'a'.repeat(64), key: { name: 'PRIMARY', columns: ['tenant', 'id'] } });
});
it('完整复合键映射、非NULL样本及非键更新列分别核验，不比较主机键值相等', () => {
  const target = source(), key = catalog().keys[0]; expect(importConflictKeyReason(target, key, 'upsert')).toBeUndefined();
  expect(importConflictKeyReason({ ...target, mapping: { id: 'id', value: 'value' } }, key, 'upsert')).toContain('所有列');
  expect(importConflictKeyReason({ ...target, rows: [{ tenant: null, id: '1' }] }, key, 'upsert')).toContain('NULL');
  expect(importConflictKeyReason({ ...target, mapping: { tenant: 'tenant', id: 'id' } }, key, 'update-existing')).toContain('没有可更新');
  expect(importConflictKeyReason({ ...target, mapping: { tenant: 'tenant', id: 'id' } }, key, 'skip-existing')).toBeUndefined();
  expect(importConflictKeyReason(target, { ...key, reliable: false, reason: '前缀索引' }, 'upsert')).toBe('前缀索引');
});
it('来源撤销与恢复同值不能发布迟到目录，也不能在迟建连后追加旧目录请求', async () => {
  const held = deferred<unknown>(), f = fixture(vi.fn(() => held.promise)); const pending = f.controller.chooseMode(f.target, 'update-existing', f.controller.snapshot());
  await Promise.resolve(); f.invalidate(); held.resolve(catalog()); await pending; expect(f.controller.snapshot().mode).toBe('insert'); expect(f.cancel).toHaveBeenCalledExactlyOnceWith('目录任务');
  const opening = deferred<void>(), g = fixture(); g.open.mockImplementation(() => opening.promise); const stale = g.controller.chooseMode(g.target, 'upsert', g.controller.snapshot()); g.invalidate(); opening.resolve(); await stale; expect(g.read).not.toHaveBeenCalled(); expect(g.cancel).not.toHaveBeenCalled();
});
it('超时只显示失败不自动重试，晚回包不能复活，须再次显式读取', async () => {
  vi.useFakeTimers(); const held = deferred<unknown>(), f = fixture(vi.fn(() => held.promise), 20);
  const pending = f.controller.chooseMode(f.target, 'upsert', f.controller.snapshot()); await vi.advanceTimersByTimeAsync(21); await pending;
  expect(f.controller.snapshot()).toMatchObject({ mode: 'upsert', status: 'failed', key: '' }); expect(f.controller.snapshot().error).toContain('超时'); expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.cancel).toHaveBeenCalledExactlyOnceWith('目录任务'); held.resolve(catalog()); await Promise.resolve(); expect(f.controller.snapshot().status).toBe('failed'); expect(f.controller.canExecute(f.target, f.controller.snapshot())).toBe(false);
});
it('旧目录取消失败不抹原超时，不取消或覆盖新目录任务', async () => {
  vi.useFakeTimers(); const first = deferred<unknown>(), second = deferred<unknown>(), f = fixture(vi.fn(() => first.promise), 20);
  f.uid.mockReturnValueOnce('旧目录任务').mockReturnValue('新目录任务'); f.cancel.mockRejectedValueOnce(Error('资源关闭未确认'));
  const old = f.controller.chooseMode(f.target, 'upsert', f.controller.snapshot()); await vi.advanceTimersByTimeAsync(21); await old;
  expect(f.cancel).toHaveBeenCalledExactlyOnceWith('旧目录任务'); expect(f.cancelFailure).toHaveBeenCalledTimes(1); expect(f.controller.snapshot().error).toContain('超时');
  f.read.mockImplementation(() => second.promise); const fresh = f.controller.chooseMode(f.target, 'upsert', f.controller.snapshot()); await Promise.resolve(); first.resolve(catalog()); await Promise.resolve(); expect(f.controller.snapshot().status).toBe('loading');
  second.resolve(catalog()); await fresh; expect(f.controller.snapshot().status).toBe('ready'); expect(f.cancel).toHaveBeenCalledTimes(1); expect(f.read.mock.calls.map(([, id]) => id)).toEqual(['旧目录任务', '新目录任务']);
});
it('错误目标和重复键目录不被当作可用目录，旧key闭包不能领取新选择', async () => {
  for (const value of [{ ...catalog(), database: 'other' }, { ...catalog(), keys: [...catalog().keys, ...catalog().keys] }]) {
    const f = fixture(vi.fn(async () => value)); await f.controller.chooseMode(f.target, 'upsert', f.controller.snapshot()); expect(f.controller.snapshot().status).toBe('failed');
  }
  const f = fixture(); await f.controller.chooseMode(f.target, 'upsert', f.controller.snapshot()); const before = f.controller.snapshot(); f.controller.chooseKey(f.target, 'PRIMARY', before); f.controller.chooseKey(f.target, '', before); expect(f.controller.snapshot().key).toBe('PRIMARY'); expect(() => f.controller.selection(f.target, before)).toThrow('变化');
});
