import type * as monaco from 'monaco-editor';
import type { WorkspaceTab } from './store';
import { snippetEdit } from './snippetInsertion';
import { historyInsertionZh as text } from './locales/historyInsertion.zh-CN';

export interface HistoryInsertionScope {
  tab: WorkspaceTab | undefined; activeTabId: string | undefined; connection: object | undefined; connectionVersion: number;
  selection: object | undefined; session: string; execution: string; alive: boolean; busy: boolean; closing: boolean;
}
export interface HistoryInsertionTarget {
  readonly title: string;
  readonly connectionId: string;
  current(): boolean;
  insert(sql: string): void;
  dispose(): void;
  subscribe(listener: () => void): () => void;
}
interface Model {
  isDisposed(): boolean;
  getVersionId(): number;
  getValueLength(): number;
  getValueLengthInRange(range: monaco.IRange): number;
  onDidChangeContent(listener: () => void): monaco.IDisposable;
}
export interface HistoryInsertionEditor {
  getModel(): Model | null;
  getSelection(): monaco.IRange | null;
  onDidChangeModel(listener: () => void): monaco.IDisposable;
  onDidChangeCursorSelection(listener: () => void): monaco.IDisposable;
  onDidDispose(listener: () => void): monaco.IDisposable;
  pushUndoStop(): boolean;
  executeEdits(source: string, edits: monaco.editor.IIdentifiedSingleEditOperation[]): boolean;
}

/** 注册只删除自身工厂；StrictMode的旧清理不能撤销后来注册的编辑器。 */
export class HistoryInsertionRegistry {
  private readonly factories = new Map<string, () => HistoryInsertionTarget | null>();
  register(tabId: string, capture: () => HistoryInsertionTarget | null): () => void {
    this.factories.set(tabId, capture);
    return () => { if (this.factories.get(tabId) === capture) this.factories.delete(tabId); };
  }
  capture(tabId: string): HistoryInsertionTarget | null { return this.factories.get(tabId)?.() ?? null; }
}

/** 捕获原模型版本和选区；任何导航/编辑/选区变化都永久撤销，恢复同值也不复活。 */
export function captureHistoryInsertion(editor: HistoryInsertionEditor, read: () => HistoryInsertionScope, subscribe: (listener: () => void) => () => void): HistoryInsertionTarget | null {
  const initial = read(), model = editor.getModel(), selected = editor.getSelection();
  if (!initial.alive || initial.busy || initial.closing || initial.tab?.kind !== 'query' || initial.activeTabId !== initial.tab.id || !initial.connection || !model || model.isDisposed() || !selected) return null;
  const version = model.getVersionId();
  const range = { startLineNumber: selected.startLineNumber, startColumn: selected.startColumn, endLineNumber: selected.endLineNumber, endColumn: selected.endColumn };
  let valid = true, disposed = false;
  const listeners = new Set<() => void>(), cleanup: Array<() => void> = [];
  const invalidate = () => { if (!valid) return; valid = false; for (const listener of [...listeners]) listener(); };
  /** 比较实际对象及会话/执行编号，不把相同标题、SQL或标签ID当原编辑器身份。 */
  const matches = () => {
    try {
      const now = read(), selection = editor.getSelection();
      return !disposed && now.alive && !now.busy && !now.closing && now.tab === initial.tab && now.activeTabId === initial.activeTabId
        && now.connection === initial.connection && now.connectionVersion === initial.connectionVersion && now.selection === initial.selection
        && now.session === initial.session && now.execution === initial.execution && editor.getModel() === model && !model.isDisposed() && model.getVersionId() === version
        && !!selection && selection.startLineNumber === range.startLineNumber && selection.startColumn === range.startColumn && selection.endLineNumber === range.endLineNumber && selection.endColumn === range.endColumn;
    } catch { return false; }
  };
  const current = () => { if (valid && !matches()) invalidate(); return valid && !disposed; };
  cleanup.push(subscribe(() => { current(); }));
  for (const event of [model.onDidChangeContent.bind(model), editor.onDidChangeModel.bind(editor), editor.onDidChangeCursorSelection.bind(editor), editor.onDidDispose.bind(editor)]) {
    const disposable = event(invalidate); cleanup.push(() => disposable.dispose());
  }
  /** 消费前解除监听，随后的一次真实编辑不能被自己的store通知误当作外部变化。 */
  const dispose = () => { if (disposed) return; disposed = true; invalidate(); for (const release of cleanup.splice(0)) release(); listeners.clear(); };
  return {
    title: initial.tab.title,
    connectionId: initial.tab.connectionId,
    current,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose,
    insert(sql) {
      if (!current()) throw Error(text.changed);
      if (typeof sql !== 'string' || sql.length > 20_000_000 || model.getValueLength() - model.getValueLengthInRange(range) + sql.length > 20_000_000) throw Error(text.tooLarge);
      dispose();
      editor.pushUndoStop();
      const accepted = editor.executeEdits('dbark-history-insertion', [snippetEdit(range, sql)]);
      editor.pushUndoStop();
      if (!accepted) throw Error(text.failed);
    },
  };
}
