import { EventEmitter } from 'node:events';
import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({ mkdir: vi.fn(), write: vi.fn() }));
vi.mock('node:fs', () => ({ mkdirSync: files.mkdir, writeFileSync: files.write }));
import { createDesktopQuitDiagnosticContext } from '../e2e/desktop-quit-diagnostics';

/** 全部端口均为内存替身，不启动进程、不读写真实文件、不接触退出RPC。 */
function fixture() {
  const attachments: Array<{ name: string; body?: Buffer | string; path?: string }> = [];
  const attach = vi.fn(async (name: string, value: { body?: Buffer | string; path?: string }) => { attachments.push({ name, ...value }); });
  const outputPath = vi.fn((name: string) => `diagnostic-test/${name}`);
  const context = createDesktopQuitDiagnosticContext({ attach, outputPath } as unknown as TestInfo);
  const manifest = () => JSON.parse(String(attachments.find(value => value.name === '退出阶段归档摘要')!.body));
  const traceBody = (generation = 1) => JSON.parse(String(attachments.find(value => value.name === `退出阶段原件-${generation}`)!.body));
  return { context, attachments, attach, outputPath, manifest, traceBody };
}

/** 仅公开事件源和固定PID，故不会隐藏新增应用控制调用。 */
function application(pid: number | undefined = 4100) {
  const child = Object.assign(new EventEmitter(), { pid: pid as number | undefined, exitCode: 0 as number | null, signalCode: null as NodeJS.Signals | null });
  const app = Object.assign(new EventEmitter(), { process: vi.fn(() => child), evaluate: vi.fn(async () => true) });
  const page = new EventEmitter();
  return { app, page, child, begin(context: ReturnType<typeof createDesktopQuitDiagnosticContext>) { return context.begin(app as unknown as ElectronApplication, page as unknown as Page); } };
}

beforeEach(() => { files.mkdir.mockReset(); files.write.mockReset(); });

