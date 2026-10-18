import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import * as paths from 'node:path';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { BatchDuplicatePreparation } from '../helpers/batchRecordDuplicateUi';
import { assertHistoryExitObservationScope, beginHistoryExitObservation, historyExitObservationFor } from '../helpers/historyExitObservation';

/** 所有原生、页面、目录及时间端口均为RAM；提取当前真实自动夹具和真实启动函数。 */
function port(stage?: string, hook = true) {
  const source = readFileSync(new URL('../e2e/desktop-fixture.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true), functions: string[] = [];
  let automatic = '';
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && ['ownedDesktopState', 'recordOwnedDesktopProcesses', 'bindOwnedDesktopExit', 'launchDesktop', 'launchPreparedOwnedDesktop', 'retainOwnedDesktopResources'].includes(node.name?.text ?? '')) functions.push(node.getText(tree));
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'desktopLifetime' && ts.isArrayLiteralExpression(node.initializer)) automatic = node.initializer.elements[0].getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); if (functions.length !== 6 || !automatic) throw Error('RAM启动端口缺少真实声明');
  let release!: () => void, enter!: () => void, bodyRelease!: () => void, bodyEnter!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
  const body = new Promise<void>(resolve => { bodyRelease = resolve; }), bodyEntered = new Promise<void>(resolve => { bodyEnter = resolve; });
  const info = { _startWallTime: 0, timeout: 120000, status: 'passed' }, states = new WeakMap<object, any>(), remove = vi.fn();
  const native = Object.assign(new EventEmitter(), { getAppMetrics: () => [{ pid: 12001 }, { pid: 12002 }] });
  const dialog: any = {}, window = Object.assign(new EventEmitter(), { locator: vi.fn(() => ({})) });
  const application = Object.assign(new EventEmitter(), {
    process: vi.fn(() => ({ pid: 12001 })), close: vi.fn(),
    firstWindow: vi.fn(async () => { if (stage === 'firstWindow') { enter(); await pending; } return window; }),
    evaluate: vi.fn(async (callback: Function, argument?: unknown) => {
      const result = callback({ app: native, dialog }, argument), label = argument === 'DBARK_E2E_QUIT_READY:RAM' ? 'willQuit' : Array.isArray(argument) ? 'dialogs' : 'metrics';
      if (stage === label) { enter(); await pending; } return result;
    }),
  });
  const launch = vi.fn(async () => { if (stage === 'native') { enter(); await pending; } if (!hook) throw Error('旧路径只到RAM原生边界'); return application; });
  const preparation = new BatchDuplicatePreparation(info, () => 1), guard = { assertCurrent: vi.fn(), ...(hook ? { assertPreparation(current: unknown) { if (current !== info) throw Error('TestInfo替换'); preparation.assertCurrent(); } } : {}) };
  const previous = { application: {}, page: {}, directory: 'C:\\RAM\\previous', errors: ['原错误'], calls: [{ message: '原回答' }], ready: Promise.resolve() };
  const context: any = { assertHistoryExitObservationScope, beginHistoryExitObservation, historyExitObservationFor, exports: {}, Error, AggregateError, preservedDesktopExits: states, process: { env: {} }, electron: { launch }, createSnippetsNativeDiagnostics: () => undefined, snippetsDiagnosticsArmed: false, snippetsDiagnostics: undefined,
    desktop: previous.application, page: previous.page, dataDir: previous.directory, pageErrors: previous.errors, dialogCalls: previous.calls, closed: true, quitReady: previous.ready,
    mkdtemp: vi.fn(async () => 'C:\\RAM\\dbark-e2e-prepared'), tmpdir: () => 'C:\\RAM', join: paths.join, rm: remove, randomUUID: () => 'RAM',
    console: { log: (text: string) => application.emit('console', { text: () => text }) },
    expect: () => ({ toBeVisible: async () => { if (stage === 'statusbar') { enter(); await pending; } } }),
  };
  const compiled = ts.transpileModule(functions.join('\n') + '\nglobalThis.fixture=' + automatic + ';globalThis.retain=retainOwnedDesktopResources;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, context);
  const use = vi.fn(async () => { bodyEnter(); await body; throw Error('RAM body结束，保留且不执行真实退出'); });
  const start = () => context.fixture({ preserveOnUnconfirmedExit: true, ownedDesktopLaunchGuard: guard, trace: 'off' }, use, info).catch((reason: unknown) => reason);
  const next = () => { const value = { application: {}, page: {}, errors: ['下一owner错误'], calls: [{ message: '下一owner回答' }], ready: Promise.resolve() }; Object.assign(context, { desktop: value.application, page: value.page, dataDir: 'C:\\RAM\\next', closed: false, pageErrors: value.errors, dialogCalls: value.calls, quitReady: value.ready }); return value; };
  return { info, states, launch, remove, application, window, native, context, previous, guard, use, entered, release, bodyEntered, bodyRelease, next, start };
}

