import type { editor, languages } from 'monaco-editor';
import type { SqliteCompletionAnalysis } from '../shared/sqliteCompletionAnalysis';
import { sqliteCompletionLimits } from '../shared/sqliteCompletion';

interface DefinitionPorts {
  model(): editor.ITextModel | null;
  current(): boolean;
  worker: { analyze(source: string, offset: number, signal: AbortSignal, intent: 'definition'): Promise<SqliteCompletionAnalysis>; dispose(): Promise<void> };
}

/** 本文声明导航独占自己的分析Worker；没有数据库、IPC、文件或任意URI执行端口。 */
export function createSqliteDefinitionProvider(ports: DefinitionPorts) {
  let active: AbortController | undefined, disposed = false, closing: Promise<void> | undefined;
  /** 换意图或卸载即撤销原结果；WorkerClient仍等待准确原线程终止后才建立继任。 */
  function cancel(): void { active?.abort(); active = undefined; }
  const provider: languages.DefinitionProvider = {
    async provideDefinition(model, position, token) {
      if (disposed || !ports.current() || ports.model() !== model || model.isDisposed() || token.isCancellationRequested || model.getValueLength() > sqliteCompletionLimits.sourceUnits) return null;
      cancel(); const controller = new AbortController(); active = controller;
      const version = model.getVersionId(), source = model.getValue(), offset = model.getOffsetAt(position);
      const cancellation = token.onCancellationRequested(() => controller.abort()), changed = model.onDidChangeContent(() => controller.abort());
      const current = () => !disposed && active === controller && !controller.signal.aborted && ports.current() && ports.model() === model && !model.isDisposed() && model.getVersionId() === version;
      try {
        const result = await ports.worker.analyze(source, offset, controller.signal, 'definition');
        if (!current() || result.status !== 'ready' || !result.definition) return null;
        const { definition, target } = result;
        if (definition.start < 0 || definition.start >= definition.end || definition.end > source.length || target.start < 0 || target.start >= target.end || target.end > source.length) return null;
        const range = (start: number, end: number) => { const from = model.getPositionAt(start), to = model.getPositionAt(end); return { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column }; };
        // URI始终取原模型；Worker只能提供本文有界范围，不能跳外部文件或命令链接。
        return [{ uri: model.uri, range: range(definition.start, definition.end), targetSelectionRange: range(definition.start, definition.end), originSelectionRange: range(target.start, target.end) }];
      } catch { return null; }
      finally { cancellation.dispose(); changed.dispose(); controller.abort(); if (active === controller) active = undefined; }
    },
  };
  return { provider, cancel, dispose(): Promise<void> { if (closing) return closing; disposed = true; cancel(); closing = ports.worker.dispose(); return closing; } };
}
