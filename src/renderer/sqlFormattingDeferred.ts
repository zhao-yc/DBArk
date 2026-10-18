import type * as monaco from 'monaco-editor';
import { formatSqlEditor, prepareSqlFormattingRoles, type FormattingPreferences } from './sqlFormatting';
import { sqlKeywordRoleLimits } from '../shared/sqlKeywordCase';
import { sqlFormattingZh as text } from './locales/sqlFormatting.zh-CN';

interface FormattingPorts {
  editor(): monaco.editor.IStandaloneCodeEditor | null;
  assertCurrent(): void;
  subscribe(changed: () => void): () => void;
  prepare?(): Promise<void>;
}
/** 捕获完整有向选区，包括全文模式的原光标位置；不接受缺失坐标的弱比较。 */
function selectionKey(editor: monaco.editor.IStandaloneCodeEditor): string {
  const selections = editor.getSelections(); if (!selections || selections.length !== 1) throw Error(text.selection);
  const value = selections[0], key = [value.startLineNumber, value.startColumn, value.endLineNumber, value.endColumn, value.selectionStartLineNumber, value.selectionStartColumn, value.positionLineNumber, value.positionColumn];
  if (key.some(coordinate => !Number.isSafeInteger(coordinate) || coordinate < 1)) throw Error(text.selection);
  return JSON.stringify(key);
}

/** 只为显式upper模块加载保存一次编辑意图；失效后不可因原值恢复而复活。 */
export class DeferredUpperSqlFormatting {
  readonly #editor: monaco.editor.IStandaloneCodeEditor;
  readonly #model: monaco.editor.ITextModel;
  readonly #version: number;
  readonly #sql: string;
  readonly #selection: string;
  readonly #preferences: FormattingPreferences;
  readonly #subscriptions: Array<{ dispose(): void }> = [];
  #valid = true; #started = false; #failure: unknown;
  constructor(private readonly ports: FormattingPorts, preferences: FormattingPreferences) {
    ports.assertCurrent(); const editor = ports.editor(), model = editor?.getModel();
    if (!editor || !model || model.isDisposed() || editor.getRawOptions().readOnly) throw Error(text.unavailable);
    if (model.getValueLength() > sqlKeywordRoleLimits.sourceUnits) throw Error(text.limited);
    this.#editor = editor; this.#model = model; this.#version = model.getVersionId(); this.#sql = model.getValue(); this.#selection = selectionKey(editor);
    this.#preferences = { tabSize: preferences.tabSize, insertSpaces: preferences.insertSpaces, keywordCase: 'upper' };
    const revoke = () => { this.#valid = false; };
    try {
      this.#subscriptions.push(editor.onDidChangeModel(revoke));
      this.#subscriptions.push(editor.onDidChangeModelContent(revoke));
      this.#subscriptions.push(editor.onDidChangeCursorSelection(revoke));
      this.#subscriptions.push(editor.onDidChangeConfiguration(revoke));
      this.#subscriptions.push(editor.onDidDispose(revoke));
      this.#subscriptions.push({ dispose: ports.subscribe(() => { try { this.#assert(); } catch (reason) { this.#valid = false; this.#failure ??= reason; } }) });
      this.#assert();
    } catch (reason) { try { this.dispose(); } catch (cleanup) { throw new AggregateError([reason, cleanup], text.failed, { cause: reason }); } throw reason; }
  }
  /** 原模型、版本、全文、完整选区与上层入口每次一起核对；事件墓碑先于值相等判断。 */
  #assert(): void {
    if (!this.#valid) throw this.#failure ?? Error(text.unavailable);
    this.ports.assertCurrent();
    if (this.ports.editor() !== this.#editor || this.#editor.getModel() !== this.#model || this.#model.isDisposed() || this.#model.getVersionId() !== this.#version || this.#model.getValue() !== this.#sql || this.#editor.getRawOptions().readOnly || selectionKey(this.#editor) !== this.#selection) throw Error(text.unavailable);
  }
  /** 回包后先重核，再解除观察并同步执行原事务；没有角色证明时原planner仍拒绝upper。 */
  async run(): Promise<boolean> {
    if (this.#started) throw Error(text.unavailable); this.#started = true; let failed = false, original: unknown;
    try {
      this.#assert(); await (this.ports.prepare ?? prepareSqlFormattingRoles)(); this.#assert();
      this.#release(); this.#assert(); return formatSqlEditor(this.#editor, this.#preferences);
    } catch (reason) { failed = true; original = reason; throw reason; }
    finally { try { this.dispose(); } catch (cleanup) { if (failed) throw new AggregateError([original, cleanup], text.failed, { cause: original }); throw cleanup; } }
  }
  /** 解绑不更改模型、选区、SQL或Undo；所有观察都尝试释放，错误仍传播。 */
  #release(): void {
    const failures: unknown[] = []; for (const subscription of this.#subscriptions.splice(0)) try { subscription.dispose(); } catch (reason) { failures.push(reason); }
    if (failures.length) throw new AggregateError(failures, text.failed);
  }
  /** 卸载/关闭永久取消，迟到模块返回只有释放权，没有编辑权。 */
  dispose(): void { this.#valid = false; this.#release(); }
}
