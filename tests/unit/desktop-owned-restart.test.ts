import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

/** 提取当前真实fixture方法，只替代原生启动边界；不导入Playwright或操作真实应用。 */
function fixture() {
  const source = readFileSync('tests/e2e/desktop-fixture.ts', 'utf8'), tree = ts.createSourceFile('desktop.ts', source, ts.ScriptTarget.Latest, true);
  const names = ['ownedDesktopState', 'ownedDesktopResources', 'restartOwnedDesktop', 'launchDesktop'];
  const methods = names.map(name => {
    const node = tree.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
    if (!node) throw Error('缺少真实fixture方法：' + name);
    return node.getText(tree).replace(/^export\s+/, '');
  }).join('\n');
  const info = {}, previous = { application: new EventEmitter(), ownerPage: new EventEmitter(), active: true, retained: false, confirmed: true, closed: true, confirming: undefined, diagnostics: undefined, restartDirectory: join(tmpdir(), 'dbark-e2e-unit-restart') };
  const map = new WeakMap<object, any>(); map.set(info, previous);
  const eventReleases = new WeakMap<object, () => void>();
  eventReleases.set(previous.application, () => { previous.application.removeAllListeners('console'); previous.application.removeAllListeners('close'); previous.ownerPage.removeAllListeners('pageerror'); });
  let hold: Promise<void> | undefined, failure: Error | undefined;
  const application = new EventEmitter(), page = new EventEmitter();
  const launch = vi.fn(async (_info: unknown, next: any, _directory: string, guard: { assertCurrent(): void }) => {
    guard.assertCurrent(); await hold;
    // 模拟原prepared边界先登记晚回句柄，任何失效不得发布共享app/page。
    next.application = application; guard.assertCurrent(); if (failure) throw failure;
    next.ownerPage = page; context.desktop = application; context.page = page; context.closed = false;
  });
  const context = createContext({ preservedDesktopExits: map, desktopEventReleases: eventReleases, desktop: previous.application, page: previous.ownerPage, dataDir: previous.restartDirectory, process: { env: { DBARK_INTEGRATION_ENABLED: '0' } as Record<string, string> }, dirname, resolve, basename, tmpdir, launchPreparedOwnedDesktop: launch });
  runInContext(ts.transpileModule(methods + '\nglobalThis.restart = restartOwnedDesktop;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { info, previous, application, page, launch, map, context, restart: () => context.restart(info) as Promise<any>, hold(value: Promise<void>) { hold = value; }, fail(value: Error) { failure = value; } };
}

it('只有已确认退出的同一临时profile可重启，新墓碑接管且旧监听不能污染新owner', async () => {
  const f = fixture(), oldConsole = vi.fn(), oldClose = vi.fn(), oldError = vi.fn();
  f.previous.application.on('console', oldConsole); f.previous.application.on('close', oldClose); f.previous.ownerPage.on('pageerror', oldError);
  const owner = await f.restart(), next = f.map.get(f.info);
  expect(f.launch).toHaveBeenCalledTimes(1); expect(owner.application).toBe(f.application); expect(owner.page).toBe(f.page); expect(owner.closed).toBe(false);
  expect(next).not.toBe(f.previous); expect(next.active).toBe(true); expect(f.previous.active).toBe(false);
  expect(f.context.dataDir).toBe(f.previous.restartDirectory);
  f.previous.application.emit('console'); f.previous.application.emit('close'); f.previous.ownerPage.emit('pageerror');
  expect(oldConsole).not.toHaveBeenCalled(); expect(oldClose).not.toHaveBeenCalled(); expect(oldError).not.toHaveBeenCalled();
  expect(f.context.desktop).toBe(f.application); expect(next.retained).toBe(false);
  next.confirmed = next.closed = true;
  await expect(f.restart()).rejects.toThrow('重启范围'); expect(f.launch).toHaveBeenCalledTimes(1);
});

it.each(['confirmed', 'closed', 'confirming', 'directory', 'diagnostics', 'outside', 'environment'] as const)('原%s未满足时不能启动或偷换墓碑', async field => {
  const f = fixture();
  if (field === 'confirmed') f.previous.confirmed = false;
  if (field === 'closed') f.previous.closed = false;
  if (field === 'confirming') (f.previous as any).confirming = Promise.resolve();
  if (field === 'directory') f.context.dataDir = join(tmpdir(), 'dbark-e2e-other');
  if (field === 'diagnostics') (f.previous as any).diagnostics = {};
  if (field === 'outside') f.context.dataDir = f.previous.restartDirectory = join(tmpdir(), 'not-owned');
  if (field === 'environment') f.context.process.env.DBARK_INTEGRATION_ENABLED = '1';
  await expect(f.restart()).rejects.toThrow(); expect(f.launch).not.toHaveBeenCalled(); expect(f.map.get(f.info)).toBe(f.previous);
});

it('晚回启动已登记新句柄，但原用例失效后保留资源且不覆盖共享app/page', async () => {
  const f = fixture(); let complete!: () => void; f.hold(new Promise<void>(yes => { complete = yes; }));
  const operation = f.restart(), next = f.map.get(f.info); next.active = false; complete();
  await expect(operation).rejects.toThrow('重启归属'); expect(next.retained).toBe(true); expect(next.application).toBe(f.application);
  expect(f.context.desktop).toBe(f.previous.application); expect(f.context.page).toBe(f.previous.ownerPage); expect(f.launch).toHaveBeenCalledTimes(1);
});

it('原生启动错误只保留本次新墓碑，不能退回旧confirmed状态删除profile', async () => {
  const f = fixture(); f.fail(Error('原生启动失败'));
  await expect(f.restart()).rejects.toThrow('原生启动失败'); const next = f.map.get(f.info);
  expect(next).not.toBe(f.previous); expect(next.retained).toBe(true); expect(next.confirmed).toBe(false); expect(next.application).toBe(f.application);
  expect(f.previous.active).toBe(false); expect(f.context.desktop).toBe(f.previous.application);
});

it('真实launch登记的回调只用公开off逐个释放，其他调用者监听继续保留', async () => {
  const f = fixture(), oldApp = f.previous.application as any, oldPage = f.previous.ownerPage as any;
  oldApp.evaluate = vi.fn(async () => {}); oldApp.firstWindow = vi.fn(async () => oldPage); oldPage.locator = () => ({});
  Object.assign(f.context, { electron: { launch: vi.fn(async () => oldApp) }, randomUUID: () => '本例退出标记', expect: () => ({ toBeVisible: async () => {} }), answerDialogs: async () => {}, snippetsDiagnosticsArmed: false, snippetsDiagnostics: undefined, dialogCalls: [], pageErrors: [], quitReady: undefined });
  await f.context.launchDesktop();
  const otherConsole = vi.fn(), otherClose = vi.fn(), otherError = vi.fn();
  oldApp.on('console', otherConsole); oldApp.on('close', otherClose); oldPage.on('pageerror', otherError);
  await f.restart();
  oldApp.emit('console', { text: () => 'DBARK_E2E_DIALOG:{"message":"旧事件"}' }); oldApp.emit('close'); oldPage.emit('pageerror', Error('旧页面'));
  expect(otherConsole).toHaveBeenCalledTimes(1); expect(otherClose).toHaveBeenCalledTimes(1); expect(otherError).toHaveBeenCalledTimes(1);
  expect(f.context.dialogCalls).toEqual([]); expect(f.context.pageErrors).toEqual([]); expect(f.context.closed).toBe(false);
});