describe('退出诊断context归属、并发与独立归档', () => {
  it('同一应用复用记录及同一pending arm Promise，原旁观只安装一次', async () => {
    const f = fixture(), a = application();
    let resolve!: (value: boolean) => void;
    a.app.evaluate.mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    const trace = a.begin(f.context)!;
    expect(a.begin(f.context)).toBe(trace);
    expect(trace.current()).toBe(true);
    const first = trace.arm(), second = trace.arm();
    expect(second).toBe(first);
    expect(a.app.evaluate).toHaveBeenCalledTimes(1);
    resolve(true); await first;
    trace.record('will-quit');
    await f.context.finish();
    expect(f.manifest()).toMatchObject({ omitted: 0, ioFailures: 0, incomplete: false, archivalComplete: true, mainObserver: 'followProcessLifetime' });
    expect(f.traceBody().events.map((value: { event: string }) => value.event)).toEqual(['observer-armed', 'will-quit', 'disposed']);
    expect(trace.current()).toBe(false);
    expect(a.app.listenerCount('console')).toBe(0); expect(a.page.listenerCount('close')).toBe(0);
    expect(a.child.listenerCount('exit')).toBe(0); expect(a.child.listenerCount('close')).toBe(0);
  });

  it('finish不等待悬挂arm且同步失效归属，迟到回执和旧owner事件均不污染原件', async () => {
    const f = fixture(), a = application();
    let resolve!: (value: boolean) => void;
    a.app.evaluate.mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    const trace = a.begin(f.context)!, armed = trace.arm();
    const finish = f.context.finish();
    expect(trace.current()).toBe(false); expect(f.context.finish()).toBe(finish);
    await finish;
    const bodies = JSON.stringify(f.attachments), writes = files.write.mock.calls.length;
    trace.record('quit-requested', { method: 'app' });
    a.app.emit('close'); a.child.emit('exit', 0, null);
    resolve(true); await armed; await trace.arm();
    expect(JSON.stringify(f.attachments)).toBe(bodies); expect(files.write).toHaveBeenCalledTimes(writes);
    expect(f.manifest()).toMatchObject({ incomplete: true, records: [{ arming: 'pending', incomplete: true }] });
    expect(f.context.begin(a.app as unknown as ElectronApplication, a.page as unknown as Page)).toBeUndefined();
  });

  it('未安装、安装拒绝与原进程未结束明确缺证，不补退出或等待', async () => {
    const f = fixture(), a = application(), b = application(4101), c = application(4102);
    a.begin(f.context);
    b.app.evaluate.mockRejectedValue(Error('私密SQL/路径/错误正文'));
    await b.begin(f.context)!.arm();
    c.child.exitCode = null; await c.begin(f.context)!.arm();
    await f.context.finish();
    expect(f.manifest().records.map((value: { incomplete: boolean }) => value.incomplete)).toEqual([true, true, true]);
    expect(f.manifest().records.map((value: { arming: string }) => value.arming)).toEqual(['not-started', 'unavailable', 'armed']);
    expect(JSON.stringify(f.attachments)).not.toContain('私密SQL');
    expect(a.app.evaluate).not.toHaveBeenCalled();
  });

  it('第九应用、无PID及读取异常只增加遗漏计数，前八份成功不掩盖缺口', async () => {
    const f = fixture();
    const missingPid = application(); missingPid.child.pid = undefined;
    expect(missingPid.begin(f.context)).toBeUndefined();
    const broken = application(); broken.app.process.mockImplementation(() => { throw Error('不得保存的路径/凭据'); });
    expect(broken.begin(f.context)).toBeUndefined();
    for (let index = 0; index < 8; index++) await application(5000 + index).begin(f.context)!.arm();
    expect(application(6000).begin(f.context)).toBeUndefined();
    await f.context.finish();
    expect(f.manifest()).toMatchObject({ omitted: 3, incomplete: true, archivalComplete: false });
    expect(f.manifest().records).toHaveLength(8);
    expect(JSON.stringify(f.attachments)).not.toContain('不得保存');
  });

  it('最终文件写失败仍附最新RAM原件，必须通过摘要识别旧文件不完整', async () => {
    const f = fixture(), a = application(), trace = a.begin(f.context)!;
    await trace.arm();
    files.write.mockImplementation(() => { throw Error('禁止回显的本机路径'); });
    await f.context.finish();
    expect(f.traceBody().disposed).toBe(true);
    expect(f.manifest()).toMatchObject({ ioFailures: 1, incomplete: true, archivalComplete: false, records: [{ fileWritten: false, bodyAttached: true, incomplete: true }] });
    expect(JSON.stringify(f.attachments)).not.toContain('禁止回显');
  });

  it('trace附件失败不影响摘要；摘要附件失败后落含更新计数的独立文件', async () => {
    const f = fixture(), a = application(); await a.begin(f.context)!.arm();
    f.attach.mockImplementation(async () => { throw Error('原附件异常不能替代测试结果'); });
    await expect(f.context.finish()).resolves.toBeUndefined();
    const summaryWrite = files.write.mock.calls.find(call => String(call[0]).endsWith('quit-diagnostic-manifest.json'))!;
    const summary = JSON.parse(String(summaryWrite[1]));
    expect(summary).toMatchObject({ ioFailures: 2, incomplete: true, archivalComplete: false, records: [{ fileWritten: true, bodyAttached: false }] });
    expect(JSON.stringify(summary)).not.toContain('原附件异常');
  });

  it('文件和附件均失败仍resolve，输出固定不可用标记且不泄露异常正文', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      files.write.mockImplementation(() => { throw Error('不可暴露的SQL'); });
      const f = fixture(), a = application(); await a.begin(f.context)!.arm();
      f.attach.mockRejectedValue(Error('不可暴露的凭据'));
      await expect(f.context.finish()).resolves.toBeUndefined();
      expect(log).toHaveBeenCalled();
      expect(log.mock.calls.every(value => value.length === 1 && value[0] === 'DBARK_QUIT_DIAGNOSTIC_ARCHIVAL_UNAVAILABLE')).toBe(true);
    } finally { log.mockRestore(); }
  });

  it('独立context的旧事件不写入新owner摘要，摘要及RAM原件不附带路径字段', async () => {
    const first = fixture(), old = application(); const trace = old.begin(first.context)!;
    await trace.arm(); await first.context.finish();
    const next = fixture(), newer = application(7200); await newer.begin(next.context)!.arm();
    trace.record('will-quit'); old.app.emit('close'); await next.context.finish();
    expect(next.traceBody().owner.mainPid).toBe(7200);
    expect(next.traceBody().events.some((value: { event: string }) => value.event === 'will-quit')).toBe(false);
    expect(next.attachments.every(value => !Object.hasOwn(value, 'path'))).toBe(true);
  });
});
