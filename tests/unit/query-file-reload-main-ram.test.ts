import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import iconv from 'iconv-lite';
import { QueryFileSources } from '../../src/main/queryFileSources';
import { queryFileBytesDigest, queryFileSqlDigest } from '../../src/main/queryFileSourceFiles';
import type { PrivateQueryFileSource } from '../../src/main/queryFileSourceRecords';
import type { QueryFileSourceHost } from '../../src/main/queryFileSources';
import type { QueryFileExternalPreview } from '../../src/shared/queryFileReload';
import { queryFileTextDifference, queryFileReloadLimits } from '../../src/shared/queryFileReload';
import { validateCommand } from '../../src/shared/validation';

const disk = vi.hoisted(() => ({ bytes: Buffer.from('SELECT 1;\n'), ino: 10n, parentIno: 2n, clock: 1n, closes: 0, reads: 0, opens: 0, code: '', link: false, parentLink: false, canonical: true, gate: undefined as Promise<void> | undefined }));
// 真实Main、文件有界读取和解码都执行；只替换原始文件系统端口，绝不读写真实用户文件。
vi.mock('node:fs/promises', () => ({
  async realpath(path: string) { return disk.canonical ? path : path + '-外来'; },
  async lstat(path: string) { if (disk.code) throw Object.assign(Error('不透传原始错误'), { code: disk.code }); const directory = !path.endsWith('.sql'); return { isDirectory: () => directory, isSymbolicLink: () => directory ? disk.parentLink : disk.link, isFile: () => !directory && !disk.link, nlink: 1n, dev: 1n, ino: directory ? disk.parentIno : disk.ino, size: BigInt(disk.bytes.length), mtimeNs: disk.clock, ctimeNs: disk.clock, mode: 0o100600n }; },
  async open(_path: string, mode: string) { if (mode !== 'r') throw Error('禁止任何写文件'); disk.opens++; let position = 0; return { async stat() { return { isFile: () => true, nlink: 1n, dev: 1n, ino: disk.ino, size: BigInt(disk.bytes.length), mtimeNs: disk.clock, ctimeNs: disk.clock }; }, async read(buffer: Buffer, offset: number, length: number) { disk.reads++; await disk.gate; const n = Math.max(0, Math.min(length, disk.bytes.length - position)); disk.bytes.copy(buffer, offset, position, position + n); position += n; return { bytesRead: n }; }, async close() { disk.closes++; } }; },
  rename() { throw Error('禁止重命名'); }, rm() { throw Error('禁止删除'); },
}));
const path = resolve('RAM', 'script.sql');
function fixture() {
  let current: PrivateQueryFileSource = { version: 1, tabId: 't', connectionId: 'c', ref: { id: randomUUID(), revision: 1 }, path, parent: { path: dirname(path), dev: '1', ino: '2' }, identity: { dev: '1', ino: '10', size: disk.bytes.length, mtime: '1', ctime: '1' }, fileDigest: queryFileBytesDigest(disk.bytes), savedSqlDigest: queryFileSqlDigest(disk.bytes.toString()), encoding: 'utf8', bom: 'none', eol: 'lf' };
  let tab = { id: 't', kind: 'query' as const, title: '原草稿', connectionId: 'c', sql: disk.bytes.toString(), fileSourceBinding: current.ref }, token = {}, generation = 0, available = true, commits = 0, fail = false, now = 100;
  const store: QueryFileSourceHost['store'] = {
    queryFileDocument: () => ({ token, tab: { ...tab }, generation }), queryFileSource: () => structuredClone(current), queryFileSourceRecords: () => [current],
    commitQueryFileSource(source, expected, opened) { if (fail || expected?.revision !== current.ref.revision || opened?.previousSql !== tab.sql) throw Error('RAM事务拒绝'); commits++; current = structuredClone(source); tab = { ...tab, fileSourceBinding: source.ref, ...(opened?.sql === undefined ? {} : { sql: opened.sql }) }; },
    releaseQueryFileSource: () => false, queryRecentFiles: () => [], queryRecentFile: () => undefined, forgetRecentFile: () => false,
  };
  const host = { store, report: vi.fn(), choose: vi.fn(async () => path), reserve: vi.fn(async () => () => {}) }, scope = { document: {}, assertCurrent() { if (!available) throw Error('RAM窗口失效'); } }, service = new QueryFileSources(host, () => now);
  const input = () => ({ tabId: 't', taskId: randomUUID(), source: current.ref, draftDigest: queryFileSqlDigest(tab.sql) });
  return { service, scope, host, input, get source() { return current; }, get tab() { return tab; }, get commits() { return commits; }, dirty() { tab = { ...tab, sql: '未保存草稿\r\n' }; generation++; }, aba() { generation += 2; }, invalidate() { available = false; }, recreate() { token = {}; }, expire() { now += queryFileReloadLimits.lifetime; }, fail() { fail = true; }, legacy() { delete current.parent; }, async preview() { const p = await service.checkExternal(input(), scope); expect(p.state).toBe('preview'); return p as QueryFileExternalPreview; } };
}
afterEach(() => { Object.assign(disk, { bytes: Buffer.from('SELECT 1;\n'), ino: 10n, parentIno: 2n, clock: 1n, closes: 0, reads: 0, opens: 0, code: '', link: false, parentLink: false, canonical: true, gate: undefined }); });
it('检查只读且dirty明确；确认仅提交文件基线与新ref，原草稿待renderer接纳，零文件写入', async () => {
  const f = fixture(); f.dirty(); disk.bytes = Buffer.from('SELECT 2;\r\n'); disk.clock++; const p = await f.preview(); expect(p).toMatchObject({ change: 'modified', dirty: true, binding: { eol: 'crlf' } }); expect(f.commits).toBe(0); expect(f.source.ref.revision).toBe(1);
  const result = await f.service.reload({ ...f.input(), previewId: p.previewId }, f.scope); expect(result).toMatchObject({ state: 'reloaded', sql: 'SELECT 2;\r\n', binding: { ref: { revision: 2 }, savedSqlDigest: queryFileSqlDigest('SELECT 2;\r\n') } }); expect(f.commits).toBe(1); expect(f.tab.sql).toBe('未保存草稿\r\n'); expect(f.tab.fileSourceBinding).toEqual(f.source.ref); expect(f.host.choose).not.toHaveBeenCalled(); expect(f.host.reserve).not.toHaveBeenCalled();
  expect((await f.service.reload({ ...f.input(), previewId: p.previewId }, f.scope)).state).toBe('blocked'); expect(f.commits).toBe(1);
});
it.each(['utf8-bom', 'utf16le-bom', 'gb18030', 'mixed', 'cr', 'empty'])('编码/BOM/EOL及完整SQL沿原政策：%s', async kind => {
  const f = fixture(), sql = kind === 'empty' ? '' : kind === 'mixed' ? '甲\r\n乙\n丙\r' : kind === 'cr' ? '甲\r乙\r' : '甲\r\n乙\r\n';
  if (kind === 'gb18030') f.source.encoding = 'gb18030';
  disk.bytes = kind === 'utf16le-bom' ? Buffer.concat([Buffer.from([255, 254]), Buffer.from(sql, 'utf16le')]) : kind === 'utf8-bom' ? Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(sql)]) : kind === 'gb18030' ? Buffer.from(iconv.encode(sql, 'gb18030')) : Buffer.from(sql); disk.clock++;
  const p = await f.preview(), result = await f.service.reload({ ...f.input(), previewId: p.previewId }, f.scope); expect(result).toMatchObject({ state: 'reloaded', sql }); expect(f.source.savedSqlDigest).toBe(queryFileSqlDigest(sql));
});
it('同父目录单链接普通文件的原子替换明确显示replaced，只有确认才接纳新inode', async () => {
  const f = fixture(); disk.ino = 99n; disk.bytes = Buffer.from('新文件\n'); const p = await f.preview(); expect(p.change).toBe('replaced'); expect(f.source.identity.ino).toBe('10'); expect(f.commits).toBe(0);
  expect((await f.service.reload({ ...f.input(), previewId: p.previewId }, f.scope)).state).toBe('reloaded'); expect(f.source.identity.ino).toBe('99');
});
it.each(['missing', 'permission', 'link', 'parent', 'parentLink', 'canonical', 'badEncoding', 'oversize', 'legacy'])('%s明确拒绝且来源/草稿不变', async kind => {
  const f = fixture(), old = f.tab.sql;
  if (kind === 'missing') disk.code = 'ENOENT'; if (kind === 'permission') disk.code = 'EACCES'; if (kind === 'link') disk.link = true; if (kind === 'parent') disk.parentIno = 99n; if (kind === 'parentLink') disk.parentLink = true; if (kind === 'canonical') disk.canonical = false; if (kind === 'badEncoding') disk.bytes = Buffer.from([0xc0, 0xaf]); if (kind === 'oversize') disk.bytes = Buffer.alloc(20 * 1024 * 1024 + 1); if (kind === 'legacy') f.legacy();
  const result = await f.service.checkExternal(f.input(), f.scope); expect(result).toMatchObject({ state: 'blocked', wrote: 'no' }); if (kind === 'missing') expect(result).toHaveProperty('reason', 'missing'); if (kind === 'permission') expect(result).toHaveProperty('reason', 'permission'); if (kind === 'badEncoding') expect(result).toHaveProperty('reason', 'encoding'); expect(f.tab.sql).toBe(old); expect(f.commits).toBe(0); expect(disk.opens).toBe(disk.closes);
});
it.each(['secondChange', 'parentChange', 'generationABA', 'recreated', 'expired', 'cancelled', 'storageFailure'])('%s阻止确认，不发生部分来源推进', async kind => {
  const f = fixture(), p = await f.preview(), previous = structuredClone(f.source), oldSql = f.tab.sql;
  if (kind === 'secondChange') { disk.bytes = Buffer.from('再次改变'); disk.clock++; } if (kind === 'parentChange') disk.parentIno++; if (kind === 'generationABA') f.aba(); if (kind === 'recreated') f.recreate(); if (kind === 'expired') f.expire(); if (kind === 'storageFailure') f.fail(); if (kind === 'cancelled') f.service.discardReload({ tabId: 't', source: f.source.ref, previewId: p.previewId }, f.scope);
  expect((await f.service.reload({ ...f.input(), previewId: p.previewId }, f.scope)).state).toBe('blocked'); expect(f.source).toEqual(previous); expect(f.tab.sql).toBe(oldSql); expect(f.commits).toBe(0);
});
it('旧/别的文档令牌不能消费新预览；取消读取等待原句柄关闭，不创建预览', async () => {
  const f = fixture(), first = await f.preview(), second = await f.preview(); expect((await f.service.reload({ ...f.input(), previewId: first.previewId }, f.scope)).state).toBe('blocked');
  expect((await f.service.reload({ ...f.input(), previewId: second.previewId }, { ...f.scope, document: {} })).state).toBe('blocked'); expect((await f.service.reload({ ...f.input(), previewId: second.previewId }, f.scope)).state).toBe('reloaded');
  const next = fixture(); let release!: () => void; const beforeReads = disk.reads; disk.gate = new Promise<void>(yes => { release = yes; }); const input = next.input(), pending = next.service.checkExternal(input, next.scope); await vi.waitFor(() => expect(disk.reads).toBeGreaterThan(beforeReads)); const cancelled = next.service.cancel({ tabId: 't', taskId: input.taskId }, next.scope); release(); await cancelled; expect((await pending).state).toBe('blocked'); expect(next.commits).toBe(0); expect(disk.opens).toBe(disk.closes);
});
it('差异线性有界且不拆Unicode代理对；严格IPC拒绝任意路径/正文与未知字段', () => {
  const diff = queryFileTextDifference('前' + '甲'.repeat(100000) + '后', '前' + '🚢'.repeat(100000) + '后'); expect(diff.before.length).toBeLessThanOrEqual(32768); expect(diff.after.length).toBeLessThanOrEqual(32768); expect(diff).toMatchObject({ prefixUnits: 1, suffixUnits: 1, beforeTruncated: true, afterTruncated: true }); expect(diff.after.endsWith('🚢')).toBe(true);
  const f = fixture(), input = f.input(); expect(validateCommand('queryFileSources.checkExternal', input)).toEqual(input); for (const field of ['path', 'displayPath', 'sql', 'previewId']) expect(() => validateCommand('queryFileSources.checkExternal', { ...input, [field]: '禁止' })).toThrow();
});
