import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rmdir, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { binaryCellFileBytes, binaryCellFileLimits as limits, binaryCellFileOpenSchema, binaryCellFileSaveSchema, binaryCellFileOpenOutputSchema, binaryCellFileSaveOutputSchema } from '../../src/shared/binaryCellFiles';
import { nativeAtomicFileIO, type AtomicFileIO, type WritableFile } from '../../src/engine/atomicFile';
import { readBinaryCellFile, writeBinaryCellFile, nativeBinaryCellFileReadIO, type BinaryCellFileReadIO, type BinaryCellFileReader } from '../../src/main/binaryCellFiles';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'dbark-binary-cell-files-')); });
/** 精确清理本例登记目录中的普通文件/链接与空目录，不扫描或删除其它路径。 */
afterEach(async () => { for (const name of await readdir(directory)) { const path = join(directory, name), value = await lstat(path); if (value.isDirectory() && !value.isSymbolicLink()) await rmdir(path); else await unlink(path); } await rmdir(directory); });
const check = () => undefined;
/** 保留真实open/read/close，只插入确定性的外部文件变更，终态以原close Promise为准。 */
function observeRead(hooks: { beforeOpen?: (path: string) => Promise<void>; afterRead?: (path: string, count: number) => Promise<void>; closeError?: boolean } = {}) {
  const facts = { opened: 0, closed: 0, reads: 0 };
  const io: BinaryCellFileReadIO = { ...nativeBinaryCellFileReadIO, async open(path) {
    await hooks.beforeOpen?.(path); const original = await nativeBinaryCellFileReadIO.open(path); facts.opened++;
    const handle: BinaryCellFileReader = { stat: () => original.stat(), async read(buffer, offset, length, position) { const result = await original.read(buffer, offset, length, position); facts.reads++; await hooks.afterRead?.(path, facts.reads); return result; }, async close() { await original.close(); facts.closed++; if (hooks.closeError) throw Error('合成close回执失败'); } }; return handle;
  } }; return { io, facts };
}
/** 包装真实原子IO，仅按指定阶段注入故障；内容和物理替换均不模拟。 */
function writeIO(wrap: (file: WritableFile) => WritableFile): AtomicFileIO { return { ...nativeAtomicFileIO, async open(path) { return wrap(await nativeAtomicFileIO.open(path)); } }; }

describe('二进制文件严格共享合同与规范Base64', () => {
  it('空串是零字节，完整字节和padding零位严格校验，不接受宽松解码前缀', () => {
    expect(binaryCellFileBytes('')).toBe(0); expect(binaryCellFileBytes('AA==')).toBe(1); expect(binaryCellFileBytes('AAA=')).toBe(2); expect(binaryCellFileBytes('AAAA')).toBe(3);
    for (const input of ['A', 'AA', 'AA=', 'AB==', 'AAB=', 'A===', '====', 'AA==\n', 'AA==junk', 'AA-_', '\ud800AAA', null, {}, 0]) expect(() => binaryCellFileBytes(input)).toThrow();
    const maximum = Buffer.alloc(limits.saveBytes).toString('base64'); expect(binaryCellFileBytes(maximum)).toBe(limits.saveBytes);
    expect(() => binaryCellFileBytes(Buffer.alloc(limits.saveBytes + 1).toString('base64'))).toThrow('2 MiB');
    expect(() => binaryCellFileBytes(Buffer.alloc(limits.openBytes + 1).toString('base64'), limits.openBytes)).toThrow('131071');
  });
  it('输入只接约定数据属性，建议名只能是单文件名，访问器不执行', () => {
    expect(binaryCellFileOpenSchema.parse({})).toEqual({}); expect(binaryCellFileSaveSchema.parse({ base64: '' })).toEqual({ base64: '' });
    expect(binaryCellFileSaveSchema.parse({ base64: 'AA==', suggestedName: '原字节.bin' })).toEqual({ base64: 'AA==', suggestedName: '原字节.bin' });
    for (const suggestedName of ['.', '..', '../a', 'a/b', 'a\\b', 'C:a', 'a\0b', 'a\nb', '\ud800', '名'.repeat(256), undefined]) expect(binaryCellFileSaveSchema.safeParse({ base64: '', suggestedName }).success).toBe(false);
    let calls = 0; const getter = {}; Object.defineProperty(getter, 'base64', { enumerable: true, get() { calls++; return ''; } });
    const hidden = {}; Object.defineProperty(hidden, 'base64', { value: '' });
    for (const input of [getter, hidden, Object.create({ base64: '' }), { base64: '', [Symbol('extra')]: 1 }, { base64: '', filePath: 'secret' }, { base64: '', fileToken: 'f' }, { base64: '', bytes: 0 }]) expect(binaryCellFileSaveSchema.safeParse(input).success).toBe(false);
    expect(binaryCellFileOpenSchema.safeParse({ filePath: '/任意路径' }).success).toBe(false); expect(calls).toBe(0);
  });
  it('输出核真实字节数和预算，取消仅为null而非NULL单元格', () => {
    expect(binaryCellFileOpenOutputSchema.parse({ base64: '', bytes: 0, name: '空.bin' })).toEqual({ base64: '', bytes: 0, name: '空.bin' });
    expect(binaryCellFileOpenOutputSchema.parse(null)).toBeNull(); expect(binaryCellFileSaveOutputSchema.parse(null)).toBeNull();
    expect(binaryCellFileOpenOutputSchema.safeParse({ base64: 'AA==', bytes: 0, name: 'a' }).success).toBe(false);
    expect(binaryCellFileSaveOutputSchema.safeParse({ bytes: limits.saveBytes + 1, name: 'a' }).success).toBe(false);
    expect(binaryCellFileOpenOutputSchema.safeParse({ base64: '', bytes: 0, name: 'a', path: '/不可回传' }).success).toBe(false);
  });
});

