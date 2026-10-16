import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachMonacoCaretDiagnostic } from '../e2e/monaco-caret-diagnostics';

const context = { cold: 2, phase: 'prepare' as const, marked: '合成|正文', pageErrorCount: 0 };
const sample = { sample: 'completed', model: { availability: 'unknown', utf16Units: null } };
function ports(evaluate: () => Promise<unknown>, attach = vi.fn(async () => undefined), duration = 100) {
  return { page: { evaluate } as never, info: { timeout: 90000, duration, attach } as never, attach };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('失败后的采样及附件共享500ms诊断预算', () => {
  it('evaluate永不返回时500ms退出，不调用附件，不遗留计时器', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const evaluate = vi.fn(() => new Promise(() => {})), p = ports(evaluate);
    const pending = attachMonacoCaretDiagnostic(p.page, p.info, context);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBe('timed-out'); expect(evaluate).toHaveBeenCalledTimes(1); expect(p.attach).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('真实采样回调中的settings.get一直pending也有界', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const invoke = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('document', { hasFocus: () => false, querySelectorAll: () => [] });
    vi.stubGlobal('window', { dbark: { invoke } });
    const p = ports(() => Promise.resolve(sample));
    p.page = { evaluate: (callback: (expected: string) => Promise<unknown>, expected: string) => callback(expected) } as never;
    const pending = attachMonacoCaretDiagnostic(p.page, p.info, context);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBe('timed-out'); expect(invoke).toHaveBeenCalledTimes(1); expect(p.attach).not.toHaveBeenCalled();
  });
  it('采样迟到返回后不再新启动附件，迟到拒绝也被承接', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let resolve!: (value: unknown) => void;
    const p = ports(() => new Promise(done => { resolve = done; }));
    const pending = attachMonacoCaretDiagnostic(p.page, p.info, context);
    await vi.advanceTimersByTimeAsync(500); await expect(pending).resolves.toBe('timed-out');
    resolve(sample); await Promise.resolve(); await Promise.resolve(); expect(p.attach).not.toHaveBeenCalled();
    let reject!: (reason: unknown) => void;
    const late = ports(() => new Promise((_, fail) => { reject = fail; }));
    const rejected = attachMonacoCaretDiagnostic(late.page, late.info, context);
    await vi.advanceTimersByTimeAsync(500); await expect(rejected).resolves.toBe('timed-out');
    reject(Error('合成迟到异常')); await Promise.resolve(); await Promise.resolve(); expect(late.attach).not.toHaveBeenCalled();
  });
  it('attach永不返回时停止等待，已发出的IO不伪称已撤回', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let reject!: (reason: unknown) => void;
    const attach = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; })), p = ports(async () => sample, attach);
    const pending = attachMonacoCaretDiagnostic(p.page, p.info, context);
    await vi.advanceTimersByTimeAsync(500); await expect(pending).resolves.toBe('timed-out'); expect(attach).toHaveBeenCalledTimes(1);
    reject(Error('合成附件迟到拒绝')); await Promise.resolve(); await Promise.resolve(); expect(vi.getTimerCount()).toBe(0);
  });
  it('采样和attach共享同一预算，不能各等500ms', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let resolve!: (value: unknown) => void;
    const p = ports(() => new Promise(done => { resolve = done; }), vi.fn(() => new Promise(() => {})));
    const pending = attachMonacoCaretDiagnostic(p.page, p.info, context);
    await vi.advanceTimersByTimeAsync(300); resolve(sample); await Promise.resolve(); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200); await expect(pending).resolves.toBe('timed-out'); expect(p.attach).toHaveBeenCalledTimes(1);
    expect(performance.now()).toBe(500);
  });
  it('attach同步抛错只结束诊断，不抛出附件错误', async () => {
    const p = ports(async () => sample, vi.fn(() => { throw Error('合成附件异常'); }));
    await expect(attachMonacoCaretDiagnostic(p.page, p.info, context)).resolves.toBe('failed');
  });
  it.each([89501, 90000, NaN, Infinity, -1])('剩余case不足或duration无效时直接跳过：%s', async duration => {
    const evaluate = vi.fn(async () => sample), p = ports(evaluate, vi.fn(async () => undefined), duration);
    await expect(attachMonacoCaretDiagnostic(p.page, p.info, context)).resolves.toBe('skipped'); expect(evaluate).not.toHaveBeenCalled(); expect(p.attach).not.toHaveBeenCalled();
  });
  it('正常采样仅附安全数据一次，不改变timeout字段', async () => {
    const p = ports(async () => sample);
    await expect(attachMonacoCaretDiagnostic(p.page, p.info, context)).resolves.toBe('attached'); expect(p.attach).toHaveBeenCalledTimes(1);
    expect((p.info as { timeout: number }).timeout).toBe(90000);
    expect(JSON.stringify(p.attach.mock.calls)).not.toContain(context.marked);
  });
});
