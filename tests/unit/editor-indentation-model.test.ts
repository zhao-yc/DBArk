import { expect, it } from 'vitest';
import { bindEditorIndentation } from '../../src/renderer/editorIndentation';
import { editorIndentationOptions } from '../../src/shared/editorIndentation';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';

/** 真实绑定器通过Monaco公共端口执行；端口不创建业务编辑或模拟原生Undo。 */
it('仅当前存活绑定应用模型选项，隐藏/已销毁模型和解绑后迟到通知均不可写', () => {
  const model = new ContentModelPort('select\n\t原文;'), editor = new ContentEditorPort(model); let current = true;
  const binding = bindEditorIndentation(editor as any, () => editorIndentationOptions(7, false), () => current);
  const callback = [...editor.modelChanges][0], version = model.getVersionId(); binding.sync(); expect(model.getOptions()).toEqual({ tabSize: 7, indentSize: 7, insertSpaces: false }); expect(model.getVersionId()).toBe(version); expect(model.controlledEdits).toBe(0); expect(model.stackStops).toBe(0); expect(editor.edits).toEqual([]); expect(editor.undoStops).toBe(0);
  current = false; const count = model.optionChanges.length; callback(); binding.sync(); expect(model.optionChanges).toHaveLength(count);
  current = true; model.dispose(); expect(() => callback()).not.toThrow(); expect(model.optionChanges).toHaveLength(count);
  binding.dispose(); editor.dispose(); expect(() => callback()).not.toThrow(); expect(editor.modelChanges.size).toBe(0);
});
