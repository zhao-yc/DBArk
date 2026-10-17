import type * as monaco from 'monaco-editor';
import { zh } from './locales/zh-CN';

const bodyFlushers = new WeakMap<monaco.editor.IStandaloneCodeEditor, (expected?: string) => string>();
/** 只通过当前存活正文桥flush，不以旧tab.sql、选区或受控sync替代模型全文。 */
export function flushEditorContent(editor: monaco.editor.IStandaloneCodeEditor, expectedDraft?: string): string {
  const flush = bodyFlushers.get(editor); if (!flush) throw Error(zh.editor.bodyUnavailable); return flush(expectedDraft);
}

export interface EditorContentProps { value: string; readOnly: boolean; onChange?: (value: string) => void; }
interface ModelLease { model: monaco.editor.ITextModel; valid: boolean; syncing: boolean; controlledThrough: number; subscriptions: monaco.IDisposable[]; }

/** 单实例只转发真实正文事件；受控props另走有明确抑制范围的编辑，不补发既有模型正文。 */
export function editorContentBridge(editor: monaco.editor.IStandaloneCodeEditor, current: () => EditorContentProps, publishReady: (ready: boolean) => void) {
  let closed = false, editorAlive = true, ready = false, lease: ModelLease | undefined;
  const subscriptions: monaco.IDisposable[] = [];
  /** 就绪发布与原生readonly同源；任何失效先锁住输入，再通知界面。 */
  function availability(next: boolean) {
    ready = next;
    if (editorAlive) editor.updateOptions({ readOnly: !next || current().readOnly });
    publishReady(next);
  }
  /** 旧模型监听先失效再释放，已排队的旧事件也不能写入新标签回调。 */
  function releaseModel() {
    const previous = lease; lease = undefined;
    if (previous) { previous.valid = false; for (const item of previous.subscriptions) item.dispose(); }
  }
  const owns = (item: ModelLease) => !closed && item.valid && lease === item && editor.getModel() === item.model && !item.model.isDisposed();
  /** 仅把外部props同步至模型；保留编辑栈，并覆盖同步及延后交付的受控事件版本。 */
  function sync() {
    const item = lease;
    if (!item || !owns(item)) { if (!closed) availability(false); return; }
    const props = current(), model = item.model;
    if (!ready || props.readOnly) editor.updateOptions({ readOnly: true });
    // Monaco将输入换行统一为模型EOL；等价的外部换行不能导致反复整篇编辑。
    const desired = props.value.replace(/\r\n|\r|\n/g, model.getEOL());
    if (model.getValue() !== desired) {
      item.syncing = true;
      try {
        // widget.executeEdits在readonly时拒绝；使用公开模型事务，不临时解除输入锁，也不用setValue清空撤销栈。
        model.pushEditOperations(editor.getSelections(), [{ range: model.getFullModelRange(), text: props.value, forceMoveMarkers: true }], () => null);
        model.pushStackElement();
      } catch (reason) { availability(false); throw reason; }
      finally { if (!model.isDisposed()) item.controlledThrough = model.getVersionId(); item.syncing = false; }
    }
    if (owns(item)) availability(true);
  }
  /** 新模型先绑定正文与销毁事件，再同步props、开放输入；不回放挂载前发生的编辑。 */
  function bindModel() {
    availability(false); releaseModel();
    if (closed) return;
    const model = editor.getModel(); if (!model || model.isDisposed()) return;
    const item: ModelLease = { model, valid: true, syncing: false, controlledThrough: model.getVersionId(), subscriptions: [] }; lease = item;
    try {
      item.subscriptions.push(model.onDidChangeContent(event => {
        if (!owns(item) || item.syncing || event.versionId <= item.controlledThrough || event.versionId !== model.getVersionId()) return;
        const props = current(); if (!props.readOnly) props.onChange?.(model.getValue());
      }));
      item.subscriptions.push(model.onWillDispose(() => { if (lease === item) { releaseModel(); availability(false); } }));
      sync();
    } catch (reason) { releaseModel(); availability(false); throw reason; }
  }
  /** 组件卸载、editor销毁和重复清理共用幂等释放，不保留旧模型或可编辑入口。 */
  function dispose() {
    if (closed) return; closed = true; releaseModel();
    const currentBridge = bodyFlushers.get(editor);
    if (currentBridge === flush) bodyFlushers.delete(editor);
    for (const item of subscriptions) item.dispose();
    // 同一editor已由新桥接管时，旧桥只能释放自身，不能锁住新桥或发布旧就绪状态。
    if (!currentBridge || currentBridge === flush) availability(false); else ready = false;
  }
  /** 只发布当前正文，不编辑模型或触碰撤销栈；外部新草稿尚未进模型时拒绝覆盖它。 */
  function flush(expected?: string): string {
    const item = lease, props = current();
    if (!ready || !item || !owns(item) || props.readOnly || editor.getRawOptions().readOnly) throw Error(zh.editor.bodyUnavailable);
    const value = item.model.getValue(), version = item.model.getVersionId();
    if (expected !== undefined && expected !== props.value && expected !== value) throw Error(zh.editor.bodyUnavailable);
    if ((expected ?? props.value) !== value) props.onChange?.(value);
    if (!owns(item) || item.model.getVersionId() !== version || item.model.getValue() !== value) throw Error(zh.editor.bodyUnavailable);
    return value;
  }
  try {
    editor.updateOptions({ readOnly: true });
    subscriptions.push(editor.onDidChangeModel(bindModel));
    subscriptions.push(editor.onDidDispose(() => { editorAlive = false; dispose(); }));
    bindModel();
  } catch (reason) { dispose(); throw reason; }
  bodyFlushers.set(editor, flush);
  return { sync, flush, dispose, get ready() { return ready; } };
}
