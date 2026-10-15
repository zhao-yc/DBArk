import { test as baseTest, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {randomUUID} from 'node:crypto';

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
}

/** 通过原生窗口或 app.quit 发起退出，保留调试通道直到保存握手和实际进程结束。 */
export async function requestQuit(method: 'app' | 'window' = 'app') {
  await desktop.evaluate(({ app, BrowserWindow }, route) => {
    setTimeout(() => route === 'window' ? BrowserWindow.getAllWindows()[0].close() : app.quit(), 0);
  }, method);
}

/** 先验证真实退出守卫到will-quit，再用公开close断开测试调试连接，仍核所有实际进程退出。 */
export async function quitDesktop(method: 'app' | 'window' = 'app') {
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
export const test = baseTest.extend<{ desktopLifetime: void }>({
  desktopLifetime: [async ({}, use) => {
    pageErrors = [];
    dataDir = await mkdtemp(join(tmpdir(), 'dbark-e2e-'));
    try {
      await launchDesktop();
      await use();
    } finally {
      try {
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
