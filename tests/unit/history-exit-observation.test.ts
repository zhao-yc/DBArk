import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { transformSync } from 'esbuild';
import type { TestInfo } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginHistoryExitObservation, currentHistoryExitObservation, historyExitObservationFor, historyExitObservationLimits, historyExitObservationTitle } from '../helpers/historyExitObservation';

/** 仅以RAM附件替身观察输出，不打开Electron、文件选择器、数据库或端口。 */
function owner(attach = vi.fn(async (_name: string, _options: { body: Buffer; contentType: string }) => {})) {
  const info = { file: 'D:/合成/tests/e2e/history-pages.spec.ts', title: historyExitObservationTitle, annotations: [], attach } as unknown as TestInfo;
  return { info, attach, output: () => JSON.parse(attach.mock.calls[0][1].body.toString('utf8')) };
}
afterEach(() => { currentHistoryExitObservation()?.retire(); vi.useRealTimers(); });

describe('原TestInfo绑定的有界退出观察', () => {
  it('默认关闭不访问TestInfo、时钟或附件；目标和trace门只在显式开启时检查', () => {
    const now = vi.fn(() => { throw Error('不应读取时钟'); });
    const forbidden = new Proxy({}, { get() { throw Error('默认路径不应访问TestInfo'); } }) as TestInfo;
    expect(beginHistoryExitObservation(false, forbidden, 'off', now)).toBeUndefined(); expect(now).not.toHaveBeenCalled();
    const own = owner();
    for (const info of [{ ...own.info, file: 'D:/合成/tests/e2e/other.spec.ts' }, { ...own.info, title: '其他用例' }]) expect(() => beginHistoryExitObservation(true, info, 'off')).toThrow('指定原用例');
    expect(() => beginHistoryExitObservation(true, own.info, 'on')).toThrow('录制关闭'); expect(own.attach).not.toHaveBeenCalled();
  });

  it('重启应用独立编号；主体和teardown分开，只输出固定对话框类别与编号', async () => {
    const own = owner(); let clock = 100;
    const observation = beginHistoryExitObservation(true, own.info, 'off', () => clock++)!;
    const first = { pid: 999, path: '敏感路径' }, second = {};
    observation.bind(first); observation.mark(first, 'request-app'); observation.mark(first, 'will-quit-marker'); observation.mark(first, 'quit-ready');
    observation.dialog(first, { title: '退出前保存或收尾失败', response: 0 });
    observation.dialog(first, { title: '敏感标题正文', response: Number.NaN });
    observation.mark(first, 'close'); observation.bind(second);
    observation.beginTeardown(); observation.dialog(second, { title: '仍有待完成的工作', response: 1 }); observation.mark(second, 'desktop-close-enter'); observation.mark(second, 'desktop-close-returned'); observation.mark(second, 'close'); observation.endTeardown(true);
    await observation.finish(); const output = own.output(), json = own.attach.mock.calls[0][1].body.toString();
    expect(output.applications).toBe(2); expect(output.phases).toEqual({ bodyEnded: true, teardownStarted: true, teardownCompleted: true });
    expect(output.events.filter((event: any) => event.kind === 'dialog')).toEqual([
      expect.objectContaining({ phase: 'body', application: 1, category: 'shutdown-error', response: 0 }),
      expect.objectContaining({ phase: 'body', application: 1, category: 'other', response: null }),
      expect.objectContaining({ phase: 'teardown', application: 2, category: 'pending-work', response: 1 })
    ]);
    for (const value of ['敏感标题正文', '敏感路径', '退出前保存或收尾失败', '仍有待完成的工作', 'pid', own.info.file, historyExitObservationTitle]) expect(json).not.toContain(value);
    expect(output.coverage.persistStateRequest).toBe('not-covered'); expect(output.coverage.settingsSaveAck).toBe('not-covered');
    expect(output.events.every((event: any, index: number) => event.sequence === index + 1 && event.atMs >= 0)).toBe(true);
  });

  it('事件和应用数有上限，倒退或失败时钟不破坏原流程，饱和后阶段终态仍可辨别', async () => {
    const own = owner(); let clock = 100, broken = false;
    const observation = beginHistoryExitObservation(true, own.info, 'off', () => { if (broken) throw Error('不记录的错误原文'); return clock; })!;
    const app = {}; observation.bind(app); clock = 99; observation.mark(app, 'request-app'); broken = true;
    for (let i = 0; i < 400; i++) { observation.bind({}); observation.mark(app, 'close'); }
    observation.beginTeardown(); observation.endTeardown(false); await observation.finish();
    const output = own.output(); expect(output.events).toHaveLength(historyExitObservationLimits.events); expect(output.applications).toBe(historyExitObservationLimits.applications); expect(output.dropped).toBeGreaterThan(0);
    expect(output.phases).toEqual({ bodyEnded: true, teardownStarted: true, teardownCompleted: false }); expect(output.events.every((event: any) => event.atMs === 0)).toBe(true);
  });

  it('旧用例和旧应用迟到事件不能写下一例，附件await期间输出也已冻结', async () => {
    let release!: () => void; const delayed = new Promise<void>(done => { release = done; });
    const first = owner(vi.fn(async (_name, _options) => { await delayed; })); const a = beginHistoryExitObservation(true, first.info, 'off')!, appA = {}; a.bind(appA);
    const finishing = a.finish(); const bytes = Buffer.from(first.attach.mock.calls[0][1].body);
    const second = owner(), b = beginHistoryExitObservation(true, second.info, 'off')!, appB = {}; b.bind(appB);
    a.bind(appB); a.mark(appA, 'close'); a.beginTeardown(); await a.finish(); b.mark(appA, 'close'); b.mark(appB, 'request-app');
    release(); await finishing; expect(first.attach).toHaveBeenCalledTimes(1); expect(first.attach.mock.calls[0][1].body).toEqual(bytes);
    await b.finish(); expect(second.output().events.filter((event: any) => event.kind === 'close')).toEqual([]); expect(second.output().applications).toBe(1);
  });

  it('活跃记录被新TestInfo替代后彻底失效，不能迟到附加到新例', async () => {
    const first = owner(), a = beginHistoryExitObservation(true, first.info, 'off')!, appA = {}; a.bind(appA);
    const second = owner(), b = beginHistoryExitObservation(true, second.info, 'off')!; a.mark(appA, 'close'); await a.finish();
    expect(first.attach).not.toHaveBeenCalled(); expect(currentHistoryExitObservation()).toBe(b); await b.finish(); expect(second.output().applications).toBe(0);
  });

  it('下一例关闭观察时同样撤销旧世代；原TestInfo找不到时不能借当前记录器', async () => {
    const first = owner(), a = beginHistoryExitObservation(true, first.info, 'off')!, appA = {}; a.bind(appA);
    const next = owner(); expect(beginHistoryExitObservation(false, next.info, 'off')).toBeUndefined(); expect(currentHistoryExitObservation()).toBeUndefined();
    a.mark(appA, 'close'); await a.finish(); expect(first.attach).not.toHaveBeenCalled();
    const b = beginHistoryExitObservation(true, next.info, 'off')!; expect(historyExitObservationFor(first.info)).toBe(a); expect(historyExitObservationFor(owner().info)).toBeUndefined(); await b.finish();
  });

  it('附件失败仍抛出同一个原错误，仅加入固定注记，不输出异常内容', async () => {
    const failure = Error('原退出超时'), own = owner(vi.fn(async () => { throw Error('附件错误包含路径和秘密'); }));
    const observation = beginHistoryExitObservation(true, own.info, 'off')!;
    await expect((async () => { try { throw failure; } finally { observation.beginTeardown(); observation.endTeardown(false); await observation.finish(); } })()).rejects.toBe(failure);
    expect(own.info.annotations).toEqual([{ type: 'history-exit-observation', description: '退出观察附件写入未确认；原测试结果保持。' }]); expect(currentHistoryExitObservation()).toBeUndefined();
  });
  it('附件悬挂只等待独立一秒预算，迟到拒绝被观察且不能覆盖原错误或下一例', async () => {
    vi.useFakeTimers(); let reject!: (error: Error) => void; const pending = new Promise<void>((_done, fail) => { reject = fail; });
    const own = owner(vi.fn(async () => pending)), observation = beginHistoryExitObservation(true, own.info, 'off')!;
    const finishing = observation.finish(); await vi.advanceTimersByTimeAsync(historyExitObservationLimits.attachmentMs); await finishing;
    expect(own.info.annotations).toHaveLength(1); expect(currentHistoryExitObservation()).toBeUndefined();
    const next = owner(), nextObservation = beginHistoryExitObservation(true, next.info, 'off')!;
    reject(Error('迟到附件错误，禁止输出')); await Promise.resolve(); await nextObservation.finish(); expect(next.info.annotations).toEqual([]);
  });
});

