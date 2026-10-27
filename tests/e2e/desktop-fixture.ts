import { test as baseTest, expect, _electron as electron, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {randomUUID} from 'node:crypto';
import { createSnippetsNativeDiagnostics, snippetsDiagnosticPort } from './snippets-native-diagnostics';
import type { SnippetsNativeDiagnostics } from '../helpers/snippetsNativeDiagnostics';
import { createDesktopQuitDiagnosticContext, observeDesktopQuitMethods } from './desktop-quit-diagnostics';

interface RecordedDialog { title?: string; message: string; buttons?: string[]; response: number; }
declare global { var __dbarkE2EDialogs: { answers: number[]; calls: RecordedDialog[] }; }

export { expect };
export let desktop: ElectronApplication;
export let page: Page;
export let dataDir: string;
export let closed = true;
export let pageErrors: string[];
export let dialogCalls: RecordedDialog[] = [];
let quitReady:Promise<void>;
export let snippetsDiagnostics: SnippetsNativeDiagnostics | undefined;
let snippetsDiagnosticsArmed = false;
let quitDiagnosticContext: ReturnType<typeof createDesktopQuitDiagnosticContext> | undefined;

/** 仅显式启用的用例持有此状态；不改变旧用例的退出及兜底路径。 */
interface OwnedDesktopExit {
  confirmed: boolean; retained: boolean; active: boolean; application?: ElectronApplication; ownerPage?: Page;
  processIds?: number[]; ready?: Promise<void>; closed: boolean; onClose?: () => void;
  diagnostics?: SnippetsNativeDiagnostics; confirming?: Promise<void>;
}
const preservedDesktopExits = new WeakMap<TestInfo, OwnedDesktopExit>();
/** 共用同一个TestInfo识别本例选项，不以全局环境开关影响其他用例。 */
export function preservesUnconfirmedExit(info: TestInfo): boolean { return preservedDesktopExits.has(info); }
/** 一旦无法确认，后续自动fixture也必须停链，不能再尝试退出或删除所属资源。 */
export function retainOwnedDesktopResources(info: TestInfo): void { const state = preservedDesktopExits.get(info); if (state) state.retained = true; }
/** 旧TestInfo和切换后的全局句柄都不能操作下一例；失配后本例永久停链。 */
function ownedDesktopState(info: TestInfo): OwnedDesktopExit {
  const state = preservedDesktopExits.get(info);
  if (!state || !state.active || state.retained) throw new Error('本例退出未确认，已停链保留所属资源');
  if (!state.application || desktop !== state.application || page !== state.ownerPage) {
    state.retained = true; throw new Error('本例桌面归属已改变，停链保留所属资源');
  }
  return state;
}
/** 实库清理也核同一所有者；只向调用者提供捕获页面和该实例的close事实。 */
export function ownedDesktopResources(info: TestInfo): { page: Page; application: ElectronApplication; closed: boolean } {
  const state = ownedDesktopState(info); return { page: state.ownerPage!, application: state.application!, closed: state.closed };
}
/** 所属PID只增不减；启动和退出前各记录一次，拒绝空记录或无效PID。 */
async function recordOwnedDesktopProcesses(info: TestInfo): Promise<void> {
  const state = ownedDesktopState(info), application = state.application!;
  const ids = await application.evaluate(({ app }) => app.getAppMetrics().map(metric => metric.pid));
  ownedDesktopState(info);
  const main = application.process()?.pid;
  if (!Array.isArray(ids) || ids.length === 0 || !Number.isSafeInteger(main) || main! <= 0 || ids.some(pid => !Number.isSafeInteger(pid) || pid <= 0)) throw new Error('本例所属进程记录未知，保留所属资源');
  state.processIds = [...new Set([...(state.processIds ?? []), main!, ...ids])];
}
/** launch返回后立即捕获本例句柄；PID读取跨await时仍须核归属。 */
async function bindOwnedDesktopExit(info: TestInfo): Promise<void> {
  const state = preservedDesktopExits.get(info)!;
  try {
    state.application = desktop; state.ownerPage = page; state.ready = quitReady; state.diagnostics = snippetsDiagnostics;
    if (closed) throw new Error('本例启动后的close状态未知，保留所属资源');
    state.onClose = () => { state.closed = true; }; state.application.on('close', state.onClose);
    await recordOwnedDesktopProcesses(info);
  } catch (reason) { state.retained = true; throw reason; }
}
/** 仅显式选项使用捕获owner的正常握手，不借旧quitDesktop的宽PID结论放行。 */
async function quitOwnedDesktop(info: TestInfo): Promise<void> {
  const state = ownedDesktopState(info), application = state.application!;
  if (state.closed) throw new Error('未取得本例完整退出证明，不能用已关闭标志替代退出收尾');
  if (state.diagnostics) { state.diagnostics.mark('before-quit'); await state.diagnostics.stop(); ownedDesktopState(info); }
  await recordOwnedDesktopProcesses(info); ownedDesktopState(info);
  dialogCalls = [];
  await application.evaluate(({ dialog }, responses) => {
    globalThis.__dbarkE2EDialogs = { answers: responses, calls: [] };
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as Electron.MessageBoxOptions;
      const response = globalThis.__dbarkE2EDialogs.answers.shift() ?? 0;
      const call = { title: options.title, message: options.message, buttons: options.buttons, response };
      globalThis.__dbarkE2EDialogs.calls.push(call); console.log('DBARK_E2E_DIALOG:' + JSON.stringify(call));
      return { response, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, [1, 1]);
  ownedDesktopState(info);
  const exited = application.waitForEvent('close', { timeout: 12000 });
  void exited.catch(() => undefined); // 归属先失效时仍观察既有事件承诺，不产生未处理拒绝。
  await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); }); ownedDesktopState(info);
  await Promise.race([state.ready!, exited]); ownedDesktopState(info);
  if (!state.closed) { await application.close(); ownedDesktopState(info); }
  await exited; ownedDesktopState(info);
  if (!state.closed || !state.processIds?.length) throw new Error('本例真实close或所属PID尚未确认，保留所属资源');
  let probeFailure: { reason: unknown } | undefined;
  await expect.poll(() => {
    try {
      ownedDesktopState(info);
      return state.processIds!.filter(pid => {
        try { process.kill(pid, 0); return true; }
        catch (reason) { if ((reason as NodeJS.ErrnoException)?.code === 'ESRCH') return false; throw reason; }
      });
    } catch (reason) { probeFailure = { reason }; return []; }
  }, { timeout: 5000, message: '本例已记录的所属进程应全部明确不存在' }).toEqual([]);
  // poll不得吞掉权限错误后继续重试并误放行；未知结果在第一次探测立即返回原错。
  if (probeFailure) throw probeFailure.reason;
  ownedDesktopState(info);
}
/** 活动用例内两层收尾复用同一退出承诺；只在真实close和严格PID核对后发放许可。 */
export async function confirmOwnedDesktopExit(info: TestInfo): Promise<void> {
  const state = ownedDesktopState(info);
  if (state.confirmed && state.closed) return;
  if (state.confirming) return state.confirming;
  state.confirming = quitOwnedDesktop(info);
  try {
    await state.confirming; ownedDesktopState(info); state.confirmed = true;
  } catch (reason) { state.retained = true; throw reason; }
  finally { state.confirming = undefined; }
}

