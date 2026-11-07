import type * as monaco from 'monaco-editor';
import type { ConnectionProfile, SqlSnippet } from '../shared/contracts';
import { matchSnippetPrefix, snippetAtStatementStart, snippetPrefix } from './snippetCompletion';
import { zh } from './locales/zh-CN';

/** 单一编辑器的本地片段补全；读取期间发生光标、模型、导航或会话变化即永久撤销。 */
export function createSnippetCompletionProvider(options: {
  editor: monaco.editor.IStandaloneCodeEditor;
  dialect: ConnectionProfile['dialect'];
  standardStrings?: boolean;
  current(): boolean;
  list(): Promise<readonly SqlSnippet[] | undefined>;
  kind: monaco.languages.CompletionItemKind;
  keepWhitespace: monaco.languages.CompletionItemInsertTextRule;
}): monaco.languages.CompletionItemProvider & { invalidate(): void; dispose(): void } {
  const { editor } = options;
  let active = true, generation = 0;
  const invalidate = () => { generation++; };
  const listeners = [editor.onDidChangeCursorSelection(invalidate), editor.onDidChangeModel(invalidate), editor.onDidDispose(() => { active = false; invalidate(); })];
  return {
    invalidate,
    dispose() { active = false; invalidate(); for (const listener of listeners.splice(0)) listener.dispose(); },
    async provideCompletionItems(model, position, _context, token) {
      const revision = ++generation;
      const current = () => active && revision === generation && options.current() && !token.isCancellationRequested &&
        editor.getModel() === model && !model.isDisposed() && editor.getSelections()?.length === 1 && editor.getSelection()?.isEmpty() === true;
      if (!current() || model.getValueLength() > 65_536) return;
      const prefix = snippetPrefix(model.getLineContent(position.lineNumber).slice(0, position.column - 1));
      if (!prefix || !snippetAtStatementStart(model.getValue(), model.getOffsetAt(position), prefix, options.dialect, options.standardStrings)) return;
      const version = model.getVersionId();
      let rows: readonly SqlSnippet[] | undefined;
      try { rows = await options.list(); } catch { return; }
      const cursor = editor.getPosition();
      if (!rows || !current() || model.getVersionId() !== version || cursor?.lineNumber !== position.lineNumber || cursor.column !== position.column) return;
      const range = { startLineNumber: position.lineNumber, startColumn: position.column - prefix.length, endLineNumber: position.lineNumber, endColumn: position.column };
      return { incomplete: true, suggestions: matchSnippetPrefix(rows, prefix, options.dialect).map((item, index) => ({
        label: { label: item.name, description: item.group || zh.snippets.ungrouped }, detail: zh.snippets.suggestion,
        documentation: item.description || item.sql.slice(0, 256), kind: options.kind, range, insertText: item.sql,
        insertTextRules: options.keepWhitespace, sortText: '1' + String(index).padStart(2, '0'),
      })) };
    },
  };
}
