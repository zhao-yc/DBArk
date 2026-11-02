import { expect, it, vi } from 'vitest';
import { SqlReferenceCompletionGuard } from '../../src/renderer/sqlReferenceCompletionGuard';
import { createSqlReferencesProvider } from '../../src/renderer/sqlReferencesProvider';
import type { CancellationToken, editor, Position } from 'monaco-editor';

it('原线程取消立即恢复补全，旧清理不能解除继任保护', () => {
  const guard = new SqlReferenceCompletionGuard(), first = new AbortController(), second = new AbortController();
  const release = guard.acquire(first.signal); expect(guard.blocked(null)).toBe(true); first.abort(); expect(guard.blocked(null)).toBe(false);
  const next = guard.acquire(second.signal); release(); expect(guard.blocked(null)).toBe(true); next(); next(); expect(guard.blocked(null)).toBe(false);
});
it('解析终态后仍挡住原peek的迟到候选，关闭后恢复；其它编辑器不互相屏蔽', () => {
  const guard = new SqlReferenceCompletionGuard(), other = new SqlReferenceCompletionGuard(), controller = new AbortController(), release = guard.acquire(controller.signal);
  const root = { querySelector: vi.fn(() => ({})) } as unknown as Element;
  release(); expect(guard.blocked(root)).toBe(true); expect(other.blocked(null)).toBe(false); expect(root.querySelector).toHaveBeenCalledWith('.reference-zone-widget');
  (root.querySelector as ReturnType<typeof vi.fn>).mockReturnValue(null); expect(guard.blocked(root)).toBe(false);
});
it('已取消信号不建立保护，也不因无面板冻结补全', () => {
  const guard = new SqlReferenceCompletionGuard(), controller = new AbortController(); controller.abort(); const release = guard.acquire(controller.signal); expect(guard.blocked(null)).toBe(false); release();
});
it('真实provider异步解析期间建立代次租约，完成与模型取消均释放', async () => {
  let version = 1; const guard = new SqlReferenceCompletionGuard(), listeners = new Set<() => void>(); let resolve!: (value: { status: 'blocked'; reason: string }) => void;
  const pending = () => new Promise<{ status: 'blocked'; reason: string }>(yes => resolve = yes);
  const model = { uri: {}, getValueLength: () => 25, getValue: () => 'SELECT s.id FROM subject s', isDisposed: () => false, getVersionId: () => version, getOffsetAt: () => 8, onDidChangeContent: (fn: () => void) => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; } } as unknown as editor.ITextModel;
  const worker = { analyze: vi.fn(pending), dispose: async () => {} }, registration = createSqlReferencesProvider({ model: () => model, current: () => true, sourceLimit: 262144, worker, begin: signal => guard.acquire(signal) });
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as CancellationToken;
  const first = registration.provider.provideReferences(model, { lineNumber: 1, column: 9 } as Position, { includeDeclaration: true }, token); expect(guard.blocked(null)).toBe(true); resolve({ status: 'blocked', reason: 'syntax' }); expect(await first).toBeNull(); expect(guard.blocked(null)).toBe(false);
  const second = registration.provider.provideReferences(model, { lineNumber: 1, column: 9 } as Position, { includeDeclaration: true }, token); version++; listeners.forEach(fn => fn()); expect(guard.blocked(null)).toBe(false); resolve({ status: 'blocked', reason: 'cancelled' }); await second; expect(listeners.size).toBe(0); await registration.dispose();
});
