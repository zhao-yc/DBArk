import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { LocalStore } from '../../src/main/storage';
import { commandSchemas } from '../../src/shared/validation';
import { type QuerySaveContent, type SavedQueryOriginContext } from '../../src/shared/queryBinding';
import { SavedQuerySearches } from '../../src/main/savedQuerySearch';
const require = createRequire(import.meta.url), paths: string[] = [];
const protector = { available: () => false, encrypt() { throw Error('不应加密'); }, decrypt() { throw Error('不应读取凭据'); } };
const profile = { id: 'c', name: '原连接', group: '', color: '', dialect: 'mysql' as const, host: '127.0.0.1', port: 1, user: 'offline', database: 'profile_default' };
const sql = "SELECT '900719925474099312345', '0.12345678901234567890', '2026-10-15 01:02:03.123456', NULL, X'00FF', '🚢'";
const content = (context: SavedQueryOriginContext = { state: 'known', database: 'db' }): QuerySaveContent => ({ name: '原查询', connectionId: 'c', context, sql });
/** 每例使用真实 SQLite 和独立磁盘，故障通过阻断原子替换目标触发。 */
async function open() {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-query-binding-')); paths.push(directory);
  const path = join(directory, 'config.sqlite'), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
  const store = await LocalStore.open(path, wasm, protector); store.saveConnection(profile);
  return { directory, path, wasm, store };
}
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('保存查询来源绑定和真实原子 CAS', () => {
  it('新建独立编号、原文摘要和正文精度，另存绝不改源记录', async () => {
    const { store } = await open(), first = store.createBoundQuery(content()), before = store.querySearchRaw(first.source.id);
    const second = store.createBoundQuery({ ...content(), name: '另存副本', sql: sql + '; -- 新内容' });
    expect(second.source.id).not.toBe(first.source.id); expect(store.querySearchRaw(first.source.id)).toBe(before);
    expect(store.bindQuerySource(first.source.id, first.source.digest)).toEqual(first.source);
    expect(JSON.parse(before!).sql).toBe(sql); expect(first.source).not.toHaveProperty('sql'); expect(first.source).not.toHaveProperty('password'); store.close();
  });
  it.each([{ state: 'known', database: 'db' }, { state: 'known', database: null }, { state: 'unknown' }, { state: 'legacy', database: 'legacy_db' }] as const)('四类上下文 %j 同类更新且拒绝类别/库变化', async context => {
    const { store } = await open(), initial = store.createBoundQuery(content(context));
    const next = store.updateBoundQuery({ source: initial.source, content: { ...content(context), sql: 'SELECT 2' } });
    expect(next.source.context).toEqual(context);
    const different = context.state === 'unknown' ? { state: 'known', database: null } : { state: 'unknown' };
    expect(() => store.updateBoundQuery({ source: next.source, content: { ...content(context), context: different } })).toThrow('默认库'); store.close();
  });
  it('并发同源标签仅首个成功，旧摘要不能覆盖更新，删除不复活', async () => {
    const { store } = await open(), first = store.createBoundQuery(content()); const revision = store.querySearchRevision();
    const latest = store.updateBoundQuery({ source: first.source, content: { ...content(), sql: 'SELECT 2' } });
    const bytes = store.querySearchRaw(first.source.id); expect(store.querySearchRevision()).not.toBe(revision);
    expect(() => store.updateBoundQuery({ source: first.source, content: { ...content(), sql: 'SELECT 3' } })).toThrow('已修改'); expect(store.querySearchRaw(first.source.id)).toBe(bytes);
    store.deleteQuery(first.source.id); expect(() => store.updateBoundQuery({ source: latest.source, content: content() })).toThrow('已删除'); expect(store.querySearchRaw(first.source.id)).toBeUndefined(); store.close();
  });
  it('源连接、替代连接、连接目标和默认库配置变化均不可静默覆盖', async () => {
    const { store } = await open(), first = store.createBoundQuery(content());
    store.saveConnection({ ...profile, id: 'replacement', host: 'other.invalid' });
    expect(() => store.updateBoundQuery({ source: first.source, content: { ...content(), connectionId: 'replacement' } })).toThrow('来源连接');
    store.saveConnection({ ...profile, database: 'changed_default' });
    expect(() => store.updateBoundQuery({ source: first.source, content: content() })).toThrow('配置已变化');
    store.deleteConnection('c'); expect(() => store.updateBoundQuery({ source: first.source, content: content() })).toThrow('已删除');
    // 显式另存可以选择替代连接，原记录保持来源不变。
    const copy = store.createBoundQuery({ ...content({ state: 'unknown' }), connectionId: 'replacement' });
    expect(copy.source.connectionId).toBe('replacement'); expect(JSON.parse(store.querySearchRaw(first.source.id)!).connectionId).toBe('c'); store.close();
  });
  it('替代连接打开仍绑定原来源，更新拒绝而原文摘要不变', async () => {
    const { store } = await open(), first = store.createBoundQuery(content()); store.saveConnection({ ...profile, id: 'replacement' });
    const reader = new SavedQuerySearches(store, '未使用的工作线程');
    const opened = reader.read({ id: first.source.id, digest: first.source.digest, connectionId: 'replacement' });
    expect(opened.contextChanged).toBe(true); expect(opened.databaseContext).toEqual({ state: 'unknown' });
    const source = store.bindQuerySource(first.source.id, first.source.digest);
    expect(() => store.updateBoundQuery({ source, content: { ...content({ state: 'unknown' }), connectionId: opened.connectionId } })).toThrow('来源连接'); store.close();
  });
  it('真实写盘失败恢复记录和修订，重启仍恢复绑定，失败修改不夹带进后续保存', async () => {
    const { store, path, wasm } = await open(), first = store.createBoundQuery(content()); const before = readFileSync(path), revision = store.querySearchRevision();
    mkdirSync(path + '.tmp'); expect(() => store.updateBoundQuery({ source: first.source, content: { ...content(), sql: '失败内容' } })).toThrow('修改未保存');
    expect(readFileSync(path)).toEqual(before); expect(store.querySearchRevision()).toBe(revision); expect(store.bindQuerySource(first.source.id, first.source.digest)).toEqual(first.source);
    rmSync(path + '.tmp', { recursive: true });
    store.saveSettings({ ...store.settings(), tabs: [{ id: 'draft', kind: 'query', connectionId: 'c', title: '独立草稿', sql, sourceBinding: first.source }] }); store.close();
    const restored = await LocalStore.open(path, wasm, protector); expect(restored.settings().tabs[0].sourceBinding).toEqual(first.source);
    expect(restored.bindQuerySource(first.source.id, first.source.digest)).toEqual(first.source); expect(restored.querySearchRaw(first.source.id)).not.toContain('失败内容'); restored.close();
  });
  it('严格拒绝额外凭据/搜索条件/SQL 超预算，旧保存命令不能覆盖已有记录', async () => {
    const { store } = await open(), first = store.createBoundQuery(content());
    expect(commandSchemas['queries.create'].safeParse({ ...content(), id: '自选编号', password: '不得保存' }).success).toBe(false);
    expect(commandSchemas['queries.updateSource'].safeParse({ source: { ...first.source, search: '不得持久化' }, content: content() }).success).toBe(false);
    expect(() => store.createBoundQuery({ ...content(), sql: 'x'.repeat(20_000_001) })).toThrow();
    expect(() => store.createLegacyQuery(JSON.parse(store.querySearchRaw(first.source.id)!))).toThrow('必须使用来源摘要'); store.close();
  });
});
