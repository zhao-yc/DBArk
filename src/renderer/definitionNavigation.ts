import type * as monaco from 'monaco-editor';
import { objectUri } from '../shared/workbench';
import { definitionTextWithinBudget, definitionSearchOpenSchema, validateDefinitionNavigationResult, type DefinitionNavigationTarget, type DefinitionNavigationSource, type DefinitionSearchOpen } from '../shared/definitionNavigation';
import { exactSavedQueryModelRanges, validSavedQuerySpans, type SavedQueryNavigationState } from './savedQueryNavigation';

export type DefinitionNavigationState = SavedQueryNavigationState & { line?: number; column?: number };
export interface DefinitionNavigationIdentity extends DefinitionNavigationTarget { uri: string; sql: string; digest: string; }
/** URI沿用工作台完整身份编码；无法表示的对象只降级查看，不自行创造另一套URI。 */
export function definitionUri(target: DefinitionNavigationTarget): string | undefined { try { return objectUri({ connectionId: target.connectionId, database: target.database, name: target.name, kind: target.kind }); } catch { return; } }
/** 完整目标和修订逐字段绑定；名称包含分隔符时也不会碰撞。 */
export function sameDefinitionTarget(a: DefinitionNavigationTarget, b: DefinitionNavigationTarget | undefined): boolean {
  return !!b && Number.isSafeInteger(a.connectionVersion) && a.connectionVersion >= 0 && a.connectionId === b.connectionId && a.connectionVersion === b.connectionVersion && a.database === b.database && a.name === b.name && a.kind === b.kind;
}
/** 同步订阅首次看到目标变化就永久结束，回到旧目标也不能交付迟到读取。 */
export class DefinitionReadLease {
  private alive = true;
  readonly target: DefinitionNavigationTarget;
  constructor(target: DefinitionNavigationTarget, private readonly identity: () => DefinitionNavigationTarget | undefined) { this.target = { ...target }; }
  current(): boolean { if (!this.alive) return false; if (!sameDefinitionTarget(this.target, this.identity())) this.alive = false; return this.alive; }
  cancel(): void { this.alive = false; }
}
/** 摘要计算不规范化换行或文本，编码/预算不明确时由调用方降级。 */
export async function definitionDigest(sql: string): Promise<string> {
  if (!definitionTextWithinBudget(sql)) throw new Error('定义包含无效Unicode或超过定位预算');
  const bytes = new TextEncoder().encode(sql);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}
export interface DefinitionReadResult { sql: string; source?: DefinitionNavigationSource; status?: 'invalid' | 'unavailable'; }
/** 现有metadata.ddl原文二次核对搜索摘要；每次await后检查租约，不执行查询正文或改写定义。 */
export async function readDefinitionNavigation(lease: DefinitionReadLease, search: DefinitionSearchOpen | undefined, read: () => Promise<string>, digest = definitionDigest): Promise<DefinitionReadResult | undefined> {
  // 首个await前复制并校验整个来源，外部复用回包对象不能换掉正在核对的摘要或位置。
  const parsed = search ? definitionSearchOpenSchema.safeParse(search) : undefined;
  const sql = await read(); if (!lease.current()) return;
  if (!parsed) return { sql };
  if (!parsed.success) return { sql, status: 'invalid' };
  search = parsed.data;
  const uri = definitionUri(lease.target);
  let result = search.result;
  if (search.invalidated || !sameDefinitionTarget(search, lease.target)) return { sql, status: 'invalid' };
  if (!result) return { sql, status: 'unavailable' };
  try { result = validateDefinitionNavigationResult(result, sql); } catch { return { sql, status: 'invalid' }; }
  if (!/^[a-f0-9]{64}$/.test(result.digest)) return { sql, status: 'invalid' };
  let actual: string;
  try { actual = await digest(sql); } catch { return lease.current() ? { sql, status: 'unavailable' } : undefined; }
  if (!lease.current()) return;
  if (actual !== result.digest) return { sql, status: 'invalid' };
  if (!uri || result.status !== 'ready' || !validSavedQuerySpans(sql, result.ranges, result.limitReached)) return { sql, status: 'unavailable' };
  return { sql, source: { ...lease.target, uri, sql, digest: actual, ranges: result.ranges.map(range => ({ ...range })), limitReached: result.limitReached } };
}
/** 搜索连接修订一旦变化即永久失效；恢复原数字也不重新认可旧搜索结果。 */
export class DefinitionSearchConnectionLease {
  private alive = true;
  constructor(readonly connectionId: string, readonly version: number, private readonly currentVersion: () => number | undefined) {}
  current(): boolean { if (this.alive && this.currentVersion() !== this.version) this.alive = false; return this.alive; }
  cancel(): void { this.alive = false; }
}
/** 同一搜索来源观察到目标变化后不可复活，只有新的显式搜索打开动作才能建立新来源。 */
export class DefinitionSearchLifetime {
  private owner?: DefinitionSearchOpen; private ended = false;
  claim(search: DefinitionSearchOpen, target: DefinitionNavigationTarget): boolean {
    if (this.owner !== search) { this.owner = search; this.ended = false; }
    if (search.invalidated || !sameDefinitionTarget(search, target)) this.ended = true;
    return !this.ended;
  }
}

