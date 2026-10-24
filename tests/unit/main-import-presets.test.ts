import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalStore } from '../../src/main/storage';
import { mainColumnsHarness } from './main-columns-owner-harness';
import type { ImportPresetConfiguration, ImportPresetSnapshot } from '../../src/shared/importPresets';

const configuration: ImportPresetConfiguration = { format: 'csv', encoding: 'gb18030', csvDelimiter: ';', csvHasHeader: false, columns: ['第1列', '第2列'], mapping: { 第1列: 'id', 第2列: '正文' } };
const protector = { available: vi.fn(() => false), encrypt: vi.fn(() => { throw Error('本用途禁止加密或读取秘密'); }), decrypt: vi.fn(() => { throw Error('本用途禁止解密'); }) };
let main: ReturnType<typeof mainColumnsHarness>, store: LocalStore, directory: string, path: string;

/** 存储与IPC全部执行生产代码；物理数据库引擎端口是必须零调用的RAM哨兵。 */
beforeEach(async () => {
  const base = join(process.cwd(), '.cache/main-import-presets'); await mkdir(base, { recursive: true }); directory = await mkdtemp(join(base, 'case-')); path = join(directory, 'dbark.sqlite');
  for (const port of Object.values(protector)) port.mockClear();
  store = await LocalStore.open(path, createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'), protector);
  main = mainColumnsHarness(); main.context.store = store; main.request.mockImplementation(async () => { throw Error('导入配置不允许调用数据库引擎'); });
});
/** 只精确清理本例新建的普通文件，保留其它任务和已有失败目录。 */
afterEach(async () => { store.close(); for (const name of await readdir(directory)) await rm(join(directory, name)); await rmdir(directory); vi.restoreAllMocks(); });
const list = () => main.run('files.importPresets.list', {}) as Promise<ImportPresetSnapshot>;

describe('导入配置真实Main文档归属与SQLite持久化', () => {
  it('新建/显式更新/删除只提交本地配置，保持连接修订与设置且不碰引擎、任务或秘密', async () => {
    const before = { revision: store.connectionRevision(), settings: store.settings(), tasks: store.tasks() }, first = await list();
    expect(first.entries).toEqual([]);
    const saved = await main.run('files.importPresets.save', { generation: first.generation, revision: first.revision, name: '每月 导入', configuration }) as ImportPresetSnapshot;
    expect(saved.revision).toBe(first.revision + 1); expect(saved.entries).toHaveLength(1); expect(saved.entries[0].configuration).toEqual(configuration);
    const updated = await main.run('files.importPresets.save', { generation: saved.generation, revision: saved.revision, id: saved.entries[0].id, name: '每月 更新', configuration }) as ImportPresetSnapshot;
    expect(updated.entries[0].id).toBe(saved.entries[0].id); expect(updated.entries[0].name).toBe('每月 更新');
    const deleted = await main.run('files.importPresets.delete', { generation: updated.generation, revision: updated.revision, id: updated.entries[0].id }) as ImportPresetSnapshot;
    expect(deleted.entries).toEqual([]); expect(deleted.revision).toBe(first.revision + 3); expect(await list()).toEqual(deleted);
    expect({ revision: store.connectionRevision(), settings: store.settings(), tasks: store.tasks() }).toEqual(before);
    expect(main.request).not.toHaveBeenCalled(); expect(main.tasks.size).toBe(0); for (const port of Object.values(protector)) expect(port).not.toHaveBeenCalled();
  });

  it('旧快照不能覆盖其它已保存配置，失败不改原内存或磁盘，不自动重试', async () => {
    const first = await list(); await main.run('files.importPresets.save', { generation: first.generation, revision: first.revision, name: '原配置', configuration });
    const bytes = await readFile(path), current = await list();
    expect((await main.invoke('files.importPresets.save', { generation: first.generation, revision: first.revision, name: '迟到覆盖', configuration })).ok).toBe(false);
    expect(await list()).toEqual(current); expect(await readFile(path)).toEqual(bytes); expect(main.request).not.toHaveBeenCalled();
  });

  it('非原窗口/子框架/退出中的请求拒绝；路径、数据行或getter在真实校验入口即拒绝', async () => {
    const first = await list(), input = { generation: first.generation, revision: first.revision, name: '原配置', configuration };
    const wrong = main.event(); wrong.sender = {} as any; expect((await main.invoke('files.importPresets.save', input, wrong)).ok).toBe(false);
    const child = main.event(); child.senderFrame = { ...child.senderFrame }; expect((await main.invoke('files.importPresets.save', input, child)).ok).toBe(false);
    const getter = vi.fn(() => '本用途不可执行'); const hidden = { ...configuration }; Object.defineProperty(hidden, 'filePath', { get: getter, enumerable: true });
    for (const extra of [{ filePath: 'D:/未选择.csv' }, { fileToken: '其它用途令牌' }, { rows: [{ 第1列: '数据不可保存' }] }, { password: '合成不可存' }]) expect((await main.invoke('files.importPresets.save', { ...input, configuration: { ...configuration, ...extra } })).ok).toBe(false);
    expect((await main.invoke('files.importPresets.save', { ...input, configuration: hidden })).ok).toBe(false); expect(getter).not.toHaveBeenCalled();
    main.context.shuttingDown = true; expect((await main.invoke('files.importPresets.save', input)).ok).toBe(false); expect((await main.invoke('files.importPresets.list', {})).ok).toBe(false);
    expect(store.importPresets()).toEqual(first); expect(main.request).not.toHaveBeenCalled();
  });

  it('原子文件替换前文档导航时，真实归属guard回滚内存并保持原磁盘', async () => {
    const first = await list(), bytes = await readFile(path), flush = (store as any).flush;
    vi.spyOn(store as any, 'flush').mockImplementation(function (this: LocalStore, guard: unknown) {
      main.windows[0].webContents.mainFrame.url = 'app://other-document'; return flush.call(this, guard);
    });
    const reply = await main.invoke('files.importPresets.save', { generation: first.generation, revision: first.revision, name: '不可迟到发布', configuration });
    expect(reply.ok).toBe(false); expect(store.importPresets()).toEqual(first); expect(await readFile(path)).toEqual(bytes); expect(main.request).not.toHaveBeenCalled();
  });

  it('读取完成至IPC发布之间的导航使旧快照失效，不向旧文档发布', async () => {
    const first = await list(), read = store.importPresets.bind(store);
    vi.spyOn(store, 'importPresets').mockImplementationOnce(() => { const result = read(); queueMicrotask(() => { main.windows[0].webContents.mainFrame.url = 'app://other-document'; }); return result; });
    const reply = await main.invoke('files.importPresets.list', {}); expect(reply.ok).toBe(false); expect(store.importPresets()).toEqual(first); expect(main.request).not.toHaveBeenCalled();
  });
});