/** 首次采集必须由离线片段用例在连接表单已关闭之后明确开启。 */
export async function startSnippetsNativeDiagnostics() {
  if (!snippetsDiagnostics || snippetsDiagnosticsArmed) return;
  snippetsDiagnosticsArmed = true;
  await snippetsDiagnostics.start(snippetsDiagnosticPort(desktop, page), 'initial');
}

/** 只替换原生对话框回答；退出状态机、渲染进程、IPC 和磁盘保存全部使用真实代码。 */
export async function answerDialogs(answers: number[], application: ElectronApplication = desktop) {
  dialogCalls = [];
  await application.evaluate(({ dialog }, responses) => {
    globalThis.__dbarkE2EDialogs = { answers: responses, calls: [] };
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as Electron.MessageBoxOptions;
      const response = globalThis.__dbarkE2EDialogs.answers.shift() ?? 0;
      const call = { title: options.title, message: options.message, buttons: options.buttons, response };
      globalThis.__dbarkE2EDialogs.calls.push(call);
      console.log('DBARK_E2E_DIALOG:' + JSON.stringify(call));
      return { response, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, answers);
}

/** 等待工作台完成初始化，避免在 preload 就绪、React 尚未装好保存监听时退出。 */
export async function launchDesktop(guard?: { assertCurrent(): void }) {
  const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, DBARK_USER_DATA: dataDir }).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.DBARK_EXECUTABLE_PATH;
  // 显式用例在原生启动前同步复核绑定，覆盖临时目录创建期间的配置漂移；默认用例无额外门。
  guard?.assertCurrent();
  desktop = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env, chromiumSandbox: true });
  const quitMarker='DBARK_E2E_QUIT_READY:'+randomUUID();let ready!:()=>void;quitReady=new Promise<void>(resolve=>{ready=resolve;});
  closed = false;
  desktop.on('close', () => { closed = true; });
  desktop.on('console', message => {
    const text = message.text();
    if (text.startsWith('DBARK_E2E_DIALOG:')) dialogCalls.push(JSON.parse(text.slice('DBARK_E2E_DIALOG:'.length)) as RecordedDialog);
    if(text===quitMarker)ready();
  });
  // 只观察实际will-quit，不阻止退出；收到此标记前保存守卫与原生对话框都已完成。
  await desktop.evaluate(({app},marker)=>{app.once('will-quit',()=>console.log(marker));},quitMarker);
  page = await desktop.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  // 原生 CI 首次启动安装产物需要额外加载时间；只延长就绪等待，仍要求状态栏真实可见。
  await expect(page.locator('.app-statusbar')).toBeVisible({ timeout: 15000 });
  await answerDialogs([]);
  if (snippetsDiagnosticsArmed) await snippetsDiagnostics?.start(snippetsDiagnosticPort(desktop, page), 'restart');
}