/** StrictMode效果重订阅保留终态，同一来源不能借编辑后撤销重新领取模型版本。 */
export class DefinitionNavigationLifetime {
  private owner?: { source: DefinitionNavigationSource; model: monaco.editor.ITextModel | null; version: number }; private ended = false;
  claim(source: DefinitionNavigationSource, model: monaco.editor.ITextModel | null): boolean {
    if (!this.owner || this.owner.source !== source) { this.owner = { source, model, version: model?.getVersionId() ?? 0 }; this.ended = !model; }
    if (this.ended || !model || model.isDisposed() || this.owner.model !== model || this.owner.version !== model.getVersionId()) { this.ended = true; return false; } return true;
  }
  end(): void { this.ended = true; }
}
/** onReady同步捕获真实模型版本，覆盖React导航效果尚未订阅前的编辑/撤销窗口。 */
export class DefinitionEditorLease {
  readonly model: monaco.editor.ITextModel | null; readonly version: number; readonly uri?: string;
  private alive = true; private listeners: monaco.IDisposable[] = [];
  constructor(readonly editor: monaco.editor.IStandaloneCodeEditor) {
    this.model = editor.getModel(); this.version = this.model?.getVersionId() ?? 0; this.uri = this.model?.uri?.toString();
    if (!this.model || this.model.isDisposed() || !this.uri) { this.alive = false; return; }
    this.listeners = [this.model.onDidChangeContent(() => this.dispose()), this.model.onWillDispose(() => this.dispose()), editor.onDidChangeModel(() => this.dispose()), editor.onDidDispose(() => this.dispose())];
  }
  current(): boolean {
    if (this.alive && (!this.model || this.model.isDisposed() || this.editor.getModel() !== this.model || this.model.getVersionId() !== this.version || this.model.uri.toString() !== this.uri)) this.dispose();
    return this.alive;
  }
  /** 不保留失效监听；同字串或同URI的模型不能重新领取这份准备租约。 */
  dispose(): void { if (!this.alive) return; this.alive = false; for (const listener of this.listeners) listener.dispose(); this.listeners = []; }
}
/** 模型对象、真实URI/版本与定义身份共同构成租约；复用保存查询已验收的UTF16/CRLF整组校验。 */
export class DefinitionNavigation {
  private readonly source: DefinitionNavigationSource; private readonly model: monaco.editor.ITextModel | null; private readonly version: number; private readonly modelUri: string | undefined;
  private alive = true; private terminal?: 'invalid' | 'unlocatable' | 'closed'; private index = 0; private decorations?: monaco.editor.IEditorDecorationsCollection; private listeners: monaco.IDisposable[] = [];
  constructor(private readonly editor: monaco.editor.IStandaloneCodeEditor, source: DefinitionNavigationSource, private readonly identity: () => DefinitionNavigationIdentity | undefined, private readonly changed: (state: DefinitionNavigationState) => void) {
    this.source = source; this.model = editor.getModel(); this.version = this.model?.getVersionId() ?? 0; this.modelUri = this.model?.uri?.toString();
    if (!this.model || !this.modelUri || this.model.isDisposed() || definitionUri(source) !== source.uri || !/^[a-f0-9]{64}$/.test(source.digest) || !validSavedQuerySpans(source.sql, source.ranges, source.limitReached) || !this.refresh()) { this.invalidate(); return; }
    try { validateDefinitionNavigationResult({ digest: source.digest, status: 'ready', ranges: source.ranges, limitReached: source.limitReached }, source.sql); } catch { this.invalidate(); return; }
    if (this.model.getValue() !== source.sql) { this.invalidate('unlocatable'); return; }
    this.source = { ...source, ranges: source.ranges.map(range => ({ ...range })) };
    if (!exactSavedQueryModelRanges(this.model, this.source.ranges)) { this.invalidate('unlocatable'); return; }
    this.listeners = [this.model.onDidChangeContent(() => this.invalidate()), this.model.onWillDispose(() => this.invalidate()), editor.onDidChangeModel(() => this.invalidate()), editor.onDidDispose(() => this.invalidate())];
    this.decorations = editor.createDecorationsCollection(); this.show();
  }
  /** 工作区同步订阅主动清理装饰，不能等下一次点击才发现对象或连接已变。 */
  refresh(): boolean {
    if (!this.alive) return false; const current = this.identity();
    if (!this.model || this.model.isDisposed() || this.editor.getModel() !== this.model || this.model.getVersionId() !== this.version || this.model.uri.toString() !== this.modelUri || !sameDefinitionTarget(this.source, current) || current?.uri !== this.source.uri || current.sql !== this.source.sql || current.digest !== this.source.digest) { this.invalidate(); return false; } return true;
  }
  /** 有界命中内循环，只移动光标和装饰；不设置文本、不执行SQL。 */
  move(delta: number): void { if (!this.refresh() || !Number.isSafeInteger(delta)) return; const count = this.source.ranges.length; this.index = ((this.index + delta) % count + count) % count; this.show(); }
  private show(): void {
    if (!this.refresh()) return; const ranges = exactSavedQueryModelRanges(this.model!, this.source.ranges);
    if (!ranges) { this.invalidate('unlocatable'); return; } if (!this.refresh()) return;
    this.decorations!.set(ranges.map((range, index) => ({ range, options: { className: index === this.index ? 'definition-match definition-match-active' : 'definition-match', showIfCollapsed: true } })));
    if (!this.refresh()) return; const active = exactSavedQueryModelRanges(this.model!, [this.source.ranges[this.index]])?.[0]; if (!active) { this.invalidate('unlocatable'); return; }
    const position = { lineNumber: active.startLineNumber, column: active.startColumn }; this.editor.setPosition(position); if (!this.refresh()) return; this.editor.revealPositionInCenter(position); if (!this.refresh()) return; this.editor.focus(); if (!this.refresh()) return;
    if (!exactSavedQueryModelRanges(this.model!, this.source.ranges)) { this.invalidate('unlocatable'); return; }
    this.changed({ status: 'ready', index: this.index, count: this.source.ranges.length, limitReached: this.source.limitReached, line: active.startLineNumber, column: active.startColumn });
  }
  /** 失效终态幂等且不可逆，编辑后恢复原字串也不复活令牌。 */
  invalidate(status: 'invalid' | 'unlocatable' | 'closed' = 'invalid'): void { if (this.terminal === 'closed' || !this.alive && status !== 'closed') return; if (this.alive) { this.alive = false; this.decorations?.clear(); for (const listener of this.listeners) listener.dispose(); this.listeners = []; } this.terminal = status; this.changed({ status, index: 0, count: 0, limitReached: false }); }
  dispose(): void { this.invalidate('closed'); }
}
