import { describe, expect, it, vi } from 'vitest';
import { QueryCloseQueue } from '../../src/renderer/queryCloseQueue';
import type { WorkspaceTab } from '../../src/renderer/store';
import type { QueryCloseRequest } from '../../src/renderer/queryCloseIntent';

const tab = (id: string): WorkspaceTab => ({ id, kind: 'query', connectionId: 'c', title: id, sql: 'SELECT ' + id });
/** 所有变更同步通知RAM订阅，不能用恢复同ID或相同字段掩盖对象身份丢失。 */
function fixture() {
  const keep = tab('keep'), a = tab('a'), b = tab('b'), table: WorkspaceTab = { ...tab('table'), kind: 'table' };
  const state = { settings: { tabs: [keep, a, table, b] }, connections: [{ id: 'c' }], connectionVersions: {} as Record<string, number> }, listeners = new Set<() => void>(), requests: QueryCloseRequest[] = [], changes: boolean[] = [];
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const queue = new QueryCloseQueue({ read: () => state, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, close: (target, owner) => { const request = { tabId: target.id, ...owner.hooks(target) }; requests.push(request); return request; }, changed: value => changes.push(value) });
  return { state, keep, a, b, queue, requests, changes, listeners, notify, change(tabs: WorkspaceTab[]) { state.settings.tabs = tabs; notify(); }, close(request: QueryCloseRequest) { const current = state.settings.tabs.find(item => item.id === request.tabId)!; queue.finish(request, queue.remove(current, () => { state.settings.tabs = state.settings.tabs.filter(item => item !== current); notify(); })); queue.committed(request,true); } };
}

describe('关闭其他查询的对象归属与串行回执', () => {
  it('成功只标记待提交；准确提交票据到达前不关闭下一项，外部modal则停止',()=>{
    const f=fixture();f.queue.start(f.keep);const first=f.requests[0];f.queue.finish(first,f.queue.remove(f.a,()=>f.change(f.state.settings.tabs.filter(tab=>tab!==f.a))));
    expect(f.requests).toHaveLength(1);expect(f.queue.awaitingCommit).toBe(first);expect(f.queue.pending).toBe(true);first.failed!();expect(f.queue.running).toBe(true);
    f.queue.committed({...first},true);expect(f.requests).toHaveLength(1);f.queue.committed(first,false);expect(f.queue.running).toBe(false);expect(f.state.settings.tabs).toContain(f.b);
  });
  it('同队列B原租约不被旧A的failed或mutate停错；当前B第一次失败仍粘性停',()=>{
    const f=fixture();f.queue.start(f.keep);const a=f.requests[0];f.close(a);expect(f.requests.map(request=>request.tabId)).toEqual(['a','b']);
    a.failed!();expect(f.queue.running).toBe(true);expect(()=>a.mutate!(f.b,{title:'旧A无权变更B'},()=>{})).toThrow();expect(f.queue.running).toBe(true);
    f.requests[1].failed!();expect(f.queue.running).toBe(false);f.queue.finish(f.requests[1],false);expect(f.listeners.size).toBe(0);
  });
  it('按原顺序每次只有一个请求，只关闭query；新开标签永不纳入', () => {
    const f = fixture(); f.queue.start(f.keep); expect(f.requests.map(item => item.tabId)).toEqual(['a']);
    const added = tab('new'); f.change([...f.state.settings.tabs, added]); f.close(f.requests[0]); expect(f.requests.map(item => item.tabId)).toEqual(['a', 'b']);
    f.close(f.requests[1]); expect(f.state.settings.tabs.map(item => item.id)).toEqual(['keep', 'table', 'new']); expect(f.changes).toEqual([true, false]); expect(f.listeners.size).toBe(0);
  });
  it.each(['取消', '失败', '卸载'])('%s停止批次，旧回包不能继续关闭后面的查询', kind => {
    const f = fixture(); f.queue.start(f.keep); const old = f.requests[0];
    if (kind === '取消') f.queue.finish(old, false); if (kind === '失败') old.failed!(); if (kind === '卸载') f.queue.dispose();
    f.queue.finish(old, true); expect(f.requests).toHaveLength(1); expect(f.state.settings.tabs).toContain(f.b); expect(f.queue.running).toBe(false); expect(f.listeners.size).toBe(0);
  });
  it.each(['移除再重建', '相同字段新对象', '未来对象替换', '正文修改后恢复', '连接修订恢复', '连接对象替换'])('%s永久停链，不能认领同ID新世代', kind => {
    const f = fixture(); f.queue.start(f.keep);
    if (kind === '移除再重建') { f.change(f.state.settings.tabs.filter(item => item !== f.a)); f.change([f.keep, { ...f.a }, f.b]); }
    if (kind === '相同字段新对象') f.change(f.state.settings.tabs.map(item => item === f.a ? { ...item } : item));
    if (kind === '未来对象替换') f.change(f.state.settings.tabs.map(item => item === f.b ? { ...item } : item));
    if (kind === '正文修改后恢复') { f.change(f.state.settings.tabs.map(item => item === f.a ? { ...item, sql: '新正文' } : item)); f.change([f.keep, f.a, f.b]); }
    if (kind === '连接修订恢复') { f.state.connectionVersions.c = 1; f.notify(); f.state.connectionVersions.c = 0; f.notify(); }
    if (kind === '连接对象替换') { f.state.connections = [{ id: 'c' }]; f.notify(); }
    expect(f.queue.running).toBe(false); expect(f.queue.remove(f.state.settings.tabs.find(item => item.id === 'a')!, vi.fn())).toBe(false); f.queue.finish(f.requests[0], false); expect(f.requests).toHaveLength(1); expect(f.listeners.size).toBe(0);
  });
  it('只接纳原保存同步声明的标题/来源/库更新，保留对象身份至回执关闭', () => {
    const f = fixture(); f.queue.start(f.keep); const request = f.requests[0], patch = { title: '新保存标题', databaseContext: { state: 'known' as const, database: null } };
    request.mutate!(f.a, patch, () => f.change(f.state.settings.tabs.map(item => item === f.a ? { ...item, ...patch } : item)));
    expect(f.queue.running).toBe(true); f.close(request); expect(f.requests.map(item => item.tabId)).toEqual(['a', 'b']);
    f.queue.finish(request, true); expect(f.requests).toHaveLength(2); f.queue.dispose(); expect(f.listeners.size).toBe(0);
  });
  it('保存失败后的当前单次重试可完成，但不能恢复整个批次；外部变更仍拒绝', () => {
    const f = fixture(); f.queue.start(f.keep); const request = f.requests[0]; request.failed!();
    const patch = { title: '手动重试' }; request.mutate!(f.a, patch, () => f.change(f.state.settings.tabs.map(item => item === f.a ? { ...item, ...patch } : item)));
    f.close(request); expect(f.requests).toHaveLength(1); expect(f.state.settings.tabs).toContain(f.b); expect(f.listeners.size).toBe(0);
  });
});