/** 仅新准备hook使用：先保留原生资源线索，全部准备完成后才一次发布共享句柄。 */
async function launchPreparedOwnedDesktop(info: TestInfo, state: OwnedDesktopExit, directory: string, guard: { assertCurrent(): void }, diagnostics: SnippetsNativeDiagnostics | undefined): Promise<void> {
  const previous = { desktop, page, dataDir, closed, quitReady, pageErrors, dialogCalls, snippetsDiagnostics, snippetsDiagnosticsArmed };
  const errors: string[] = [], calls: RecordedDialog[] = [];
  let application: ElectronApplication | undefined, preparedPage: Page | undefined, ready: Promise<void> | undefined, published = false;
  /** 发布前核原共享快照，发布后只承认本app/page；保留墓碑永不追认下一owner。 */
  const own = (allowClosed = false) => {
    try {
      guard.assertCurrent();
      if (preservedDesktopExits.get(info) !== state || !state.active || state.retained) throw new Error('本例准备启动的所有权已失效');
      if (published ? desktop !== application || page !== preparedPage || dataDir !== directory || quitReady !== ready || pageErrors !== errors || snippetsDiagnostics !== diagnostics || closed !== state.closed
        : desktop !== previous.desktop || page !== previous.page || dataDir !== previous.dataDir || closed !== previous.closed || quitReady !== previous.quitReady || pageErrors !== previous.pageErrors || dialogCalls !== previous.dialogCalls || snippetsDiagnostics !== previous.snippetsDiagnostics || snippetsDiagnosticsArmed !== previous.snippetsDiagnosticsArmed) throw new Error('本例准备启动的共享句柄已属于其他owner');
      if (!allowClosed && state.closed) throw new Error('本例准备启动的应用已经关闭');
    } catch (reason) { state.retained = true; throw reason; }
  };
  try {
    own();
    const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, DBARK_USER_DATA: directory }).filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete env.ELECTRON_RUN_AS_NODE;
    const executablePath = process.env.DBARK_EXECUTABLE_PATH;
    own(); application = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env, chromiumSandbox: true });
    // 即使原launch在超时后才返回，也先将app及可同步取得的主PID登记给原state，不能丢线索。
    state.application = application;
    const main = application.process()?.pid;
    if (Number.isSafeInteger(main) && main! > 0) state.processIds = [...new Set([...(state.processIds ?? []), main!])];
    own();
    if (!Number.isSafeInteger(main) || main! <= 0) throw new Error('本例准备启动缺少可确认的主进程');
    const localApplication = application, quitMarker = 'DBARK_E2E_QUIT_READY:' + randomUUID(); let resolveReady!: () => void;
    ready = new Promise<void>(resolve => { resolveReady = resolve; }); state.ready = ready; state.diagnostics = diagnostics;
    // 事件只操作当前原owner；失效后仅保留原state，不写下一例的closed/dialog/pageErrors。
    state.onClose = () => { try { own(true); state.closed = true; if (published) closed = true; } catch { state.retained = true; } };
    localApplication.on('close', state.onClose);
    localApplication.on('console', message => {
      try { own(true); const text = message.text(); if (text.startsWith('DBARK_E2E_DIALOG:')) (published ? dialogCalls : calls).push(JSON.parse(text.slice('DBARK_E2E_DIALOG:'.length))); if (text === quitMarker) resolveReady(); }
      catch { state.retained = true; }
    });
    own(); await localApplication.evaluate(({ app }, marker) => { app.once('will-quit', () => console.log(marker)); }, quitMarker); own();
    own(); preparedPage = await localApplication.firstWindow(); state.ownerPage = preparedPage; own();
    const localPage = preparedPage;
    localPage.on('pageerror', error => { try { own(true); errors.push(error.message); } catch { state.retained = true; } });
    own(); await expect(localPage.locator('.app-statusbar')).toBeVisible({ timeout: 15000 }); own();
    // 仅在本地app安装原有回答协议，不能调用会提前重置全局dialogCalls的旧answerDialogs。
    own(); await localApplication.evaluate(({ dialog }, responses) => {
      globalThis.__dbarkE2EDialogs = { answers: responses, calls: [] };
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.MessageBoxOptions, response = globalThis.__dbarkE2EDialogs.answers.shift() ?? 0;
        const call = { title: options.title, message: options.message, buttons: options.buttons, response };
        globalThis.__dbarkE2EDialogs.calls.push(call); console.log('DBARK_E2E_DIALOG:' + JSON.stringify(call));
        return { response, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    }, []); own();
    own(); const ids = await localApplication.evaluate(({ app }) => app.getAppMetrics().map(metric => metric.pid)); own();
    if (!Array.isArray(ids) || !ids.length || ids.some(pid => !Number.isSafeInteger(pid) || pid <= 0)) throw new Error('本例准备启动的所属PID未知');
    state.processIds = [...new Set([...(state.processIds ?? []), ...ids])];
    // 最终发布没有await；所有原生准备、原时钟和原共享句柄核验都已完成。
    own(); desktop = localApplication; page = localPage; dataDir = directory; closed = false; quitReady = ready;
    pageErrors = errors; dialogCalls = calls; snippetsDiagnostics = diagnostics; snippetsDiagnosticsArmed = false; published = true;
  } catch (reason) { state.retained = true; throw reason; }
}

