import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { LocalStore } from '../../src/main/storage';
import { SnippetTransfers } from '../../src/main/snippetTransfer';
import type { SqlSnippet } from '../../src/shared/contracts';

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const directories: string[] = [], stores = new Set<LocalStore>();
const protector = { available: () => false, encrypt(): string { throw Error('不得访问凭据'); }, decrypt(): string { throw Error('不得访问凭据'); } };
const sample: SqlSnippet = { id: '原片段', name: '同名片段', group: '常用', description: '只保存原文', sql: "SELECT '🚢', '${name}', '$1';\r\n", updatedAt: '' };

/** 每例只使用新建临时目录及真实SQLite/磁盘，不接网络、原生窗口或用户配置。 */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-snippet-transfer-test-')); directories.push(directory);
  const file = join(directory, 'local.sqlite'), store = await open(file);
  return { directory, file, store };
}
/** 跟踪每个真实库实例，关闭后才允许删除本例目录。 */
async function open(file: string) { const store = await LocalStore.open(file, wasm, protector); stores.add(store); return store; }
/** 手动重开前移除已关闭实例，清理阶段不重复关闭同一数据库。 */
function close(store: LocalStore) { store.close(); stores.delete(store); }
afterEach(() => {
  for (const store of stores) store.close(); stores.clear();
  for (const directory of directories.splice(0)) {
    const absolute = resolve(directory);
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('dbark-snippet-transfer-test-')) throw Error('临时清理目标越界');
    rmSync(absolute, { recursive: true, force: true });
  }
});

it('真实文件预览零保存，明确替换和同名新增整批持久化，重开SQLite保留SQL原文', async () => {
  const { directory, file, store } = await fixture(); store.saveSnippet({ ...sample, sql: 'SELECT 原内容' });
  const incoming = [{ ...sample }, { ...sample, id: '同名副本', sql: "-- 新副本\nSELECT '$&';\n" }], input = join(directory, 'import.json');
  writeFileSync(input, '\ufeff' + JSON.stringify({ format: 'DBArk-snippets', version: 1, snippets: incoming }));
  const service = new SnippetTransfers(store, { choose: async () => input }), owner = { document: {}, assertCurrent() {} };
  const { scopeId } = service.open(owner), before = readFileSync(file), revision = store.snippetRevision();
  const preview = (await service.preview(scopeId, owner))!;
  expect(readFileSync(file)).toEqual(before); expect(store.snippetRevision()).toBe(revision);
  expect(preview.entries.map(entry => entry.status)).toEqual(['replace', 'add']);
  const result = service.apply(scopeId, owner, preview.previewId, [{ id: sample.id, action: 'replace' }, { id: '同名副本', action: 'add' }]);
  expect(result).toMatchObject({ added: 1, replaced: 1, skipped: 0 }); expect(store.snippetRevision()).toBe(revision + 1);
  close(store); const restored = await open(file);
  expect(restored.snippets().map(item => [item.id, item.sql]).sort()).toEqual(incoming.map(item => [item.id, item.sql]).sort());
  expect(restored.connections()).toEqual([]); expect(restored.queries()).toEqual([]); expect(restored.history()).toEqual([]);
});

it('真实原子导出替换目标，白名单与精确SQL可独立JSON读回，目录没有残留阶段文件', async () => {
  const { directory, store } = await fixture(); store.saveSnippet(sample); store.saveSnippet({ ...sample, id: '副本', sql: 'SELECT 2;\n' });
  const target = join(directory, 'export.json'); writeFileSync(target, '原目标完整字节');
  const service = new SnippetTransfers(store, { choose: async () => target }), owner = { document: {}, assertCurrent() {} }, { scopeId } = service.open(owner);
  expect(await service.export(scopeId, owner)).toEqual({ count: 2 });
  const parsed = JSON.parse(readFileSync(target, 'utf8'));
  expect(Object.keys(parsed)).toEqual(['format', 'version', 'snippets']); expect(parsed.format).toBe('DBArk-snippets'); expect(parsed.version).toBe(1);
  expect(parsed.snippets.map((item: SqlSnippet) => [item.id, item.sql]).sort()).toEqual([[sample.id, sample.sql], ['副本', 'SELECT 2;\n']].sort());
  for (const item of parsed.snippets) expect(Object.keys(item).sort()).toEqual(['id', 'name', 'group', 'description', 'sql', 'updatedAt'].sort());
  expect(readdirSync(directory).sort()).toEqual(['export.json', 'local.sqlite']);
});

it('真实SQLite发布受阻时整批回退，随后设置保存与重开不夹带失败行', async () => {
  const { file, store } = await fixture(); store.saveSnippet(sample); const before = readFileSync(file), revision = store.snippetRevision();
  // 在专用临时库旁制造空目录，真实writeFileSync失败；不替换文件或SQLite实现。
  mkdirSync(file + '.tmp');
  expect(() => store.applySnippetBatch([{ ...sample, sql: '失败替换' }, { ...sample, id: '失败新增' }], revision, () => {})).toThrow('修改未保存');
  expect(readFileSync(file)).toEqual(before); expect(store.snippetRevision()).toBe(revision); expect(store.snippets()[0].sql).toBe(sample.sql);
  rmdirSync(file + '.tmp'); store.saveSettings({ ...store.settings(), theme: 'light' }); close(store);
  const restored = await open(file); expect(restored.snippets().map(item => [item.id, item.sql])).toEqual([[sample.id, sample.sql]]);
});

it('真实事务最终归属检查失败零发布，外部片段修订也拒绝旧预览和重放', async () => {
  const { directory, file, store } = await fixture(); store.saveSnippet(sample); const before = readFileSync(file), revision = store.snippetRevision(); let checks = 0;
  expect(() => store.applySnippetBatch([{ ...sample, sql: '未授权替换' }, { ...sample, id: '未授权新增' }], revision, () => { if (++checks === 3) throw Error('原归属失效'); })).toThrow('修改未保存');
  expect(readFileSync(file)).toEqual(before); expect(store.snippets().map(item => item.id)).toEqual([sample.id]); expect(store.snippetRevision()).toBe(revision);
  const input = join(directory, 'import.json'); writeFileSync(input, JSON.stringify({ format: 'DBArk-snippets', version: 1, snippets: [{ ...sample, sql: '文件替换' }] }));
  const service = new SnippetTransfers(store, { choose: async () => input }), owner = { document: {}, assertCurrent() {} }, { scopeId } = service.open(owner), preview = (await service.preview(scopeId, owner))!;
  store.saveSnippet({ ...sample, description: '实际外部修改' }); const changed = readFileSync(file);
  for (let index = 0; index < 2; index++) expect(() => service.apply(scopeId, owner, preview.previewId, [{ id: sample.id, action: 'replace' }])).toThrow();
  expect(readFileSync(file)).toEqual(changed); close(store); const restored = await open(file);
  expect(restored.snippets()[0]).toMatchObject({ description: '实际外部修改', sql: sample.sql });
});
