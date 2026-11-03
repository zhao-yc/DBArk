import type { editor, languages, CancellationToken, IPosition } from 'monaco-editor';
import type { LocalRename } from '../shared/localRename';
import { localRenameZh as zh } from './locales/localRename.zh-CN';

interface RenamePorts {
  model(): editor.ITextModel | null; current(): boolean; sourceLimit: number;
  begin?(signal: AbortSignal): () => void; prepare?(): void;
  notify?(message: string): void;
  worker: { analyze(source: string, offset: number, signal: AbortSignal, newName?: string): Promise<LocalRename>; dispose(): Promise<void> };
}

/** F2仅提交原模型的版本化workspace编辑；Monaco负责一次撤销，不执行或保存SQL。 */
export function createSqlRenameProvider(ports: RenamePorts) {
  let active: AbortController | undefined, disposed = false, closing: Promise<void> | undefined, generation = 0;
  let prepared: { model: editor.ITextModel; version: number; start: number; end: number; name: string; kind: string } | undefined;
  const cancel = () => { generation++; active?.abort(); active = undefined; prepared = undefined; };
  const rejected = (reason: string) => reason === 'collision' ? zh.collision : reason === 'unresolved' ? zh.unresolved : reason === 'name' ? zh.name : ['cancelled', 'context'].includes(reason) ? zh.stale : zh.unavailable;
  /** standalone Monaco的通知服务不保证可见，拒绝原因同时交给原编辑器的可访问提示。 */
  const report = (model: editor.ITextModel, reason: string) => { const message = rejected(reason); if (!disposed && ports.current() && ports.model() === model && !model.isDisposed()) ports.notify?.(message); return message; };
  /** 每个await后核原模型、版本、scope及取消；旧请求不能交付修改或清除继任请求。 */
  async function analyze(model: editor.ITextModel, position: IPosition, token: CancellationToken, newName?: string): Promise<LocalRename> {
    if (disposed || !ports.current() || model.isDisposed() || ports.model() !== model || token.isCancellationRequested || model.getValueLength() > ports.sourceLimit) return { status: 'blocked', reason: 'cancelled' };
    active?.abort(); const controller = new AbortController(); active = controller;
    const version = model.getVersionId(), source = model.getValue(), offset = model.getOffsetAt(position);
    const cancellation = token.onCancellationRequested(() => controller.abort()), changed = model.onDidChangeContent(() => controller.abort());
    const current = () => !disposed && active === controller && !controller.signal.aborted && ports.current() && ports.model() === model && !model.isDisposed() && model.getVersionId() === version;
    let release: (() => void) | undefined;
    try {
      release = ports.begin?.(controller.signal); ports.prepare?.();
      if (!current()) return { status: 'blocked', reason: 'cancelled' };
      const result = await ports.worker.analyze(source, offset, controller.signal, newName);
      return current() ? result : { status: 'blocked', reason: 'cancelled' };
    } catch { return { status: 'blocked', reason: 'worker' }; }
    finally { cancellation.dispose(); changed.dispose(); controller.abort(); release?.(); if (active === controller) active = undefined; }
  }
  const provider: languages.RenameProvider = {
    async resolveRenameLocation(model, position, token) {
      const request = ++generation; prepared = undefined;
      const result = await analyze(model, position, token);
      if (request !== generation) return { range: { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column }, text: '', rejectReason: zh.stale };
      if (result.status !== 'ready') return { range: { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column }, text: '', rejectReason: report(model, result.reason) };
      const from = model.getPositionAt(result.target.start), to = model.getPositionAt(result.target.end);
      prepared = { model, version: model.getVersionId(), start: result.target.start, end: result.target.end, name: result.name, kind: result.kind };
      return { range: { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column }, text: result.name };
    },
    async provideRenameEdits(model, position, newName, token) {
      const original = prepared, request = generation, offset = model.getOffsetAt(position);
      if (!original || original.model !== model || original.version !== model.getVersionId() || offset < original.start || offset > original.end) return { edits: [], rejectReason: report(model, 'cancelled') };
      const result = await analyze(model, position, token, newName);
      if (request !== generation) return { edits: [], rejectReason: zh.stale };
      if (prepared !== original || result.status !== 'ready' || result.name !== original.name || result.kind !== original.kind || result.target.start !== original.start || result.target.end !== original.end) return { edits: [], rejectReason: report(model, result.status === 'blocked' ? result.reason : 'cancelled') };
      prepared = undefined;
      return { edits: result.edits.map(item => { const from = model.getPositionAt(item.start), to = model.getPositionAt(item.end); return { resource: model.uri, versionId: original.version, textEdit: { range: { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column }, text: item.text } }; }) };
    },
  };
  return { provider, cancel, dispose(): Promise<void> { if (closing) return closing; disposed = true; cancel(); closing = ports.worker.dispose(); return closing; } };
}