describe('真实普通文件有界载入及身份终态', () => {
  it.each([0, 512, limits.openBytes])('实际载入%s字节包含全字节/BOM/NUL，前后不解码、不丢第一字节且close完成', async count => {
    const bytes = Buffer.from(Array.from({ length: count }, (_, i) => i % 256)); if (count >= 3) { bytes[0] = 0xef; bytes[1] = 0xbb; bytes[2] = 0xbf; }
    const path = join(directory, '任意后缀.data'); await writeFile(path, bytes); const { io, facts } = observeRead();
    expect(await readBinaryCellFile(path, check, io)).toEqual({ bytes: count, base64: bytes.toString('base64'), name: basename(path) }); expect(facts.opened).toBe(1); expect(facts.closed).toBe(1);
  });
  it('已知大文件在open前拒绝，文件增长超过上限拒绝完整值并实际close', async () => {
    const path = join(directory, '增长.bin'); await writeFile(path, Buffer.alloc(limits.openBytes + 1)); let observed = observeRead();
    await expect(readBinaryCellFile(path, check, observed.io)).rejects.toThrow('131071'); expect(observed.facts.opened).toBe(0);
    await writeFile(path, Buffer.alloc(limits.openBytes)); observed = observeRead({ async afterRead(path, count) { if (count === 1) await appendFile(path, Buffer.from([1, 2])); } });
    await expect(readBinaryCellFile(path, check, observed.io)).rejects.toThrow('131071'); expect(observed.facts.closed).toBe(1);
  });
  it.each(['grow', 'same-size', 'replace', 'before-open'] as const)('%s真实改写或换文件不能成为旧授权的迟到值', async kind => {
    const path = join(directory, 'source.bin'); await writeFile(path, Buffer.from([1, 2, 3]));
    const change = async (actual: string) => { if (kind === 'grow') await appendFile(actual, Buffer.from([4])); else if (kind === 'same-size') { await writeFile(actual, Buffer.from([4, 5, 6])); await utimes(actual, new Date(0), new Date(0)); } else { await rename(actual, join(directory, 'original.bin')); await writeFile(actual, Buffer.from([4, 5, 6])); } };
    const observed = observeRead(kind === 'before-open' ? { beforeOpen: change } : { async afterRead(actual, count) { if (count === 1) await change(actual); } });
    await expect(readBinaryCellFile(path, check, observed.io)).rejects.toThrow('变化'); expect(observed.facts.closed).toBe(1);
  });
  it('目录与真实符号链接/Windows目录联接拒绝，不尝试打开读取内容', async () => {
    const folder = join(directory, 'folder'); await mkdir(folder); const link = join(directory, 'link'); await symlink(folder, link, process.platform === 'win32' ? 'junction' : 'dir'); const observed = observeRead();
    for (const path of [folder, link]) await expect(readBinaryCellFile(path, check, observed.io)).rejects.toThrow('普通文件'); expect(observed.facts.opened).toBe(0);
  });
  it('读取中撤权与原close回执失败均不发布字节，但原句柄仍已关闭', async () => {
    const path = join(directory, 'source.bin'); await writeFile(path, Buffer.from([1])); let allowed = true;
    let observed = observeRead({ async afterRead() { allowed = false; } }); await expect(readBinaryCellFile(path, () => { if (!allowed) throw Error('原文档失效'); }, observed.io)).rejects.toThrow('原文档失效'); expect(observed.facts.closed).toBe(1);
    observed = observeRead({ closeError: true }); await expect(readBinaryCellFile(path, check, observed.io)).rejects.toThrow('close'); expect(observed.facts.closed).toBe(1);
  });
});

