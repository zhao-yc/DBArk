import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import initSqlJs from 'sql.js';
import { LocalStore, defaultSettings } from '../../src/main/storage';
import { QueryFileSources, type QueryFileSourceScope } from '../../src/main/queryFileSources';
import { queryFileSqlDigest } from '../../src/main/queryFileSourceFiles';
import type { QueryFileSourceOpenResult } from '../../src/shared/queryFileSources';
import type { QueryFileCheckResult } from '../../src/shared/queryFileReload';

const root = resolve('.cache/sql-file-reload-persistence-tests');
const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const directories: string[] = [], stores = new Set<LocalStore>();
const protector = { available: () => false, encrypt: () => { throw Error('本例不使用凭据'); }, decrypt: () => { throw Error('本例不读取凭据'); } };
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async () => { mkdirSync(root, { recursive: true }); SQL = await initSqlJs({ locateFile: () => wasm }); });
/** 只关闭本例实例并删除已核父目录的自有文件，不触碰用户来源或封存现场。 */
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores) store.close(); stores.clear();
  for (const directory of directories.splice(0)) { if (dirname(directory) !== root) throw Error('清理路径越界'); rmSync(directory, { recursive: true, force: true }); }
});
/** 真实SQL文件、SQLite及来源服务；只有原生文件选择返回本例自有路径。 */
async function fixture() {
  const directory = mkdtempSync(join(root, 'owned-')); directories.push(directory);
  const target = join(directory, 'owned.sql'), database = join(directory, 'config.sqlite');
  writeFileSync(target, 'select 1;\n');
  const store = await LocalStore.open(database, wasm, protector); stores.add(store);
  store.saveSettings({ ...defaultSettings, tabs: [{ id: 'one', kind: 'query', title: '原草稿', connectionId: 'ram', sql: '' }] });
  const choose = vi.fn(async () => target);
  const service = new QueryFileSources({ store, choose, reserve: async () => { throw Error('只读重载不能申请文件写入'); }, report: () => {} });
  const scope: QueryFileSourceScope = { document: {}, assertCurrent: () => {} };
  const initial = opened(await service.open({ tabId: 'one', taskId: randomUUID(), encoding: 'utf8' }, scope));
  const draft = "select '用户未保存的草稿';\r\n", disk = "select '外部的新文件';\n";
  store.saveSettings({ ...store.settings(), tabs: [{ ...store.settings().tabs[0], sql: draft }] });
  writeFileSync(target, disk);
  const input = () => ({ tabId: 'one', taskId: randomUUID(), source: initial.binding.ref, draftDigest: queryFileSqlDigest(draft) });
  return { target, database, store, service, scope, choose, initial, draft, disk, input };
}
/** 判别联合收窄，同时保留失败时的真实状态。 */
function opened(result: QueryFileSourceOpenResult) { expect(result.state).toBe('opened'); if (result.state !== 'opened') throw Error(JSON.stringify(result)); return result; }
function previewed(result: QueryFileCheckResult) { expect(result.state).toBe('preview'); if (result.state !== 'preview') throw Error(JSON.stringify(result)); return result; }
/** 独立读取已落盘SQLite，不依赖服务的设置投影或renderer补写。 */
function persistedSql(database: string): string {
  const db = new SQL.Database(readFileSync(database));
  try { return JSON.parse(String(db.exec('SELECT data FROM settings WHERE id=1')[0].values[0][0])).tabs[0].sql; }
  finally { db.close(); }
}
it('检查外部文件只返回预览，SQLite字节、正文及来源修订保持', async () => {
  const f = await fixture(), before = readFileSync(f.database);
  const preview = previewed(await f.service.checkExternal(f.input(), f.scope));
  expect(preview.dirty).toBe(true); expect(preview.change).toBe('modified');
  expect(readFileSync(f.database)).toEqual(before); expect(f.store.queryFileSource('one')?.ref).toEqual(f.initial.binding.ref);
  expect(persistedSql(f.database)).toBe(f.draft); expect(f.choose).toHaveBeenCalledTimes(1);
});
it('Main重载已返回而renderer回包丢失，磁盘和重启仍保留原草稿及新的文件基线', async () => {
  const f = await fixture(), preview = previewed(await f.service.checkExternal(f.input(), f.scope));
  const result = await f.service.reload({ ...f.input(), previewId: preview.previewId }, f.scope);
  expect(result.state).toBe('reloaded'); if (result.state !== 'reloaded') throw Error(JSON.stringify(result));
  expect(result.sql).toBe(f.disk); expect(result.binding.ref.revision).toBe(f.initial.binding.ref.revision + 1);
  // 以下没有renderer updateTab/flush；不能让未接纳的外部正文覆盖用户唯一持久草稿。
  expect(persistedSql(f.database)).toBe(f.draft); expect(f.store.settings().tabs[0].sql).toBe(f.draft);
  expect(f.store.queryFileSource('one')?.savedSqlDigest).toBe(queryFileSqlDigest(f.disk));
  f.store.close(); stores.delete(f.store);
  const restored = await LocalStore.open(f.database, wasm, protector); stores.add(restored);
  expect(restored.settings().tabs[0].sql).toBe(f.draft); expect(restored.settings().tabs[0].fileSourceBinding).toEqual(result.binding.ref);
  expect(restored.queryFileSource('one')?.savedSqlDigest).toBe(queryFileSqlDigest(f.disk));
});
it('来源事务写盘失败同时回退内存及磁盘，不丢原草稿或推进来源', async () => {
  const f = await fixture(), preview = previewed(await f.service.checkExternal(f.input(), f.scope)), before = readFileSync(f.database);
  vi.spyOn(f.store as unknown as { flush(): void }, 'flush').mockImplementationOnce(() => { throw Error('本例注入配置写盘失败'); });
  const result = await f.service.reload({ ...f.input(), previewId: preview.previewId }, f.scope);
  expect(result).toMatchObject({ state: 'blocked', reason: 'storage', wrote: 'no' });
  expect(f.store.settings().tabs[0].sql).toBe(f.draft); expect(f.store.queryFileSource('one')?.ref).toEqual(f.initial.binding.ref);
  expect(readFileSync(f.database)).toEqual(before); expect(persistedSql(f.database)).toBe(f.draft); expect(readFileSync(f.target, 'utf8')).toBe(f.disk);
});
it('预览后再次外改拒绝提交且令牌不能重用，原草稿及来源均保持', async () => {
  const f = await fixture(), preview = previewed(await f.service.checkExternal(f.input(), f.scope));
  writeFileSync(f.target, "select '又一次外部修改';\n");
  const input = { ...f.input(), previewId: preview.previewId }, result = await f.service.reload(input, f.scope);
  expect(result).toMatchObject({ state: 'blocked', wrote: 'no' }); expect(f.store.queryFileSource('one')?.ref).toEqual(f.initial.binding.ref);
  expect(persistedSql(f.database)).toBe(f.draft);
  expect((await f.service.reload({ ...input, taskId: randomUUID() }, f.scope)).state).toBe('blocked');
});

