import { describe, expect, it, vi } from 'vitest';
import type { editor, CancellationToken, Position } from 'monaco-editor';
import type { CompletionSessionState } from '../../src/shared/sqlCompletion';
import { createSqlSignatureProvider } from '../../src/renderer/sqlSignatureProvider';

/** 纯模型与缓存端口，只模拟事件；没有Monaco布局、数据库或系统输入。 */
function fixture(session = false, dialect: 'mysql' | 'sqlite' = 'mysql') {
  let source = "SELECT SUBSTR('x',1,2)", version = 1, disposed = false, allowed = true, cancelled = false;
  const changes = new Set<() => void>(), cancellations = new Set<() => void>();
  const model = { getValue: () => source, getValueLength: () => source.length, getVersionId: () => version, getOffsetAt: (position: { column: number }) => position.column - 1, isDisposed: () => disposed, onDidChangeContent: (callback: () => void) => { changes.add(callback); return { dispose() { changes.delete(callback); } }; } } as unknown as editor.ITextModel;
  let activeModel: editor.ITextModel | null = model;
  const token = { get isCancellationRequested() { return cancelled; }, onCancellationRequested: (callback: () => void) => { cancellations.add(callback); return { dispose() { cancellations.delete(callback); } }; } } as unknown as CancellationToken;
  const cached: CompletionSessionState = { database: 'db', databaseKnown: true, dialect: 'mysql', ansiQuotes: false, noBackslashEscapes: false, busy: false, broken: false, objectsRevision: 1, serverVersion: '8.4.11' };
  const scope = { connectionId: 'c', connectionVersion: 1, database: 'db', ...(session ? { sessionId: 's' } : {}) };
  const current = vi.fn(() => allowed), state = vi.fn(async (_id: string) => cached), ports = { current, model: () => activeModel, dialect, scope, state }, service = createSqlSignatureProvider(ports);
  const read = (own = model, ownToken = token) => Promise.resolve(service.provider.provideSignatureHelp(own, { lineNumber: 1, column: source.indexOf('2') + 1 } as Position, ownToken, { triggerKind: 1, isRetrigger: false }));
  return { model, token, cached, scope, ports, service, read, state, current, changes, cancellations, edit(value = source) { source = value; version++; changes.forEach(callback => callback()); }, cancel() { cancelled = true; cancellations.forEach(callback => callback()); }, available(value: boolean) { allowed = value; }, disposeModel() { disposed = true; }, switchModel(value: editor.ITextModel | null) { activeModel = value; } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

describe('函数参数提示来源与生命周期', () => {
  it.each(['mysql', 'sqlite'] as const)('%s本地提示不调用缓存或数据库，标签范围只来自固定中文资料', async dialect => {
    const f = fixture(false, dialect), result = await f.read(); expect(result?.value.activeSignature).toBe(1); expect(result?.value.activeParameter).toBe(2); const signature = result!.value.signatures[1];
    expect(signature.label).toBe('SUBSTR(字符串, 起始位置, 长度)'); expect(signature.parameters.map(parameter => { const [start, end] = parameter.label as [number, number]; return signature.label.slice(start, end); })).toEqual(['字符串', '起始位置', '长度']);
    expect(signature.documentation).not.toContain("'x'"); expect(f.state).not.toHaveBeenCalled(); expect(f.changes.size).toBe(0); expect(f.cancellations.size).toBe(0); result?.dispose(); f.service.dispose();
  });
  it('已有会话只读同一编号的前后缓存；无默认库仍可显示纯语法', async () => {
    const f = fixture(true); f.cached.databaseKnown = false; f.cached.database = undefined; expect(await f.read()).not.toBeNull(); expect(f.state.mock.calls).toEqual([['s'], ['s']]);
  });
  it.each(['ansiQuotes', 'noBackslashEscapes', 'objectsRevision', 'database', 'serverVersion', 'dialect', 'busy', 'broken'] as const)('%s变化拒绝迟到提示，缓存对象原地变化也不借旧引用通过', async key => {
    const f = fixture(true); f.state.mockImplementationOnce(async () => f.cached).mockImplementationOnce(async () => { Object.assign(f.cached, { [key]: key === 'objectsRevision' ? 2 : key === 'database' ? 'other' : key === 'serverVersion' ? 'other' : key === 'dialect' ? 'sqlite' : true }); return f.cached; });
    expect(await f.read()).toBeNull(); expect(f.state).toHaveBeenCalledTimes(2);
  });
  it.each(['busy', 'broken'] as const)('原会话%s时不分析或追加缓存读取', async key => { const f = fixture(true); f.cached[key] = true; expect(await f.read()).toBeNull(); expect(f.state).toHaveBeenCalledTimes(1); });
  it.each(['edit', 'cancel', 'dispose', 'model', 'focus'] as const)('%s撤销等待中的原提示，无额外线程或目录请求', async kind => {
    const f = fixture(true), pending = deferred<CompletionSessionState>(); f.state.mockImplementationOnce(() => pending.promise); const reading = f.read();
    if (kind === 'edit') { f.edit('SELECT ABS(2)'); f.edit(); } if (kind === 'cancel') f.cancel(); if (kind === 'dispose') f.service.dispose(); if (kind === 'model') f.switchModel(null); if (kind === 'focus') f.available(false);
    pending.resolve(f.cached); expect(await reading).toBeNull(); expect(f.state).toHaveBeenCalledTimes(1); expect(f.changes.size).toBe(0); expect(f.cancellations.size).toBe(0);
  });
  it('新请求即使被拒绝也撤销旧请求，已观测作用域ABA不能复活旧授权', async () => {
    const f = fixture(true), pending = deferred<CompletionSessionState>(); f.state.mockImplementationOnce(() => pending.promise); const reading = f.read(); f.scope.database = 'other'; expect(await f.read()).toBeNull(); f.scope.database = 'db'; pending.resolve(f.cached); expect(await reading).toBeNull(); expect(await f.read()).toBeNull();
  });
  it('同步重入守卫不递归读取缓存，也不发布外层旧结果', async () => {
    const f = fixture(true); let successor: ReturnType<typeof f.read> | undefined; f.current.mockImplementationOnce(() => { successor = f.read(); return true; }); expect(await f.read()).toBeNull(); expect(await successor).toBeNull(); expect(f.state).not.toHaveBeenCalled();
  });
  it('SQLite不读取传入会话；模型或来源无效、缓存异常均不显示', async () => {
    const sqlite = fixture(true, 'sqlite'); expect(await sqlite.read()).not.toBeNull(); expect(sqlite.state).not.toHaveBeenCalled();
    const f = fixture(true); f.state.mockRejectedValueOnce(Error('不可用')); expect(await f.read()).toBeNull(); f.disposeModel(); expect(await f.read()).toBeNull();
  });
});