describe('原字节另存真实原子替换与精确清理', () => {
  it.each([0, 256, limits.saveBytes])('实际保存%s字节完整值，不把suggestedName当目标，暂存无残留', async count => {
    const path = join(directory, '实际目标.bin'), bytes = Buffer.alloc(count); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    if (count > 3) { bytes[0] = 0xff; bytes[1] = 0xfe; bytes[2] = 0; }
    await writeFile(path, '原目标'); expect(await writeBinaryCellFile(path, { base64: bytes.toString('base64'), suggestedName: '仅建议.bin' }, check)).toEqual({ bytes: count, name: '实际目标.bin' });
    expect((await readFile(path)).equals(bytes)).toBe(true); expect(await readdir(directory)).toEqual(['实际目标.bin']);
  });
  it('无效base64和越界在任何临时文件open之前拒绝，原目标不变', async () => {
    const path = join(directory, 'target.bin'); await writeFile(path, '保留'); const open = vi.fn(nativeAtomicFileIO.open), io = { ...nativeAtomicFileIO, open };
    for (const base64 of ['AB==', Buffer.alloc(limits.saveBytes + 1).toString('base64')]) await expect(writeBinaryCellFile(path, { base64 }, check, io)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled(); expect(await readFile(path, 'utf8')).toBe('保留'); expect(await readdir(directory)).toEqual(['target.bin']);
  });
  it.each(['write', 'sync', 'close', 'rename'] as const)('%s真实阶段失败保留原目标并清理本例temp，原close不被mock冒充', async phase => {
    const path = join(directory, 'target.bin'); await writeFile(path, '保留'); let closeCount = 0;
    const io = writeIO(file => ({ ...file, async write(buffer, offset, length) { if (phase === 'write') throw Error('合成write失败'); return file.write(buffer, offset, length); }, async sync() { await file.sync(); if (phase === 'sync') throw Error('合成sync失败'); }, async close() { await file.close(); if (++closeCount === 1 && phase === 'close') throw Error('合成close失败'); } }));
    if (phase === 'rename') io.rename = async () => { throw Error('合成rename失败'); };
    await expect(writeBinaryCellFile(path, { base64: 'AAEC' }, check, io)).rejects.toThrow(); expect(closeCount).toBeGreaterThan(0); expect(await readFile(path, 'utf8')).toBe('保留'); expect(await readdir(directory)).toEqual(['target.bin']);
  });
  it('最后rename前撤权不替换目标，已同步关闭的原temp仍精确删除', async () => {
    const path = join(directory, 'target.bin'); await writeFile(path, '保留'); let allowed = true, checks = 0;
    const rename = vi.fn(nativeAtomicFileIO.rename), io: AtomicFileIO = { ...nativeAtomicFileIO, rename, async identity(path) { const identity = await nativeAtomicFileIO.identity!(path); if (++checks === 3) allowed = false; return identity; } };
    await expect(writeBinaryCellFile(path, { base64: 'AAEC' }, () => { if (!allowed) throw Error('原文档失效'); }, io)).rejects.toThrow('原文档失效'); expect(rename).not.toHaveBeenCalled(); expect(await readFile(path, 'utf8')).toBe('保留'); expect(await readdir(directory)).toEqual(['target.bin']);
  });
  it('目标外部改写拒绝覆盖，临时文件不残留', async () => {
    const path = join(directory, 'target.bin'); await writeFile(path, '原目标');
    const io = writeIO(file => ({ ...file, async sync() { await file.sync(); await writeFile(path, '外部新目标'); } }));
    await expect(writeBinaryCellFile(path, { base64: 'AAEC' }, check, io)).rejects.toThrow('变化'); expect(await readFile(path, 'utf8')).toBe('外部新目标'); expect(await readdir(directory)).toEqual(['target.bin']);
  });
  it('真实rename ACK后撤权保留已保存事实，不回滚、重放或再次检查旧文档', async () => {
    const path = join(directory, 'target.bin'); await writeFile(path, '原目标'); let allowed = true;
    const rename = vi.fn(async (source: string, target: string) => { await nativeAtomicFileIO.rename(source, target); allowed = false; });
    expect(await writeBinaryCellFile(path, { base64: 'AAEC' }, () => { if (!allowed) throw Error('晚撤权'); }, { ...nativeAtomicFileIO, rename })).toEqual({ bytes: 3, name: 'target.bin' }); expect((await readFile(path)).equals(Buffer.from([0, 1, 2]))).toBe(true); expect(rename).toHaveBeenCalledTimes(1); expect(await readdir(directory)).toEqual(['target.bin']);
  });
});
