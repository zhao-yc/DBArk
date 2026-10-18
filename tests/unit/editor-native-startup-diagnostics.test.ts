import type { TestInfo } from '@playwright/test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { bindEditorIndentNativeCase } from '../e2e/editor-indentation-native-gate';
import { observeNativeStartup, attachNativeStartupDiagnostics } from '../e2e/editor-native-startup-diagnostics';

/** 全部事件与句柄是RAM，不加载Playwright、不启动应用，也没有系统端口。 */
function fixture(enabled = true, elapsed?: () => number | undefined, currentCheck?: () => void) {
  const app = new EventEmitter() as any, context = new EventEmitter() as any, page = new EventEmitter() as any;
  page.url = vi.fn(() => 'file:///秘密路径/index.html?password=不应记录'); context.pages = vi.fn(() => [page]);
  app.context = vi.fn(() => context); let current = enabled;
  const guard = vi.fn(() => { if (!current) throw Error('原TestInfo已结束'); currentCheck?.(); });
  const observer = observeNativeStartup(app, guard, 'RAM-QUIT', elapsed);
  return { app, context, page, guard, observer, expire: () => { current = false; } };
}

it('首个页面和firstWindow只保存分类，准备事件不读取任何错误/消息正文', () => {
  const f = fixture(), forbidden = new Proxy({}, { get() { throw Error('不许读错误正文'); } });
  f.page.emit('pageerror', forbidden); f.page.emit('crash');
  f.page.emit('console', { type: () => 'error', text: () => { throw Error('不许读console正文'); } });
  f.observer.firstWindow(f.page);
  expect(f.observer.data).toMatchObject({ pages: 1, firstObservedUrl: 'file', firstWindowUrl: 'file', prepared: false, events: [{ kind: 'pageerror', page: 1 }, { kind: 'crash', page: 1 }, { kind: 'console-error', page: 1 }] });
  expect(JSON.stringify(f.observer.data)).not.toMatch(/秘密|password|不应记录/);
  f.app.emit('console', { type: () => 'error', text: () => { throw Error('主进程错误也不读正文'); } });
  expect(f.observer.data.events.at(-1)).toEqual({ kind: 'console-error', page: 0 });
});

it('4页面/32事件/1024丢弃计数都有界，getter不主动取样、事件不增加RPC等待', () => {
  const f = fixture();
  for (let n = 0; n < 40; n++) { const page = new EventEmitter() as any; page.url = () => 'https://秘密正文'; f.context.emit('page', page); }
  for (let n = 0; n < 5000; n++) f.page.emit('pageerror', Error('SQL与凭据不许外传'));
  expect(f.observer.data.pages).toBe(4); expect(f.observer.data.events).toHaveLength(32); expect(f.observer.data.dropped).toBe(1024);
  expect(Buffer.byteLength(JSON.stringify(f.observer.data))).toBeLessThan(4096);
  expect(f.app.context).toHaveBeenCalledOnce(); expect(f.context.pages).toHaveBeenCalledOnce();
});

it.each(['期限结束', '已准备'] as const)('%s后迟到事件不读getter、不修改旧case快照', mode => {
  const f = fixture(); if (mode === '期限结束') f.expire(); else f.observer.finish();
  const before = JSON.stringify(f.observer.data), forbidden = () => { throw Error('迟到事件不得读取SDK'); };
  f.page.url = forbidden; f.page.emit('console', { type: forbidden }); f.page.emit('pageerror', Error('迟到')); f.app.emit('console', { type: forbidden, text: forbidden });
  f.context.emit('page', { url: forbidden }); f.observer.firstWindow(f.page); f.observer.finish();
  expect(JSON.stringify(f.observer.data)).toBe(before);
});

it('真实同步SDK异常不被权限拒绝catch吞掉', () => {
  const f = fixture(), failure = Error('SDK真实失败');
  expect(() => f.page.emit('console', { type: () => { throw failure; } })).toThrow(failure);
});

it('原120秒超时后只用内存附件，不调用原owner/SDK；附件与原错误同时保留', async () => {
  const f = fixture(); f.observer.firstWindow(f.page); f.expire();
  const original = { message: '原120秒超时' }, attachment = Error('附件写入失败'), attach = vi.fn<TestInfo['attach']>(async () => { throw attachment; });
  const owner = { startupDiagnostics: f.observer.data, application: new Proxy({}, { get() { throw Error('不得调用过期owner'); } }) } as any;
  await expect(attachNativeStartupDiagnostics({ errors: [original], attach }, { owners: [owner] })).rejects.toMatchObject({ errors: [original, attachment], cause: original });
  const body = attach.mock.calls[0][1]!.body as Buffer;
  expect(body.byteLength).toBeLessThanOrEqual(8192); expect(JSON.parse(body.toString()).owners[0].startup.firstWindowUrl).toBe('file');
});

it('未开启诊断的owner不产生附件IO；独立附件失败原样传播', async () => {
  const failure = Error('附件单独失败'), attach = vi.fn(async () => { throw failure; });
  await attachNativeStartupDiagnostics({ attach, errors: [] }, { owners: [{}] as any }); expect(attach).not.toHaveBeenCalled();
  const f = fixture(); await expect(attachNativeStartupDiagnostics({ attach, errors: [] }, { owners: [{ startupDiagnostics: f.observer.data }] as any })).rejects.toBe(failure);
});