/** 通过原生窗口或 app.quit 发起退出，保留调试通道直到保存握手和实际进程结束。 */
export async function requestQuit(method: 'app' | 'window' = 'app') {
  await desktop.evaluate(({ app, BrowserWindow }, route) => {
    setTimeout(() => route === 'window' ? BrowserWindow.getAllWindows()[0].close() : app.quit(), 0);
  }, method);
}

/** 显式诊断使用原退出函数，只旁观原应用的方法和原will-quit承诺。 */
export async function quitDesktopDiagnosed(method: 'app' | 'window' = 'app') {
  const application = desktop, ownerPage = page, ready = quitReady;
  const context = quitDiagnosticContext, diagnostic = context?.begin(application, ownerPage);
  if (!diagnostic) return quitDesktop(method);
  await diagnostic.arm();
  if (quitDiagnosticContext !== context || !diagnostic.current() || desktop !== application || page !== ownerPage || quitReady !== ready) { diagnostic.record('observer-unavailable', { ok: false }); throw Error('原诊断退出归属已变化，未投递退出请求'); }
  const restore = observeDesktopQuitMethods(application, diagnostic, () => { if (desktop !== application) throw Error('原应用归属已变化'); return closed; });
  void ready.then(() => diagnostic.record('will-quit'));
  try { await quitDesktop(method); }
  catch (error) { diagnostic.record('quit-failed'); throw error; }
  finally { restore(); }
}

