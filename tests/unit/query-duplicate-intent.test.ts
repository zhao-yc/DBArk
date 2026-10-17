import { describe, expect, it, vi } from 'vitest';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';
import { editorContentBridge, flushEditorContent } from '../../src/renderer/editorContentBridge';
import { QueryDuplicateIntent, type QueryDuplicateScope } from '../../src/renderer/queryDuplicateIntent';

/** 真实正文桥与复制控制器，Monaco只用RAM公开端口；无store、IPC或系统剪贴板。 */
function fixture() {
  const model = new ContentModelPort('SELECT 原文;'), editor = new ContentEditorPort(model), connection: any = { id: 'c' }, listeners = new Set<() => void>();
  let scope: QueryDuplicateScope = { tab: { id: 'q', kind: 'query', title: '已保存查询', connectionId: 'c', sql: model.value, databaseContext: { state: 'known', database: null }, sourceBinding: { id: 'saved', digest: 'a'.repeat(64), connectionId: 'c', context: { state: 'known', database: null } } }, connection, connectionVersion: 1, sessionId: '', present: true, active: true, blocked: false };
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const bridge = editorContentBridge(editor as any, () => ({ value: 'SELECT 原文;', readOnly: false, onChange: sql => { scope = { ...scope, tab: { ...scope.tab!, sql } }; notify(); } }), () => {});
  const open = vi.fn(), ports = { editor: () => editor as any, scope: () => scope, subscribe: (changed: () => void) => { listeners.add(changed); return () => { listeners.delete(changed); }; }, flush: flushEditorContent, database: async () => ({ state: 'known', database: null } as const), open };
  return { model, editor, bridge, open, ports, getScope: () => scope, change: (update: Partial<QueryDuplicateScope>) => { scope = { ...scope, ...update }; notify(); }, close: () => { bridge.dispose(); editor.dispose(); } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

describe('查询复制意图与既有正文桥', () => {
  it('flush补发尚未交付的最新模型正文，只建白名单独立草稿，不编辑原模型/撤销栈/来源', async () => {
    const f = fixture(); f.model.deferred = true; f.editor.nativeInput('SELECT 用户刚输入;'); const binding = f.getScope().tab!.sourceBinding, version = f.model.version;
    const intent = new QueryDuplicateIntent(f.ports); await intent.run();
    expect(f.open).toHaveBeenCalledExactlyOnceWith({ kind: 'query', title: '已保存查询（副本）', connectionId: 'c', sql: 'SELECT 用户刚输入;', database: undefined, databaseContext: { state: 'known', database: null } });
    expect(f.getScope().tab!.sourceBinding).toBe(binding); expect(f.model.getValue()).toBe('SELECT 用户刚输入;'); expect(f.model.version).toBe(version); expect(f.model.controlledEdits).toBe(0); expect(f.editor.undoStops).toBe(0); expect(f.editor.edits).toEqual([]);
    f.model.flush(); expect(f.open).toHaveBeenCalledTimes(1); await expect(intent.run()).rejects.toThrow('已变化'); f.close();
  });
  it('外部新草稿尚未进模型时不允许flush把旧模型覆盖回store', async () => {
    const f = fixture(); f.change({ tab: { ...f.getScope().tab!, sql: 'SELECT 外部新草稿;' } }); const intent = new QueryDuplicateIntent(f.ports);
    await expect(intent.run()).rejects.toThrow(); expect(f.getScope().tab!.sql).toBe('SELECT 外部新草稿;'); expect(f.model.getValue()).toBe('SELECT 原文;'); expect(f.open).not.toHaveBeenCalled(); f.close();
  });
  it.each(['关闭重开', '连接删除恢复', '连接修订恢复', '换连', '编辑撤回', '换模型', '只读', '弹窗', '新作业'] as const)('flush等待期%s永久失效，不接纳迟到返回', async kind => {
    const f = fixture(), wait = deferred<string>(); const intent = new QueryDuplicateIntent({ ...f.ports, flush: () => wait.promise }); const pending = intent.run(); const initial = f.getScope();
    if (kind === '关闭重开') { f.change({ present: false, tab: undefined }); f.change(initial); }
    if (kind === '连接删除恢复') { f.change({ connection: undefined }); f.change(initial); }
    if (kind === '连接修订恢复') { f.change({ connectionVersion: 2 }); f.change(initial); }
    if (kind === '换连') f.change({ tab: { ...initial.tab!, connectionId: 'other' } });
    if (kind === '编辑撤回') { f.editor.nativeInput('SELECT 新;'); f.editor.nativeInput('SELECT 原文;'); }
    if (kind === '换模型') f.editor.setModel(new ContentModelPort('SELECT 原文;')); if (kind === '只读') f.editor.readOnly = true; if (kind === '弹窗' || kind === '新作业') f.change({ blocked: true });
    wait.resolve('SELECT 原文;'); await expect(pending).rejects.toThrow('已变化'); expect(f.open).not.toHaveBeenCalled(); f.close();
  });
  it('等待协议上下文时关闭原编辑器，不会用已flush正文复活标签', async () => {
    const f = fixture(), wait = deferred<{ state: 'known'; database: string }>(); const intent = new QueryDuplicateIntent({ ...f.ports, database: () => wait.promise }), pending = intent.run(); await Promise.resolve(); f.close(); wait.resolve({ state: 'known', database: 'live' }); await expect(pending).rejects.toThrow(); expect(f.open).not.toHaveBeenCalled();
  });
  it('旧桥dispose不能删除同editor新桥的flush；失效/只读桥不能取正文', () => {
    const f = fixture(), second = editorContentBridge(f.editor as any, () => ({ value: f.model.value, readOnly: false }), () => {}); f.bridge.dispose(); expect(flushEditorContent(f.editor as any)).toBe(f.model.value); second.dispose(); expect(() => flushEditorContent(f.editor as any)).toThrow(); f.close();
  });
});
