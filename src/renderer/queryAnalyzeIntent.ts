import type * as monaco from 'monaco-editor';

export interface QueryAnalyzeScope {
  tabId: string; connectionId: string; connectionVersion: number; connection: unknown;
  sessionId: string; draft: string | undefined; databaseKey: string; sourceKey: string;
  present: boolean; active: boolean;
}

/** 确认始终绑定原模型、选区、连接及固定会话；离开再回到同值也不能复活旧确认。 */
export class QueryAnalyzeIntent {
  readonly source: string;
  private readonly model: monaco.editor.ITextModel;
  private readonly version: number;
  private readonly selection: string;
  private readonly scope: QueryAnalyzeScope;
  private session: string;
  private phase: 'preparing' | 'ready' | 'sending' = 'preparing';
  private valid = true;
  private databaseKey = '';
  private preparingContext = false;
  private contextPrepared = false;
  private databaseValue: string | null | undefined;
  private subscriptions: Array<{ dispose(): void }> = [];

  constructor(private readonly editor: monaco.editor.IStandaloneCodeEditor, private readonly read: () => QueryAnalyzeScope, subscribe: (changed: () => void) => () => void, private readonly changed: () => void, private readonly changedMessage: string) {
    const model = editor.getModel(), selection = editor.getSelection(), scope = read();
    if (!model || model.isDisposed() || !selection || !scope.present || !scope.active || !scope.connection) throw Error(changedMessage);
    this.model = model; this.version = model.getVersionId(); this.selection = JSON.stringify(selection);
    this.scope = { ...scope }; this.session = scope.sessionId;
    const selected = model.getValueInRange(selection);
    this.source = selected.trim() ? selected : model.getValue();
    if (!this.source.trim() || new TextEncoder().encode(this.source).byteLength > 20 * 1024 * 1024) throw Error('实际执行分析需要非空且不超过20MiB的SQL');
    try {
      const invalidate = () => this.invalidate();
      this.subscriptions.push(model.onDidChangeContent(invalidate), model.onWillDispose(invalidate), editor.onDidChangeModel(invalidate), editor.onDidDispose(invalidate));
      this.subscriptions.push(editor.onDidChangeCursorSelection(() => { if (JSON.stringify(editor.getSelection()) !== this.selection) this.invalidate(); }));
      const unsubscribe = subscribe(() => { if (!this.matches()) this.invalidate(); });
      this.subscriptions.push({ dispose: unsubscribe });
      this.assertCurrent();
    } catch (error) { this.dispose(); throw error; }
  }

  /** 新会话只在准备阶段绑定一次；既有事务会话绝不替换成另一个会话。 */
  bindSession(session: string): void {
    if (this.phase !== 'preparing' || !session || this.session && this.session !== session) this.invalidate();
    this.session = session; this.assertCurrent();
  }

  /** 默认库来自原会话的可信缓存；打开确认前不执行用户SQL。 */
  ready(database: string | null): void {
    this.assertCurrent();
    if (this.phase !== 'preparing' || !this.session || !(database === null || typeof database === 'string')) throw Error(this.changedMessage);
    this.databaseValue = database; this.databaseKey = this.read().databaseKey; this.phase = 'ready'; this.assertCurrent();
  }

  /** 一个确认最多交付一次；失败后也必须重新打开、核对并明确确认。 */
  beginSend(): void { this.assertCurrent(); if (this.phase !== 'ready') throw Error(this.changedMessage); this.phase = 'sending'; }

  /** 只放行本次发送前的未知恢复快照，其他目标变化仍永久撤销；Engine另核真实默认库。 */
  allowContextPreparation(): void { this.assertCurrent(); if (this.phase !== 'sending' || this.preparingContext || this.contextPrepared) throw Error(this.changedMessage); this.preparingContext = true; }

  get database(): string | null { if (this.databaseValue === undefined) throw Error(this.changedMessage); return this.databaseValue; }

  private matches(): boolean {
    const now = this.read(), before = this.scope;
    let context = this.phase === 'preparing' || now.databaseKey === this.databaseKey;
    // 本次恢复快照只允许单向推进一次；看到unknown后恢复原已知值也属于来源ABA。
    if (!context && this.phase === 'sending' && this.preparingContext && now.databaseKey === JSON.stringify([undefined, { state: 'unknown' }])) {
      this.databaseKey = now.databaseKey; this.preparingContext = false; this.contextPrepared = true; context = true;
    }
    return now.present && now.active && now.tabId === before.tabId && now.connectionId === before.connectionId && now.connectionVersion === before.connectionVersion && now.connection === before.connection && now.draft === before.draft && now.sourceKey === before.sourceKey && (!this.session || now.sessionId === this.session) && context && this.editor.getModel() === this.model && !this.model.isDisposed() && this.model.getVersionId() === this.version && JSON.stringify(this.editor.getSelection()) === this.selection;
  }

  private invalidate(): void { if (!this.valid) return; this.valid = false; this.changed(); }

  /** 每个await之后、发送前及来源事件到达时核同一租约，拒绝正文或连接ABA。 */
  assertCurrent(): void {
    try { if (!this.valid || !this.matches()) throw Error(this.changedMessage); }
    catch { this.invalidate(); throw Error(this.changedMessage); }
  }

  /** 取消、完成和卸载仅释放本次监听，不关闭用户原有事务会话。 */
  dispose(): void { this.valid = false; for (const item of this.subscriptions.splice(0)) item.dispose(); }
}