/** 独立显式诊断生命周期；默认及结构写入用例继续消费原夹具主体。 */
async function runQuitDiagnosedDesktopLifetime(trace: Parameters<typeof createSnippetsNativeDiagnostics>[0], use: () => Promise<void>, info: TestInfo): Promise<void> {
  const context = createDesktopQuitDiagnosticContext(info), previous = quitDiagnosticContext;
  quitDiagnosticContext = context;
  try {
    snippetsDiagnosticsArmed = false; snippetsDiagnostics = createSnippetsNativeDiagnostics(trace, info); pageErrors = [];
    dataDir = await mkdtemp(join(tmpdir(), 'dbark-e2e-'));
    try { await launchDesktop(); await use(); }
    finally {
      try {
        if (snippetsDiagnostics) await snippetsDiagnostics.finish(info.status !== info.expectedStatus);
        if (!closed) { await answerDialogs([1, 1]); await quitDesktopDiagnosed(); }
      } finally {
        const diagnostic = !closed ? context.begin(desktop, page) : undefined;
        if (diagnostic) diagnostic.record('force-stop-started', { processCount: 1 });
        await forceStopOwnProcess();
        if (diagnostic) diagnostic.record('force-stop-finished', { closed });
        if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('dbark-e2e-')) throw new Error('拒绝清理测试临时目录以外的路径');
        await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    }
  } finally { await context.finish(); if (quitDiagnosticContext === context) quitDiagnosticContext = previous; }
}

/** 先验证真实退出守卫到will-quit，再用公开close断开测试调试连接，仍核所有实际进程退出。 */
export async function quitDesktop(method: 'app' | 'window' = 'app') {
  if (snippetsDiagnostics) { snippetsDiagnostics.mark('before-quit'); await snippetsDiagnostics.stop(); }
  const processIds = await desktop.evaluate(({ app }) => app.getAppMetrics().map(metric => metric.pid));
  const exited = desktop.waitForEvent('close', { timeout: 12000 });
  // 不在保存对话框之前脱离调试，否则会丢失实际回答证据；取消和保存失败继续保留调试通道。
  await requestQuit(method);await Promise.race([quitReady,exited]);
  if(!closed)await desktop.close();
  await exited;
  await expect.poll(() => processIds.filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }), { timeout: 5000, message: '本次 Electron 启动的子进程应全部释放' }).toEqual([]);
}

/** 失败兜底只终止本次 launch 的进程树，不按进程名清理其他 Electron 应用。 */
async function forceStopOwnProcess() {
  if (closed) return;
  const child = desktop?.process();
  if (!child?.pid) return;
  if (process.platform === 'win32') await promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']).catch(() => undefined);
  else child.kill('SIGKILL');
}

