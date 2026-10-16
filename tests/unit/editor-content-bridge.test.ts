import { describe, expect, it, vi } from 'vitest';
import { editorContentBridge, type EditorContentProps } from '../../src/renderer/editorContentBridge';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';

/** 通过真实桥接配合公共模型端口，所有回调及数据只留在RAM。 */
function fixture(value = '', eol = '\n') {
  const model = new ContentModelPort(value, eol), editor = new ContentEditorPort(model, { readOnly: true }), change = vi.fn(), ready: boolean[] = [];
  let props: EditorContentProps = { value, readOnly: false, onChange: change };
  const bridge = editorContentBridge(editor as any, () => props, state => ready.push(state));
  return { model, editor, change, ready, bridge, update: (patch: Partial<EditorContentProps>) => { props = { ...props, ...patch }; bridge.sync(); } };
}
describe('单实例正文事件桥接', () => {
  it('监听先绑定才解除readonly，就绪不主动转发初始正文', () => {
    const f = fixture('SELECT 原文;'); expect(f.bridge.ready).toBe(true); expect(f.ready).toEqual([false, true]); expect(f.editor.unlocks.every(count => count >= 2)).toBe(true); expect(f.change).not.toHaveBeenCalled();
    f.editor.nativeInput('SELECT 🚢;'); expect(f.change).toHaveBeenCalledExactlyOnceWith('SELECT 🚢;');
  });
  it.each([false, true])('外部受控value无回声，包括延迟内容事件 %s', deferred => {
    const f = fixture('原文'); f.model.deferred = deferred; f.update({ value: '外部\n新文' }); f.model.flush();
    expect(f.model.getValue()).toBe('外部\n新文'); expect(f.change).not.toHaveBeenCalled(); expect(f.model.controlledEdits).toBe(1); expect(f.editor.edits).toEqual([]); expect(f.editor.setValueCalls).toBe(0);
    f.model.deferred = false; f.editor.nativeInput('用户继续'); expect(f.change).toHaveBeenCalledExactlyOnceWith('用户继续');
  });
  it('CRLF与LF等价props不重复编辑，真正外部替换仍无回声', () => {
    const f = fixture('a\nb', '\r\n'); expect(f.model.controlledEdits).toBe(0); f.update({ value: 'c\nd' }); f.update({ value: 'c\nd' });
    expect(f.model.getValue()).toBe('c\r\nd'); expect(f.model.controlledEdits).toBe(1); expect(f.change).not.toHaveBeenCalled();
  });
  it('真实正文使用最新回调，不重绑、不回放已有模型', () => {
    const f = fixture(), next = vi.fn(), listeners = f.model.content.size; f.update({ onChange: next }); expect(f.model.content.size).toBe(listeners);
    expect(next).not.toHaveBeenCalled(); f.editor.nativeInput('新标签正文'); expect(next).toHaveBeenCalledExactlyOnceWith('新标签正文'); expect(f.change).not.toHaveBeenCalled();
  });
  it('后到的受控值取代旧用户事件，延迟交付时不能把受控值补发为用户输入', () => {
    const f = fixture(); f.model.deferred = true; f.editor.nativeInput('排队旧正文'); f.update({ value: '外部受控值' }); f.model.flush();
    expect(f.change).not.toHaveBeenCalled(); f.model.deferred = false; f.editor.nativeInput('新的用户编辑'); expect(f.change).toHaveBeenCalledExactlyOnceWith('新的用户编辑');
  });
  it('旧模型已排队事件、销毁事件不能写入新模型或最新回调', () => {
    const f = fixture('初始'), old = f.model; old.deferred = true; f.editor.nativeInput('旧事件');
    const replacement = new ContentModelPort('另一个初始值'); f.editor.setModel(replacement); old.flush(); expect(f.change).not.toHaveBeenCalled(); expect(old.content.size).toBe(0);
    expect(replacement.getValue()).toBe('初始'); f.editor.nativeInput('新模型用户编辑'); expect(f.change).toHaveBeenCalledExactlyOnceWith('新模型用户编辑');
    replacement.dispose(); expect(f.bridge.ready).toBe(false); expect(f.editor.readOnly).toBe(true);
  });
  it('缺模型时锁定，挂上新模型后才恢复可交互状态', () => {
    const f = fixture('当前props'); f.editor.setModel(null); expect(f.bridge.ready).toBe(false); expect(f.editor.readOnly).toBe(true);
    const next = new ContentModelPort('其它值'); f.editor.setModel(next); expect(f.bridge.ready).toBe(true); expect(next.getValue()).toBe('当前props'); expect(f.change).not.toHaveBeenCalled();
  });
  it('readonly变更立即锁住原生输入，readonly props更新仍不回声', () => {
    const f = fixture(); f.update({ readOnly: true, value: '只读新文' }); expect(f.editor.nativeInput('不允许')).toBe(false); expect(f.change).not.toHaveBeenCalled();
    f.update({ readOnly: false }); expect(f.editor.nativeInput('重新编辑')).toBe(true); expect(f.change).toHaveBeenCalledExactlyOnceWith('重新编辑');
  });
  it.each(['component', 'editor'] as const)('%s释放幂等，延迟事件和后续props不能复活订阅', method => {
    const f = fixture(); f.model.deferred = true; f.editor.nativeInput('尚未交付');
    if (method === 'component') f.bridge.dispose(); else f.editor.dispose(); f.bridge.dispose(); f.model.flush(); f.update({ value: '迟到props' });
    expect(f.change).not.toHaveBeenCalled(); expect(f.bridge.ready).toBe(false); expect(f.editor.modelChanges.size).toBe(0); expect(f.model.ending.size).toBe(0);
  });
  it('受控编辑失败不回传内容，保持只读并保留原失败', () => {
    const f = fixture(), failure = Error('合成受控编辑失败'); f.model.pushEditOperations = () => { throw failure; }; expect(() => f.update({ value: '无法应用' })).toThrow(failure);
    expect(f.editor.readOnly).toBe(true); expect(f.bridge.ready).toBe(false); expect(f.change).not.toHaveBeenCalled();
  });
  it('后续订阅失败时释放已取得的模型和editor监听，不能留下半就绪实例', () => {
    const model = new ContentModelPort(), editor = new ContentEditorPort(model, { readOnly: true }); model.onWillDispose = () => { throw Error('合成订阅失败'); };
    expect(() => editorContentBridge(editor as any, () => ({ value: '', readOnly: false }), () => {})).toThrow('合成订阅失败');
    expect(model.content.size).toBe(1); expect(editor.modelChanges.size).toBe(0); expect(editor.ending.size).toBe(0); expect(editor.readOnly).toBe(true);
  });
});
