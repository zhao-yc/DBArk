import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { TableDraftFiles, tableDraftFileMessages as text, type TableDraftFilePorts } from '../../src/main/tableDraftFiles';
import { encodeTableDraft, tableDraftLimits, type TableDraftDocument } from '../../src/shared/tableDraft';


const directories: string[] = [];
const owner = { assertCurrent() {} };
const document: TableDraftDocument = {
  kind: 'dbark.table-draft', version: 1,
  target: { connectionId: 'connection-a', database: '草稿验收', table: '记录' }, endpointKey: 'a'.repeat(64), metadataKey: '真实结构摘要',
  changes: [
    { kind: 'insert', values: { id: '18446744073709551615', empty: '', nil: null, bytes: { type: 'binary', base64: '' }, json: '{ "n": 12345678901234567890 }', minusZero: -0 } },
    { kind: 'update', before: { id: '2', value: '旧值' }, values: { value: '新值' } },
    { kind: 'delete', before: { id: '3', value: null } },
  ],
};
const stale = '草稿窗口已变化';
/** 每例使用独立真实目录，结束时只删除本例所创建的随机目录。 */
async function directory(): Promise<string> {
  const path = await fs.mkdtemp(join(tmpdir(), 'dbark-draft-files-')); directories.push(path); return path;
}
/** 可控等待用于核对原始磁盘操作尚未结束时，锁与资源仍由原请求持有。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
/** 代理仅替换指定的真实句柄方法，其余方法绑定原句柄避免内部 receiver 变化。 */
function wrap(handle: FileHandle, overrides: Record<string, unknown>): FileHandle {
  return new Proxy(handle, { get(target, key) {
    if (typeof key === 'string' && key in overrides) return overrides[key];
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
/** 默认磁盘实现可按单项替换，所有权与占用端口不依赖数据库或窗口。 */
function ports(path?: string, io: Partial<NonNullable<TableDraftFilePorts['io']>> = {}) {
  const released = vi.fn();
  return { choose: vi.fn(async () => path), reserve: vi.fn(async () => released), io: { ...fs, ...io }, released };
}
afterEach(async () => {
  for (const path of directories.splice(0)) {
    const checked = resolve(path);
    if (dirname(checked) !== resolve(tmpdir()) || !checked.startsWith(join(resolve(tmpdir()), 'dbark-draft-files-'))) throw new Error('拒绝清理非本例临时目录');
    await fs.rm(checked, { recursive: true, force: true });
  }
});

describe('表格草稿原生文件生命周期', () => {
  it('真实磁盘往返并替换旧文件，只返回文件名且释放占用', async () => {
    const path = join(await directory(), '草稿.dbark-draft.json'); await fs.writeFile(path, '旧文件');
    const open = vi.fn(fs.open), dependency = ports(path, { open }), files = new TableDraftFiles(dependency);
    await expect(files.save(document, owner)).resolves.toEqual({ name: '草稿.dbark-draft.json' });
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/\.dbark-draft-[\w-]+\.tmp$/), 'wx', 0o600);
    expect(await fs.readFile(path, 'utf8')).toBe(encodeTableDraft(document));
    expect(dependency.reserve).toHaveBeenCalledWith(path); expect(dependency.released).toHaveBeenCalledTimes(1);
    await expect(files.open(owner)).resolves.toEqual({ name: '草稿.dbark-draft.json', document });
    expect(await fs.readdir(join(path, '..'))).toEqual(['草稿.dbark-draft.json']);
  });

  it('取消不占用文件，非法内容在对话框之前拒绝', async () => {
    const dependency = ports(), files = new TableDraftFiles(dependency);
    await expect(files.open(owner)).resolves.toBeNull(); await expect(files.save(document, owner)).resolves.toBeNull();
    expect(dependency.reserve).not.toHaveBeenCalled();
    dependency.choose.mockClear();
    await expect(files.save({ ...document, version: 2 } as unknown as TableDraftDocument, owner)).rejects.toThrow();
    expect(dependency.choose).not.toHaveBeenCalled();
  });

  it('保存捕获时的原值与修改值，原对象后续变化不改变文件', async () => {
    const dir = await directory(), path = join(dir, 'JSON.json'), choice = deferred<string | undefined>();
    const original: TableDraftDocument = { ...document, changes: [{ kind: 'update', before: { id: '1', value: '旧值' }, values: { value: '保存值' } }] };
    const dependency = ports(path); dependency.choose.mockImplementationOnce(() => choice.promise);
    const files = new TableDraftFiles(dependency), saving = files.save(original, owner);
    const change = original.changes[0];
    if (change.kind !== 'update') throw new Error('测试准备错误');
    change.before.value = '后续原值'; change.values.value = '后续修改'; choice.resolve(path); await saving;
    const restored = await files.open(owner);
    expect(restored?.document.changes).toEqual([{ kind: 'update', before: { id: '1', value: '旧值' }, values: { value: '保存值' } }]);
  });
  it.each(['open', 'save'] as const)('%s 拒绝非绝对路径，绝不占用或打开磁盘', async mode => {
    const open = vi.fn(fs.open), dependency = ports('relative.json', { open }), files = new TableDraftFiles(dependency);
    await expect(mode === 'open' ? files.open(owner) : files.save(document, owner)).rejects.toThrow(text.invalid);
    expect(open).not.toHaveBeenCalled(); expect(dependency.reserve).not.toHaveBeenCalled();
  });

  it.each(['open', 'save'] as const)('%s 拒绝符号链接，不跟随到其他文件', async mode => {
    const path = join(await directory(), '链接.json'); await fs.writeFile(path, encodeTableDraft(document));
    const real = await fs.lstat(path), open = vi.fn(fs.open);
    const dependency = ports(path, { open, lstat: (async () => new Proxy(real, { get(target, key) { if (key === 'isSymbolicLink') return () => true; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } })) as unknown as typeof fs.lstat });
    const files = new TableDraftFiles(dependency);
    await expect(mode === 'open' ? files.open(owner) : files.save(document, owner)).rejects.toThrow('普通'); expect(open).not.toHaveBeenCalled();
    expect(await fs.readFile(path, 'utf8')).toBe(encodeTableDraft(document));
    expect(dependency.released).toHaveBeenCalledTimes(mode === 'save' ? 1 : 0);
  });

  it('短写入会继续直到完整同步；零字节写入立即失败并清理', async () => {
    const dir = await directory(), path = join(dir, '输出.json'); let zero = false, writes = 0;
    const dependency = ports(path, { open: (async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return wrap(handle, { write: async (buffer: Buffer, offset: number, length: number, position: number) => {
        writes++; if (zero) return { bytesWritten: 0, buffer }; return handle.write(buffer, offset, Math.min(length, 7), position);
      } });
    }) as typeof fs.open });
    const files = new TableDraftFiles(dependency); await files.save(document, owner);
    expect(writes).toBeGreaterThan(1); expect(await fs.readFile(path, 'utf8')).toBe(encodeTableDraft(document));
    zero = true; await expect(files.save(document, owner)).rejects.toThrow('未取得进展');
    expect(await fs.readFile(path, 'utf8')).toBe(encodeTableDraft(document)); expect(await fs.readdir(dir)).toEqual(['输出.json']);
  });

  it('读取异常仍关闭原始句柄，之后可开始下一次操作', async () => {
    const path = join(await directory(), '输入.json'); await fs.writeFile(path, encodeTableDraft(document)); let closes = 0;
    const dependency = ports(path, { open: (async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); return wrap(handle, { read: async () => { throw new Error('磁盘读取失败'); }, close: async () => { closes++; await handle.close(); } });
    }) as typeof fs.open });
    const files = new TableDraftFiles(dependency); await expect(files.open(owner)).rejects.toThrow('磁盘读取失败');
    expect(closes).toBe(1); dependency.choose.mockResolvedValue(undefined); await expect(files.open(owner)).resolves.toBeNull();
  });

  it.each(['open', 'save'] as const)('%s 对话框期间拒绝竞争，取消原操作后才解锁', async mode => {
    const choice = deferred<string | undefined>(), dependency = ports(); dependency.choose.mockImplementationOnce(() => choice.promise);
    const files = new TableDraftFiles(dependency);
    const first = mode === 'open' ? files.open(owner) : files.save(document, owner);
    await expect(files.open(owner)).rejects.toThrow(text.busy); await expect(files.save(document, owner)).rejects.toThrow(text.busy);
    choice.resolve(undefined); await expect(first).resolves.toBeNull(); await expect(files.open(owner)).resolves.toBeNull();
  });

  it('选择文件后窗口失效，原始对话框返回前始终保持锁', async () => {
    const choice = deferred<string | undefined>(), dependency = ports(); dependency.choose.mockImplementationOnce(() => choice.promise);
    let current = true; const session = { assertCurrent() { if (!current) throw new Error(stale); } };
    const files = new TableDraftFiles(dependency), first = files.open(session), rejection = expect(first).rejects.toThrow(stale);
    current = false; await expect(files.open(owner)).rejects.toThrow(text.busy);
    choice.resolve(undefined); await rejection; await expect(files.open(owner)).resolves.toBeNull();
  });

  it.each(['directory', 'oversized', 'utf8', 'invalid'] as const)('拒绝 %s 来源', async kind => {
    const path = join(await directory(), '输入.json');
    if (kind === 'directory') await fs.mkdir(path);
    else await fs.writeFile(path, kind === 'oversized' ? Buffer.alloc(tableDraftLimits.bytes + 1) : kind === 'utf8' ? Buffer.from([0xc3, 0x28]) : '{}');
    const open = vi.fn(fs.open), dependency = ports(path, { open }), files = new TableDraftFiles(dependency);
    await expect(files.open(owner)).rejects.toThrow(kind === 'oversized' ? text.tooLarge : kind === 'utf8' ? 'UTF-8' : kind === 'invalid' ? /草稿|无效|格式/ : '普通');
    expect(dependency.reserve).not.toHaveBeenCalled();
  });

  it('打开句柄返回时所有权失效仍关闭该句柄', async () => {
    const path = join(await directory(), '输入.json'); await fs.writeFile(path, encodeTableDraft(document));
    let current = true, close = vi.fn();
    const dependency = ports(path, { open: (async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); close = vi.fn(() => handle.close()); current = false;
      return wrap(handle, { close });
    }) as typeof fs.open });
    await expect(new TableDraftFiles(dependency).open({ assertCurrent() { if (!current) throw new Error(stale); } })).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('读取后来源被原地修改，拒绝发布并关闭句柄', async () => {
    const path = join(await directory(), '输入.json'); await fs.writeFile(path, encodeTableDraft(document));
    let close = vi.fn(), changed = false;
    const dependency = ports(path, { open: (async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); close = vi.fn(() => handle.close());
      return wrap(handle, { close, read: async (buffer: Buffer, offset: number, length: number, position: number) => {
        const result = await handle.read(buffer, offset, length, position); if (!changed) { changed = true; await fs.appendFile(path, ' '); } return result;
      } });
    }) as typeof fs.open });
    await expect(new TableDraftFiles(dependency).open(owner)).rejects.toThrow('变化'); expect(close).toHaveBeenCalledTimes(1);
  });

  it('最终路径身份不同于原句柄时拒绝打开，即使原句柄内容仍有效', async () => {
    const dir = await directory(), path = join(dir, '输入.json'), replacement = join(dir, '替换.json');
    await fs.writeFile(path, encodeTableDraft(document)); await fs.writeFile(replacement, encodeTableDraft(document));
    let checks = 0;
    const dependency = ports(path, { lstat: (async (...args: Parameters<typeof fs.lstat>) => {
      // Windows 会拒绝替换已打开的文件，注入最终路径身份用于跨平台复现该边界。
      if (++checks === 2) return fs.lstat(replacement); return fs.lstat(...args);
    }) as typeof fs.lstat });
    await expect(new TableDraftFiles(dependency).open(owner)).rejects.toThrow('变化');
  });

  it('占用返回时所有权失效仍精确释放', async () => {
    const path = join(await directory(), '输出.json'), dependency = ports(path); let current = true;
    dependency.reserve.mockImplementationOnce(async () => { current = false; return dependency.released; });
    await expect(new TableDraftFiles(dependency).save(document, { assertCurrent() { if (!current) throw new Error(stale); } })).rejects.toThrow();
    expect(dependency.released).toHaveBeenCalledTimes(1); expect(await fs.readdir(join(path, '..'))).toEqual([]);
  });

  it.each(['write', 'sync', 'close', 'rename'] as const)('%s 失败保留原文件并清理临时文件及占用', async phase => {
    const dir = await directory(), path = join(dir, '输出.json'); await fs.writeFile(path, '原文件');
    let closes = 0;
    const dependency = ports(path, {
      open: (async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args);
        return wrap(handle, {
          write: phase === 'write' ? async () => { throw new Error('磁盘写入失败'); } : handle.write.bind(handle),
          sync: phase === 'sync' ? async () => { throw new Error('同步失败'); } : handle.sync.bind(handle),
          close: async () => { closes++; if (phase === 'close' && closes === 1) throw new Error('关闭失败'); await handle.close(); },
        });
      }) as typeof fs.open,
      rename: phase === 'rename' ? async () => { throw new Error('重命名失败'); } : fs.rename,
    });
    await expect(new TableDraftFiles(dependency).save(document, owner)).rejects.toThrow(phase === 'rename' ? text.unknownWrite : /失败/);
    expect(await fs.readFile(path, 'utf8')).toBe('原文件'); expect(await fs.readdir(dir)).toEqual(['输出.json']);
    expect(dependency.released).toHaveBeenCalledTimes(1); expect(closes).toBe(phase === 'close' ? 2 : 1);
  });

  it('临时文件创建后失效仍关闭并清理，不覆盖旧文件', async () => {
    const dir = await directory(), path = join(dir, '输出.json'); await fs.writeFile(path, '原文件'); let current = true, closes = 0;
    const dependency = ports(path, { open: (async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); current = false;
      return wrap(handle, { close: async () => { closes++; await handle.close(); } });
    }) as typeof fs.open });
    await expect(new TableDraftFiles(dependency).save(document, { assertCurrent() { if (!current) throw new Error(stale); } })).rejects.toThrow();
    expect(closes).toBe(1); expect(await fs.readFile(path, 'utf8')).toBe('原文件'); expect(await fs.readdir(dir)).toEqual(['输出.json']);
  });

  it('同步结束前失效不解锁；等待原同步结束后清理临时文件', async () => {
    const dir = await directory(), path = join(dir, '输出.json'), entered = deferred<void>(), finish = deferred<void>(); let current = true;
    const dependency = ports(path, { open: (async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return wrap(handle, { sync: async () => { entered.resolve(); await finish.promise; await handle.sync(); } });
    }) as typeof fs.open });
    const files = new TableDraftFiles(dependency), pending = files.save(document, { assertCurrent() { if (!current) throw new Error(stale); } });
    const rejection = expect(pending).rejects.toThrow(); await entered.promise; current = false;
    await expect(files.open(owner)).rejects.toThrow(text.busy); expect(dependency.released).not.toHaveBeenCalled();
    finish.resolve(); await rejection; expect(dependency.released).toHaveBeenCalledTimes(1); expect(await fs.readdir(dir)).toEqual([]);
  });

  it('目标在写入期间被其他操作修改，保留他人文件并拒绝替换', async () => {
    const dir = await directory(), path = join(dir, '输出.json'); await fs.writeFile(path, '原文件');
    const dependency = ports(path, { open: (async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return wrap(handle, { sync: async () => { await handle.sync(); await fs.writeFile(path, '他人的修改'); } });
    }) as typeof fs.open });
    await expect(new TableDraftFiles(dependency).save(document, owner)).rejects.toThrow('其他操作修改');
    expect(await fs.readFile(path, 'utf8')).toBe('他人的修改'); expect(await fs.readdir(dir)).toEqual(['输出.json']);
  });

  it('替换已成功但所有权失效时明确报告未知写入，保持实际文件', async () => {
    const dir = await directory(), path = join(dir, '输出.json'); let current = true;
    const dependency = ports(path, { rename: async (...args) => { await fs.rename(...args); current = false; } });
    await expect(new TableDraftFiles(dependency).save(document, { assertCurrent() { if (!current) throw new Error(stale); } })).rejects.toThrow(text.unknownWrite);
    expect(await fs.readFile(path, 'utf8')).toBe(encodeTableDraft(document)); expect(await fs.readdir(dir)).toEqual(['输出.json']);
    expect(dependency.released).toHaveBeenCalledTimes(1);
  });

  it('清理失败不能伪装成功，完成全部清理尝试后才解锁', async () => {
    const dir = await directory(), path = join(dir, '输出.json'), cleaning = deferred<void>(), finish = deferred<void>();
    const dependency = ports(path, { rename: async () => { throw new Error('重命名失败'); }, unlink: async () => { cleaning.resolve(); await finish.promise; throw new Error('临时文件清理失败'); } });
    const files = new TableDraftFiles(dependency), pending = files.save(document, owner), rejection = expect(pending).rejects.toThrow(text.unknownWrite);
    await cleaning.promise; await expect(files.open(owner)).rejects.toThrow(text.busy); expect(dependency.released).not.toHaveBeenCalled();
    finish.resolve(); await rejection; expect(dependency.released).toHaveBeenCalledTimes(1);
    expect((await fs.readdir(dir)).some(name => name.endsWith('.tmp'))).toBe(true);
  });
});
