import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const progress: any = await import(new URL('../../scripts/native-editor-progress.mjs', import.meta.url).href);
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const state = { owners: 1, registeredPids: 3, pids: [101, 202, 303], confirmedOwners: 0, readyOwners: 0, closedOwners: 0, retained: false, removed: false };
/** 文件、FD、链接与失败全部为RAM端口；不创建真实目录或写任何实际文件。 */
function fixture() {
  let serial = 10, fdSerial = 100, allowed = true;
  const parent = resolve('RAM-progress'), directory = join(parent, 'installed-indent'), manifestPath = join(parent, 'installed-indent-manifest.json'), path = join(directory, 'progress.ndjson');
  const nodes = new Map<string, any>(), handles = new Map<number, any>(), operations: any[] = [], fail: any = {};
  const add = (path: string, directory: boolean, bytes = Buffer.alloc(0)) => nodes.set(path, { path, file: !directory, directory, link: false, dev: '2', ino: String(++serial), links: 1, bytes });
  add(parent, true); add(directory, true); add(manifestPath, false, Buffer.from('{"version":1,"kind":"installed"}'));
  const shape = (node: any) => ({ file: node.file, directory: node.directory, link: node.link, dev: node.dev, ino: node.ino, links: node.links, size: node.bytes.length });
  const io = {
    stat(path: string) { operations.push(['stat', path]); const node = nodes.get(path); if (!node) throw Error('RAM不存在'); return shape(node); },
    real(path: string) { operations.push(['real', path]); return nodes.get(path)?.real ?? path; },
    open(path: string, mode: string) { operations.push(['open', path, mode]); if (mode === 'create') { if (nodes.has(path)) throw Error('EEXIST'); add(path, false); } const node = nodes.get(path); if (!node) throw Error('RAM不存在'); const fd = ++fdSerial; handles.set(fd, { node, mode }); return fd; },
    fstat(fd: number) { return shape(handles.get(fd).node); },
    header(fd: number) { return handles.get(fd).node.bytes.subarray(0, 4096); },
    bytes(fd: number, maximum?: number) { if (fail.expireRead) allowed = false; return handles.get(fd).node.bytes.subarray(0, maximum ?? handles.get(fd).node.bytes.length); },
    append(fd: number, bytes: Buffer) { operations.push(['append', handles.get(fd).node.path]); if (fail.write) throw fail.write; const node = handles.get(fd).node; node.bytes = Buffer.concat([node.bytes, bytes]); return bytes.length; },
    close(fd: number) { const handle = handles.get(fd); handles.delete(fd); if (handle.mode === 'append' && fail.close) throw fail.close; },
  };
  const guard = () => { if (!allowed) throw Error('原期限失效'); };
  const options = { manifestPath, manifestSha256: hash(nodes.get(manifestPath).bytes), guard };
  const prepare = () => progress.prepareNativeProgress(options, io);
  const open = (descriptor: any) => progress.openNativeProgress({ ...options, enabled: true, listing: false, headerSha256: descriptor.sha256 }, io);
  return { io, nodes, operations, fail, guard, options, prepare, open, path, directory, handles, expire: () => { allowed = false; } };
}

describe('原生阶段持久诊断的固定目标与原guard（纯RAM）', () => {
  it.each([{ enabled: false, listing: false }, { enabled: true, listing: true }])('默认关闭/list不读写任何文件：%j', input => {
    const f = fixture(); expect(progress.openNativeProgress({ ...input, guard: f.guard }, f.io)).toBeUndefined(); expect(f.operations).toEqual([]);
  });
  it('正常只向原固定文件追加枚举/序号/数字状态，文件头绑定原批准与FD', () => {
    const f = fixture(), descriptor = f.prepare(), writer = f.open(descriptor), header = Buffer.from(f.nodes.get(f.path).bytes);
    writer.record('scan.begin', state); writer.record('launch.begin', state);
    const bytes = f.nodes.get(f.path).bytes; expect(bytes.subarray(0, header.length)).toEqual(header);
    const values = bytes.toString('utf8').trim().split('\n').map((line: string) => JSON.parse(line));
    expect(values[0].manifestSha256).toBe(f.options.manifestSha256); expect(values.slice(1)).toEqual([{ sequence: 1, stage: 'scan.begin', ...state }, { sequence: 2, stage: 'launch.begin', ...state }]);
    expect(f.operations.filter(row => row[0] === 'append').every(row => row[1] === f.path)).toBe(true); expect(f.handles.size).toBe(0);
    expect(() => f.prepare()).toThrow('EEXIST');
  });
  it.each(['link', 'inode', 'directory', 'hardlink'])('%s漂移后拒绝追加且不能恢复旧writer', mode => {
    const f = fixture(), writer = f.open(f.prepare()), before = Buffer.from(f.nodes.get(f.path).bytes);
    if (mode === 'link') f.nodes.get(f.path).link = true;
    if (mode === 'inode') f.nodes.get(f.path).ino = '999';
    if (mode === 'directory') f.nodes.get(f.directory).real = resolve('RAM-other');
    if (mode === 'hardlink') f.nodes.get(f.path).links = 2;
    expect(() => writer.record('launch.begin', state)).toThrow(); expect(f.nodes.get(f.path).bytes).toEqual(before); expect(f.handles.size).toBe(0);
  });
  it('原期限在manifest读取后失效，不创建writer或迟到追加', () => {
    const f = fixture(), descriptor = f.prepare(), before = Buffer.from(f.nodes.get(f.path).bytes); f.fail.expireRead = true;
    expect(() => f.open(descriptor)).toThrow('原期限失效'); expect(f.nodes.get(f.path).bytes).toEqual(before); expect(f.handles.size).toBe(0);
  });
  it('已打开writer到期也不能继续追加', () => {
    const f = fixture(), writer = f.open(f.prepare()), before = Buffer.from(f.nodes.get(f.path).bytes); f.expire();
    expect(() => writer.record('close.request', state)).toThrow('原期限失效'); expect(f.nodes.get(f.path).bytes).toEqual(before);
  });
  it('非固定basename、阶段或SQL额外字段不能取得写入', () => {
    const f = fixture(); expect(() => progress.prepareNativeProgress({ ...f.options, manifestPath: join(dirname(f.options.manifestPath), '任意.json') }, f.io)).toThrow();
    expect(f.operations).toEqual([]);
    const writer = f.open(f.prepare()), before = Buffer.from(f.nodes.get(f.path).bytes);
    expect(() => writer.record('任意动作', state)).toThrow(); expect(f.nodes.get(f.path).bytes).toEqual(before);
    const other = fixture(), second = other.open(other.prepare()), original = Buffer.from(other.nodes.get(other.path).bytes);
    expect(() => second.record('scan.begin', { ...state, sql: '不得写入诊断' })).toThrow(); expect(other.nodes.get(other.path).bytes).toEqual(original);
  });
  it('追加与关闭同时失败保留原错误cause，不以新IO吞原原因或自动重试', () => {
    const f = fixture(), writer = f.open(f.prepare()), original = Error('原追加失败'), close = Error('FD关闭失败'); f.fail.write = original; f.fail.close = close;
    let caught: any; try { writer.record('launch.begin', state); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError); expect(caught.cause).toBe(original); expect(caught.errors).toEqual([original, close]); expect(f.handles.size).toBe(0);
    const count = f.operations.filter(row => row[0] === 'append').length; delete f.fail.write; delete f.fail.close;
    expect(() => writer.record('launch.begin', state)).toThrow(); expect(f.operations.filter(row => row[0] === 'append')).toHaveLength(count);
  });
});
