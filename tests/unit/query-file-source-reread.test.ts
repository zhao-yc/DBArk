import { afterEach, beforeAll, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import initSqlJs from 'sql.js';
import { LocalStore, defaultSettings } from '../../src/main/storage';
import { QueryFileSources, type QueryFileSourceScope } from '../../src/main/queryFileSources';
import { ExportReservations } from '../../src/main/exportReservations';
import { queryFileSqlDigest } from '../../src/main/queryFileSourceFiles';
import type { QueryFileSourceOpenResult } from '../../src/shared/queryFileSources';
import type { TaskEvent } from '../../src/shared/contracts';

const root = resolve('.cache/sql-file-reread-tests'), wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const directories: string[] = [], stores = new Set<LocalStore>();
const protector = { available: () => false, encrypt: () => { throw Error('本例不使用凭据'); }, decrypt: () => { throw Error('本例不得读取凭据'); } };
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async () => { mkdirSync(root, { recursive: true }); SQL = await initSqlJs({ locateFile: () => wasm }); });
/** 只关闭本例配置实例并清理已核父目录的自有临时文件，不触碰真实用户配置。 */
afterEach(() => {
  for (const store of stores) store.close(); stores.clear();
  for (const directory of directories.splice(0)) { if (dirname(directory) !== root) throw Error('清理路径越界'); rmSync(directory, { recursive: true, force: true }); }
});
/** 使用真实LocalStore和文件读写，原生选择端口只返回本例创建的路径。 */
async function fixture() {
  const directory = mkdtempSync(join(root, 'owned-')); directories.push(directory);
  const target = join(directory, 'owned.sql'), database = join(directory, 'config.sqlite'); writeFileSync(target, "select '磁盘初始SQL';\n");
  const store = await LocalStore.open(database, wasm, protector); stores.add(store);
  store.saveSettings({ ...defaultSettings, tabs: [{ id: 'one', kind: 'query', title: '占位查询', connectionId: 'ram', sql: '' }] });
  const reservations = new ExportReservations(), events: TaskEvent[] = [];
  const host = { store, choose: async () => target, reserve: (path: string) => reservations.acquire(path), report: (event: TaskEvent) => { events.push(event); } };
  const service = new QueryFileSources(host), scope: QueryFileSourceScope = { document: {}, assertCurrent: () => undefined };
  return { target, database, store, host, service, scope };
}
/** 判别联合收窄，测试失败保留实际typed结果。 */
function opened(result: QueryFileSourceOpenResult) { expect(result.state).toBe('opened'); if (result.state !== 'opened') throw Error(JSON.stringify(result)); return result; }
/** 独立读取已落盘SQLite的原始settings，不调用renderer flush或依赖store的展示投影。 */
function persistedSql(database: string): string {
  const db = new SQL.Database(readFileSync(database));
  try { return JSON.parse(String(db.exec('SELECT data FROM settings WHERE id=1')[0].values[0][0])).tabs[0].sql; }
  finally { db.close(); }
}
it('带source重读只推进来源基线，返回后无renderer flush原标签SQL在磁盘及重启均保持', async () => {
  const f = await fixture(), initial = opened(await f.service.open({ tabId: 'one', taskId: randomUUID(), encoding: 'utf8' }, f.scope));
  const originalSql = "select '原标签未保存SQL';\n", diskSql = "select '外部新版SQL';\n";
  f.store.saveSettings({ ...f.store.settings(), tabs: [{ ...f.store.settings().tabs[0], sql: originalSql }] });
  writeFileSync(f.target, diskSql);
  const result = opened(await f.service.open({ tabId: 'one', taskId: randomUUID(), encoding: 'utf8', source: initial.binding.ref }, f.scope));
  // 从此到读取配置和重启之间没有renderer settings.save，模拟回包丢失或renderer崩溃。
  expect(persistedSql(f.database)).toBe(originalSql);
  expect(f.store.settings().tabs[0].sql).toBe(originalSql);
  expect(result.sql).toBe(diskSql); expect(result.binding.ref.revision).toBe(initial.binding.ref.revision + 1);
  expect(result.binding.savedSqlDigest).toBe(queryFileSqlDigest(diskSql));
  expect(f.store.settings().tabs[0].fileSourceBinding).toEqual(result.binding.ref);
  f.store.close(); stores.delete(f.store); const restored = await LocalStore.open(f.database, wasm, protector); stores.add(restored);
  expect(restored.settings().tabs[0].sql).toBe(originalSql); expect(restored.queryFileSource('one')?.savedSqlDigest).toBe(queryFileSqlDigest(diskSql));
});
it('无source首次打开仍原子接管空占位SQL及来源', async () => {
  const f = await fixture(), result = opened(await f.service.open({ tabId: 'one', taskId: randomUUID(), encoding: 'utf8' }, f.scope));
  expect(result.sql).toBe("select '磁盘初始SQL';\n"); expect(persistedSql(f.database)).toBe(result.sql);
  expect(f.store.settings().tabs[0].sql).toBe(result.sql); expect(f.store.settings().tabs[0].fileSourceBinding).toEqual(result.binding.ref);
});
it('带source重读期间有新输入仍拒绝旧读，保留新SQL及原来源修订', async () => {
  for (const phase of ['reading', 'recording']) {
    const f = await fixture(), initial = opened(await f.service.open({ tabId: 'one', taskId: randomUUID(), encoding: 'utf8' }, f.scope));
    const taskId = randomUUID(), newerSql = "select '读取期间新输入';\n"; let changed = false;
    writeFileSync(f.target, "select '待重读磁盘内容';\n");
    const report = f.host.report; f.host.report = event => {
      report(event);
      if (changed || event.taskId !== taskId || event.queryFileSource?.phase !== phase || phase === 'reading' && !event.queryFileSource.bytesProcessed) return;
      changed = true; f.store.saveSettings({ ...f.store.settings(), tabs: [{ ...f.store.settings().tabs[0], sql: newerSql }] });
    };
    expect(await f.service.open({ tabId: 'one', taskId, encoding: 'utf8', source: initial.binding.ref }, f.scope)).toMatchObject({ state: 'blocked', reason: 'document-changed', wrote: 'no' });
    expect(changed).toBe(true); expect(persistedSql(f.database)).toBe(newerSql); expect(f.store.settings().tabs[0].sql).toBe(newerSql);
    expect(f.store.queryFileSource('one')?.ref).toEqual(initial.binding.ref);
  }
});
