import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { QueryFileSources, type QueryFileSourceScope } from '../../src/main/queryFileSources';
import { queryFileBytesDigest, queryFileSqlDigest } from '../../src/main/queryFileSourceFiles';
import type { PrivateQueryFileSource } from '../../src/main/queryFileSourceRecords';
import type { TaskEvent } from '../../src/shared/contracts';

interface RamFile { bytes: Buffer; mode: number; ino: bigint; mtime: bigint; ctime: bigint; }
const ram = vi.hoisted(() => ({ files: new Map<string, RamFile>(), target: '/mode-case/query.sql', log: [] as string[], fault: '' as '' | 'chmod' | 'readback' | 'cancel-chmod' | 'cancel-stat', cancelled: false, serial: 1n, removed: [] as string[], closed: [] as string[] }));
/** 仅读写RAM；普通mode按POSIX open(mode & ~umask)模拟，不依赖当前Windows mode映射。 */
vi.mock('node:fs/promises', () => {
  const get = (path: string) => { const file = ram.files.get(path); if (!file) throw Object.assign(Error('RAM文件不存在'), { code: 'ENOENT' }); return file; };
  const stat = (path: string) => {
    const file = get(path); let mode = file.mode;
    if (path !== ram.target && ram.fault === 'readback') mode &= ~0o020;
    if (path !== ram.target && ram.fault === 'cancel-stat') ram.cancelled = true;
    return { isFile: () => true, nlink: 1n, ino: file.ino, dev: 1n, size: BigInt(file.bytes.length), mtimeNs: file.mtime, ctimeNs: file.ctime, mode: BigInt(0o100000 | mode) };
  };
  return {
    lstat: async (path: string) => stat(path), realpath: async (path: string) => { get(path); return path; },
    open: async (path: string, flags: string, mode = 0o666) => {
      if (flags === 'wx') { if (ram.files.has(path)) throw Error('RAM临时文件已存在'); ram.files.set(path, { bytes: Buffer.alloc(0), mode: mode & ~0o022, ino: ++ram.serial, mtime: 2n, ctime: 2n }); ram.log.push('open:' + (mode & ~0o022).toString(8)); }
      const file = get(path); let cursor = 0;
      return {
        stat: async () => { ram.log.push(path === ram.target ? 'stat-target' : 'stat-temporary'); return stat(path); },
        read: async (buffer: Buffer, offset: number, length: number) => { const count = Math.min(length, file.bytes.length - cursor); file.bytes.copy(buffer, offset, cursor, cursor + count); cursor += count; return { bytesRead: count }; },
        write: async (bytes: Buffer, offset: number, length: number) => { ram.log.push('write'); file.bytes = Buffer.concat([file.bytes, bytes.subarray(offset, offset + length)]); return { bytesWritten: length }; },
        chmod: async (mode: number) => {
          ram.log.push('chmod:' + mode.toString(8)); if (ram.fault === 'chmod') throw Object.assign(Error('RAM权限设置失败'), { code: 'EPERM' });
          file.mode = mode; if (ram.fault === 'cancel-chmod') ram.cancelled = true;
        },
        sync: async () => { ram.log.push('sync'); }, close: async () => { ram.closed.push(path); ram.log.push('close'); }
      };
    },
    rename: async (from: string, to: string) => { ram.log.push('rename'); const file = get(from); ram.files.set(to, file); ram.files.delete(from); },
    rm: async (path: string) => { ram.removed.push(path); ram.files.delete(path); }
  };
});

