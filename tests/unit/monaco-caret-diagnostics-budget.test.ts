import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachMonacoCaretDiagnostic } from '../e2e/monaco-caret-diagnostics';
import { diagnosticSample as sample, diagnosticFilePorts } from './monaco-diagnostic-test-ports';

const context = { cold: 2, phase: 'prepare' as const, marked: '合成|正文', pageErrorCount: 0 };
function ports(evaluate: () => Promise<unknown>, attach = vi.fn(async () => undefined), duration = 100) {
  return { page: { evaluate } as never, info: { timeout: 90000, duration, attach, outputPath: vi.fn((name: string) => 'diagnostic-output/' + name) } as never, attach };
}
let disk: ReturnType<typeof diagnosticFilePorts>;
beforeEach(() => { disk = diagnosticFilePorts(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
    expect(disk.write).not.toHaveBeenCalled(); expect(disk.rename).not.toHaveBeenCalled(); expect(disk.remove).not.toHaveBeenCalled(); expect(disk.warning).not.toHaveBeenCalled();
  });
  it('正常采样仅附安全数据一次，不改变timeout字段', async () => {
    const p = ports(async () => sample);
    await expect(attachMonacoCaretDiagnostic(p.page, p.info, context)).resolves.toBe('attached'); expect(p.attach).toHaveBeenCalledTimes(1);
    expect((p.info as { timeout: number }).timeout).toBe(90000);
    expect(JSON.stringify(p.attach.mock.calls)).not.toContain(context.marked);
  });
  it('写入超时取消signal；迟到成功或拒绝均不启动rename/attach/清理', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let resolve!: () => void;
    disk.write.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const p = ports(async () => sample), pending = attachMonacoCaretDiagnostic(p.page, p.info, context);
    await vi.advanceTimersByTimeAsync(500); await expect(pending).resolves.toBe('timed-out');
    expect(disk.write).toHaveBeenCalledTimes(1); expect((disk.write.mock.calls[0][2] as { signal: AbortSignal }).signal.aborted).toBe(true);
    resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(disk.rename).not.toHaveBeenCalled(); expect(p.attach).not.toHaveBeenCalled(); expect(disk.remove).not.toHaveBeenCalled();
    let reject!: (error: Error) => void;
    disk.write.mockImplementation(() => new Promise<void>((_, fail) => { reject = fail; }));
    const late = ports(async () => sample), rejected = attachMonacoCaretDiagnostic(late.page, late.info, context);
    await vi.advanceTimersByTimeAsync(500); await expect(rejected).resolves.toBe('timed-out'); reject(Error('不可输出的磁盘错误')); await vi.advanceTimersByTimeAsync(1);
    expect(disk.rename).not.toHaveBeenCalled(); expect(late.attach).not.toHaveBeenCalled(); expect(disk.remove).not.toHaveBeenCalled(); expect(disk.warning).not.toHaveBeenCalled();
  });
  it('已发出的rename迟到后不启动path附件，不宣称撤回已发出的IO', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let resolve!: () => void;
    disk.rename.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const p = ports(async () => sample), pending = attachMonacoCaretDiagnostic(p.page, p.info, context);
    await vi.advanceTimersByTimeAsync(500); await expect(pending).resolves.toBe('timed-out'); expect(disk.rename).toHaveBeenCalledTimes(1);
    resolve(); await vi.advanceTimersByTimeAsync(1); expect(p.attach).not.toHaveBeenCalled(); expect(disk.remove).not.toHaveBeenCalled();
  });
  it('采样、写入、改名、附件共享500ms，不能为落盘增加预算', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let sampleDone!: (value: unknown) => void, writeDone!: () => void, renameDone!: () => void;
    disk.write.mockImplementation(() => new Promise<void>(done => { writeDone = done; }));
    disk.rename.mockImplementation(() => new Promise<void>(done => { renameDone = done; }));
    const p = ports(() => new Promise(done => { sampleDone = done; }), vi.fn(() => new Promise(() => {})));
    const pending = attachMonacoCaretDiagnostic(p.page, p.info, context);
    await vi.advanceTimersByTimeAsync(300); sampleDone(sample); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100); writeDone(); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50); renameDone(); await vi.advanceTimersByTimeAsync(0);
    expect(p.attach).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toBe('timed-out'); expect(performance.now()).toBe(500); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['write', 'rename', 'remove'] as const)('磁盘%s失败只记固定不可用状态，不输出原异常或附加半文件', async stage => {
    disk.write.mockRejectedValue(Error('不可输出的路径和凭据'));
    if (stage === 'rename') { disk.write.mockResolvedValue(); disk.rename.mockRejectedValue(Error('不可输出的路径和凭据')); }
    if (stage === 'remove') disk.remove.mockRejectedValue(Error('不可输出的路径和凭据'));
    const p = ports(async () => sample);
    await expect(attachMonacoCaretDiagnostic(p.page, p.info, context)).resolves.toBe('failed'); expect(p.attach).not.toHaveBeenCalled();
    expect(disk.warning.mock.calls).toEqual([['离线补全诊断不可用：采样或持久化附件失败']]);
    expect(disk.data.size).toBe(0);
  });
  it('落盘再次投影白名单，未知字符串字段不能进入JSON', async () => {
    const p = ports(async () => ({ ...sample, sql: '不可输出', model: { ...sample.model, dom: '不可输出' } }));
    await expect(attachMonacoCaretDiagnostic(p.page, p.info, context)).resolves.toBe('attached');
    expect([...disk.data.values()]).toHaveLength(1); expect([...disk.data.values()][0]).not.toContain('不可输出');
  });
  it.each([NaN, -1, 1.5, '123', {}])('异常标量不转换或落盘：%s', async value => {
    const p = ports(async () => ({ ...sample, model: { ...sample.model, utf16Units: value } }));
    await expect(attachMonacoCaretDiagnostic(p.page, p.info, context)).resolves.toBe('failed');
    expect(disk.write).not.toHaveBeenCalled(); expect(p.attach).not.toHaveBeenCalled();
  });
});
