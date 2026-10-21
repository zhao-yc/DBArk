import { describe, expect, it, vi } from 'vitest';
import { createSqlFieldHoverProvider } from '../../src/renderer/sqlFieldHoverProvider';
import { CompletionDirectory } from '../../src/renderer/completionDirectory';
import { analyzeCompletionHover } from '../../src/shared/completionHoverAnalysis';
import type { CompletionMetadataOutput, CompletionSessionState } from '../../src/shared/sqlCompletion';

/** 模型/网络为内存端口；生产provider、目录调度、取消和作用域分析全部运行。 */
function fixture(session = false, deferred = false) {
  let source = 'SELECT u.amount FROM db.users u', version = 1, valid = true, busy = false, serial = 0;
  const changes = new Set<() => void>(), callbacks: (() => void)[] = [], replies: ((value: CompletionMetadataOutput) => void)[] = [];
  const model = { getValue: () => source, getValueLength: () => source.length, getVersionId: () => version, isDisposed: () => false, getOffsetAt: () => source.indexOf('amount') + 3, getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }), onDidChangeContent: (listener: () => void) => { changes.add(listener); return { dispose: () => changes.delete(listener) }; } };
  let currentModel = model; const facts = { dialect: 'mysql' as const, version: '8.4.11' }, state: CompletionSessionState = { database: 'db', databaseKnown: true, ansiQuotes: false, noBackslashEscapes: false, dialect: 'mysql', serverVersion: '8.4.11', objectsRevision: 0, busy: false, broken: false };
  const data: CompletionMetadataOutput = { entries: [{ name: 'amount', kind: 'column', visible: true, details: { type: 'decimal(30,20)', nullable: false, defaultValue: '0.12345678901234567890', comment: '<img src=x> [x](command:danger)', extra: '' } }], incomplete: false };
  const cancel = vi.fn(async () => {}), request = vi.fn(async () => deferred ? await new Promise<CompletionMetadataOutput>(resolve => replies.push(resolve)) : data), directory = new CompletionDirectory('c', 1, { request, cancel, id: () => 'h' + ++serial });
  const stateRead = vi.fn(async () => ({ ...state })), analyze = vi.fn(async (text, offset, mode, _signal, capabilities) => analyzeCompletionHover(text, offset, mode, capabilities));
  const hover = createSqlFieldHoverProvider({ scope: { connectionId: 'c', connectionVersion: 1, database: 'db', ...(session ? { sessionId: 's' } : {}) }, model: () => currentModel as any, current: () => valid, completionBusy: () => busy, facts: () => facts, state: stateRead, analyze, directory, temporary: async () => ({ entries: [], incomplete: false, handled: false, shadowed: [], uncertain: false, revision: 0, caseMode: 0 }) });
  const token = { isCancellationRequested: false, onCancellationRequested(listener: (event: any) => any) { const callback = () => listener(undefined); callbacks.push(callback); return { dispose() { const index = callbacks.indexOf(callback); if (index >= 0) callbacks.splice(index, 1); } }; } };
  return { hover, model, state, stateRead, request, cancel, data, analyze, directory, replies, run: () => hover.provider.provideHover(model as any, { lineNumber: 1, column: 12 } as any, token), edit() { version++; source += ' '; for (const listener of [...changes]) listener(); }, invalid() { valid = false; }, keyboard() { busy = true; hover.cancel(); }, replace() { currentModel = { ...model }; }, tokenCancel() { for (const callback of [...callbacks]) callback(); }, cleanup() { hover.dispose(); directory.dispose(); }, listeners: () => changes.size + callbacks.length };
}
const tick = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };

describe('真实字段悬停provider的模型与物理会话边界', () => {
  it('输出安全Markdown和原字段范围，网络只收到单字段目标', async () => {
    const f = fixture(); const result = await f.run(); expect(result?.contents[0]).toMatchObject({ isTrusted: false, supportHtml: false }); expect((result?.contents[0] as any).value).toContain('decimal(30,20)'); expect(result?.range).toEqual({ startLineNumber: 1, startColumn: 10, endLineNumber: 1, endColumn: 16 });
    expect(f.request.mock.calls[0]).toEqual([{ kind: 'columns', database: 'db', table: 'users', prefix: 'amount', details: true, connectionId: 'c', taskId: 'h1' }]); expect(f.listeners()).toBe(0); f.cleanup();
  });
  it.each(['edit', 'tokenCancel', 'keyboard', 'cleanup'] as const)('%s中止旧读取并仅取消一次，不交付迟到属性', async action => {
    const f = fixture(false, true), pending = f.run(); await tick(); expect(f.request).toHaveBeenCalledTimes(1); f[action](); expect(await pending).toBeNull(); expect(f.cancel).toHaveBeenCalledExactlyOnceWith('h1'); f.replies[0](f.data); await tick(); expect(f.listeners()).toBe(0); f.cleanup();
  });
  it.each(['invalid', 'replace'] as const)('%s后原回包不能进入新编辑上下文', async action => {
    const f = fixture(false, true), pending = f.run(); await tick(); f[action](); f.replies[0](f.data); expect(await pending).toBeNull(); expect(f.listeners()).toBe(0); f.cleanup();
  });
  it('会话繁忙时零分析；读取期间模式变化、对象变更或断线均拒绝交付', async () => {
    const busy = fixture(true); busy.state.busy = true; expect(await busy.run()).toBeNull(); expect(busy.analyze).not.toHaveBeenCalled(); busy.cleanup();
    for (const field of ['ansiQuotes', 'objectsRevision', 'broken'] as const) {
      const f = fixture(true, true), pending = f.run(); await tick(); if (field === 'objectsRevision') f.state.objectsRevision = 1; else f.state[field] = true; f.replies[0](f.data); expect(await pending).toBeNull(); f.cleanup();
    }
  });
});