/** 抽取正式退出函数在RAM运行；不导入Playwright测试注册，也不执行任何原生动作。 */
function exitHarness(mode: 'normal' | 'before-ready-timeout' | 'after-close-timeout' | 'request-error' | 'late-owner', enabled = true) {
  const file = readFileSync('tests/e2e/desktop-fixture.ts', 'utf8'), parsed = ts.createSourceFile('desktop-fixture.ts', file, ts.ScriptTarget.Latest, true);
  const source = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && ['requestQuit', 'quitDesktop'].includes(node.name?.text ?? '')).map(node => node.getText(parsed).replace(/^export\s+/, '')).join('\n');
  const code = transformSync(source, { loader: 'ts', target: 'node22' }).code;
  const own = owner(), observation = beginHistoryExitObservation(enabled, own.info, 'off');
  const operations: string[] = [], failure = Error(mode); let rejectExit!: (error: Error) => void;
  const exited = new Promise<void>((_done, reject) => { rejectExit = reject; }); let resolveExit!: () => void;
  const successfulExit = new Promise<void>(done => { resolveExit = done; });
  let releaseMetrics!: () => void; const metricsGate = new Promise<void>(done => { releaseMetrics = done; });
  const app = {
    evaluate: async (fn: Function) => { if (fn.toString().includes('getAppMetrics')) { operations.push('metrics'); if (mode === 'late-owner') await metricsGate; return []; } operations.push('request'); if (mode === 'request-error') throw failure; },
    waitForEvent: (_event: string, options: { timeout: number }) => { operations.push('wait:' + options.timeout); return mode === 'normal' || mode === 'late-owner' ? successfulExit : exited; },
    close: async () => { operations.push('desktop.close'); if (mode === 'normal' || mode === 'late-owner') { context.closed = true; observation?.mark(app, 'close'); resolveExit(); } }
  };
  observation?.bind(app);
  const context = { desktop: app, snippetsDiagnostics: undefined, closed: false, quitReady: mode === 'before-ready-timeout' ? new Promise<void>(() => {}) : Promise.resolve(), historyExitObservationFor,
    process: { kill() { throw Error('RAM用例禁止进程探测'); } }, expect: { poll: (read: () => unknown, options: { timeout: number }) => { operations.push('poll:' + options.timeout); return { toEqual: (expected: unknown) => expect(read()).toEqual(expected) }; } }
  };
  const functions = vm.runInNewContext(code + ';({quitDesktop})', context) as { quitDesktop(method: 'app', info: TestInfo): Promise<void> };
  return { ...own, observation, operations, failure, run: () => functions.quitDesktop('app', own.info), rejectExit, releaseMetrics };
}

