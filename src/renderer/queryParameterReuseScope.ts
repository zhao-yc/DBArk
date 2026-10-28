import type { QueryParameterReuseScope } from './queryParameterReuse';
import type { QueryParameterReuseCandidateView } from './queryParameterReuseCandidate';

export interface QueryParameterReusePosition { lineNumber: number; column: number; }
export interface QueryParameterReuseRange { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number; }
export interface QueryParameterReuseSelection extends QueryParameterReuseRange {
  getStartPosition(): QueryParameterReusePosition; getEndPosition(): QueryParameterReusePosition;
}
export interface QueryParameterReuseModel {
  getValue(): string; getVersionId(): number; isDisposed(): boolean;
  getValueInRange(range: QueryParameterReuseRange): string; getOffsetAt(position: QueryParameterReusePosition): number;
}
export interface QueryParameterReuseEditor {
  getModel(): QueryParameterReuseModel | null; getSelection(): QueryParameterReuseSelection | null;
}
export interface QueryParameterReuseScopeInput {
  tabId: string; connectionId: string; connectionVersion: number; sessionId: string | null;
  editor: QueryParameterReuseEditor | null; present: boolean; draft: string | undefined;
  savedSourceKey: string; fileSourceKey: string; databaseKey: string; databaseKnown: boolean;
  formIdentity: object; taskId: string;
}
const inputKeys = ['tabId', 'connectionId', 'connectionVersion', 'sessionId', 'editor', 'present', 'draft', 'savedSourceKey', 'fileSourceKey', 'databaseKey', 'databaseKnown', 'formIdentity', 'taskId'] as const;

/** 偏移是UTF16边界；不允许把CRLF或补充平面字符拆成另一个实际模板。 */
function boundary(source: string, offset: number): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length) return false;
  if (offset > 0 && offset < source.length && (source[offset - 1] === '\r' && source[offset] === '\n' || /[\ud800-\udbff]/.test(source[offset - 1]) && /[\udc00-\udfff]/.test(source[offset]))) return false;
  return true;
}

/** 只读真实模型及有效执行范围；空白选区与普通光标移动仍代表全文。 */
function executionSource(editor: QueryParameterReuseEditor, model: QueryParameterReuseModel, full: string): { source: string; rangeIdentity: string } {
  const selection = editor.getSelection(); if (!selection) return { source: full, rangeIdentity: 'all' };
  const startPosition = selection.getStartPosition(), endPosition = selection.getEndPosition();
  for (const position of [startPosition, endPosition]) if (!Number.isSafeInteger(position.lineNumber) || position.lineNumber < 1 || !Number.isSafeInteger(position.column) || position.column < 1) throw Error('参数有效选区无效');
  if (startPosition.lineNumber !== selection.startLineNumber || startPosition.column !== selection.startColumn || endPosition.lineNumber !== selection.endLineNumber || endPosition.column !== selection.endColumn) throw Error('参数选区坐标不一致');
  const start = model.getOffsetAt(startPosition), end = model.getOffsetAt(endPosition), selected = model.getValueInRange(selection);
  if (!boundary(full, start) || !boundary(full, end) || start > end || typeof selected !== 'string' || full.slice(start, end) !== selected) throw Error('参数选区与模型原文不一致');
  return selected.trim() ? { source: selected, rangeIdentity: `selection:${start}:${end}` } : { source: full, rangeIdentity: 'all' };
}

/** 同一QueryTab只有三个单槽memo；不保留整个tab、历史tokenMap或额外SQL副本，无任何订阅副作用。 */
export class QueryParameterReuseScopeReader {
  private savedMemo: { key: string; draft: string | undefined; token: object } | null = null;
  private fileMemo: { key: string; token: object } | null = null;
  private databaseMemo: { key: string; known: boolean; token: object } | null = null;
  private disposed = false;
  constructor(private reader: (() => QueryParameterReuseScopeInput | null) | null) {}

  /** 缺失或异常立即释放key/draft引用；恢复相同key也签发新token，旧scope不能复活。 */
  private clear(): null { this.savedMemo = null; this.fileMemo = null; this.databaseMemo = null; return null; }

  /** 父级workspace、模型及有效范围事件同步调用；读取不执行IPC、SQL、存储或React更新。 */
  read(): QueryParameterReuseCandidateView | null {
    if (this.disposed || !this.reader) return null;
    try {
      const raw = this.reader(); if (!raw) return this.clear(); const input = { ...raw };
      if (input.present !== true || typeof input.tabId !== 'string' || !input.tabId || typeof input.connectionId !== 'string' || !input.connectionId || !Number.isSafeInteger(input.connectionVersion) || input.connectionVersion < 0 || typeof input.sessionId !== 'string' && input.sessionId !== null || input.draft !== undefined && typeof input.draft !== 'string' || !input.editor || !input.formIdentity || typeof input.formIdentity !== 'object' || typeof input.taskId !== 'string' || typeof input.savedSourceKey !== 'string' || typeof input.fileSourceKey !== 'string' || typeof input.databaseKey !== 'string' || typeof input.databaseKnown !== 'boolean') return this.clear();
      const editor = input.editor, model = editor.getModel(); if (!model || model.isDisposed()) return this.clear();
      const full = model.getValue(), version = model.getVersionId(); if (typeof full !== 'string' || !full.trim() || !Number.isSafeInteger(version) || version < 0) return this.clear();
      const selected = executionSource(editor, model, full);
      // 只读端口也可能同步触发外来编辑；发布前重核模型、版本、范围及工作区字段，拒绝混合来源。
      const current = this.reader(); if (!current || !inputKeys.every(key => current[key] === input[key]) || editor.getModel() !== model || model.isDisposed() || model.getVersionId() !== version || model.getValue() !== full) return this.clear();
      const after = executionSource(editor, model, full); if (after.source !== selected.source || after.rangeIdentity !== selected.rangeIdentity) return this.clear();
      // saved键额外包含workspace draft；外来草稿先到也签发新代次，不用它替代真实模型正文。
      if (!this.savedMemo || this.savedMemo.key !== input.savedSourceKey || this.savedMemo.draft !== input.draft) this.savedMemo = { key: input.savedSourceKey, draft: input.draft, token: Object.freeze({}) };
      if (!this.fileMemo || this.fileMemo.key !== input.fileSourceKey) this.fileMemo = { key: input.fileSourceKey, token: Object.freeze({}) };
      // known位单独比较，unknown记账即撤销普通Cache；候选只用返回的语义key及known自行判断。
      if (!this.databaseMemo || this.databaseMemo.key !== input.databaseKey || this.databaseMemo.known !== input.databaseKnown) this.databaseMemo = { key: input.databaseKey, known: input.databaseKnown, token: Object.freeze({}) };
      const scope: QueryParameterReuseScope = { tabId: input.tabId, connectionId: input.connectionId, connectionVersion: input.connectionVersion, sessionId: input.sessionId, editorIdentity: editor, modelIdentity: model, modelVersion: version, source: selected.source, rangeIdentity: selected.rangeIdentity, savedSourceIdentity: this.savedMemo.token, fileSourceIdentity: this.fileMemo.token, defaultDatabaseIdentity: this.databaseMemo.token };
      return { scope, databaseKey: input.databaseKey, databaseKnown: input.databaseKnown, formIdentity: input.formIdentity, taskId: input.taskId };
    } catch { return this.clear(); }
  }

  /** 卸载后丢reader及所有key、draft引用；迟到读取不能重新签发来源。 */
  dispose(): void { this.disposed = true; this.reader = null; this.clear(); }
}
