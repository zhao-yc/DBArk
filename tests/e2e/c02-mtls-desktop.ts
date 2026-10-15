import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { C02FixtureError, c02Failure } from '../integration/helpers/c02-mtls-policy';
import { c02DesktopEnvironment, c02DialogAnswer, c02PidGone } from './c02-mtls-ui-policy';

type DialogState = { unexpected: boolean };
type MainGlobal = typeof globalThis & { __c02Dialogs?: DialogState };

/** 本例专属 Electron 生命周期；不复用会加载通用 .env 或自动启动 GUI 的现有夹具。 */
export class C02Desktop {
  app?: ElectronApplication;
  page!: Page;
  private closed = true;
  private quitReady?: Promise<void>;
  private readonly pids = new Set<number>();
  private pageErrorCount = 0;
  private quitObserved = false;
  private constructor(readonly directory: string, private readonly parent: string, private readonly identity: { dev: number; ino: number }) {}

  /** 先创建独占数据目录，调用 start 前不启动进程。 */
  static async create(parent: string): Promise<C02Desktop> {
    const target = await mkdtemp(join(resolve(parent), 'dbark-c02-ui-'));
    return new C02Desktop(target, resolve(parent), await lstat(target));
  }

  /** 真实启动主进程及 preload；仅替换本应用的已知原生确认回答，不替换认证、IPC 或系统加密。 */
  async start(): Promise<void> {
    if (!this.closed) throw new C02FixtureError('C02 上一次 Electron 仍在运行');
    try {
      const executablePath = process.env.DBARK_C02_EXECUTABLE_PATH;
      if (executablePath) {
        const info = isAbsolute(executablePath) ? await lstat(executablePath) : undefined;
        if (!info?.isFile() || info.isSymbolicLink()) throw new C02FixtureError('C02 显式应用路径必须为已有普通文件绝对路径');
      }
      this.pids.clear(); this.quitObserved = false;
      this.app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env: c02DesktopEnvironment(process.env, this.directory), chromiumSandbox: true });
      this.closed = false; this.app.on('close', () => { this.closed = true; });
      if (this.app.process().pid) this.pids.add(this.app.process().pid!);
      const marker = `C02-QUIT-${randomUUID()}`;
      this.quitReady = new Promise<void>(done => this.app!.on('console', message => { if (message.text() === marker) { this.quitObserved = true; done(); } }));
      await this.app.evaluate(({ app }, value) => { app.once('will-quit', () => console.log(value)); }, marker);
      this.page = await this.app.firstWindow();
      this.page.on('pageerror', () => { this.pageErrorCount++; });
      await expect(this.page.locator('.app-statusbar')).toBeVisible({ timeout: 15000 });
      // 通过源码序列化纯回答策略；主进程内只持有已知消息，原始异常不进入报告。
      await this.app.evaluate(({ dialog }, source) => {
        const answer = (0, eval)(`(${source})`) as typeof c02DialogAnswer;
        const state: DialogState = { unexpected: false }; (globalThis as MainGlobal).__c02Dialogs = state;
        const choose = (args: unknown[]) => { const options = args.at(-1) as Electron.MessageBoxOptions; const result = answer(options.buttons ?? [], options.message); state.unexpected ||= result.unexpected; return result.response; };
        dialog.showMessageBox = (async (...args: unknown[]) => ({ response: choose(args), checkboxChecked: false })) as typeof dialog.showMessageBox;
        dialog.showMessageBoxSync = ((...args: unknown[]) => choose(args)) as typeof dialog.showMessageBoxSync;
      }, c02DialogAnswer.toString());
      await this.rememberProcesses();
    } catch (error) { throw c02Failure('C02 真实 Electron 启动失败', error); }
  }

  /** 只记录本 app 实际报告的 PID，并返回数据库 utility 的真实存在性。 */
  async rememberProcesses(): Promise<boolean> {
    const metrics = await this.app!.evaluate(({ app }) => app.getAppMetrics().map(item => ({ pid: item.pid, type: item.type, name: item.name, serviceName: item.serviceName })));
    for (const item of metrics) this.pids.add(item.pid);
    return metrics.some(item => item.type === 'Utility' && (item.name === 'DBArk 数据库引擎' || item.serviceName === 'DBArk 数据库引擎'));
  }

  /** 必须走真实 app.quit 保存握手并等待本例全部已记录进程消失；不会因正常退出而删除用户目录。 */
  async quit(): Promise<void> {
    if (this.closed) return;
    const app = this.app!;
    await this.rememberProcesses();
    const unexpected = await app.evaluate(() => (globalThis as MainGlobal).__c02Dialogs?.unexpected === true);
    if (unexpected || this.pageErrorCount) throw new C02FixtureError('C02 出现页面错误或非预期原生确认');
    const exited = app.waitForEvent('close', { timeout: 15000 });
    await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); });
    await Promise.race([this.quitReady, exited]);
    if (!this.quitObserved) throw new C02FixtureError('C02 未经过真实 will-quit 保存握手就已退出');
    if (!this.closed) await app.close();
    await exited;
    await expect.poll(() => [...this.pids].every(pid => c02PidGone(pid)), { timeout: 7000, message: '本例 Electron 与实际 utility 进程必须退出' }).toBe(true);
  }

  /** finally 内只处理本例 PID 树和已验证的临时目录；退出失败仍保留为失败，不以强杀替代成功。 */
  async dispose(): Promise<void> {
    const failures: unknown[] = [];
    try { await this.quit(); } catch (error) { failures.push(c02Failure('C02 原生应用退出失败', error)); }
    if (!this.closed && this.app?.process().pid) {
      try {
        const pid = this.app.process().pid!;
        if (process.platform === 'win32') await promisify(execFile)('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
        else this.app.process().kill('SIGKILL');
        await expect.poll(() => [...this.pids].every(value => c02PidGone(value)), { timeout: 7000 }).toBe(true);
      } catch (error) { failures.push(c02Failure('C02 本例进程兜底释放失败', error)); }
    }
    try {
      const target = resolve(this.directory), info = await lstat(target);
      if (dirname(target) !== this.parent || !/^dbark-c02-ui-[A-Za-z0-9]+$/.test(basename(target)) || !info.isDirectory() || info.isSymbolicLink() || info.ino !== this.identity.ino || info.dev !== this.identity.dev) throw new C02FixtureError('C02 应用临时目录所有权不匹配');
      // 删除前已解析绝对路径并校验本例目录身份；仍有进程时保留目录，不递归清除在用材料。
      if ([...this.pids].some(pid => !c02PidGone(pid))) throw new C02FixtureError('C02 本例进程仍存在或无法确认，保留临时目录');
      await rm(target, { recursive: true, force: false });
    } catch (error) { failures.push(c02Failure(`C02 应用目录清理失败，保留 ${this.directory}`, error)); }
    if (failures.length) throw new AggregateError(failures, 'C02 原生应用收尾失败', { cause: failures[0] });
  }
}
