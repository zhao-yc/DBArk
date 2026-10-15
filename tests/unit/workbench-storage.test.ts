import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from '../../src/main/storage';
import { emptyWorkbench } from '../../src/shared/workbench';
const require = createRequire(import.meta.url); const directories: string[] = [];
const protector = { available: () => false, encrypt: () => '', decrypt: () => '' };
/** 每例使用独立配置库，模拟真实关闭、重新打开与写盘失败。 */
async function open(path?: string) {
  if (!path) { const directory = mkdtempSync(join(tmpdir(), 'dbark-workbench-')); directories.push(directory); path = join(directory, 'config.sqlite'); }
  return { path, store: await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector) };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
describe('工作台独立配置持久化', () => {
  it('空配置兼容旧记录，收藏顺序、分组及专注模式重启恢复且不修改连接和查询', async () => {
    const { path, store } = await open(); expect(store.workbench()).toEqual({ revision: 0, document: emptyWorkbench() });
    store.saveConnection({ id: 'c', name: '原连接', group: '连接分组', color: '#123456', dialect: 'mysql', host: '127.0.0.1', port: 1, user: 'offline' });
    const before = store.connections(); const settings = store.settings();
    const document = { version: 1 as const, focusMode: true, groups: [{ id: '__proto__', name: '虚拟组' }, { id: 'second', name: '第二组' }], favorites: [{ id: 'b', label: '库', groupId: null, target: { connectionId: 'c', database: '库.名', kind: 'database' as const } }, { id: 'a', label: '原型表', groupId: '__proto__', target: { connectionId: 'c', database: '库.名', name: '__proto__', kind: 'table' as const } }] };
    expect(store.saveWorkbench({ revision: 0, document })).toEqual({ revision: 1, document });
    expect(store.connections()).toEqual(before); expect(store.settings()).toEqual(settings); expect(store.queries()).toEqual([]); expect(store.history()).toEqual([]); store.close();
    const restored = (await open(path)).store; expect(restored.workbench()).toEqual({ revision: 1, document }); expect(restored.connections()).toEqual(before);
    restored.deleteConnection('c'); expect(restored.workbench().document).toEqual(document); restored.close();
  });
  it('旧版本5没有独立工作台表也可迁移，损坏文档不会静默清空', async () => {
    const { path, store } = await open(); store.close();
    const init = (await import('sql.js')).default; const SQL = await init({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
    const old = new SQL.Database(readFileSync(path)); old.run('DROP TABLE workbench'); const { writeFileSync } = await import('node:fs'); writeFileSync(path, old.export()); old.close();
    const restored = (await open(path)).store; expect(restored.workbench().document).toEqual(emptyWorkbench()); restored.close();
    const corrupt = new SQL.Database(readFileSync(path)); corrupt.run('INSERT INTO workbench VALUES(1,1,?)', ['{"version":999}']); writeFileSync(path, corrupt.export()); corrupt.close();
    const damaged = (await open(path)).store; expect(() => damaged.workbench()).toThrow(); damaged.close();
  });
  it('过期修订与写盘失败保留原配置，后续保存不夹带失败修改', async () => {
    const { path, store } = await open(); const first = store.saveWorkbench({ revision: 0, document: emptyWorkbench() });
    expect(() => store.saveWorkbench({ revision: 0, document: { ...emptyWorkbench(), focusMode: true } })).toThrow('已变化'); expect(store.workbench()).toEqual(first);
    mkdirSync(path + '.tmp'); expect(() => store.saveWorkbench({ ...first, document: { ...first.document, focusMode: true } })).toThrow('修改未保存'); expect(store.workbench()).toEqual(first);
    rmSync(path + '.tmp', { recursive: true }); store.saveSettings(store.settings()); store.close();
    const restored = (await open(path)).store; expect(restored.workbench()).toEqual(first); restored.close();
  });
});