beforeEach(() => {
  ram.files.clear(); ram.log.length = ram.removed.length = ram.closed.length = 0; ram.cancelled = false; ram.fault = ''; ram.serial = 1n;
  ram.files.set(ram.target, { bytes: Buffer.from('原内容\n'), mode: 0o664, ino: 1n, mtime: 1n, ctime: 1n });
});
/** 实际后台保存链使用RAM私有记录，验证typed wrote与提交次数；不启动SQLite、GUI或真实文件IO。 */
function fixture() {
  const original = ram.files.get(ram.target)!;
  let source: PrivateQueryFileSource = { version: 1, tabId: 'one', connectionId: 'ram', ref: { id: randomUUID(), revision: 1 }, path: ram.target, identity: { dev: '1', ino: '1', size: original.bytes.length, mtime: '1', ctime: '1' }, fileDigest: queryFileBytesDigest(original.bytes), savedSqlDigest: queryFileSqlDigest(original.bytes.toString('utf8')), encoding: 'utf8', bom: 'none', eol: 'lf' };
  const token = {}, events: TaskEvent[] = []; let commits = 0, reservations = 0;
  const scope: QueryFileSourceScope = { document: {}, assertCurrent: () => { if (ram.cancelled) throw Error('原文档已取消'); } };
  const service = new QueryFileSources({
    store: { queryFileSource: () => source, queryFileSourceRecords: () => [source], queryFileDocument: () => ({ token, tab: { id: 'one', kind: 'query', title: 'RAM', connectionId: 'ram', sql: '当前输入' } }), commitQueryFileSource: value => { commits++; source = value; }, releaseQueryFileSource: () => { throw Error('本例不释放私有来源'); }, queryRecentFiles: () => { throw Error('本例不访问最近记录'); }, queryRecentFile: () => { throw Error('本例不访问最近记录'); }, forgetRecentFile: () => { throw Error('本例不访问最近记录'); } },
    choose: async () => { throw Error('保存不得弹原生框'); }, report: event => events.push(event), reserve: async () => { reservations++; return () => { reservations--; }; }
  });
  return { original, events, commits: () => commits, reservations: () => reservations, save: () => service.save({ tabId: 'one', taskId: randomUUID(), source: source.ref, sql: '新内容\n' }, scope) };
}
/** 只允许删除本次wx取得的暂存文件；失败不触碰目标，预约和句柄必须结算。 */
function expectNoReplacement(f: ReturnType<typeof fixture>) {
  expect(ram.files.get(ram.target)).toBe(f.original); expect(ram.files.get(ram.target)?.bytes.toString()).toBe('原内容\n'); expect(ram.files.get(ram.target)?.mode).toBe(0o664);
  expect(ram.log).not.toContain('rename'); expect(f.commits()).toBe(0); expect(f.reservations()).toBe(0);
  expect([...ram.files.keys()]).toEqual([ram.target]); expect(ram.removed).toHaveLength(1); expect(ram.closed).toContain(ram.removed[0]); expect(ram.removed[0]).not.toBe(ram.target);
  expect(f.events.at(-1)?.queryFileSource?.wrote).toBe('no');
}
it('mode恢复成功：open受umask得到0644，写完显式chmod及fstat后保留原0664', async () => {
  const f = fixture(); expect(await f.save()).toMatchObject({ state: 'saved' });
  expect(ram.files.get(ram.target)?.mode).toBe(0o664); expect(ram.files.get(ram.target)?.bytes.toString()).toBe('新内容\n');
  const chmod = ram.log.indexOf('chmod:664'), lastWrite = ram.log.lastIndexOf('write'), modeReadback = ram.log.indexOf('stat-temporary');
  expect(ram.log).toContain('open:644'); expect(chmod).toBeGreaterThan(lastWrite); expect(modeReadback).toBeGreaterThan(chmod); expect(ram.log.indexOf('rename')).toBeGreaterThan(modeReadback);
  expect(f.commits()).toBe(1); expect(f.reservations()).toBe(0); expect(f.events.at(-1)).toMatchObject({ status: 'completed', queryFileSource: { wrote: 'yes' } });
});
it('chmod失败先拒绝，typed wrote=no且原文件与普通mode保持', async () => {
  ram.fault = 'chmod'; const f = fixture(); expect(await f.save()).toMatchObject({ state: 'blocked', wrote: 'no', reason: 'io' }); expectNoReplacement(f);
});
it('fstat不能证明mode一致时先拒绝，typed wrote=no且不替换原文件', async () => {
  ram.fault = 'readback'; const f = fixture(); expect(await f.save()).toMatchObject({ state: 'blocked', wrote: 'no', reason: 'io' }); expectNoReplacement(f);
});
it('chmod await返回后原文档取消，禁止后续替换并精确清理', async () => {
  ram.fault = 'cancel-chmod'; const f = fixture(); expect(await f.save()).toMatchObject({ state: 'blocked', wrote: 'no', reason: 'document-changed' }); expectNoReplacement(f); expect(f.events.at(-1)?.status).toBe('cancelled');
});
it('mode fstat await返回后原文档取消，禁止后续替换并精确清理', async () => {
  ram.fault = 'cancel-stat'; const f = fixture(); expect(await f.save()).toMatchObject({ state: 'blocked', wrote: 'no', reason: 'document-changed' }); expectNoReplacement(f); expect(f.events.at(-1)?.status).toBe('cancelled');
});
