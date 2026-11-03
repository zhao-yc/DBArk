import type * as monaco from 'monaco-editor';
import { sqlSyntaxBoundary } from '../shared/sqlSyntaxCheck';
import { currentStatementZh as text } from './locales/currentStatement.zh-CN';

export interface CurrentStatementScope { tabId: string; connectionId: string; connectionVersion: number; sessionId: string; draft: string | undefined; present: boolean; active: boolean; modal: boolean; }

/** 点击时捕获全源和真实光标；模型/正文/上下文的任意失效都永久撤销本次投递意图。 */
export class CurrentStatementIntent {
  readonly source: string;
  readonly offset: number;
  private readonly model: monaco.editor.ITextModel;
  private readonly version: number;
  private readonly scope: CurrentStatementScope;
  private readonly selectedRange?: { start: number; end: number };
  private boundSession: string;
  private valid = true;
  private readonly subscriptions: Array<{ dispose(): void }> = [];

  constructor(private readonly editor: monaco.editor.IStandaloneCodeEditor, private readonly getScope: () => CurrentStatementScope, subscribeContext: (changed: () => void) => () => void, readonly selectionOnly = false) {
    const model = editor.getModel(), position = editor.getPosition(), scope = getScope();
    if (!model || model.isDisposed() || !position || !scope.present || !scope.active || scope.modal) throw new Error(text.unavailable);
    this.model = model; this.version = model.getVersionId(); this.offset = model.getOffsetAt(position); this.scope = { ...scope }; this.boundSession = scope.sessionId;
    const full = model.getValue();
    if (selectionOnly) {
      const eol = model.getEOL(), range = this.selectionRange();
      if (full !== (scope.draft ?? '').replace(/\r\n|\r|\n/g, eol)) throw new Error(text.selectionChanged);
      if (!range || range.end <= range.start || !sqlSyntaxBoundary(full, range.start) || !sqlSyntaxBoundary(full, range.end)) throw new Error(text.selectionRequired);
      const source = full.slice(range.start, range.end);
      if (!source.trim()) throw new Error(text.selectionRequired);
      this.selectedRange = range;
      this.source = source;
    } else this.source = full;
    try {
      this.subscriptions.push(model.onDidChangeContent(() => { this.valid = false; }), model.onWillDispose(() => { this.valid = false; }), editor.onDidChangeModel(() => { this.valid = false; }), editor.onDidDispose(() => { this.valid = false; }));
      this.subscriptions.push(editor.onDidChangeCursorPosition(() => { try { const point = editor.getPosition(); if (!point || model.getOffsetAt(point) !== this.offset) this.valid = false; } catch { this.valid = false; } }));
      if (selectionOnly) this.subscriptions.push(editor.onDidChangeCursorSelection(() => { if (!this.selectionMatches()) this.valid = false; }));
      const unsubscribe = subscribeContext(() => { if (!this.contextMatches(getScope())) this.valid = false; }); this.subscriptions.push({ dispose: unsubscribe });
      this.assertCurrent();
    } catch (reason) { this.dispose(); throw reason; }
  }

  /** 新建会话只绑定一次；已存在会话不能换成另一个会话继续执行旧意图。 */
  bindSession(session: string): void {
    if (!session || (this.boundSession && this.boundSession !== session)) { this.valid = false; throw new Error(this.selectionOnly ? text.selectionChanged : text.changed); }
    this.boundSession = session; this.assertCurrent();
  }

  /** 每次await后和最终invoke前核对；恢复同样文字、光标或连接不能复活已失效意图。 */
  assertCurrent(): void {
    try {
      const position = this.editor.getPosition();
      if (!this.valid || !this.contextMatches(this.getScope()) || this.editor.getModel() !== this.model || this.model.isDisposed() || this.model.getVersionId() !== this.version || !position || this.model.getOffsetAt(position) !== this.offset || this.selectionOnly && !this.selectionMatches()) throw new Error(text.changed);
    } catch { this.valid = false; throw new Error(this.selectionOnly ? text.selectionChanged : text.changed); }
  }

  /** 唯一选区按原模型 UTF-16 半开区间捕获，多光标不能混合提交。 */
  private selectionRange(): { start: number; end: number } | undefined {
    const selections = this.editor.getSelections();
    if (selections?.length !== 1 || selections[0].isEmpty()) return;
    return { start: this.model.getOffsetAt(selections[0].getStartPosition()), end: this.model.getOffsetAt(selections[0].getEndPosition()) };
  }
  /** 光标保持原位但选区锚点改变时也永久撤销原意图。 */
  private selectionMatches(): boolean {
    try {
      const current = this.selectionRange();
      return !!current && current.start === this.selectedRange?.start && current.end === this.selectedRange?.end;
    } catch { return false; }
  }

  /** workspace的正文快照也参与校验，防止React尚未把外部新草稿送入Monaco时抢先执行。 */
  private contextMatches(scope: CurrentStatementScope): boolean {
    return scope.present && scope.active && !scope.modal && scope.tabId === this.scope.tabId && scope.connectionId === this.scope.connectionId && scope.connectionVersion === this.scope.connectionVersion && scope.draft === this.scope.draft && (!this.boundSession || scope.sessionId === this.boundSession);
  }

  /** 所有路径释放监听器；投递结束后不保留全文模型租约。 */
  dispose(): void { this.valid = false; for (const subscription of this.subscriptions.splice(0)) subscription.dispose(); }
}
