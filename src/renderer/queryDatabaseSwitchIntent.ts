import type * as monaco from 'monaco-editor';
import type { QueryDatabaseContext } from '../shared/queryContext';
import { validateQueryDatabaseSwitchName } from '../shared/queryDatabaseSwitch';
import type { WorkspaceTab } from './store';

export interface QueryDatabaseSwitchScope {
  tab: WorkspaceTab | undefined; connection: unknown; connectionVersion: number;
  sessionId: string; actualContext: QueryDatabaseContext;
  present: boolean; active: boolean; closing: boolean; available: boolean;
}
const contextKey = (value: QueryDatabaseContext) => JSON.stringify(value);
const recoveryKey = (tab: WorkspaceTab | undefined) => JSON.stringify([tab?.database, tab?.databaseContext]);

/** 一次弹窗只保留一个原来源；同步观察ABA，自己的恢复快照通过受限迁移推进。 */
export class QueryDatabaseSwitchIntent {
  readonly expectedContext: QueryDatabaseContext;
  readonly sessionId: string;
  private readonly origin: QueryDatabaseSwitchScope;
  private tab: WorkspaceTab;
  private actualKey: string;
  private recovery: string;
  private readonly model: monaco.editor.ITextModel;
  private readonly version: number;
  private readonly body: string;
  private readonly selection: string;
  private valid = true;
  private phase: 'loading' | 'ready' | 'sending' = 'loading';
  private choices: readonly string[] = [];
  private mutation?: { recovery?: string; actual?: string; tabObserved?: WorkspaceTab; actualObserved?: boolean };
  private subscriptions: Array<{ dispose(): void }> = [];
  private listeners = new Set<() => void>();

  constructor(private readonly editor: monaco.editor.IStandaloneCodeEditor, private readonly read: () => QueryDatabaseSwitchScope, subscribe: (changed: () => void) => () => void, private readonly message: string) {
    const scope = read(), model = editor.getModel(), selection = editor.getSelection();
    if (!scope.tab || !scope.sessionId || !model || model.isDisposed() || !selection) throw Error(message);
    this.origin = { ...scope }; this.tab = scope.tab; this.sessionId = scope.sessionId;
    this.expectedContext = { ...scope.actualContext }; this.actualKey = contextKey(scope.actualContext); this.recovery = recoveryKey(scope.tab);
    this.model = model; this.version = model.getVersionId(); this.body = model.getValue(); this.selection = JSON.stringify(selection);
    try {
      const changed = () => { this.current(); };
      this.subscriptions.push(model.onDidChangeContent(() => this.invalidate()), model.onWillDispose(() => this.invalidate()), editor.onDidChangeModel(() => this.invalidate()), editor.onDidDispose(() => this.invalidate()), editor.onDidChangeCursorSelection(changed), { dispose: subscribe(changed) });
      this.assertCurrent();
    } catch (reason) { this.dispose(); throw reason; }
  }

  /** 目录只是可选候选；名称原文保留，不提供空库或任意SQL输入。 */
  ready(databases: readonly string[]): readonly string[] {
    this.assertCurrent(); if (this.phase !== 'loading') throw Error(this.message);
    this.choices = [...new Set(databases.filter(value => { try { validateQueryDatabaseSwitchName(value); return true; } catch { return false; } }))];
    this.phase = 'ready'; return this.choices;
  }

  /** 同步消费一次确认，双击及旧确认回调都不能创建第二个任务。 */
  beginSend(database: string): void {
    this.assertCurrent(); if (this.phase !== 'ready' || !this.choices.includes(database)) throw Error(this.message);
    this.phase = 'sending';
  }

  /** 只允许本次同步写入默认库字段；正文、来源、标题和任何外来tab替换仍会撤销。 */
  transition<T>(allowed: { recovery?: QueryDatabaseContext; actual?: QueryDatabaseContext }, write: () => T): T {
    this.assertCurrent();
    if (this.phase !== 'sending' || this.mutation) throw Error(this.message);
    this.mutation = { recovery: allowed.recovery ? JSON.stringify([allowed.recovery.state === 'known' ? allowed.recovery.database ?? undefined : undefined, allowed.recovery]) : undefined, actual: allowed.actual ? contextKey(allowed.actual) : undefined };
    try {
      const result = write(); this.assertCurrent();
      const now = this.read(); this.tab = now.tab!; this.recovery = recoveryKey(now.tab); this.actualKey = contextKey(now.actualContext);
      return result;
    } finally { this.mutation = undefined; }
  }

  /** 标签对象只在本用途受控库迁移中替换；来源离开再回来也无法恢复授权。 */
  current(): boolean {
    if (!this.valid) return false;
    try {
      const now = this.read(), before = this.origin, tab = now.tab;
      const sameTab = tab === this.tab || !!this.mutation?.recovery && !!tab && recoveryKey(tab) === this.mutation.recovery && [...new Set([...Object.keys(tab), ...Object.keys(this.tab)])].every(key => key === 'database' || key === 'databaseContext' || Object.is((tab as unknown as Record<string, unknown>)[key], (this.tab as unknown as Record<string, unknown>)[key]));
      const recovery = recoveryKey(tab), actual = contextKey(now.actualContext);
      if (!now.present || !now.active || now.closing || !now.available || !now.connection || now.connection !== before.connection || now.connectionVersion !== before.connectionVersion || now.sessionId !== this.sessionId || !sameTab || recovery !== this.recovery && recovery !== this.mutation?.recovery || actual !== this.actualKey && actual !== this.mutation?.actual || this.mutation?.tabObserved && tab !== this.mutation.tabObserved || this.mutation?.actualObserved && actual !== this.mutation.actual || this.editor.getModel() !== this.model || this.model.isDisposed() || this.model.getVersionId() !== this.version || this.model.getValue() !== this.body || JSON.stringify(this.editor.getSelection()) !== this.selection) this.invalidate();
      // 一次受控迁移只接纳一个新tab对象及单向实际库变化，重入的同值替换也不获豁免。
      if(this.valid&&this.mutation){if(tab!==this.tab)this.mutation.tabObserved=tab;if(actual!==this.actualKey)this.mutation.actualObserved=true;}
    } catch { this.invalidate(); }
    return this.valid;
  }

  assertCurrent(): void { if (!this.current()) throw Error(this.message); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** 墓碑立即通知弹窗，保留发送中的原任务占用直至真实落定。 */
  invalidate(): void { if (!this.valid) return; this.valid = false; for (const listener of this.listeners) listener(); }
  dispose(): void { this.invalidate(); for (const subscription of this.subscriptions.splice(0)) subscription.dispose(); this.listeners.clear(); }
}
