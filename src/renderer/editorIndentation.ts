import type * as monaco from 'monaco-editor';
import type { editorIndentationOptions } from '../shared/editorIndentation';

/** 持有原widget的模型选项订阅；只更新选项，不创建模型或触及正文、视图状态和撤销栈。 */
export function bindEditorIndentation(editor: monaco.editor.IStandaloneCodeEditor, read: () => ReturnType<typeof editorIndentationOptions>, current: () => boolean) {
  let disposed = false;
  /** 新模型可能已从正文猜过缩进，必须在挂载/切换时重新应用明确偏好。 */
  function sync() {
    if (disposed || !current()) return;
    const options = read(); editor.updateOptions(options);
    const model = editor.getModel();
    if (model && !model.isDisposed()) model.updateOptions({ tabSize: options.tabSize, indentSize: options.indentSize, insertSpaces: options.insertSpaces });
  }
  const subscription = editor.onDidChangeModel(sync);
  return { sync, dispose() { if (!disposed) { disposed = true; subscription.dispose(); } } };
}