it('关闭后同ID重建属于新文档，旧预览拒绝而新检查可用', async () => {
  const f = await fixture(), preview = previewed(await f.service.checkExternal(f.input(), f.scope));
  const original = f.store.queryFileDocument('one'), tab = original.tab;
  expect(original.generation).toBeGreaterThan(0);
  f.store.saveSettings({ ...f.store.settings(), tabs: [] });
  f.store.saveSettings({ ...f.store.settings(), tabs: [{ ...tab, fileSourceBinding: undefined }] });
  const rebuilt = f.store.queryFileDocument('one');
  expect(rebuilt.token).not.toBe(original.token); expect(rebuilt.generation).toBe(0);
  expect(f.store.queryFileSource('one')).toBeUndefined(); expect(persistedSql(f.database)).toBe(f.draft);
  const reopened = opened(await f.service.open({ tabId: 'one', taskId: randomUUID(), encoding: 'utf8' }, f.scope));
  const input = () => ({ tabId: 'one', taskId: randomUUID(), source: reopened.binding.ref, draftDigest: queryFileSqlDigest(f.disk) });
  const before = readFileSync(f.database);
  expect((await f.service.reload({ ...input(), previewId: preview.previewId }, f.scope)).state).toBe('blocked');
  expect(readFileSync(f.database)).toEqual(before); expect(readFileSync(f.target, 'utf8')).toBe(f.disk);
  const fresh = previewed(await f.service.checkExternal(input(), f.scope));
  expect((await f.service.reload({ ...input(), previewId: fresh.previewId }, f.scope)).state).toBe('reloaded');
  expect(persistedSql(f.database)).toBe(f.disk); expect(f.choose).toHaveBeenCalledTimes(2);
});
