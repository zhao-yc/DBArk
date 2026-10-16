import type * as monaco from 'monaco-editor';
import { describe, expect, it } from 'vitest';
import { CurrentStatementIntent, type CurrentStatementScope } from '../../src/renderer/currentStatementIntent';

/** 事件端口只模拟生命周期；UTF16换行映射另由真实Monaco模型回归验证。 */
function fixture() {
  const listeners = new Map<string, Set<() => void>>(); let source = 'SELECT 1; SELECT 2;', version = 1, offset = 12, disposed = false;
  const scope: CurrentStatementScope = { tabId: 'tab', connectionId: 'connection', connectionVersion: 1, sessionId: '', draft: source, present: true, active: true, modal: false };
  const listen = (kind: string, action: () => void) => { const group = listeners.get(kind) ?? new Set(); group.add(action); listeners.set(kind, group); return { dispose: () => { group.delete(action); } }; };
  const emit = (kind: string) => { for (const action of [...listeners.get(kind) ?? []]) action(); };
  const model = { getValue: () => source, getVersionId: () => version, isDisposed: () => disposed, getOffsetAt: (position: monaco.IPosition) => position.column - 1, onDidChangeContent: (action: () => void) => listen('content', action), onWillDispose: (action: () => void) => listen('modelDispose', action) };
  let activeModel: unknown = model;
  const editor = { getModel: () => activeModel, getPosition: () => ({ lineNumber: 1, column: offset + 1 }), onDidChangeModel: (action: () => void) => listen('model', action), onDidDispose: (action: () => void) => listen('editorDispose', action), onDidChangeCursorPosition: (action: () => void) => listen('caret', action) };
  return { scope, model, editor, emit, listeners,
    create: () => new CurrentStatementIntent(editor as unknown as monaco.editor.IStandaloneCodeEditor, () => scope, action => listen('context', action).dispose),
    edit: (value: string) => { source = value; version++; emit('content'); },
    move: (value: number) => { offset = value; emit('caret'); },
    swap: (value: unknown) => { activeModel = value; emit('model'); },
    disposeModel: () => { disposed = true; emit('modelDispose'); },
  };
}

describe('当前语句投递意图永久失效', () => {
  it('捕获真实模型全源/光标且只绑定本次新会话，不更改正文', () => {
    const f = fixture(), intent = f.create(); expect(intent.source).toBe(f.scope.draft); expect(intent.offset).toBe(12); f.scope.sessionId = 'session'; intent.bindSession('session'); intent.assertCurrent(); intent.dispose();
    expect([...f.listeners.values()].every(group => group.size === 0)).toBe(true); expect(f.model.getValue()).toBe('SELECT 1; SELECT 2;');
  });
  it('编辑再撤销为同样内容也不能复活原意图', () => { const f = fixture(), intent = f.create(); f.edit('SELECT 改动'); f.edit(intent.source); expect(() => intent.assertCurrent()).toThrow('已变化'); intent.dispose(); });
  it('换到别的模型再换回相同模型也不能复活', () => { const f = fixture(), intent = f.create(); f.swap({}); f.swap(f.model); expect(() => intent.assertCurrent()).toThrow('已变化'); intent.dispose(); });
  it('光标移开再移回也不能复活', () => { const f = fixture(), intent = f.create(); f.move(1); f.move(12); expect(() => intent.assertCurrent()).toThrow('已变化'); intent.dispose(); });
  it.each(['active', 'present', 'connectionVersion', 'connectionId', 'draft', 'sessionId'] as const)('%s变化再恢复仍永久失效', key => {
    const f = fixture(); f.scope.sessionId = 'session'; const intent = f.create(), before = f.scope[key];
    Object.assign(f.scope, { [key]: typeof before === 'boolean' ? false : typeof before === 'number' ? before + 1 : 'changed' }); f.emit('context'); Object.assign(f.scope, { [key]: before }); f.emit('context');
    expect(() => intent.assertCurrent()).toThrow('已变化'); intent.dispose();
  });
  it.each(['modelDispose', 'editorDispose'])('%s后不能再投递', event => { const f = fixture(), intent = f.create(); f.emit(event); expect(() => intent.assertCurrent()).toThrow('已变化'); intent.dispose(); });
  it('已有会话不能改绑另一会话，即使上下文随后切回也拒绝', () => { const f = fixture(); f.scope.sessionId = 'first'; const intent = f.create(); expect(() => intent.bindSession('second')).toThrow('已变化'); expect(() => intent.assertCurrent()).toThrow('已变化'); intent.dispose(); });
  it('模态窗口在最终校验时阻止发送', () => { const f = fixture(), intent = f.create(); f.scope.modal = true; expect(() => intent.assertCurrent()).toThrow('已变化'); intent.dispose(); });
  it.each(['present', 'active', 'modal'] as const)('初始%s不满足时不建立意图或泄露监听器', key => { const f = fixture(); f.scope[key] = key === 'modal'; expect(() => f.create()).toThrow('不可用'); expect([...f.listeners.values()].every(group => !group.size)).toBe(true); });
});