it('prepared：launch在途被保留后晚返回，保留原app/PID而不覆盖下一owner或继续原生动作', async () => {
  const f = port('native'), work = f.start(); await f.entered; f.info.status = 'timedOut'; f.context.retain(f.info); const next = f.next(); f.release(); await work;
  const state = f.states.get(f.info); expect(state.application).toBe(f.application); expect(Array.from(state.processIds)).toEqual([12001]); expect(state.retained).toBe(true);
  expect(f.context.desktop).toBe(next.application); expect(f.context.page).toBe(next.page); expect(f.context.dataDir).toBe('C:\\RAM\\next'); expect(f.context.closed).toBe(false);
  expect(f.application.evaluate).not.toHaveBeenCalled(); expect(f.application.firstWindow).not.toHaveBeenCalled(); expect(f.use).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled(); expect(f.application.close).not.toHaveBeenCalled();
});
it.each(['willQuit', 'firstWindow', 'statusbar', 'dialogs', 'metrics'])('prepared：%s等待后的原墓碑先于共享发布及后续动作', async stage => {
  const f = port(stage), work = f.start(); await f.entered; const calls = f.application.evaluate.mock.calls.length, windows = f.application.firstWindow.mock.calls.length; f.context.retain(f.info); const next = f.next(); f.release(); await work;
  expect(f.states.get(f.info).application).toBe(f.application); expect(f.states.get(f.info).processIds).toContain(12001); expect(f.states.get(f.info).retained).toBe(true);
  expect(f.context.desktop).toBe(next.application); expect(f.context.page).toBe(next.page); expect(f.context.dataDir).toBe('C:\\RAM\\next'); expect(f.context.closed).toBe(false);
  expect(f.application.evaluate).toHaveBeenCalledTimes(calls); expect(f.application.firstWindow).toHaveBeenCalledTimes(windows); expect(f.use).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled(); expect(f.application.close).not.toHaveBeenCalled();
});
it('prepared：合法准备一次发布本地app/page/ready和PID，不无条件阻断', async () => {
  const f = port(), work = f.start(); await f.bodyEntered; const state = f.states.get(f.info);
  expect(f.context.desktop).toBe(f.application); expect(f.context.page).toBe(f.window); expect(f.context.dataDir).toBe('C:\\RAM\\dbark-e2e-prepared'); expect(f.context.closed).toBe(false);
  expect(state.ownerPage).toBe(f.window); expect(state.ready).toBe(f.context.quitReady); expect(Array.from(state.processIds)).toEqual([12001, 12002]); expect(state.retained).toBe(false);
  f.context.retain(f.info); f.bodyRelease(); await work; expect(f.remove).not.toHaveBeenCalled(); expect(f.application.close).not.toHaveBeenCalled();
});
it('prepared：当前回调正常记账，下一owner出现后旧close/console/pageerror只保留原state', async () => {
  const f = port(), work = f.start(); await f.bodyEntered;
  f.application.emit('console', { text: () => 'DBARK_E2E_DIALOG:{"message":"本owner回答"}' }); f.window.emit('pageerror', Error('本owner错误'));
  expect(f.context.dialogCalls).toEqual([{ message: '本owner回答' }]); expect(f.context.pageErrors).toEqual(['本owner错误']);
  const close = f.states.get(f.info).onClose, next = f.next(), text = vi.fn(() => '不得读取迟到内容');
  close(); f.application.emit('console', { text }); f.window.emit('pageerror', Error('迟到错误'));
  expect(f.states.get(f.info).retained).toBe(true); expect(f.context.desktop).toBe(next.application); expect(f.context.page).toBe(next.page); expect(f.context.closed).toBe(false); expect(f.context.dialogCalls).toBe(next.calls); expect(f.context.pageErrors).toBe(next.errors); expect(next.calls).toEqual([{ message: '下一owner回答' }]); expect(next.errors).toEqual(['下一owner错误']); expect(text).not.toHaveBeenCalled();
  f.bodyRelease(); await work; expect(f.remove).not.toHaveBeenCalled(); expect(f.application.close).not.toHaveBeenCalled();
});
it('prepared：无hook仍走原launch函数与两次guard，不进入新准备发布协议', async () => {
  const f = port(undefined, false); await f.start(); expect(f.launch).toHaveBeenCalledTimes(1); expect(f.guard.assertCurrent).toHaveBeenCalledTimes(2); expect(f.application.process).not.toHaveBeenCalled(); expect(f.application.firstWindow).not.toHaveBeenCalled(); expect(f.use).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
});
