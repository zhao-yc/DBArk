import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
import { LocalStore } from '../../src/main/storage';
import { RecordTemplateMain } from '../../src/main/recordTemplateMain';
import { recordTemplateSnapshotSchema, type RecordTemplateContent, type RecordTemplateStored } from '../../src/shared/recordTemplates';
import { mainColumnsHarness } from './main-columns-owner-harness';

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const profile = { id: 'trusted', name: '合成', group: '', color: '', dialect: 'sqlite' as const, sqlite: { filePath: '不应读取.sqlite', readOnly: false, busyTimeoutMs: 0 } };
const target = { connectionId: profile.id, database: 'main', table: '__proto__.模板🚢' };
const content: RecordTemplateContent = { version: 1, dialect: 'sqlite', fields: [{ name: '__proto__', signature: '["ANY",true,false]', value: { kind: 'text', value: '\0{"n":9007199254740993,"n":-0}🚢' } }, { name: 'id', signature: '["INTEGER",false,false]', value: { kind: 'integer', value: '9223372036854775807' } }, { name: 'bytes', signature: '["BLOB",true,false]', value: { kind: 'blob', value: '00ff' } }] };
const protector = { available: () => true, encrypt: vi.fn((value: string) => value), decrypt: vi.fn((value: string) => value) };
const packet = (snapshot: RecordTemplateStored) => ({ ...snapshot.target, source: snapshot.source, expectedRevision: snapshot.revision, bindingToken: randomUUID() });
let folder: string, file: string, store: LocalStore | undefined;
beforeEach(async () => { folder = mkdtempSync(join(realpathSync.native(tmpdir()), 'tabrelio-record-template-')); file = join(folder, 'config.sqlite'); store = await LocalStore.open(file, wasm, protector); store.saveConnection(profile); vi.clearAllMocks(); });
/** 失败保留准确文件，只有本例成功且原目录未变才清理；不访问目标数据库。 */
afterEach(context => {
  store?.close(); if (context.task.result?.state === 'fail') return;
  if (dirname(realpathSync.native(folder)) !== realpathSync.native(tmpdir()) || !basename(folder).startsWith('tabrelio-record-template-') || lstatSync(folder).isSymbolicLink()) throw Error('拒绝清理非本例目录');
  rmSync(folder, { recursive: true });
});
it('真实配置库保存重开，列表不包含原值，显式读取保留typed精度和目标隔离', async () => {
  const saved = store!.saveRecordTemplate({ ...packet(store!.recordTemplates(target)), name: '原型🚢', content });
  expect(Object.keys(saved.entries[0]).sort()).toEqual(['columns', 'dialect', 'id', 'name', 'sourceCurrent']);
  expect(JSON.stringify(saved)).not.toContain('9223372036854775807');
  expect(saved.entries[0]).toMatchObject({ name: '原型🚢', columns: ['__proto__', 'id', 'bytes'], sourceCurrent: true });
  expect(store!.readRecordTemplate({ ...packet(saved), id: saved.entries[0].id })).toEqual(content);
  expect(store!.recordTemplates({ ...target, table: target.table + 'x' }).entries).toEqual([]);
  store!.close(); store = await LocalStore.open(file, wasm, protector); const current = store.recordTemplates(target);
  expect(store.readRecordTemplate({ ...packet(current), id: saved.entries[0].id })).toEqual(content); expect(protector.decrypt).not.toHaveBeenCalled();
});
it('覆盖、改名、删除均有持久CAS，旧回包及同名覆盖不能偷偷写盘', () => {
  const initial = store!.recordTemplates(target), saved = store!.saveRecordTemplate({ ...packet(initial), name: '一', content }), id = saved.entries[0].id, bytes = readFileSync(file);
  expect(() => store!.saveRecordTemplate({ ...packet(initial), name: '二', content })).toThrow(/变化/); expect(readFileSync(file)).toEqual(bytes);
  expect(() => store!.saveRecordTemplate({ ...packet(saved), name: '一', content })).toThrow(/覆盖/);
  const renamed = store!.renameRecordTemplate({ ...packet(saved), id, name: '二' }); expect(renamed.entries[0].id).toBe(id);
  expect(() => store!.deleteRecordTemplate({ ...packet(saved), id })).toThrow(/变化/);
  const replaced = store!.saveRecordTemplate({ ...packet(renamed), replaceId: id, name: '二', content: { ...content, fields: [content.fields[1]] } });
  expect(store!.readRecordTemplate({ ...packet(replaced), id }).fields).toEqual([content.fields[1]]);
  const removed = store!.deleteRecordTemplate({ ...packet(replaced), id }); expect(removed.entries).toEqual([]); expect(removed.revision).toBe(4);
});
it('连接重绑定只留下不可读概要，名称修改不续借旧值；明确覆盖后才能重新使用', () => {
  const saved = store!.saveRecordTemplate({ ...packet(store!.recordTemplates(target)), name: '一', content }), id = saved.entries[0].id;
  store!.saveConnection({ ...profile, sqlite: { ...profile.sqlite, filePath: '另一个不得读取.sqlite' } }); const changed = store!.recordTemplates(target);
  expect(changed.entries[0].sourceCurrent).toBe(false); expect(() => store!.readRecordTemplate({ ...packet(changed), id })).toThrow(/来源/);
  const renamed = store!.renameRecordTemplate({ ...packet(changed), id, name: '二' }); expect(renamed.entries[0].sourceCurrent).toBe(false);
  const replaced = store!.saveRecordTemplate({ ...packet(renamed), name: '二', replaceId: id, content }); expect(replaced.entries[0].sourceCurrent).toBe(true);
  store!.deleteConnection(profile.id); store!.saveConnection(profile); expect(store!.recordTemplates(target).entries).toEqual([]);
});
it('落盘失败和落盘前失去归属均恢复原内存与磁盘，不在随后保存中夹带失败模板', () => {
  const before = readFileSync(file), initial = store!.recordTemplates(target);
  mkdirSync(file + '.tmp'); expect(() => store!.saveRecordTemplate({ ...packet(initial), name: '失败', content })).toThrow(/未成功|EISDIR|目录|保存/); rmdirSync(file + '.tmp');
  expect(store!.recordTemplates(target).entries).toEqual([]); expect(readFileSync(file)).toEqual(before);
  expect(() => store!.saveRecordTemplate({ ...packet(initial), name: '失效', content }, () => { throw Error('原文档失效'); })).toThrow(/失效/);
  expect(store!.recordTemplates(target).entries).toEqual([]); expect(readFileSync(file)).toEqual(before);
  store!.saveRecordTemplate({ ...packet(initial), name: '明确保存', content }); expect(store!.recordTemplates(target).entries.map(entry => entry.name)).toEqual(['明确保存']);
});
it('未知版本或损坏模板在迁移写盘前拒绝，原始配置字节保持', async () => {
  store!.saveRecordTemplate({ ...packet(store!.recordTemplates(target)), name: '一', content }); store!.close(); store = undefined;
  const SQL = await initSqlJs({ locateFile: () => wasm }), db = new SQL.Database(readFileSync(file));
  try { db.run('UPDATE record_templates SET data=?', [JSON.stringify({ version: 99 })]); writeFileSync(file, db.export()); } finally { db.close(); }
  const before = readFileSync(file); await expect(LocalStore.open(file, wasm, protector)).rejects.toThrow(); expect(readFileSync(file)).toEqual(before);
});
it('真实IPC校验、分发、发布与本机持久化闭环；导航和假frame无法领取旧模板，零worker', async () => {
  const f = mainColumnsHarness(); f.context.store = store; f.setRevision(store!.connectionRevision());
  f.context.recordTemplates = new RecordTemplateMain({ get store() { return store!; }, assert: owner => f.capabilities.assertCapturedOwner(owner), same: (a, b) => f.capabilities.sharesDocumentOwner(a, b), available: id => f.context.connectionConfig.assertAvailable(id), shuttingDown: () => f.context.shuttingDown });
  const initial = await f.run('record.templates.list', target), saved = recordTemplateSnapshotSchema.parse(await f.run('record.templates.save', { ...packet(initial), bindingToken: initial.bindingToken, name: '原IPC', content }));
  const input = { ...packet(saved), bindingToken: saved.bindingToken, id: saved.entries[0].id }; expect(await f.run('record.templates.read', input)).toEqual(content);
  const before = readFileSync(file);
  expect((await f.invoke('record.templates.read', input, { ...f.event(), senderFrame: {} })).ok).toBe(false); expect(readFileSync(file)).toEqual(before);
  f.context.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  await expect(f.run('record.templates.delete', input)).rejects.toThrow(); expect(readFileSync(file)).toEqual(before);
  const fresh = await f.run('record.templates.list', target); expect((await f.run('record.templates.delete', { ...packet(fresh), bindingToken: fresh.bindingToken, id: input.id })).entries).toEqual([]);
  expect(f.request).not.toHaveBeenCalled(); expect(protector.decrypt).not.toHaveBeenCalled();
});
it('Main单调期限到期和时钟回退均撤销原令牌', () => {
  const f = mainColumnsHarness(); f.context.store = store; f.setRevision(store!.connectionRevision()); let now = 10;
  const main = new RecordTemplateMain({ get store() { return store!; }, assert: owner => f.capabilities.assertCapturedOwner(owner), same: (a, b) => f.capabilities.sharesDocumentOwner(a, b), available: () => {}, shuttingDown: () => false }, () => now), owner = f.capabilities.capture(f.event());
  const first = main.execute('list', target, owner); first.publish(); const initial = recordTemplateSnapshotSchema.parse(first.value);
  now += 600000; expect(() => main.execute('save', { ...packet(initial), bindingToken: initial.bindingToken, name: '过期', content }, owner)).toThrow(/来源/);
  const next = main.execute('list', target, owner), fresh = recordTemplateSnapshotSchema.parse(next.value); now--;
  expect(() => main.execute('save', { ...packet(fresh), bindingToken: fresh.bindingToken, name: '倒退', content }, owner)).toThrow(/期限/); expect(store!.recordTemplates(target).entries).toEqual([]);
});

it('Main保存后原文档失效，发布明确报告已保存；新文档刷新能核对事实且不重复写', () => {
  const f = mainColumnsHarness(); f.context.store = store; f.setRevision(store!.connectionRevision());
  const main = new RecordTemplateMain({ get store() { return store!; }, assert: owner => f.capabilities.assertCapturedOwner(owner), same: (a,b) => f.capabilities.sharesDocumentOwner(a,b), available: () => {}, shuttingDown: () => false });
  const owner = f.capabilities.capture(f.event()), initial = main.execute('list', target, owner); initial.publish();
  const snapshot = recordTemplateSnapshotSchema.parse(initial.value), saved = main.execute('save', { ...packet(snapshot), bindingToken: snapshot.bindingToken, name: '已经保存', content }, owner);
  f.context.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  expect(() => saved.publish()).toThrow(/已保存/);
  const fresh = main.execute('list', target, f.capabilities.capture(f.event())); fresh.publish();
  const current = recordTemplateSnapshotSchema.parse(fresh.value); expect(current.revision).toBe(1); expect(current.entries.map(entry => entry.name)).toEqual(['已经保存']); expect(f.request).not.toHaveBeenCalled();
});
