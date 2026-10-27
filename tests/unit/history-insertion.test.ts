import { describe, expect, it, vi } from 'vitest';
import { captureHistoryInsertion, HistoryInsertionRegistry, type HistoryInsertionEditor, type HistoryInsertionScope } from '../../src/renderer/historyInsertion';
import { historyInsertionZh as text } from '../../src/renderer/locales/historyInsertion.zh-CN';

/** 最小编辑端口只记录普通编辑及undo边界，不模拟或宣称原生Monaco撤销已验。 */
function fixture() {
  const changes = new Set<() => void>(), models = new Set<() => void>(), cursors = new Set<() => void>(), deaths = new Set<() => void>(), workspace = new Set<() => void>();
  const event = (set: Set<() => void>) => (listener: () => void) => { set.add(listener); return { dispose: () => { set.delete(listener); } }; };
  let version = 1, disposed = false;
  let range = { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 9 };
  const model = { isDisposed: () => disposed, getVersionId: () => version, getValueLength: () => 9, getValueLengthInRange: () => 1, onDidChangeContent: event(changes) };
  const calls: string[] = [];
  let attached: typeof model | null = model;
  const edit = vi.fn<HistoryInsertionEditor['executeEdits']>(() => { calls.push('edit'); version++; for (const listener of [...changes]) listener(); return true; });
  const editor: HistoryInsertionEditor = { getModel: () => attached, getSelection: () => range, onDidChangeModel: event(models), onDidChangeCursorSelection: event(cursors), onDidDispose: event(deaths), pushUndoStop: () => { calls.push('undo-stop'); return true; }, executeEdits: edit };
  let state: HistoryInsertionScope = { tab: { id: 'q', kind: 'query', title: '原查询', connectionId: 'c', database: 'original', sql: 'SELECT 1;' }, activeTabId: 'q', connection: {}, connectionVersion: 1, selection: {}, session: 'session', execution: 'execution', alive: true, busy: false, closing: false };
  const capture = () => captureHistoryInsertion(editor, () => state, listener => { workspace.add(listener); return () => { workspace.delete(listener); }; });
  const update = (patch: Partial<HistoryInsertionScope>) => { state = { ...state, ...patch }; for (const listener of [...workspace]) listener(); };
  return { capture, update, edit, editor, model, calls, state: () => state,
    content: () => { version++; for (const listener of [...changes]) listener(); },
    cursor: () => { range = { ...range, startColumn: 1 }; for (const listener of [...cursors]) listener(); },
    detach: () => { attached = null; for (const listener of [...models]) listener(); },
    dispose: () => { disposed = true; for (const listener of [...deaths]) listener(); },
    listeners: () => workspace.size + changes.size + models.size + cursors.size + deaths.size,
  };
}

describe('历史正文插入原查询的单次编辑权限', () => {
  it('完整正文作为一次普通文本编辑，前后各undo stop，原上下文不变且只消费一次', () => {
    const f = fixture(), target = f.capture()!;
    const sql = 'SELECT "$0", \'引号\', {"n":9007199254740993};\r\n-- 原注释';
    const before = f.state(); target.insert(sql);
    expect(f.calls).toEqual(['undo-stop', 'edit', 'undo-stop']);
    expect(f.edit).toHaveBeenCalledExactlyOnceWith('dbark-history-insertion', [{ range: { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 9 }, text: sql, forceMoveMarkers: true }]);
    expect(f.state()).toBe(before); expect(f.listeners()).toBe(0); expect(target.connectionId).toBe('c');
    expect(() => target.insert('再插入')).toThrow(text.changed); expect(f.edit).toHaveBeenCalledTimes(1);
  });
  it('切页A→B→A不能恢复原导航权限，迟到正文不修改任何模型', () => {
    const f = fixture(), target = f.capture()!;
    f.update({ activeTabId: 'other' }); f.update({ activeTabId: 'q' });
    expect(target.current()).toBe(false); expect(() => target.insert('SELECT 2')).toThrow(text.changed); expect(f.edit).not.toHaveBeenCalled(); target.dispose();
  });
  it.each(['content', 'cursor', 'detach', 'dispose'] as const)('原%s变化立即撤销并通知面板，不靠最后一次同值比较复活', event => {
    const f = fixture(), target = f.capture()!, notify = vi.fn(); target.subscribe(notify); f[event]();
    expect(notify).toHaveBeenCalledTimes(1); expect(target.current()).toBe(false); expect(() => target.insert('SQL')).toThrow(text.changed); expect(f.edit).not.toHaveBeenCalled(); target.dispose(); expect(f.listeners()).toBe(0);
  });
  it.each(['tab', 'connection', 'connectionVersion', 'selection', 'session', 'execution', 'alive', 'busy', 'closing'] as const)('原%s离开后恢复原值也保持失效', key => {
    const f = fixture(), target = f.capture()!, old = f.state()[key];
    const replacements = { tab: { ...f.state().tab!, sql: '新草稿' }, connection: {}, connectionVersion: 2, selection: {}, session: 'other', execution: 'other', alive: false, busy: true, closing: true };
    f.update({ [key]: replacements[key] }); f.update({ [key]: old });
    expect(target.current()).toBe(false); expect(() => target.insert('SQL')).toThrow(text.changed); expect(f.edit).not.toHaveBeenCalled(); target.dispose();
  });
  it('主动取消/关闭只释放原租约，不能再用同历史迟到正文插入', () => {
    const f = fixture(), target = f.capture()!; target.dispose(); target.dispose();
    expect(f.listeners()).toBe(0); expect(() => target.insert('SQL')).toThrow(text.changed); expect(f.edit).not.toHaveBeenCalled();
  });
  it('没有活动可编辑查询或模型时不创建可用插入目标', () => {
    for (const patch of [{ activeTabId: 'other' }, { busy: true }, { closing: true }, { alive: false }, { tab: undefined }, { connection: undefined }]) {
      const f = fixture(); f.update(patch); expect(f.capture()).toBeNull(); expect(f.listeners()).toBe(0);
    }
    const f = fixture(); f.detach(); expect(f.capture()).toBeNull();
  });
  it('正文预算在任何编辑及undo stop前拒绝，失败不触碰原草稿', () => {
    const f = fixture(), target = f.capture()!;
    expect(() => target.insert('x'.repeat(20_000_000))).toThrow(text.tooLarge); expect(f.calls).toEqual([]); expect(target.current()).toBe(true); target.dispose();
  });
  it('编辑器拒绝时明确失败，原权限已消费，不能自动重放', () => {
    const f = fixture(), target = f.capture()!; f.edit.mockReturnValueOnce(false);
    expect(() => target.insert('SQL')).toThrow(text.failed); expect(() => target.insert('SQL')).toThrow(text.changed); expect(f.edit).toHaveBeenCalledTimes(1);
  });
  it('注册清理按工厂身份，旧StrictMode清理不能删除新工厂，也不回退到其它标签', () => {
    const registry = new HistoryInsertionRegistry(), first = fixture(), second = fixture();
    const old = registry.register('q', first.capture), latest = registry.register('q', second.capture);
    old(); const captured = registry.capture('q'); expect(captured).not.toBeNull();
    captured!.insert('SQL'); expect(first.edit).not.toHaveBeenCalled(); expect(second.edit).toHaveBeenCalledTimes(1);
    expect(registry.capture('missing')).toBeNull(); latest(); expect(registry.capture('q')).toBeNull();
  });
});