/** 自动夹具随每个用例运行，不依赖模块首次导入时注册钩子，避免跨文件复用已关闭窗口。 */
export const test = baseTest.extend<{ desktopLifetime: void; preserveOnUnconfirmedExit: boolean; collectQuitDiagnostics: boolean; ownedDesktopLaunchGuard: { assertCurrent(): void; assertPreparation?(info: TestInfo): void } | undefined }>({
  preserveOnUnconfirmedExit: [false, { option: true }],
  collectQuitDiagnostics: [false, { option: true }],
  ownedDesktopLaunchGuard: [undefined, { option: true }],
  desktopLifetime: [async ({ trace, preserveOnUnconfirmedExit, collectQuitDiagnostics, ownedDesktopLaunchGuard }, use, testInfo) => {
    if (preserveOnUnconfirmedExit || collectQuitDiagnostics) {
      if (collectQuitDiagnostics && !preserveOnUnconfirmedExit) { await runQuitDiagnosedDesktopLifetime(trace, use, testInfo); return; }
      // 检查端口仅在显式strict分支生效，并在分配所属资源前复核；默认分支保留原文。
      // 旧strict路径保留原调用时点；只有新准备hook需要先登记本例真实墓碑。
      if (!ownedDesktopLaunchGuard?.assertPreparation) ownedDesktopLaunchGuard?.assertCurrent();
      const state: OwnedDesktopExit = { confirmed: false, retained: false, active: true, closed: false }; preservedDesktopExits.set(testInfo, state);
      const originalGuard = ownedDesktopLaunchGuard;
      const launchGuard = originalGuard?.assertPreparation ? { assertCurrent() {
        try {
          if (preservedDesktopExits.get(testInfo) !== state || !state.active || state.retained) throw new Error('本例启动准备已失效，保留所属资源');
          originalGuard.assertPreparation!(testInfo);
          originalGuard.assertCurrent();
          // 参数/字节核对也可能耗时或触发保留，原生启动前再次核同一墓碑与原期限。
          if (preservedDesktopExits.get(testInfo) !== state || !state.active || state.retained) throw new Error('本例启动准备已失效，保留所属资源');
          originalGuard.assertPreparation!(testInfo);
        } catch (reason) { state.retained = true; throw reason; }
      } } : originalGuard;
      // 新准备路径的诊断和目录也先留在本地，不能在launch晚回包时覆盖下一owner。
      const preparedDiagnostics = originalGuard?.assertPreparation ? createSnippetsNativeDiagnostics(trace, testInfo) : undefined;
      if (!originalGuard?.assertPreparation) { snippetsDiagnosticsArmed = false; snippetsDiagnostics = createSnippetsNativeDiagnostics(trace, testInfo); pageErrors = []; }
      // 显式新hook在目录await两侧都核原TestInfo/墓碑；旧路径不增加门或改变失败策略。
      const directory = originalGuard?.assertPreparation ? await (async () => {
        launchGuard!.assertCurrent();
        try { const created = await mkdtemp(join(tmpdir(), 'dbark-e2e-')); launchGuard!.assertCurrent(); return created; }
        catch (reason) { state.retained = true; throw reason; }
      })() : await mkdtemp(join(tmpdir(), 'dbark-e2e-'));
      // 内层已核目录回包，外层await恢复仍可能晚于afterEach；先复核再写共享目录句柄。
      if (originalGuard?.assertPreparation) launchGuard!.assertCurrent();
      if (!originalGuard?.assertPreparation) dataDir = directory;
      let failed = false, originalFailure: unknown;
      try {
        if (originalGuard?.assertPreparation) { await launchPreparedOwnedDesktop(testInfo, state, directory, launchGuard!, preparedDiagnostics); launchGuard!.assertCurrent(); ownedDesktopState(testInfo); }
        else { await launchDesktop(launchGuard); await bindOwnedDesktopExit(testInfo); }
        await use();
        if (originalGuard?.assertPreparation) { launchGuard!.assertCurrent(); ownedDesktopState(testInfo); }
      }
      catch (reason) { failed = true; originalFailure = reason; throw reason; }
      finally {
        try {
          if (state.retained) {
            if (!failed) throw new Error('本例已经停链，保留所属资源且不重复退出');
          } else try {
            ownedDesktopState(testInfo);
            if (state.diagnostics) { await state.diagnostics.finish(testInfo.status !== testInfo.expectedStatus); ownedDesktopState(testInfo); }
            await confirmOwnedDesktopExit(testInfo);
            ownedDesktopState(testInfo);
            if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-e2e-')) throw new Error('拒绝清理测试临时目录以外的路径');
            await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
          } catch (cleanupFailure) {
            state.retained = true;
            if (failed) throw new AggregateError([originalFailure, cleanupFailure], '原用例失败且退出或清理未确认，保留所属资源', { cause: originalFailure });
            throw cleanupFailure;
          }
        } finally {
          // WeakMap保留失效墓碑：迟到的实库helper仍识别显式模式，不能退回默认清理分支。
          state.active = false; if (state.application && state.onClose) state.application.off('close', state.onClose);
        }
      }
      return;
    }
    // 必须在启动 Electron 前拒绝私网环境；trace 是 fixture 的实际解析值，包含 CLI 覆写。
    snippetsDiagnosticsArmed = false;
    snippetsDiagnostics = createSnippetsNativeDiagnostics(trace, testInfo);
    pageErrors = [];
    dataDir = await mkdtemp(join(tmpdir(), 'dbark-e2e-'));
    try {
      await launchDesktop();
      await use();
    } finally {
      try {
        if (snippetsDiagnostics) await snippetsDiagnostics.finish(testInfo.status !== testInfo.expectedStatus);
        if (!closed) {
          // 仅清理阶段允许放弃本例留下的草稿，具体退出测试自行核对对话框和保存结果。
          await answerDialogs([1, 1]);
          await quitDesktop();
        }
      } finally {
        await forceStopOwnProcess();
        // 删除前核对绝对路径，确保只能移除本测试创建的临时目录。
        if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('dbark-e2e-')) throw new Error('拒绝清理测试临时目录以外的路径');
        await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    }
  }, { auto: true }]
});
