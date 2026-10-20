import type * as monaco from 'monaco-editor';
import { zh } from './locales/zh-CN';

export type EditorContentFlushPolicy = 'preserve-equivalent-draft-eol';
const bodyFlushers = new WeakMap<monaco.editor.IStandaloneCodeEditor, (expected?: string, policy?: EditorContentFlushPolicy) => string>();
export interface EditorReloadLease { current(): boolean; apply(sql: string, commit: () => void): Promise<boolean>; dispose(): void; }
const reloaders = new WeakMap<monaco.editor.IStandaloneCodeEditor, (expected: string) => EditorReloadLease>();
/** 只对正式存活正文桥申请模型锁，不从旧tab正文创建替代模型。 */
export function beginEditorReload(editor: monaco.editor.IStandaloneCodeEditor, expected: string): EditorReloadLease {
  const begin = reloaders.get(editor); if (!begin) throw Error(zh.editor.bodyUnavailable); return begin(expected);
}
/** 只通过当前存活正文桥flush，不以旧tab.sql、选区或受控sync替代模型全文。 */
export function flushEditorContent(editor: monaco.editor.IStandaloneCodeEditor, expectedDraft?: string, policy?: EditorContentFlushPolicy): string {
  const flush = bodyFlushers.get(editor); if (!flush) throw Error(zh.editor.bodyUnavailable); return flush(expectedDraft, policy);
}

export interface EditorContentProps { value: string; readOnly: boolean; onChange?: (value: string) => void; }
interface ModelLease { model: monaco.editor.ITextModel; valid: boolean; syncing: boolean; controlledThrough: number; syncedValue: string; syncedVersion: number; publishedValue?: string; subscriptions: monaco.IDisposable[]; }

