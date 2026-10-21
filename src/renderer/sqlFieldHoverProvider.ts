import type { editor, languages } from 'monaco-editor';
import type { CompletionAnalysis } from '../shared/completionAnalysis';
import type { CompletionLexicalMode } from '../shared/completionLexical';
import type { CompletionScopeCapabilities } from '../shared/completionCapabilities';
import { completionLimits, type CompletionDirectoryRequest, type CompletionMetadataOutput, type CompletionSessionState } from '../shared/sqlCompletion';
import type { ConnectionStatus } from '../shared/contracts';
import type { SessionObjectCompletion } from '../shared/sessionObjects';
import { completionContextCapabilities, resolveCompletionContext, sameCompletionState, type SqlCompletionScope } from './completionContext';
import { SessionCompletionDirectory } from './sessionCompletionDirectory';
import { sqlFieldHover } from './sqlFieldHover';

interface HoverPort {
  scope: SqlCompletionScope; model(): editor.ITextModel | null; current(): boolean; completionBusy(): boolean;
  facts(): Readonly<Pick<ConnectionStatus, 'dialect' | 'version'>> | undefined;
  state(sessionId: string): Promise<CompletionSessionState>;
  analyze(source: string, offset: number, mode: CompletionLexicalMode, signal: AbortSignal, capabilities: CompletionScopeCapabilities): Promise<CompletionAnalysis>;
  directory: { load(query: CompletionDirectoryRequest, signal?: AbortSignal): Promise<CompletionMetadataOutput>; };
  temporary(sessionId: string, query: CompletionDirectoryRequest): Promise<SessionObjectCompletion>;
}
/** 同一worker优先处理键盘补全；悬停独立取消，任何迟到字段都必须仍属于原模型和物理会话。 */
export function createSqlFieldHoverProvider(port: HoverPort): { provider: languages.HoverProvider; cancel(): void; dispose(): void } {
  let active: AbortController | undefined, disposed = false;
  function cancel(): void { active?.abort(); active = undefined; }
  const provider: languages.HoverProvider = {
    async provideHover(model, position, token) {
      if (disposed || !port.current() || port.completionBusy() || port.model() !== model || model.isDisposed() || token.isCancellationRequested || model.getValueLength() > completionLimits.sourceUnits) return null;
      cancel(); const controller = new AbortController(); active = controller;
      const version = model.getVersionId(), source = model.getValue(), offset = model.getOffsetAt(position), facts = port.scope.sessionId ? undefined : port.facts();
      const cancellation = token.onCancellationRequested(() => controller.abort()), changed = model.onDidChangeContent(() => controller.abort());
      const current = () => !disposed && active === controller && !controller.signal.aborted && port.current() && !port.completionBusy() && !model.isDisposed() && port.model() === model && model.getVersionId() === version && (!!port.scope.sessionId || port.facts() === facts);
      try {
        const cached = port.scope.sessionId ? await port.state(port.scope.sessionId) : undefined;
        if (!current()) return null;
        const scope = resolveCompletionContext(port.scope.database, cached, port.scope.databaseUnknown);
        if (!scope.available) return null;
        const analysis = await port.analyze(source, offset, scope.mode, controller.signal, completionContextCapabilities(cached, facts));
        if (!current() || analysis.status !== 'ready') return null;
        const directory = port.scope.sessionId ? new SessionCompletionDirectory(port.directory, query => port.temporary(port.scope.sessionId!, query), cached?.objectsRevision ?? 0) : port.directory;
        const content = await sqlFieldHover(analysis, scope.database, directory, controller.signal);
        if (!current() || !content) return null;
        if (port.scope.sessionId) { const latest = await port.state(port.scope.sessionId); if (!current() || !sameCompletionState(cached!, latest)) return null; }
        const { start, end } = analysis.target;
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > source.length) return null;
        const from = model.getPositionAt(start), to = model.getPositionAt(end);
        return { range: { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column }, contents: [{ value: content, isTrusted: false, supportHtml: false }] };
      } catch { return null; }
      finally { cancellation.dispose(); changed.dispose(); controller.abort(); if (active === controller) active = undefined; }
    }
  };
  return { provider, cancel, dispose() { disposed = true; cancel(); } };
}
