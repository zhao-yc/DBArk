import { describe, expect, it } from 'vitest';
import { QueryCloseRequests, QuerySaveCloseIntent, type QueryCloseScope } from '../../src/renderer/queryCloseIntent';
/** 编辑器和订阅为可控IO端口，专门验证永久失效、世代和释放，不冒充Monaco或GUI。 */
function fixture(title?: string) {
  let sql = 'SELECT 合成;', version = 1, alive = true, current = true, disposed = false;
  let scope: QueryCloseScope = { present: true, title, connectionId: 'c', connectionVersion: 1, sessionId: 's', databaseContext: { state: 'known', database: null } };
  const listeners = new Map<string, Set<() => void>>();
  function listen(type: string, fn: () => void) { const set = listeners.get(type) ?? new Set(); set.add(fn); listeners.set(type, set); return { dispose: () => set.delete(fn) }; }
  function emit(type: string) { for (const fn of listeners.get(type) ?? []) fn(); }
  const model = { isDisposed: () => disposed, getValue: () => sql, getVersionId: () => version, onDidChangeContent: (fn: () => void) => listen('content', fn), onWillDispose: (fn: () => void) => listen('dispose', fn) };
  let active = model;
  const editor = { getModel: () => active, onDidChangeModel: (fn: () => void) => listen('model', fn), onDidDispose: (fn: () => void) => listen('editor', fn) };
  const intent = new QuerySaveCloseIntent(editor as any, () => scope, fn => { const disposable = listen('context', fn); return () => { disposable.dispose(); }; }, () => alive, () => current);
  return { intent, setScope(patch: Partial<QueryCloseScope>) { scope = { ...scope, ...patch }; emit('context'); }, edit(value: string) { sql = value; version++; emit('content'); }, replace() { active = { ...model }; emit('model'); }, cancel() { current = false; }, unmount() { alive = false; }, disposeModel() { disposed = true; emit('dispose'); }, count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0) };
}
describe('保存后关闭的一次性意图', () => {
  it('请求身份互斥，同标签新请求不接受旧返回', () => { const requests = new QueryCloseRequests(), a = requests.begin('t')!; expect(requests.begin('u')).toBeUndefined(); expect(requests.finish({ tabId: 't' })).toBe(false); expect(requests.finish(a)).toBe(true); const b = requests.begin('t')!; expect(requests.finish(a)).toBe(false); expect(requests.finish(b)).toBe(true); });
  it('普通完成有效，释放所有订阅后不可再次使用', () => { const f = fixture(); expect(f.intent.isCurrent()).toBe(true); expect(f.count()).toBe(5); f.intent.dispose(); expect(f.count()).toBe(0); expect(f.intent.isCurrent()).toBe(false); });
  it('文件自身可采纳保存后的文件名，用户标题变化即使恢复也永久保留标签', () => {
    const f = fixture('原文件'); f.intent.adoptTitle('新文件'); f.setScope({ title: '新文件' }); expect(f.intent.isCurrent()).toBe(true);
    f.setScope({ title: '用户标题' }); f.setScope({ title: '新文件' }); expect(f.intent.isCurrent()).toBe(false); f.intent.dispose(); expect(f.count()).toBe(0);
  });
  it.each(['connection', 'connectionId', 'connectionVersion', 'sessionId', 'draft', 'database', 'databaseContext', 'present', 'blocked'] as const)('%s变化后即使恢复也不能复活', key => { const f = fixture(); const before: any = { connection: undefined, connectionId: 'c', connectionVersion: 1, sessionId: 's', draft: undefined, database: undefined, databaseContext: { state: 'known', database: null }, present: true, blocked: undefined }; const values: any = { connection: {}, connectionId: 'other', connectionVersion: 2, sessionId: 'new', draft: '外部草稿', database: 'db', databaseContext: { state: 'unknown' }, present: false, blocked: true }; f.setScope({ [key]: values[key] }); f.setScope({ [key]: before[key] }); expect(f.intent.isCurrent()).toBe(false); f.intent.dispose(); });
  it.each(['edit', 'replace', 'cancel', 'unmount', 'disposeModel'])('%s拒绝自动关闭', method => { const f = fixture(); if (method === 'edit') { f.edit('新SQL'); f.edit('SELECT 合成;'); } else (f as any)[method](); expect(f.intent.isCurrent()).toBe(false); f.intent.dispose(); });
  it('允许保存自身采纳明确上下文，其它变化不能靠采纳复活', () => { const f = fixture(); f.intent.adoptContext({ state: 'known', database: 'db' }); f.setScope({ database: 'db', databaseContext: { state: 'known', database: 'db' } }); expect(f.intent.isCurrent()).toBe(true); f.setScope({ databaseContext: { state: 'unknown' } }); expect(() => f.intent.adoptContext({ state: 'known', database: 'db' })).toThrow('已变化'); f.intent.dispose(); });
});