/** 单实例只转发真实正文事件；受控props另走有明确抑制范围的编辑，不补发既有模型正文。 */
export function editorContentBridge(editor: monaco.editor.IStandaloneCodeEditor, current: () => EditorContentProps, publishReady: (ready: boolean) => void) {
  let closed = false, editorAlive = true, ready = false, lease: ModelLease | undefined;
  let reload: { valid: boolean } | undefined;
  const subscriptions: monaco.IDisposable[] = [];
  /** 就绪发布与原生readonly同源；任何失效先锁住输入，再通知界面。 */
  function availability(next: boolean) {
    ready = next;
    if (editorAlive) editor.updateOptions({ readOnly: !next || current().readOnly || !!reload });
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
    if (reload) { editor.updateOptions({ readOnly: true }); return; }
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
    if (owns(item)) { item.syncedValue = props.value; item.syncedVersion = model.getVersionId(); item.publishedValue = undefined; availability(true); }
  }
  /** 新模型先绑定正文与销毁事件，再同步props、开放输入；不回放挂载前发生的编辑。 */
  function bindModel() {
    availability(false); releaseModel();
    if (closed) return;
    const model = editor.getModel(); if (!model || model.isDisposed()) return;
    const item: ModelLease = { model, valid: true, syncing: false, controlledThrough: model.getVersionId(), syncedValue: current().value, syncedVersion: 0, subscriptions: [] }; lease = item;
    try {
      item.subscriptions.push(model.onDidChangeContent(event => {
        if (!owns(item) || item.syncing || event.versionId <= item.controlledThrough || event.versionId !== model.getVersionId()) return;
        const props = current(); if (!props.readOnly && props.onChange) { const value = model.getValue(); item.publishedValue = value; props.onChange(value); }
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
    if (reloaders.get(editor) === beginReload) reloaders.delete(editor);
    if (reload) reload.valid = false;
    for (const item of subscriptions) item.dispose();
    // 同一editor已由新桥接管时，旧桥只能释放自身，不能锁住新桥或发布旧就绪状态。
    if (!currentBridge || currentBridge === flush) availability(false); else ready = false;
  }
  /** 只发布当前正文，不编辑模型或触碰撤销栈；外部新草稿尚未进模型时拒绝覆盖它。 */
  function flush(expected?: string, policy?: EditorContentFlushPolicy): string {
    const item = lease, props = current();
    if (!ready || !item || !owns(item) || props.readOnly || editor.getRawOptions().readOnly) throw Error(zh.editor.bodyUnavailable);
    const value = item.model.getValue(), version = item.model.getVersionId();
    // 当前props也可能来自尚未sync的外部更新；只有桥已同步/交付的正文或当前模型本身可以作为读取基线。
    if (props.value !== item.syncedValue && props.value !== item.publishedValue && props.value !== value) throw Error(zh.editor.bodyUnavailable);
    if (expected !== undefined && expected !== props.value && expected !== value) throw Error(zh.editor.bodyUnavailable);
    // 文件捕获不能把恰等于模型的外部新props误认成桥已接纳的正文；默认flush保留原合同。
    if (policy === 'preserve-equivalent-draft-eol' && props.value !== item.syncedValue && props.value !== item.publishedValue) throw Error(zh.editor.bodyUnavailable);
    let preserveDraft = false;
    if (policy === 'preserve-equivalent-draft-eol' && expected === props.value && props.value === item.syncedValue && item.publishedValue === undefined && version === item.syncedVersion && version === item.controlledThrough) {
      const eol = item.model.getEOL(); if (eol !== '\n' && eol !== '\r\n') throw Error(zh.editor.bodyUnavailable);
      // 必须同时属于原受控版本；等价sync不能把尚未交付的原生版本洗成未编辑草稿。
      preserveDraft = value === props.value.replace(/\r\n|\r|\n/g, eol);
    }
    if (!preserveDraft && (expected ?? props.value) !== value && props.onChange) { item.publishedValue = value; props.onChange(value); }
    if (!owns(item) || item.model.getVersionId() !== version || item.model.getValue() !== value) throw Error(zh.editor.bodyUnavailable);
    return preserveDraft ? props.value : value;
  }
  /** 预览期间锁原模型；EOL与正文各保留独立历史项，再同步提交同一份工作区来源。 */
  function beginReload(expected: string): EditorReloadLease {
    if (reload || flush(expected, 'preserve-equivalent-draft-eol') !== expected || !lease) throw Error(zh.editor.bodyUnavailable);
    const item = lease, model = item.model, version = model.getVersionId(), held = { valid: true }; reload = held;
    let applied = false, applying = false, disposeRequested = false, rollbackFailed = false;
    const valid = () => {
      if (!owns(item) || reload !== held || model.getVersionId() !== version || current().value !== expected) held.valid = false;
      return held.valid;
    };
    /** 异步Undo尚未结算时继续锁原模型；未知归属的失败不能用受控补写覆盖外来编辑。 */
    function finishDispose() {
      if (applying || reload !== held) return;
      reload = undefined;
      if (owns(item)) { if (rollbackFailed) availability(false); else if (!applied) sync(); else availability(true); }
    }
    availability(true);
    return {
      current: valid,
      async apply(sql, commit) {
        if (applying || !valid()) return false;
        const before = { value: model.getValue(), eol: model.getEOL(), alternative: model.getAlternativeVersionId(), selections: editor.getSelections() };
        let ownedVersion = model.getVersionId();
        /** 每个公开模型编辑至多推进一次版本；重入修改或失效不能被认领为本次可撤销操作。 */
        const edit = (action: () => void) => {
          const previous = model.getVersionId(); action();
          const next = model.getVersionId();
          if (!owns(item) || next < previous || next > previous + 1 || current().value !== expected) rollbackFailed = true;
          ownedVersion = next;
        };
        applying = true; item.syncing = true;
        try {
          model.pushStackElement();
          // Monaco模型只支持LF/CRLF，裸CR/混合原文仍由工作区及来源摘要逐字保留。
          const eol = /\r\n/.test(sql) && !/(^|[^\r])\n|\r(?!\n)/.test(sql) ? '\r\n' : '\n';
          const differs = model.getEOL() !== eol || model.getValue() !== sql.replace(/\r\n|\r|\n/g, eol);
          // Monaco历史的文字偏移不跨EOL压缩。分隔两步，否则CRLF→LF重做可能留下多余换行。
          // pushEOL自身写入null选区，前后公开空编辑保留该独立步骤的选区与方向。
          if (differs && model.getEOL() !== eol) { const selections = editor.getSelections(); edit(() => model.pushEditOperations(selections, [], () => selections)); edit(() => model.pushEOL(eol === '\r\n' ? 1 : 0)); edit(() => model.pushEditOperations(selections, [], () => selections)); model.pushStackElement(); }
          if (model.getValue() !== sql.replace(/\r\n|\r|\n/g, eol)) edit(() => model.pushEditOperations(editor.getSelections(), [{ range: model.getFullModelRange(), text: sql, forceMoveMarkers: true }], () => {
            const end = model.getPositionAt(model.getValueLength());
            return [{ selectionStartLineNumber: end.lineNumber, selectionStartColumn: end.column, positionLineNumber: end.lineNumber, positionColumn: end.column }] as monaco.Selection[];
          }));
          model.pushStackElement();
          if (rollbackFailed || !owns(item) || !held.valid || model.getVersionId() !== ownedVersion || model.getValue() !== sql.replace(/\r\n|\r|\n/g, eol)) throw Error(zh.editor.bodyUnavailable);
          item.controlledThrough = model.getVersionId(); item.syncedValue = sql; item.syncedVersion = model.getVersionId(); item.publishedValue = undefined;
          commit(); applied = true; held.valid = false; return true;
        } catch (reason) {
          held.valid = false;
          try {
            if (rollbackFailed || !owns(item) || current().value !== expected || model.getVersionId() !== ownedVersion) throw Error(zh.editor.bodyUnavailable);
            model.pushStackElement();
            // 只撤销本次最多两个历史组，不用setValue清栈，也不把恢复正文追加成新的历史项。
            for (let count = 0; model.getAlternativeVersionId() !== before.alternative && count < 2; count++) {
              if (!owns(item) || model.getVersionId() !== ownedVersion || !model.canUndo()) throw Error(zh.editor.bodyUnavailable);
              await model.undo();
              if (!owns(item) || current().value !== expected || model.getVersionId() > ownedVersion + 1) throw Error(zh.editor.bodyUnavailable);
              ownedVersion = model.getVersionId();
            }
            if (model.getAlternativeVersionId() !== before.alternative || model.getValue() !== before.value || model.getEOL() !== before.eol) throw Error(zh.editor.bodyUnavailable);
            if (before.selections) editor.setSelections(before.selections);
            item.syncedValue = expected; item.syncedVersion = model.getVersionId(); item.publishedValue = undefined;
          } catch { rollbackFailed = true; if (owns(item)) availability(false); }
          throw reason;
        } finally {
          if (!model.isDisposed()) item.controlledThrough = model.getVersionId();
          item.syncing = false; applying = false;
          if (disposeRequested) finishDispose();
        }
      },
      dispose() { held.valid = false; disposeRequested = true; finishDispose(); },
    };
  }
  try {
    editor.updateOptions({ readOnly: true });
    subscriptions.push(editor.onDidChangeModel(bindModel));
    subscriptions.push(editor.onDidDispose(() => { editorAlive = false; dispose(); }));
    bindModel();
  } catch (reason) { dispose(); throw reason; }
  bodyFlushers.set(editor, flush);
  reloaders.set(editor, beginReload);
  return { sync, flush, dispose, get ready() { return ready; } };
}