describe('原退出顺序的RAM接线反例', () => {
  it.each([true, false])('诊断启用=%s时原RPC、12秒等待、close和原PID断言顺序相同，无新增重试', async enabled => {
    const h = exitHarness('normal', enabled); await h.run();
    expect(h.operations).toEqual(['metrics', 'wait:12000', 'request', 'desktop.close', 'poll:5000']);
    if (h.observation) { await h.observation.finish(); expect(h.output().events.map((event: any) => event.kind)).toEqual(['observation-start', 'application-bound', 'quit-start', 'close-wait-start', 'request-app', 'request-returned', 'quit-race-returned', 'desktop-close-enter', 'close', 'desktop-close-returned', 'quit-complete', 'observation-end']); }
    else expect(h.attach).not.toHaveBeenCalled();
  });
  it('quitReady前close等待拒绝，只报告原超时，不进入desktop.close或PID断言', async () => {
    const h = exitHarness('before-ready-timeout'), result = h.run(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); h.rejectExit(h.failure);
    await expect(result).rejects.toBe(h.failure); await h.observation!.finish();
    expect(h.operations).toEqual(['metrics', 'wait:12000', 'request']); expect(h.output().events.at(-2).kind).toBe('quit-error');
  });
  it('desktop.close返回但没有close事件时，原等待错误可区别于进入前超时', async () => {
    const h = exitHarness('after-close-timeout'), result = h.run(); for (let i = 0; i < 8; i++) await Promise.resolve(); h.rejectExit(h.failure);
    await expect(result).rejects.toBe(h.failure); await h.observation!.finish();
    expect(h.operations).toEqual(['metrics', 'wait:12000', 'request', 'desktop.close']); const events = h.output().events.map((event: any) => event.kind);
    expect(events).toContain('desktop-close-returned'); expect(events).not.toContain('close'); expect(events).not.toContain('quit-complete');
  });
  it('原请求失败仍是原对象，只记录阶段，不追加退出或吞错', async () => {
    const h = exitHarness('request-error'); await expect(h.run()).rejects.toBe(h.failure); await h.observation!.finish();
    expect(h.operations).toEqual(['metrics', 'wait:12000', 'request']); expect(h.output().events.map((event: any) => event.kind)).toContain('request-error');
  });
  it('旧退出在await后迟到继续时，嵌套requestQuit也不能改绑下一TestInfo', async () => {
    const h = exitHarness('late-owner'), oldQuit = h.run();
    const next = owner(), b = beginHistoryExitObservation(true, next.info, 'off')!, nextApp = {}; b.bind(nextApp);
    h.releaseMetrics(); await oldQuit; await h.observation!.finish(); await b.finish();
    expect(h.attach).not.toHaveBeenCalled(); expect(next.output().events.map((event: any) => event.kind)).toEqual(['observation-start', 'application-bound', 'observation-end']);
  });
  it('显式选项只绑定原目标用例；观察模块无运行时I/O导入或保存RPC补采', () => {
    const helper = readFileSync('tests/helpers/historyExitObservation.ts', 'utf8'), fixture = readFileSync('tests/e2e/desktop-fixture.ts', 'utf8'), history = readFileSync('tests/e2e/history-pages.spec.ts', 'utf8');
    const ast = ts.createSourceFile('helper.ts', helper, ts.ScriptTarget.Latest, true), imports = ast.statements.filter(ts.isImportDeclaration);
    expect(imports).toHaveLength(1); expect(imports[0].importClause?.isTypeOnly).toBe(true);
    expect(history.match(/observedExitTest\(/g)).toHaveLength(1); expect(history).toContain("test.extend({ historyExitObservation: true })"); expect(history).toContain("test.use({trace:'off'})");
    expect(fixture).toContain('historyExitObservation: [false, { option: true }]');
    expect(fixture).toContain("exitObservation?.mark(observedApplication, 'will-quit-marker'); ready(); exitObservation?.mark(observedApplication, 'quit-ready')");
    expect(helper).not.toMatch(/\.evaluate\(|readFile|writeFile|process\.kill|ipcMain|settings\.save'\s*,/);
  });
});
