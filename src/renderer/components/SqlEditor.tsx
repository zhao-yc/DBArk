import { zh } from '../locales/zh-CN';
import { useEffect, useRef } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { useWorkspace } from '../store';

/** Monaco 使用随安装包发布的编辑器和 worker，离线环境也可直接编辑 SQL。 */
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

export function SqlEditor({ value, onChange, onReady, height = '100%', readOnly = false, suggestions = [], onExecute }: { value: string; onChange?: (value: string) => void; onReady?: (editor: monaco.editor.IStandaloneCodeEditor) => void; height?: string | number; readOnly?: boolean; suggestions?: string[]; onExecute?: () => void }) {
  const theme = useWorkspace(state => state.settings.theme);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const runRef = useRef(onExecute); runRef.current = onExecute;
  useEffect(() => {
    const provider = monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: (model, position) => {
        if (editorRef.current?.getModel() !== model) return { suggestions: [] };
        const word = model.getWordUntilPosition(position);
        return { suggestions: [...new Set(suggestions)].map(label => ({ label, kind: monaco.languages.CompletionItemKind.Field, insertText: '`' + label.replaceAll('`', '``') + '`', range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn } })) };
      }
    });
    return () => provider.dispose();
  }, [suggestions]);
  const mounted: OnMount = editor => {
    editorRef.current = editor; onReady?.(editor);
    editor.addAction({ id: 'dbark-run', label: zh.editor.text001, keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter], run: () => runRef.current?.() });
  };
  return <Editor language="sql" theme={theme === 'dark' ? 'vs-dark' : 'light'} value={value} onChange={text => onChange?.(text ?? '')} onMount={mounted} height={height} loading={<div className="editor-loading">{zh.editor.text002}</div>} options={{ readOnly, fontFamily: 'Cascadia Code, SFMono-Regular, Consolas, monospace', fontSize: 13, lineHeight: 23, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 18, bottom: 12 }, tabSize: 2, wordWrap: 'on', renderLineHighlight: 'line', smoothScrolling: true, fixedOverflowWidgets: true, contextmenu: true }} />;
}
