import type * as monaco from 'monaco-editor';

export interface QueryFailureSourceScope {
  tabId: string; connectionId: string; connectionVersion: number; draft: string | undefined;
  present: boolean; active: boolean; busy: boolean; modal: boolean; closing: boolean;
}
interface Capture {
  editor: monaco.editor.IStandaloneCodeEditor; source: string; all: boolean;
  scope(): QueryFailureSourceScope; subscribe(changed: () => void): () => void;
  onInvalidated(): void;
}

/** UTF16半开区间不能拆开CRLF或一个完整代理对。 */
function boundary(source: string, offset: number): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length) return false;
  const before = source.charCodeAt(offset - 1), after = source.charCodeAt(offset);
  return !(before === 13 && after === 10 || before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

/** 源码定位只保留本次真实模型租约；不持有执行权限，也不修改SQL或撤销栈。 */
export class QueryFailureSourceLease {
  private valid = true;
  private readonly subscriptions: Array<{ dispose(): void }> = [];
  private range: { start: number; end: number } | undefined;
  private draft: string | undefined;
  private publishedFull = false;

  /** 唯一创建入口验证真实全文或选区，调用方不能自行传入推测的基址。 */
  static capture(capture: Capture): QueryFailureSourceLease | undefined {
    try {
      const model = capture.editor.getModel(), scope = capture.scope();
      if (!model || model.isDisposed() || !scope.present || !scope.active || scope.busy || scope.modal || scope.closing) return;
      const full = model.getValue(), version = model.getVersionId(); let base = 0;
      if (capture.source !== full) {
        if (capture.all) return;
        const selection = capture.editor.getSelection(); if (!selection) return;
        const start = model.getOffsetAt(selection.getStartPosition()), end = model.getOffsetAt(selection.getEndPosition());
        if (!boundary(full, start) || !boundary(full, end) || start >= end || full.slice(start, end) !== capture.source || model.getValueInRange(selection) !== capture.source) return;
        base = start;
      }
      return new QueryFailureSourceLease(capture, model, version, full, base, { ...scope });
    } catch { return; }
  }

  private constructor(private readonly capture: Capture, private readonly model: monaco.editor.ITextModel, private readonly version: number, private readonly full: string, private readonly base: number, private readonly origin: QueryFailureSourceScope) {
    this.draft = origin.draft; this.publishedFull = this.draft === full;
    try {
      const watch = (subscription: { dispose(): void }) => { if (this.valid) this.subscriptions.push(subscription); else subscription.dispose(); };
      watch(model.onDidChangeContent(() => this.invalidate())); watch(model.onWillDispose(() => this.invalidate())); watch(capture.editor.onDidChangeModel(() => this.invalidate())); watch(capture.editor.onDidDispose(() => this.invalidate()));
      const unsubscribe = capture.subscribe(() => { this.current(); }); watch({ dispose: unsubscribe });
      if (!this.current()) this.dispose();
    } catch { this.dispose(); }
  }

  /** 工作区可自然接收原模型正文；外来草稿先到或已发布正文退回旧值均永久失效。 */
  private current(): boolean {
    if (!this.valid) return false;
    try {
      const scope = this.capture.scope();
      if (!scope.present || scope.tabId !== this.origin.tabId || scope.connectionId !== this.origin.connectionId || scope.connectionVersion !== this.origin.connectionVersion || this.capture.editor.getModel() !== this.model || this.model.isDisposed() || this.model.getVersionId() !== this.version || this.model.getValue() !== this.full) { this.invalidate(); return false; }
      if (scope.draft !== this.draft) {
        if (!this.publishedFull && scope.draft === this.full) { this.draft = scope.draft; this.publishedFull = true; }
        else { this.invalidate(); return false; }
      }
      return true;
    } catch { this.invalidate(); return false; }
  }

  /** 单独验证引擎给出的数值范围，不读取访问器，也不按SQL文本搜索重复语句。 */
  bindRange(value: unknown): boolean {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== 2) throw Error('范围不可用');
      const descriptors = Object.getOwnPropertyDescriptors(value), start = descriptors.start, end = descriptors.end;
      if (!start || !end || !('value' in start) || !('value' in end) || typeof start.value !== 'number' || typeof end.value !== 'number') throw Error('范围不可用');
      const from = start.value, to = end.value;
      if (!this.current() || from >= to || !boundary(this.capture.source, from) || !boundary(this.capture.source, to) || !boundary(this.full, this.base + from) || !boundary(this.full, this.base + to)) throw Error('范围不可用');
      this.range = { start: this.base + from, end: this.base + to }; return true;
    } catch { this.dispose(); return false; }
  }

  /** 光标和选区移动不会失效；非活动标签、模态、忙碌或关闭期间只暂时禁用。 */
  available(): boolean {
    if (!this.range || !this.current()) return false;
    try { const scope = this.capture.scope(); return scope.active && !scope.busy && !scope.modal && !scope.closing; } catch { this.invalidate(); return false; }
  }

  /** 点击只选择、滚动及聚焦原模型；每个同步端口前重核，不投递IPC或再次执行。 */
  locate(): boolean {
    if (!this.available() || !this.range) return false;
    try {
      const start = this.model.getPositionAt(this.range.start), end = this.model.getPositionAt(this.range.end), selection = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
      if (!this.available()) return false; this.capture.editor.setSelection(selection);
      if (!this.available()) return false; this.capture.editor.revealRangeInCenter(selection);
      if (!this.available()) return false; this.capture.editor.focus(); return true;
    } catch { this.invalidate(); return false; }
  }

  /** 一次失效即释放全部监听；同文Undo、同ID连接恢复或迟到回调都不能复活。 */
  private invalidate(): void { if (!this.valid) return; this.valid = false; for (const subscription of this.subscriptions.splice(0)) { try { subscription.dispose(); } catch { /* 其它监听仍须精确释放。 */ } } try { this.capture.onInvalidated(); } catch { /* 定位失效通知不能影响原查询。 */ } }
  dispose(): void { this.invalidate(); }
}

/** 捕获仅由全文零偏移或当时真实选区给出基址；失败只禁用定位，不能阻止原查询。 */
export function captureQueryFailureSource(capture: Capture): QueryFailureSourceLease | undefined {
  return QueryFailureSourceLease.capture(capture);
}
