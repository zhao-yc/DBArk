import { describe, expect, it, vi } from 'vitest';
import type { Stats } from 'node:fs';
import type { AtomicFileIO } from '../../src/engine/atomicFile';
import { SnippetTransfers, type SnippetTransferPorts } from '../../src/main/snippetTransfer';
import { encodeSnippetTransfer, snippetTransferLimits } from '../../src/shared/snippetTransfer';
import type { SqlSnippet } from '../../src/shared/contracts';

// 路径归一化及全部文件句柄均为RAM端口，不触发系统对话框、磁盘或数据库。
vi.mock('node:fs/promises', () => ({ realpath: async (path: string) => path, open: () => { throw Error('禁止真实打开'); }, rename: () => { throw Error('禁止真实发布'); }, rm: () => { throw Error('禁止真实删除'); }, lstat: () => { throw Error('禁止真实stat'); } }));
const sample: SqlSnippet = { id: '用户一', name: '片段', group: '', description: '', sql: 'SELECT 1;\r\n', updatedAt: '' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function memoryIO() {
  const files = new Map<string, Buffer>(); let stage = '', closed = 0, renames = 0, removed = 0;
  const state = { failWrite: false, failSync: false, failRemove: false, failRename: false, beforeRename: undefined as (() => Promise<void>) | undefined, beforeWrite: undefined as (() => Promise<void>) | undefined };
  const identity = (path: string) => { if (!files.has(path)) throw Error('RAM文件缺失'); return String(files.get(path)!.length); };
  const io: AtomicFileIO = {
    async open(path) { stage = path; files.set(path, Buffer.alloc(0)); return {
      async write(buffer, offset, length) { await state.beforeWrite?.(); if (state.failWrite) throw Error('RAM写失败'); const take = Math.min(length, 17); files.set(path, Buffer.concat([files.get(path)!, Buffer.from(buffer.subarray(offset, offset + take))])); return { bytesWritten: take }; },
      async sync() { if (state.failSync) throw Error('RAM同步失败'); }, async close() { closed++; }, async identity() { return identity(path); },
      async protectOwnership() { return async () => { if (state.failRemove) throw Error('RAM清理失败'); files.delete(path); removed++; }; },
    }; },
    identity: async path => identity(path), parentIdentity: async () => 'RAM父目录',
    async rename(from, to) { renames++; await state.beforeRename?.(); if (state.failRename) throw Error('RAM发布失败'); files.set(to, files.get(from)!); files.delete(from); }, async remove() { throw Error('不得绕过原清理能力'); },
  };
  return { io, files, state, get stage() { return stage; }, get closed() { return closed; }, get renames() { return renames; }, get removed() { return removed; } };
}
function harness(incoming: SqlSnippet[] = [sample], existing: SqlSnippet[] = [], overrides: Partial<SnippetTransferPorts> = {}) {
  let rows = structuredClone(existing), revision = 0, alive = true, closes = 0, statCount = 0, applied = 0, now = 100;
  const raw = Buffer.from(encodeSnippetTransfer(incoming));
  const handle = { async stat() { statCount++; return { size: raw.length, dev: 1, ino: 2, mtimeMs: 3, ctimeMs: 4, isFile: () => true } as Stats; }, async read(buffer: Buffer, offset: number, length: number, position: number) { const size = Math.max(0, Math.min(length, raw.length - position)); raw.copy(buffer, offset, position, position + size); return { bytesRead: size }; }, async close() { closes++; } };
  const store = { snippets: () => structuredClone(rows), snippetRevision: () => revision, applySnippetBatch(changed: SqlSnippet[], expected: number, current: () => void) { current(); if (expected !== revision) throw Error('RAM修订变化'); applied++; const ids = new Set(changed.map(s => s.id)); rows = [...rows.filter(s => !ids.has(s.id)), ...structuredClone(changed)]; if (changed.length) revision++; } };
  const owner = { document: {}, assertCurrent() { if (!alive) throw Error('RAM文档失效'); } }, io = memoryIO();
  const ports = { choose: vi.fn(async () => 'RAM片段.json'), read: vi.fn(async () => handle), io: io.io, ...overrides };
  const service = new SnippetTransfers(store, ports, () => now), { scopeId } = service.open(owner);
  return { service, owner, scopeId, ports, store, handle, io, raw, get closes() { return closes; }, get applied() { return applied; }, get statCount() { return statCount; }, bump() { revision++; }, expire() { now += snippetTransferLimits.lifetime; }, invalidate() { alive = false; } };
}
describe('真实Main片段传输协调器，文件与库端口仅RAM', () => {
  it('预览零保存，外部修改返回快照不影响Main；一次明确确认保存且令牌不重放', async () => {
    const h = harness(), p = (await h.service.preview(h.scopeId, h.owner))!; expect(h.applied).toBe(0); expect(h.closes).toBe(1); expect(h.statCount).toBe(2);
    p.entries[0].snippet.sql = '篡改'; const result = h.service.apply(h.scopeId, h.owner, p.previewId, [{ id: sample.id, action: 'add' }]);
    expect(result).toMatchObject({ added: 1, replaced: 0, skipped: 0 }); expect(result.items[0].sql).toBe(sample.sql); expect(h.applied).toBe(1);
    expect(() => h.service.apply(h.scopeId, h.owner, p.previewId, [{ id: sample.id, action: 'add' }])).toThrow();
  });
  it('同ID仅显式replace；新增可skip，same不得replace，非法决定消费预览', async () => {
    const h = harness([{ ...sample, sql: 'SELECT 2' }, { ...sample, id: '副本' }], [sample]); const p = (await h.service.preview(h.scopeId, h.owner))!;
    expect(h.service.apply(h.scopeId, h.owner, p.previewId, [{ id: sample.id, action: 'replace' }, { id: '副本', action: 'skip' }])).toMatchObject({ added: 0, replaced: 1, skipped: 1 });
    const same = harness([sample], [sample]), q = (await same.service.preview(same.scopeId, same.owner))!;
    expect(() => same.service.apply(same.scopeId, same.owner, q.previewId, [{ id: sample.id, action: 'replace' }])).toThrow();
    expect(() => same.service.apply(same.scopeId, same.owner, q.previewId, [{ id: sample.id, action: 'skip' }])).toThrow(); expect(same.applied).toBe(0);
  });
  it.each(['修订往返', '过期', '取消', '不同文档', '重复决定', '未知ID'] as const)('%s使预览失败且零保存', async kind => {
    const h = harness(), p = (await h.service.preview(h.scopeId, h.owner))!; let owner = h.owner, decisions: { id: string; action: 'add' }[] = [{ id: sample.id, action: 'add' }];
    if (kind === '修订往返') { h.bump(); h.bump(); } if (kind === '过期') h.expire(); if (kind === '取消') h.service.cancel(h.scopeId, h.owner); if (kind === '不同文档') owner = { ...owner, document: {} }; if (kind === '重复决定') decisions.push(decisions[0]); if (kind === '未知ID') decisions[0].id = '未知';
    expect(() => h.service.apply(h.scopeId, owner, p.previewId, decisions)).toThrow(); expect(h.applied).toBe(0);
  });
  it('原生选择取消返回null；选择迟到取消不打开文件，也不复活预览', async () => {
    const gate = deferred<string | undefined>(), h = harness([sample], [], { choose: () => gate.promise }); const pending = h.service.preview(h.scopeId, h.owner);
    h.service.cancel(h.scopeId, h.owner); gate.resolve('迟到路径'); await expect(pending).rejects.toThrow(); expect(h.ports.read).not.toHaveBeenCalled(); expect(h.applied).toBe(0);
    const cancelled = harness([sample], [], { choose: async () => undefined }); expect(await cancelled.service.preview(cancelled.scopeId, cancelled.owner)).toBeNull();
  });
  it('open迟到、read迟到及原文档失效均关闭原句柄，零预览/保存', async () => {
    for (const at of ['open', 'read', 'owner']) {
      const h = harness(), gate = deferred<void>();
      if (at === 'open') h.ports.read = vi.fn(async () => { await gate.promise; return h.handle; });
      else { const read = h.handle.read; h.handle.read = async (...args) => { await gate.promise; return read(...args); }; }
      const pending = h.service.preview(h.scopeId, h.owner); await vi.waitFor(() => expect(h.ports.read).toHaveBeenCalled());
      if (at === 'owner') h.invalidate(); else h.service.cancel(h.scopeId, h.owner, true); gate.resolve(); await expect(pending).rejects.toThrow(); expect(h.closes).toBe(1); expect(h.applied).toBe(0);
    }
  });
  it('读期间文件变化、超预算和关闭失败都拒绝，不写库', async () => {
    for (const kind of ['变化', '超限', '关闭失败']) {
      const h = harness(); const stat = h.handle.stat; h.handle.stat = async () => { const value = await stat(); return kind === '超限' ? { ...value, size: snippetTransferLimits.bytes + 1 } as Stats : kind === '变化' && h.statCount === 2 ? { ...value, ino: 99 } as Stats : value; };
      if (kind === '关闭失败') h.handle.close = async () => { throw Error('RAM关闭失败'); };
      await expect(h.service.preview(h.scopeId, h.owner)).rejects.toThrow(); expect(h.applied).toBe(0);
    }
  });
  it('真实AtomicFile短写、保护、同步、关闭、rename完整发布，只有用户片段', async () => {
    const h = harness([sample], [sample]); expect(await h.service.export(h.scopeId, h.owner)).toEqual({ count: 1 });
    expect(h.io.files.get('RAM片段.json')?.toString()).toBe(encodeSnippetTransfer([sample])); expect(h.io.files.has(h.io.stage)).toBe(false); expect(h.io.renames).toBe(1); expect(h.io.closed).toBe(1);
  });
  it.each(['failWrite', 'failSync', 'failRename'] as const)('%s保持原目标，无部分发布与自动重试，清理只用原能力', async key => {
    const h = harness([sample], [sample]); h.io.files.set('RAM片段.json', Buffer.from('原目标')); h.io.state[key] = true;
    await expect(h.service.export(h.scopeId, h.owner)).rejects.toThrow(); expect(h.io.files.get('RAM片段.json')?.toString()).toBe('原目标'); expect(h.io.removed).toBe(1); expect(h.io.files.has(h.io.stage)).toBe(false);
  });
  it('写入取消不发布；rename提交点之后拒绝取消并按原提交结果结算', async () => {
    const h = harness([sample], [sample]); h.io.files.set('RAM片段.json', Buffer.from('原目标')); h.io.state.beforeWrite = async () => { h.service.cancel(h.scopeId, h.owner); };
    await expect(h.service.export(h.scopeId, h.owner)).rejects.toThrow(); expect(h.io.renames).toBe(0); expect(h.io.files.get('RAM片段.json')?.toString()).toBe('原目标');
    const committed = harness([sample], [sample]); committed.io.state.beforeRename = async () => { expect(committed.service.cancel(committed.scopeId, committed.owner)).toEqual({ cancelled: false }); };
    expect(await committed.service.export(committed.scopeId, committed.owner)).toEqual({ count: 1 }); expect(committed.io.renames).toBe(1);
  });
  it('原写入和原清理双失败同时保留，原目标不动，不自动重试', async () => {
    const h = harness([sample], [sample]); h.io.state.failWrite = h.io.state.failRemove = true;
    const error = await h.service.export(h.scopeId, h.owner).catch(e => e); expect(error).toBeInstanceOf(AggregateError); expect(error.errors.map((e: Error) => e.message)).toEqual(['RAM写失败', 'RAM清理失败']); expect(h.io.renames).toBe(0);
  });
  it('提交前暂存或父目录身份变化均不rename，原目标保留', async () => {
    for (const side of ['stage', 'parent']) {
      const h = harness([sample], [sample]); h.io.files.set('RAM片段.json', Buffer.from('原目标')); let checks = 0;
      if (side === 'stage') h.io.io.identity = async () => '外来文件';
      else h.io.io.parentIdentity = async () => ++checks === 1 ? '原父目录' : '外来父目录';
      await expect(h.service.export(h.scopeId, h.owner)).rejects.toThrow(); expect(h.io.renames).toBe(0); expect(h.io.files.get('RAM片段.json')?.toString()).toBe('原目标');
    }
  });
  it('关闭释放scope且迟到旧scope不能影响新scope；库修订发生在选择期间不打开文件', async () => {
    const gate = deferred<string | undefined>(), h = harness([sample], [], { choose: () => gate.promise }); const pending = h.service.preview(h.scopeId, h.owner); h.bump(); gate.resolve('RAM片段.json'); await expect(pending).rejects.toThrow(); expect(h.ports.read).not.toHaveBeenCalled();
    h.service.cancel(h.scopeId, h.owner, true); expect(() => h.service.cancel(h.scopeId, h.owner)).toThrow(); const next = h.service.open(h.owner); expect(next.scopeId).not.toBe(h.scopeId);
  });
});