it('双owner各32事件只复用最后一条数字来源，附件严格小于8KiB且不带旧错误正文', async () => {
  const f = fixture(true, () => 119999); for (let n = 0; n < 32; n++) f.page.emit('pageerror', Error('不应进入新附件'));
  const source = { phase: '启动来源', complete: false, expected: { launcherPid: 101, platform: 'darwin', relation: '同一进程' }, observed: { mainPid: 101, parentPid: 1, platform: 'darwin', metrics: Array(64).fill(Number.MAX_SAFE_INTEGER) } };
  const owner = { startupDiagnostics: f.observer.data, sourceDiagnostics: Array(12).fill(source), pageErrors: [{ message: '秘密SQL正文' }] } as any;
  const attach = vi.fn<TestInfo['attach']>(async () => {});
  await attachNativeStartupDiagnostics({ attach, errors: [] }, { owners: [owner, owner] });
  const body = attach.mock.calls[0][1]!.body as Buffer, data = JSON.parse(body.toString());
  expect(body.byteLength).toBeLessThanOrEqual(8192); expect(data.owners.map((value: any) => value.sourceDiagnostics.length)).toEqual([1, 1]);
  expect(data.owners.map((value: any) => value.startup.events.length)).toEqual([32, 32]); expect(body.toString()).not.toContain('秘密SQL正文');
});

/** 抽取实际原hook回调，验证仅复用原evaluate，不另造替身实现。 */
function hook() {
  const source = readFileSync(new URL('../e2e/editor-indentation-native-runtime.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('runtime.ts', source, ts.ScriptTarget.Latest, true); let node: ts.ArrowFunction | undefined;
  const visit = (value: ts.Node) => { if (ts.isArrowFunction(value) && value.getText(tree).includes("app.once('will-quit'") && value.getText(tree).startsWith('({ app, BrowserWindow }')) node = value; ts.forEachChild(value, visit); }; visit(tree);
  if (!node) throw Error('原主进程hook回调缺失');
  const text = ts.transpileModule('const hook = ' + node.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return { text, original: source, run: (context: object) => runInNewContext(text + '\nhook', context) as Function };
}

it('原hook仅在显式诊断时监听真实preload-error，固定标记至多32次，不读事件参数', () => {
  const h = hook(), app = new EventEmitter(), contents = new EventEmitter(), log = vi.fn(), callback = h.run({ console: { log } });
  callback({ app, BrowserWindow: { getAllWindows: () => [{ webContents: contents }] } }, { marker: 'RAM-QUIT' });
  for (let n = 0; n < 100; n++) contents.emit('preload-error', null, '/秘密脚本', Error('SELECT 密码'));
  expect(log).toHaveBeenCalledTimes(32); expect(log.mock.calls.every(args => args.length === 1 && args[0] === 'RAM-QUIT:PRELOAD')).toBe(true);
  expect(h.text).not.toMatch(/await|setTimeout|\.evaluate|\.launch|\.retry/);
  const f = fixture(); f.app.emit('console', { type: () => 'log', text: () => 'RAM-QUIT:PRELOAD' });
  expect(f.observer.data.events).toEqual([{ kind: 'preload-error', page: 0 }]);
});

it('默认原hook不安装额外主进程监听，原will-quit握手照旧', () => {
  const h = hook(), app = new EventEmitter(), log = vi.fn(), windows = vi.fn(() => { throw Error('关闭时零额外读取'); });
  h.run({ console: { log } })({ app, BrowserWindow: { getAllWindows: windows } }, '原标记');
  expect(windows).not.toHaveBeenCalled(); expect(app.eventNames()).toEqual(['will-quit']); app.emit('will-quit'); expect(log).toHaveBeenCalledWith('原标记');
});


it('相对毫秒复用原TestInfo已校验时点，不读取新时钟、不泄露绝对时间且原期限不延长', () => {
  const start = 1700000000000, info = { startTime: new Date(start), timeout: 120000, status: 'passed' }; let clock = start + 20;
  const now = vi.fn(() => clock), scope = bindEditorIndentNativeCase(info, { assertCurrent() {} }, () => info, now);
  expect(scope.elapsedMs()).toBeUndefined(); scope.assertCurrent();
  const reads = now.mock.calls.length; expect(scope.elapsedMs()).toBe(20); expect(now).toHaveBeenCalledTimes(reads);
  const f = fixture(true, scope.elapsedMs, scope.assertCurrent);
  clock = start + 40; f.page.emit('pageerror', Error('合成'));
  clock = start + 50; f.observer.firstWindow(f.page);
  clock = start + 60; scope.assertCurrent(); const before = now.mock.calls.length; f.observer.statusbar(); expect(now).toHaveBeenCalledTimes(before);
  expect(f.observer.data).toMatchObject({ launchReturnedElapsedMs: 20, firstObservedElapsedMs: 20, firstWindowElapsedMs: 50, statusbarStartElapsedMs: 60, events: [{ kind: 'pageerror', page: 1, elapsedMs: 40 }] });
  expect(JSON.stringify(f.observer.data)).not.toContain(String(start));
  const snapshot = JSON.stringify(f.observer.data); clock = start + 120000; f.page.emit('pageerror', Error('迟到')); expect(JSON.stringify(f.observer.data)).toBe(snapshot);
});
