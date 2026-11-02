import type { editor, languages } from 'monaco-editor';
import type { LocalReferences } from '../shared/localReferences';

interface ReferencesPorts {
  model(): editor.ITextModel | null; current(): boolean; sourceLimit: number;
  prepare?(): void;
  worker: { analyze(source: string, offset: number, signal: AbortSignal): Promise<LocalReferences>; dispose(): Promise<void> };
}

/** Monaco引用列表只跳转原模型的有界范围；编辑、切换、模态、取消及卸载均撤销迟到结果。 */
export function createSqlReferencesProvider(ports: ReferencesPorts) {
  let active: AbortController | undefined, disposed = false, closing: Promise<void> | undefined;
  const cancel = () => { active?.abort(); active = undefined; };
  const provider: languages.ReferenceProvider = {
    async provideReferences(model, position, context, token) {
      if (disposed || !ports.current() || ports.model() !== model || model.isDisposed() || token.isCancellationRequested || model.getValueLength() > ports.sourceLimit) return null;
      cancel(); const controller = new AbortController(); active = controller;
      const version = model.getVersionId(), source = model.getValue(), offset = model.getOffsetAt(position);
      const cancellation = token.onCancellationRequested(() => controller.abort()), changed = model.onDidChangeContent(() => controller.abort());
      const current = () => !disposed && active === controller && !controller.signal.aborted && ports.current() && ports.model() === model && !model.isDisposed() && model.getVersionId() === version;
      try {
        ports.prepare?.();
        if (!current()) return null;
        const result = await ports.worker.analyze(source, offset, controller.signal);
        if (!current() || result.status !== 'ready') return null;
        const ranges = [...result.references, ...(context.includeDeclaration ? [result.declaration] : [])].sort((a, b) => a.start - b.start);
        if (ranges.some(item => !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end) || item.start < 0 || item.start >= item.end || item.end > source.length)) return null;
        return ranges.map(item => { const from = model.getPositionAt(item.start), to = model.getPositionAt(item.end); return { uri: model.uri, range: { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column } }; });
      } catch { return null; }
      finally { cancellation.dispose(); changed.dispose(); controller.abort(); if (active === controller) active = undefined; }
    },
  };
  return { provider, cancel, dispose(): Promise<void> { if (closing) return closing; disposed = true; cancel(); closing = ports.worker.dispose(); return closing; } };
}
