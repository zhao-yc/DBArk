import { describe, expect, it, vi } from 'vitest';
import { editorContentBridge, flushEditorContent } from '../../src/renderer/editorContentBridge';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';

/** 仅验证正文桥基线交接；全部端口驻留RAM，不运行编辑器布局、数据库或剪贴板。 */
function fixture() {
  const model = new ContentModelPort('SELECT 初始;'), editor = new ContentEditorPort(model), changed = vi.fn();
  let props = { value: model.value, readOnly: false, onChange(value: string) { changed(value); props = { ...props, value }; } };
  const bridge = editorContentBridge(editor as any, () => props, () => {});
  return { model, editor, bridge, changed, props: () => props,
    external(value: string) { props = { ...props, value }; }, readonly(value: boolean) { props = { ...props, readOnly: value }; },
    dispose() { bridge.dispose(); editor.dispose(); } };
}

describe('正文flush的受控与已交付基线窄对照', () => {
  it('已有未交付native正文也不能覆盖后来发布、尚未sync的外部新草稿', () => {
    const f = fixture();
    try {
      f.model.deferred = true; f.editor.nativeInput('SELECT 较早的用户输入;'); const version = f.model.version;
      f.external('SELECT 后来的外部草稿;');
      expect(() => flushEditorContent(f.editor as any, f.props().value)).toThrow();
      expect(f.props().value).toBe('SELECT 后来的外部草稿;'); expect(f.changed).not.toHaveBeenCalled();
      expect(f.model.version).toBe(version); expect(f.model.controlledEdits).toBe(0); expect(f.editor.undoStops).toBe(0);
    } finally { f.dispose(); }
  });
  it('外部正文经显式sync接纳后可重新flush，随后未交付native输入仍正常发布', () => {
    const f = fixture();
    try {
      f.external('SELECT 已接纳的外部草稿;'); expect(() => flushEditorContent(f.editor as any, f.props().value)).toThrow();
      f.bridge.sync(); expect(flushEditorContent(f.editor as any, f.props().value)).toBe('SELECT 已接纳的外部草稿;');
      f.model.deferred = true; f.editor.nativeInput('SELECT 后续用户输入;'); const version = f.model.version, edits = f.model.controlledEdits, stops = f.model.stackStops;
      expect(flushEditorContent(f.editor as any, f.props().value)).toBe('SELECT 后续用户输入;');
      expect(f.changed).toHaveBeenCalledExactlyOnceWith('SELECT 后续用户输入;'); expect(f.model.version).toBe(version); expect(f.model.controlledEdits).toBe(edits); expect(f.model.stackStops).toBe(stops); expect(f.editor.undoStops).toBe(0);
    } finally { f.dispose(); }
  });
  it('已交付native正文尚未sync时，下一次未交付输入可以沿交付基线flush', () => {
    const f = fixture();
    try {
      f.editor.nativeInput('SELECT 已交付正文;'); f.model.deferred = true; f.editor.nativeInput('SELECT 下一次未交付正文;'); const version = f.model.version;
      expect(flushEditorContent(f.editor as any, f.props().value)).toBe('SELECT 下一次未交付正文;');
      expect(f.changed.mock.calls.map(call => call[0])).toEqual(['SELECT 已交付正文;', 'SELECT 下一次未交付正文;']);
      expect(f.model.version).toBe(version); expect(f.model.controlledEdits).toBe(0); expect(f.editor.setValueCalls).toBe(0);
    } finally { f.dispose(); }
  });
  it('有效基线不能绕过props或原生readonly，拒绝时不交付也不改变模型', () => {
    const f = fixture();
    try {
      f.model.deferred = true; f.editor.nativeInput('SELECT 待交付;'); const version = f.model.version;
      f.readonly(true); expect(() => flushEditorContent(f.editor as any, f.props().value)).toThrow();
      f.readonly(false); f.editor.readOnly = true; expect(() => flushEditorContent(f.editor as any, f.props().value)).toThrow();
      expect(f.changed).not.toHaveBeenCalled(); expect(f.model.version).toBe(version); expect(f.editor.readOnly).toBe(true); expect(f.model.controlledEdits).toBe(0);
    } finally { f.dispose(); }
  });
});
