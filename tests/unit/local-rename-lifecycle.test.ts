import { expect, it, vi } from 'vitest';
import type { CancellationToken, editor, Position } from 'monaco-editor';
import { createSqlRenameProvider } from '../../src/renderer/sqlRenameProvider';
import { analyzeSqliteLocalRename } from '../../src/shared/sqliteLocalRename';
import { createLocalRenameAnalysis } from '../../src/renderer/localRenameAnalysis';
import type { LocalReferencesWorkerClient } from '../../src/renderer/localReferencesWorkerClient';
import type { CompletionSessionState } from '../../src/shared/sqlCompletion';

const source = 'SELECT s.id FROM subject s WHERE s.id=1', position = { lineNumber: 1, column: 9 } as Position;
/** 受控端口只制造取消和代次竞态，绑定及修改范围始终用真实分析器产生。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => resolve = yes); return { promise, resolve }; }
function fixture() {
  let version = 1, live = true, alive = true;
  const changes = new Set<() => void>(), cancellations = new Set<() => void>(), uri = { toString: () => 'inmemory://original' };
  const model = { uri, isDisposed: () => !alive, getValue: vi.fn(() => source), getValueLength: () => source.length, getVersionId: () => version, getOffsetAt: (point: { column: number }) => point.column - 1, getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }), onDidChangeContent: (listener: () => void) => { changes.add(listener); return { dispose: () => changes.delete(listener) }; } } as unknown as editor.ITextModel;
  let currentModel = model;
  const token = { isCancellationRequested: false, onCancellationRequested: (listener: () => void) => { cancellations.add(listener); return { dispose: () => { cancellations.delete(listener); } }; } } as unknown as CancellationToken;
  const worker = { analyze: vi.fn(async (text: string, offset: number, _signal: AbortSignal, name?: string) => analyzeSqliteLocalRename(text, offset, name)), dispose: vi.fn(async () => {}) };
  const release = vi.fn(), prepare = vi.fn(), begin = vi.fn(() => release), notify = vi.fn();
  const registration = createSqlRenameProvider({ model: () => currentModel, current: () => live, sourceLimit: 262144, worker, begin, prepare, notify });
  return { model, token, worker, begin, prepare, release, notify, registration, changes, cancellations, resolve: () => registration.provider.resolveRenameLocation!(model, position, token), rename: () => registration.provider.provideRenameEdits(model, position, 'new alias', token), edit() { version++; changes.forEach(listener => listener()); }, invalidate() { live = false; }, close() { alive = false; }, replace() { currentModel = { ...model } as editor.ITextModel; } };
}
it('准备和提交均核原模型；只输出同URI、原版本的三个workspace编辑', async () => {
  const f = fixture(); expect(await f.resolve()).toMatchObject({ text: 's' });
  const result = await f.rename(); expect(result?.edits).toHaveLength(3);
  for (const edit of result!.edits) expect(edit).toMatchObject({ resource: f.model.uri, versionId: 1, textEdit: { text: '"new alias"' } });
  expect(f.changes.size + f.cancellations.size).toBe(0); expect(f.release).toHaveBeenCalledTimes(2); await f.registration.dispose();
});
it.each(['edit', 'invalidate', 'close', 'replace', 'cancel', 'dispose'] as const)('%s使迟到准备失效并释放监听和租约', async action => {
  const f = fixture(), pending = deferred<ReturnType<typeof analyzeSqliteLocalRename>>(); f.worker.analyze.mockReturnValueOnce(pending.promise);
  const result = f.resolve(); if (action === 'cancel') f.cancellations.forEach(listener => listener()); else if (action === 'dispose') await f.registration.dispose(); else f[action]();
  pending.resolve(analyzeSqliteLocalRename(source, 8)); expect(await result).toHaveProperty('rejectReason'); expect(f.changes.size + f.cancellations.size).toBe(0); expect(f.release).toHaveBeenCalledOnce(); await f.registration.dispose();
});
it.each(['edit', 'invalidate', 'close', 'replace', 'cancel', 'dispose'] as const)('%s使迟到修改整批失效', async action => {
  const f = fixture(); await f.resolve(); const pending = deferred<ReturnType<typeof analyzeSqliteLocalRename>>(); f.worker.analyze.mockReturnValueOnce(pending.promise);
  const result = f.rename(); if (action === 'cancel') f.cancellations.forEach(listener => listener()); else if (action === 'dispose') await f.registration.dispose(); else f[action]();
  pending.resolve(analyzeSqliteLocalRename(source, 8, 'new alias')); expect(await result).toMatchObject({ edits: [], rejectReason: expect.any(String) }); await f.registration.dispose();
});
it('准备后正文变化不发第二次分析，无法把新模型接管为原重命名', async () => {
  const f = fixture(); await f.resolve(); f.edit(); expect(await f.rename()).toMatchObject({ edits: [], rejectReason: expect.any(String) }); expect(f.worker.analyze).toHaveBeenCalledOnce(); await f.registration.dispose();
});
it('旧准备finally不撤销继任准备，卸载幂等等待原dispose', async () => {
  const f = fixture(), pending = deferred<ReturnType<typeof analyzeSqliteLocalRename>>(); f.worker.analyze.mockReturnValueOnce(pending.promise);
  const old = f.resolve(); expect(await f.resolve()).toMatchObject({ text: 's' }); pending.resolve(analyzeSqliteLocalRename(source, 8)); expect(await old).toHaveProperty('rejectReason'); expect(f.notify).not.toHaveBeenCalled(); expect((await f.rename())?.edits).toHaveLength(3);
  const close = f.registration.dispose(); expect(f.registration.dispose()).toBe(close); await close; expect(f.worker.dispose).toHaveBeenCalledOnce();
});
it('超预算不读取正文或建立线程', async () => {
  const f = fixture(); vi.spyOn(f.model, 'getValueLength').mockReturnValue(262145); expect(await f.resolve()).toHaveProperty('rejectReason'); expect(f.model.getValue).not.toHaveBeenCalled(); expect(f.worker.analyze).not.toHaveBeenCalled(); await f.registration.dispose();
});
it('SQLite不读会话或facts；MySQL原缓存前后检查，变化时拒绝已算编辑', async () => {
  for (const dialect of ['sqlite', 'mysql'] as const) {
    const cached: CompletionSessionState = { database: 'db', databaseKnown: true, dialect: 'mysql', busy: false, broken: false, objectsRevision: 1 };
    const state = vi.fn(async () => ({ ...cached })), facts = vi.fn(() => undefined), worker = { rename: vi.fn(async () => { cached.objectsRevision = 2; return analyzeSqliteLocalRename(source, 8, 'next'); }), dispose: vi.fn() };
    const analysis = createLocalRenameAnalysis({ dialect, scope: { connectionId: 'own', connectionVersion: 1, sessionId: 'own-session', database: 'db' }, current: () => true, state, facts, create: () => worker as unknown as LocalReferencesWorkerClient });
    expect(await analysis.analyze(source, 8, new AbortController().signal, 'next')).toMatchObject({ status: dialect === 'sqlite' ? 'ready' : 'blocked' });
    expect(state).toHaveBeenCalledTimes(dialect === 'sqlite' ? 0 : 2); expect(facts).not.toHaveBeenCalled(); expect(worker.dispose).toHaveBeenCalledOnce(); await analysis.dispose();
  }
});
it('等待缓存期间卸载不再分配线程', async () => {
  const pending = deferred<CompletionSessionState>(), create = vi.fn();
  const analysis = createLocalRenameAnalysis({ dialect: 'mysql', scope: { connectionId: 'own', connectionVersion: 1, sessionId: 'session' }, current: () => true, state: () => pending.promise, facts: () => undefined, create });
  const request = analysis.analyze(source, 8, new AbortController().signal); await analysis.dispose(); pending.resolve({ databaseKnown: true, busy: false, broken: false });
  expect(await request).toMatchObject({ status: 'blocked' }); expect(create).not.toHaveBeenCalled();
});
