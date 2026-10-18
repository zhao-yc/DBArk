import { describe, expect, it, vi } from 'vitest';
import { QueryFileTaskOperation, canCancelQueryFileTask, cancelQueryFileTask, type QueryFileTaskState } from '../../src/renderer/queryFileTasks';
import { queryFileSourceHasChanges, queryFileSourceSqlDigest } from '../../src/shared/queryFileSources';
import type { WorkspaceTab } from '../../src/renderer/store';
import type { TaskEvent } from '../../src/shared/contracts';

/** 任务、文档与取消均为RAM端口；不读取文件或连接Main、数据库、网络。 */
function fixture() {
  let tab: WorkspaceTab | undefined = { id: 't', kind: 'query', connectionId: 'c', title: '中文文件', sql: 'SELECT 原文;', fileSourceBinding: { id: '11111111-1111-4111-8111-111111111111', revision: 1 } }, alive = true;
  const taskId = crypto.randomUUID(), documents = new Set<() => void>(), events = new Set<(event: TaskEvent) => void>(), states: QueryFileTaskState[] = [], order: string[] = [];
  const cancel = vi.fn(async (_input: { tabId: string; taskId: string }) => ({ cancelled: true }));
  const owner = new QueryFileTaskOperation({ ...tab }, taskId, 'save', { read: () => tab, ownsView: () => alive,
    subscribeDocument(fn) { order.push('订阅文档'); documents.add(fn); return () => { documents.delete(fn); }; }, subscribeTask(fn) { order.push('订阅事件'); events.add(fn); return () => { events.delete(fn); }; }, cancel, publish(value) { states.push(value); } });
  return { taskId, owner, cancel, order, states, count: () => documents.size + events.size,
    event(patch: Partial<TaskEvent['queryFileSource']> = {}, status: TaskEvent['status'] = 'running', id = taskId) { for (const fn of events) fn({ taskId: id, status, progress: 20, message: '不可展示的进度路径/SQL', queryFileSource: { tabId: 't', operation: 'save', phase: 'staging', bytesProcessed: 10, totalBytes: 20, wrote: 'no', cancellable: true, ...patch } }); },
    change(patch: Partial<WorkspaceTab>) { if (tab) tab = { ...tab, ...patch }; for (const fn of documents) fn(); },
    remove() { tab = undefined; for (const fn of documents) fn(); }, unmount() { alive = false; owner.documentCurrent(); return owner.cancel(true); },
    finish() { owner.finish({ state: 'cancelled' }); } };
}
describe('追加文件任务合同的文档绑定与取消', () => {
  it('先订阅再由调用者发RPC；未确认阶段不授权取消，准确事件才授权且不泄漏扩展字段', async () => {
    const f = fixture(); try { f.order.push('调用RPC'); expect(f.order).toEqual(['订阅事件', '订阅文档', '调用RPC']); expect(canCancelQueryFileTask(f.taskId)).toBe(false);
      f.event({}, 'running', crypto.randomUUID()); f.event({ tabId: '其它文档' }); expect(canCancelQueryFileTask(f.taskId)).toBe(false);
      f.event({ displayPath: '不可展示的路径', sql: '不可展示的SQL' } as any); expect(canCancelQueryFileTask(f.taskId)).toBe(true); expect(f.states.at(-1)).toMatchObject({ bytesProcessed: 10, totalBytes: 20 }); expect(JSON.stringify(f.states)).not.toContain('不可展示');
      await cancelQueryFileTask(f.taskId); await cancelQueryFileTask(f.taskId); expect(f.cancel).toHaveBeenCalledExactlyOnceWith({ tabId: 't', taskId: f.taskId }); expect(f.states.at(-1)?.status).toBe('running');
    } finally { f.finish(); expect(f.count()).toBe(0); }
  });
  it.each(['连接', '数据库', '文件来源', '来源ABA', '关闭', '卸载'] as const)('%s只取消准确旧任务，不能在文档恢复后复活', async kind => {
    const f = fixture(); try {
      f.event();
      if (kind === '连接') f.change({ connectionId: '新连接' }); if (kind === '数据库') f.change({ databaseContext: { state: 'known', database: '新库' } });
      if (kind === '文件来源' || kind === '来源ABA') { f.change({ fileSourceBinding: { id: '11111111-1111-4111-8111-111111111111', revision: 2 } }); if (kind === '来源ABA') f.change({ fileSourceBinding: { id: '11111111-1111-4111-8111-111111111111', revision: 1 } }); }
      if (kind === '关闭') f.remove(); if (kind === '卸载') await f.unmount();
      await Promise.resolve(); expect(f.owner.documentCurrent()).toBe(false); expect(f.cancel).toHaveBeenCalledExactlyOnceWith({ tabId: 't', taskId: f.taskId }); expect(canCancelQueryFileTask(f.taskId)).toBe(false);
    } finally { f.finish(); }
  });
  it('正文及标题编辑继续保留，不撤销正在保存的点击快照', () => { const f = fixture(); try { f.event(); f.change({ sql: 'SELECT 新正文;', title: '用户新标题' }); expect(f.owner.documentCurrent()).toBe(true); expect(f.cancel).not.toHaveBeenCalled(); } finally { f.finish(); } });
  it('提交点永久关闭取消，迟到staging或取消回包都不能把已写保存改成未写', async () => {
    const f = fixture(); try {
      f.event(); f.cancel.mockResolvedValueOnce({ cancelled: false }); await cancelQueryFileTask(f.taskId);
      f.event({ phase: 'replacing', wrote: 'yes', cancellable: false }); f.event({ phase: 'staging', wrote: 'no', cancellable: true }); await cancelQueryFileTask(f.taskId);
      expect(f.cancel).toHaveBeenCalledTimes(1); expect(f.states.at(-1)).toMatchObject({ committed: true, wrote: 'yes', cancellable: false });
      expect(f.owner.finish({ state: 'saved', unchanged: false })).toBe('yes'); expect(f.states.at(-1)).toMatchObject({ status: 'completed', wrote: 'yes', running: false }); expect(f.count()).toBe(0);
    } finally { f.finish(); }
  });
  it('取消RPC失败不自动重试；原操作最终成功仍记录真实已写', async () => {
    const f = fixture(); try { f.event(); f.cancel.mockRejectedValueOnce(Error('不可展示的系统异常')); await cancelQueryFileTask(f.taskId); expect(f.states.at(-1)?.cancelState).toBe('unknown'); await cancelQueryFileTask(f.taskId); expect(f.cancel).toHaveBeenCalledTimes(1); f.owner.finish({ state: 'saved', unchanged: false }); expect(f.states.at(-1)?.status).toBe('completed'); expect(JSON.stringify(f.states)).not.toContain('不可展示'); } finally { f.finish(); }
  });
  it('取消终态不能被迟到running复活；无写完成与已写事实分别保留', () => {
    const f = fixture(); try { f.event({}, 'cancelled'); f.event(); expect(canCancelQueryFileTask(f.taskId)).toBe(false); f.owner.finish({ state: 'saved', unchanged: true }); expect(f.states.at(-1)).toMatchObject({ status: 'completed', wrote: 'no' }); } finally { f.finish(); }
  });
});
describe('追加共享摘要算法在renderer的使用边界', () => {
  it.each(['SELECT \ud800', 'SELECT \udc00', 'SELECT \0'])('非法Unicode/NUL保持未知dirty，不能经TextEncoder替换后假报相同', async sql => { await expect(queryFileSourceSqlDigest(sql)).rejects.toThrow(); });
  it('正文BOM和CRLF保持逐字；相同正文的编码、BOM或换行变化仍dirty', async () => {
    const sql = '\ufeffSELECT 中文😀;\r\n'; const digest = await queryFileSourceSqlDigest(sql), baseline = { ref: { id: crypto.randomUUID(), revision: 1 }, name: '合成', displayPath: 'RAM', encoding: 'utf8' as const, bom: 'none' as const, eol: 'crlf' as const, savedSqlDigest: digest };
    expect(await queryFileSourceHasChanges(sql, baseline)).toBe(false); expect(await queryFileSourceHasChanges(sql.slice(1), baseline)).toBe(true); expect(await queryFileSourceHasChanges(sql.replace('\r\n', '\n'), baseline)).toBe(true);
    for (const format of [{ encoding: 'utf16le' as const }, { bom: 'utf8' as const }, { eol: 'lf' as const }]) expect(await queryFileSourceHasChanges(sql, baseline, format)).toBe(true);
  });
});
