import { expect, it, vi } from 'vitest';
import type { CompletionSessionState } from '../../src/shared/sqlCompletion';
import type { SqliteCompletionInput, SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { analyzeSqliteCompletion, type SqliteCompletionAnalysis } from '../../src/shared/sqliteCompletionAnalysis';
import { createSqliteCompletionProvider, type SqliteCompletionModel } from '../../src/renderer/sqliteCompletionProvider';

const analysis = (): SqliteCompletionAnalysis => ({ status: 'ready', target: { start: 9, end: 9, prefix: '', quoted: false }, syntax: ['column'], qualifiers: ['s'], relations: [{ kind: 'physical', name: 'subject', alias: 's' }] });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
/** 真实provider/suggestions/合同；只有Monaco、Worker协议及Main请求端口为RAM，不伪装真实CPU或SQLite。 */
function fixture(session = false) {
  let version = 1, sequence = 0; const changes = new Set<() => void>(), live = { value: true }, modelAlive = { value: true };
  const model: SqliteCompletionModel = { isDisposed: () => !modelAlive.value, getVersionId: () => version, getValue: vi.fn(() => 'SELECT s. FROM subject AS s'), getValueLength: vi.fn(() => 26), getOffsetAt: () => 9, getPositionAt: offset => ({ lineNumber: 1, column: offset + 1 }), onDidChangeContent: listener => { changes.add(listener); return { dispose: () => { changes.delete(listener); } }; } };
  const stateValue: CompletionSessionState = { database: 'main', databaseKnown: true, dialect: 'sqlite', objectsRevision: 1, serverVersion: '3.53.0', busy: false, broken: false };
  const reply = (input: SqliteCompletionInput): SqliteCompletionOutput => ({ entries: input.kind === 'columns' ? [{ name: 'field_🚢', kind: 'column', schema: input.schema ?? 'main', table: input.table, declaredType: 'INTEGER', generated: false, hidden: false }] : [], incomplete: false, stamp: '1:0', ...(session ? { sessionRevision: 1 } : {}) });
  const worker = { analyze: vi.fn(async (_source: string, _offset: number, _signal?: AbortSignal, _intent?: 'hover') => analysis()), cancel: vi.fn(async () => {}), dispose: vi.fn(async () => {}) }, request = vi.fn(async (input: SqliteCompletionInput): Promise<unknown> => reply(input)), cancel = vi.fn(async (_id: string) => {}), state = vi.fn(async (_id: string) => ({ ...stateValue })), status = vi.fn();
  const provider = createSqliteCompletionProvider({ connectionId: 'c', ...(session ? { sessionId: 'sqlite:s' } : {}), model: () => model, current: () => live.value, worker, request, cancel, state, status, id: () => 'sqlite-completion:unit-' + ++sequence });
  const token = () => { const listeners = new Set<() => void>(), saved: (() => void)[] = [], value = { isCancellationRequested: false, onCancellationRequested(listener: () => void) { listeners.add(listener); saved.push(listener); return { dispose: () => { listeners.delete(listener); } }; } }; return { value, saved, cancel() { value.isCancellationRequested = true; [...listeners].forEach(listener => listener()); }, get listeners() { return listeners.size; } }; };
  const invoke = (t = token()) => ({ token: t, promise: provider.provideCompletionItems(model, { lineNumber: 1, column: 10 }, {}, t.value) });
  return { provider, model, live, modelAlive, worker, request, cancel, state, stateValue, status, reply, token, invoke, changes, edit() { version++; [...changes].forEach(listener => listener()); } };
}
/** 悬停复用同一个真实provider；RAM模型仅提供固定正文，解析仍走SQLite算法。 */
function hoverFixture(session = false) {
  const f = fixture(session), source = 'SELECT s.field_🚢 FROM subject AS s';
  vi.mocked(f.model.getValue).mockReturnValue(source); vi.mocked(f.model.getValueLength).mockReturnValue(source.length);
  f.worker.analyze.mockImplementation(async (source, offset, _signal, intent) => analyzeSqliteCompletion(source, offset, intent));
  return { ...f, hover(t = f.token()) { return { token: t, promise: f.provider.provideHover(f.model, { lineNumber: 1, column: 10 }, t.value) }; } };
}
it.each([false, true])('悬停%s会话精确字段及纯文本range，只有字段/stamp请求、不传SQL', async session => {
  const f = hoverFixture(session), run = f.hover(), result = await run.promise;
  expect(result).toMatchObject({ range: { startLineNumber: 1, startColumn: 10, endLineNumber: 1, endColumn: 18 }, contents: [{ isTrusted: false, supportHtml: false }] });
  expect(result!.contents[0].value).toContain('"INTEGER"'); expect(f.request.mock.calls.map(([q]) => q.kind)).toEqual(['columns', 'stamp']); expect(f.request.mock.calls[0][0]).toMatchObject({ prefix: 'field_🚢', table: 'subject' });
  expect(JSON.stringify(f.request.mock.calls)).not.toContain('SELECT'); expect(f.status).not.toHaveBeenCalled(); expect(f.state).toHaveBeenCalledTimes(session ? 2 : 0); expect(run.token.listeners).toBe(0); expect(f.changes.size).toBe(0); await f.provider.dispose();
});
it('补全运行时悬停立即安静返回，不取消或创建第二次分析', async () => {
  const f = hoverFixture(), pending = deferred<SqliteCompletionAnalysis>(); f.worker.analyze.mockReturnValueOnce(pending.promise);
  const completion = f.invoke(); await flush(); expect(await f.hover().promise).toBeNull(); expect(f.worker.analyze).toHaveBeenCalledOnce(); expect(f.worker.cancel).not.toHaveBeenCalled();
  pending.resolve(analysis()); await completion.promise; await f.provider.dispose();
});
it('键盘补全取消旧悬停但等原目录终态与取消回执，旧token不能取消新工作', async () => {
  const f = hoverFixture(true), pending = deferred<unknown>(), cancel = deferred<void>(); f.request.mockImplementationOnce(() => pending.promise); f.cancel.mockReturnValueOnce(cancel.promise);
  const hover = f.hover(); await flush(); const completion = f.invoke(); await flush(); expect(f.cancel).toHaveBeenCalledExactlyOnceWith('sqlite-completion:unit-1'); expect(f.worker.analyze).toHaveBeenCalledOnce();
  pending.resolve(f.reply(f.request.mock.calls[0][0])); await flush(); expect(f.worker.analyze).toHaveBeenCalledOnce(); cancel.resolve(undefined); expect(await hover.promise).toBeNull(); await completion.promise;
  const cancellations = f.worker.cancel.mock.calls.length; hover.token.saved[0](); expect(f.worker.cancel).toHaveBeenCalledTimes(cancellations); await f.provider.dispose();
});
it.each(['stamp', 'revision', 'busy', 'model'] as const)('悬停目录或来源%s变化不交付旧类型', async change => {
  const f = hoverFixture(true);
  if (change === 'stamp') f.request.mockImplementation(async input => ({ ...f.reply(input), ...(input.kind === 'stamp' ? { stamp: '2:0' } : {}) }));
  if (change === 'revision' || change === 'busy') f.state.mockResolvedValueOnce({ ...f.stateValue }).mockResolvedValueOnce({ ...f.stateValue, ...(change === 'revision' ? { objectsRevision: 2 } : { busy: true }) });
  if (change === 'model') f.request.mockImplementationOnce(async input => { f.edit(); return f.reply(input); });
  expect(await f.hover().promise).toBeNull(); expect(f.status).not.toHaveBeenCalled(); await f.provider.dispose();
});
it('卸载等待原悬停目录及准确取消终态，不发布迟到字段', async () => {
  const f = hoverFixture(), pending = deferred<unknown>(); f.request.mockReturnValueOnce(pending.promise); const run = f.hover(); await flush();
  const close = f.provider.dispose(); let closed = false; void close.then(() => closed = true); await flush(); expect(closed).toBe(false);
  pending.resolve(f.reply(f.request.mock.calls[0][0])); expect(await run.promise).toBeNull(); await close; expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(f.changes.size).toBe(0); expect(run.token.listeners).toBe(0); expect(await f.hover().promise).toBeNull();
});
it.each([false, true])('同模型%s会话补全只有固定目录调用，完整range正确且不送SQL正文', async session => {
  const f = fixture(session), run = f.invoke(), result = await run.promise; expect(result.suggestions[0]).toMatchObject({ label: 'field_🚢', insertText: '"field_🚢"', range: { startLineNumber: 1, startColumn: 10, endLineNumber: 1, endColumn: 10 } });
  expect(f.request.mock.calls.map(([q]) => q.kind)).toEqual(['columns', 'stamp']); expect(f.request.mock.calls[0][0]).toMatchObject({ connectionId: 'c', prefix: '', kind: 'columns', table: 'subject', ...(session ? { sessionId: 'sqlite:s' } : {}) }); expect(JSON.stringify(f.request.mock.calls)).not.toContain('SELECT s.'); expect(f.state).toHaveBeenCalledTimes(session ? 2 : 0); expect(f.cancel).not.toHaveBeenCalled(); expect(run.token.listeners).toBe(0); expect(f.changes.size).toBe(0); await f.provider.dispose(); expect(f.worker.dispose).toHaveBeenCalledOnce();
});
it('分析前预算拒绝不取SQL正文、不发目录或分配线程', async () => {
  const f = fixture(); vi.mocked(f.model.getValueLength).mockReturnValue(262145); expect((await f.invoke().promise).suggestions).toEqual([]); expect(f.model.getValue).not.toHaveBeenCalled(); expect(f.worker.analyze).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled(); expect(f.status).toHaveBeenCalledWith('limited'); await f.provider.dispose();
});
it.each(['comment', 'string', 'parameter', 'budget', 'timeout', 'startup-timeout', 'worker'])('分析阻止%s不请求数据库', async reason => {
  const f = fixture(); f.worker.analyze.mockResolvedValue({ status: 'blocked', reason }); expect((await f.invoke().promise).suggestions).toEqual([]); expect(f.request).not.toHaveBeenCalled(); await f.provider.dispose();
});
it('模型内容变更终止真实操作端口，迟到分析不能读取目录', async () => {
  const f = fixture(), pending = deferred<SqliteCompletionAnalysis>(); f.worker.analyze.mockReturnValue(pending.promise); const run = f.invoke(); await flush(); f.edit(); pending.resolve(analysis()); expect((await run.promise).suggestions).toEqual([]); expect(f.worker.cancel).toHaveBeenCalledOnce(); expect(f.request).not.toHaveBeenCalled(); await f.provider.dispose();
});
it('新请求等待原目录真实终态，取消ACK先到也不在同会话并发', async () => {
  const f = fixture(true), pending = deferred<unknown>(); f.request.mockImplementationOnce(() => pending.promise); const old = f.invoke(); await flush(); expect(f.request).toHaveBeenCalledTimes(1); const next = f.invoke(); await flush(); expect(f.cancel).toHaveBeenCalledExactlyOnceWith('sqlite-completion:unit-1'); expect(f.worker.analyze).toHaveBeenCalledTimes(1); pending.resolve(f.reply(f.request.mock.calls[0][0])); expect((await old.promise).suggestions).toEqual([]); expect((await next.promise).suggestions[0].label).toBe('field_🚢'); expect(f.worker.analyze).toHaveBeenCalledTimes(2); await f.provider.dispose();
});
it('旧取消回调在新worker运行时不能终止继任分析', async () => {
  const f = fixture(); const first = f.invoke(); await first.promise; const pending = deferred<SqliteCompletionAnalysis>(); f.worker.analyze.mockReturnValueOnce(pending.promise); const second = f.invoke(); await flush(); first.token.saved[0](); expect(f.worker.cancel).not.toHaveBeenCalled(); pending.resolve(analysis()); expect((await second.promise).suggestions[0].label).toBe('field_🚢'); await f.provider.dispose();
});
it.each(['stamp', 'session-revision', 'wrong-table', 'wrong-kind', 'duplicate', 'unknown-field', 'entries-overflow'] as const)('目录%s不匹配拒绝整组，不混合旧来源', async change => {
  const f = fixture(true); f.request.mockImplementation(async input => {
    const raw: any = f.reply(input);
    if (change === 'stamp' && input.kind === 'stamp') raw.stamp = '2:0';
    if (change === 'session-revision') raw.sessionRevision = 2;
    if (change === 'wrong-table' && input.kind === 'columns') raw.entries[0].table = 'other';
    if (change === 'wrong-kind' && input.kind === 'columns') raw.entries = [{ name: 'other', kind: 'table', schema: 'main' }];
    if (change === 'duplicate' && input.kind === 'columns') raw.entries.push({ ...raw.entries[0] });
    if (change === 'unknown-field') raw.sql = '不应存在';
    if (change === 'entries-overflow' && input.kind === 'columns') raw.entries = Array.from({ length: 257 }, (_, i) => ({ ...raw.entries[0], name: 'field' + i }));
    return raw;
  }); expect((await f.invoke().promise).suggestions).toEqual([]); await f.provider.dispose();
});
it.each(['revision', 'busy', 'broken', 'database', 'dialect'] as const)('完成时%s变化不发布原建议', async field => {
  const f = fixture(true); const changed = { ...f.stateValue, ...(field === 'revision' ? { objectsRevision: 2 } : field === 'database' ? { database: undefined, databaseKnown: false } : field === 'dialect' ? { dialect: 'mysql' as const } : { [field]: true }) }; f.state.mockResolvedValueOnce({ ...f.stateValue }).mockResolvedValueOnce(changed); expect((await f.invoke().promise).suggestions).toEqual([]); await f.provider.dispose();
});
it('dispose幂等且等待原请求终态，模型/任务监听全部移除', async () => {
  const f = fixture(), pending = deferred<unknown>(); f.request.mockImplementationOnce(() => pending.promise); const run = f.invoke(); await flush(); const closing = f.provider.dispose(); expect(f.provider.dispose()).toBe(closing); let ended = false; void closing.then(() => { ended = true; }); await flush(); expect(ended).toBe(false); pending.resolve(f.reply(f.request.mock.calls[0][0])); expect((await run.promise).suggestions).toEqual([]); await closing; expect(f.changes.size).toBe(0); expect(run.token.listeners).toBe(0); expect(f.worker.dispose).toHaveBeenCalledOnce(); expect((await f.invoke().promise).suggestions).toEqual([]);
});
