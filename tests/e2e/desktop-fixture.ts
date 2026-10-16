import { test as baseTest, expect, _electron as electron, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {randomUUID} from 'node:crypto';
import { createSnippetsNativeDiagnostics, snippetsDiagnosticPort } from './snippets-native-diagnostics';
import type { SnippetsNativeDiagnostics } from '../helpers/snippetsNativeDiagnostics';

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
export function ownedDesktopResources(info: TestInfo): { page: Page; closed: boolean } {
  const state = ownedDesktopState(info); return { page: state.ownerPage!, closed: state.closed };
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
export async function answerDialogs(answers: number[]) {
  dialogCalls = [];
  await desktop.evaluate(({ dialog }, responses) => {
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
export async function launchDesktop() {
  const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, DBARK_USER_DATA: dataDir }).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.DBARK_EXECUTABLE_PATH;
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

/** 通过原生窗口或 app.quit 发起退出，保留调试通道直到保存握手和实际进程结束。 */
export async function requestQuit(method: 'app' | 'window' = 'app') {
  await desktop.evaluate(({ app, BrowserWindow }, route) => {
    setTimeout(() => route === 'window' ? BrowserWindow.getAllWindows()[0].close() : app.quit(), 0);
  }, method);
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
export const test = baseTest.extend<{ desktopLifetime: void; preserveOnUnconfirmedExit: boolean }>({
  preserveOnUnconfirmedExit: [false, { option: true }],
  desktopLifetime: [async ({ trace, preserveOnUnconfirmedExit }, use, testInfo) => {
    if (preserveOnUnconfirmedExit) {
      const state: OwnedDesktopExit = { confirmed: false, retained: false, active: true, closed: false }; preservedDesktopExits.set(testInfo, state);
      snippetsDiagnosticsArmed = false; snippetsDiagnostics = createSnippetsNativeDiagnostics(trace, testInfo); pageErrors = [];
      const directory = await mkdtemp(join(tmpdir(), 'dbark-e2e-')); dataDir = directory;
      let failed = false, originalFailure: unknown;
      try { await launchDesktop(); await bindOwnedDesktopExit(testInfo); await use(); }
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
