import { _electron as electron, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, lstat, rm, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import type { AppSettings } from '../../src/shared/contracts';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { EditorIndentNativeRun, recordIndentNativePageError, type IndentNativeOwner, type IndentNativeSourceDiagnostic } from './editor-indentation-native-owner';
import { observeNativeStartup } from './editor-native-startup-diagnostics';
export { attachNativeStartupDiagnostics } from './editor-native-startup-diagnostics';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';
import { openNativeProgress, type NativeProgressStage, type NativeProgressWriter } from '../../scripts/native-editor-progress.mjs';

/** 固定原脚本；完整授权由调用者在调用前和原Promise完成后共同检查。 */
export async function requireIndentOfflinePort(env: NodeJS.ProcessEnv) {
  await promisify(execFile)(process.execPath, [resolve(__dirname, '../../scripts/check-offline-query-port.mjs')], { env, timeout: 10000, windowsHide: true });
}
/** SQLite每个await也消费同一原期限/停链门，不让stopped外层的迟到拒绝代替内部授权。 */
export async function readIndentNativeSettings(path: string, guard: () => void): Promise<{ settings: AppSettings; schema: number }> {
  guard(); const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') }); guard();
  const bytes = await readFile(join(path, 'dbark.sqlite')); guard(); const db = new SQL.Database(bytes);
  try { guard(); return { settings: JSON.parse(String(db.exec('SELECT data FROM settings WHERE id=1')[0].values[0][0])) as AppSettings, schema: Number(db.exec('PRAGMA user_version')[0].values[0][0]) }; }
  finally { db.close(); }
}
/** 原生适配器所有资源await/副作用共享run+原TestInfo门，入口身份只取Root批准清单。 */
export function createEditorIndentNativeRun(binding: { assertCurrent(): void; elapsedMs?(): number | undefined }, approval?: { manifestPath: string; approvedHash: string }): EditorIndentNativeRun {
  // 新专项可显式传Root批准清单；未传时保留原环境读取路径，不伪造旧专项开关。
  const explicitApproval = approval && Object.freeze({ manifestPath: approval.manifestPath, approvedHash: approval.approvedHash });
  let parent = '', run!: EditorIndentNativeRun, identity: Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>> | undefined;
  const captured = new WeakMap<IndentNativeOwner, { application: IndentNativeOwner['application']; child: ReturnType<IndentNativeOwner['application']['process']>; launcher: number; main?: number; page?: IndentNativeOwner['page']; marker: string; window?: { id: number; contents: number }; pids: Set<number>; quitting: boolean; closed: boolean; willQuit: boolean; startup?: ReturnType<typeof observeNativeStartup> }>();
  /** 只做同步归属检查；run.assert再叠加sticky retained，避免递归调用授权门。 */
  function base(owner?: IndentNativeOwner) {
    binding.assertCurrent(); if (!owner) return;
    const own = captured.get(owner);
    if (!own || owner.application !== own.application || owner.page !== own.page || own.child.pid !== own.launcher || [...own.pids].some(pid => !owner.ids.has(pid))) throw Error('原应用/page/启动器PID身份已变化，保留资源');
    if (owner.closed !== own.closed || owner.ready !== own.willQuit || own.closed && !own.quitting) throw Error('原应用正常退出阶段或握手标记已变化，保留资源');
    // dispatcher会先于客户端close投递失效；只在原source已确认的私有quit阶段使用原缓存，不捕获或吞SDK异常。
    if (!own.quitting ? own.application.process() !== own.child : !own.window || !Number.isSafeInteger(own.main) || own.main! <= 0) throw Error('原应用启动器或退出来源证明已变化，保留资源');
  }
  const guard = (owner?: IndentNativeOwner, closed = false) => run.assert(owner, closed);
  const progressActive = process.env.DBARK_NATIVE_EDITOR_PROGRESS === '1' && !(process.argv ?? []).some(value => value === '--list' || value.startsWith('--list='));
  let progress: NativeProgressWriter | undefined;
  let progressGuard = () => guard();
  /** 仅消费已登记的数字状态；日志没有任何清理/退出/查PID权限，失败直接保留原资源。 */
  function phase(stage: NativeProgressStage, owner?: IndentNativeOwner, closed = false) {
    if (!progressActive) return;
    progressGuard = () => guard(owner, closed); progressGuard();
    progress ??= openNativeProgress({ enabled: true, listing: false, manifestPath: explicitApproval?.manifestPath ?? process.env.DBARK_EDITOR_INDENT_MANIFEST!, manifestSha256: explicitApproval?.approvedHash ?? process.env.DBARK_EDITOR_INDENT_MANIFEST_SHA256!, headerSha256: process.env.DBARK_NATIVE_EDITOR_PROGRESS_SHA256, guard: () => progressGuard() });
    const pids = [...new Set(run.owners.flatMap(value => [...value.ids]))].sort((a, b) => a - b);
    progress!.record(stage, { owners: run.owners.length, registeredPids: pids.length, pids, confirmedOwners: run.owners.filter(value => value.confirmed).length, readyOwners: run.owners.filter(value => value.ready).length, closedOwners: run.owners.filter(value => value.closed).length, retained: run.retained, removed: run.removed });
    guard(owner, closed);
  }
  /** 目录读取完成后先查完整门，随后才可继续下一次IO或launch/rm。 */
  async function assertDirectory(path: string) {
    guard(); const stat = await lstat(path); guard(); const actual = await realpath(path); guard();
    if (dirname(resolve(path)) !== parent || !basename(path).startsWith('dbark-indent-') || !stat.isDirectory() || stat.isSymbolicLink() || actual !== resolve(path)) throw Error('缩进原生专项目录归属未知，保留现场');
  }
  /** 清单摘要来自Root，首次捕获后不可用当时的新字节重签；每次启动前后复核。 */
  async function verified() {
    guard();
    phase('scan.begin');
    if (!identity) {
      identity = await sealEditorIndentLaunchIdentity(explicitApproval ? explicitApproval.manifestPath : process.env.DBARK_EDITOR_INDENT_MANIFEST!, explicitApproval ? explicitApproval.approvedHash : process.env.DBARK_EDITOR_INDENT_MANIFEST_SHA256!, resolve(__dirname, '../..'), {
        stat: async path => { const value = await lstat(path); return { file: value.isFile(), directory: value.isDirectory(), link: value.isSymbolicLink() }; }, real: realpath, list: readdir, bytes: readFile,
      }, () => guard()); guard();
    }
    await identity.assertCurrent(); guard();
    if (process.env.DBARK_EXECUTABLE_PATH && (identity.manifest.kind !== 'installed' || resolve(process.env.DBARK_EXECUTABLE_PATH) !== identity.manifest.executable)) throw Error('环境安装路径不匹配Root批准清单');
    phase('scan.done');
    return identity;
  }
  /** 先保留原句柄返回的正PID线索，再核期限/来源；线索不认证main/window，也不授权退出、清理或终止。 */
  function rememberObservedPids(owner: IndentNativeOwner, values: readonly number[]): void {
    const own = captured.get(owner)!;
    for (const pid of values) if (Number.isSafeInteger(pid) && pid > 0 && !own.pids.has(pid)) { own.pids.add(pid); owner.ids.add(pid); }
  }
  /** 启动器与实际主进程分别封存；Windows Playwright 的 shell ChildProcess 不是应用主进程。 */
  async function sampleSource(owner: IndentNativeOwner): Promise<{ ids: number[]; complete: boolean }> {
    guard(owner); const own = captured.get(owner)!;
    const actual = await own.application.evaluate(({ app, BrowserWindow }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid, parent: process.ppid, platform: process.platform, metrics: app.getAppMetrics().map(value => value.pid), windows: BrowserWindow.getAllWindows().map(window => ({ id: window.id, contents: window.webContents.id, renderer: window.webContents.getOSProcessId() })) }));
    rememberObservedPids(owner, [actual.pid, ...actual.metrics, ...actual.windows.map(window => window.renderer)]); guard(owner);
    const diagnostic: IndentNativeSourceDiagnostic = { phase: !own.page ? '启动来源' : own.window ? '已准备来源' : '窗口准备', complete: false,
      expected: { launcherPid: own.launcher, mainPid: own.main, platform: process.platform, relation: process.platform === 'win32' ? '启动器父进程' : '同一进程', window: own.window && { ...own.window } },
      observed: { mainPid: actual.pid, parentPid: actual.parent, platform: actual.platform, metrics: actual.metrics.slice(0, 64) } };
    const diagnostics = owner.sourceDiagnostics ??= []; diagnostics.push(diagnostic); if (diagnostics.length > 12) diagnostics.shift();
    await identity!.assertActual(actual); guard(owner);
    if (actual.platform !== process.platform || !Number.isSafeInteger(actual.pid) || actual.pid <= 0 || (process.platform === 'win32' ? actual.parent !== own.launcher || actual.pid === own.launcher : actual.pid !== own.launcher) || own.main !== undefined && actual.pid !== own.main) throw Error('本owner实际主进程与原启动器关系未知');
    own.main ??= actual.pid;
    // 归属只取上面的原来源门；完整renderer证明仍须下方原条件全部成立，不能从线索集合推导。
    let complete = false;
    if (own.page) {
      const handle = await own.application.browserWindow(own.page); guard(owner);
      const window = await handle.evaluate(value => ({ id: value.id, contents: value.webContents.id, renderer: value.webContents.getOSProcessId(), url: value.webContents.getURL(), destroyed: value.isDestroyed() }));
      rememberObservedPids(owner, [window.renderer]); guard(owner);
      diagnostic.observed.window = { id: window.id, contents: window.contents, renderer: window.renderer, destroyed: window.destroyed };
      const url = new URL(window.url);
      if (window.destroyed || own.window && (own.window.id !== window.id || own.window.contents !== window.contents) || own.page.url() !== window.url || url.protocol !== 'file:' || url.search || url.hash || resolve(fileURLToPath(url)) !== join(identity!.manifest.appPath, 'dist/renderer/index.html')) throw Error('本owner返回页面来源未知');
      complete = actual.metrics.length > 0 && actual.metrics.every(pid => Number.isSafeInteger(pid) && pid > 0) && Number.isSafeInteger(window.renderer) && window.renderer > 0 && actual.metrics.includes(window.renderer) && actual.windows.some(value => value.id === window.id && value.contents === window.contents && value.renderer === window.renderer);
      if (complete) own.window ??= { id: window.id, contents: window.contents };
    }
    diagnostic.complete = complete; return { ids: [...own.pids], complete };
  }
  /** 只有窗口准备阶段可在原期限内等待指标；完整证明缺失不放行UI，身份错误立即停链。 */
  async function source(owner: IndentNativeOwner, preparing = false): Promise<number[]> {
    if (preparing) {
      let result: Awaited<ReturnType<typeof sampleSource>> | undefined, failure: unknown;
      await expect.poll(async () => { try { result = await sampleSource(owner); guard(owner); return result.complete; } catch (reason) { failure = reason; return true; } }, { timeout: 5000, intervals: [50, 100, 250], message: '本owner窗口准备后metrics与renderer PID须完整有效' }).toBe(true); guard(owner);
      if (failure) throw failure;
      if (!result?.complete) throw Error('本owner窗口准备后metrics或renderer PID未知');
      return result.ids;
    }
    const result = await sampleSource(owner); guard(owner);
    if (captured.get(owner)!.page && !result.complete) throw Error('本owner实际metrics PID未知或renderer来源未证实');
    return result.ids;
  }
  run = new EditorIndentNativeRun({
    assertCurrent: base,
    preflight: async () => { await verified(); guard(); await requireIndentOfflinePort(process.env); guard(); },
    directory: async () => { guard(); parent = await realpath(tmpdir()); guard(); const path = await mkdtemp(join(parent, 'dbark-indent-')); run.acquiredDirectory(path); guard(); return path; }, assertDirectory,
    launch: async path => {
      await assertDirectory(path); guard(); const seal = await verified(); guard();
      const env = Object.fromEntries(Object.entries({ ...process.env, DBARK_USER_DATA: path }).filter((entry): entry is [string, string] => entry[1] !== undefined));
      guard(); phase('launch.begin'); const application = await electron.launch({ executablePath: seal.manifest.executable, args: seal.manifest.kind === 'source' ? [seal.manifest.root] : [], cwd: seal.manifest.root, env, chromiumSandbox: true });
      // 即使原期限在launch等待时结束，也先登记原句柄及主PID，再停链；不能留下未登记实例。
      let ready!: () => void; const child = application.process(), main = child.pid, marker = 'DBARK_INDENT_QUIT:' + randomUUID();
      const owner: IndentNativeOwner = { application, page: undefined!, ids: new Set(main && Number.isSafeInteger(main) ? [main] : []), closed: false, confirmed: false, ready: false, errors: [], sourceDiagnostics: [], quitReady: new Promise(done => { ready = done; }) };
      const own: NonNullable<ReturnType<typeof captured.get>> = { application, child, launcher: main!, marker, pids: new Set(owner.ids), quitting: false, closed: false, willQuit: false };
      captured.set(owner, own); run.acquiredOwner(owner);
      // 只认原句柄的真实事件；公共closed/ready不能伪造私有阶段，提前退出立即永久停链。
      application.on('close', () => { own.closed = true; owner.closed = true; if (!own.quitting) run.retained = true; });
      application.on('console', message => { if (message.text() === marker) { own.willQuit = true; owner.ready = true; if (!own.quitting) run.retained = true; ready(); } });
      guard(owner);
      if (progressActive) {
        // 观察权限只查本地身份/原TestInfo，不调用SDK，拒绝后不再写旧case。
        own.startup = observeNativeStartup(application, () => {
          binding.assertCurrent();
          if (run.retained || run.removed || run.owners.at(-1) !== owner || owner.application !== own.application || owner.page !== own.page || own.quitting || own.closed || owner.confirmed) throw Error('启动观察的原owner已失效');
        }, marker, binding.elapsedMs);
        owner.startupDiagnostics = own.startup.data;
      }
      phase('launch.returned', owner); if (!Number.isSafeInteger(main) || main! <= 0) throw Error('新应用主PID未知'); await verified(); guard(owner); await source(owner); guard(owner); return owner;
    },
    prepare: async owner => {
      guard(owner); const own = captured.get(owner)!;
      phase('prepare.hook', owner);
      await own.application.evaluate(({ app, BrowserWindow }, value) => {
        const marker = typeof value === 'string' ? value : value.marker;
        app.once('will-quit', () => console.log(marker));
        if (typeof value !== 'string') {
          // 仅复用这次原hook RPC；只发固定标记，不读取脚本路径、错误正文或参数。
          let contents = 0, reports = 0;
          const watch = (webContents: Electron.WebContents) => {
            if (contents >= 4) return; contents++;
            webContents.on('preload-error', () => { if (reports < 32) { reports++; console.log(marker + ':PRELOAD'); } });
          };
          BrowserWindow.getAllWindows().forEach(window => watch(window.webContents));
          app.on('web-contents-created', (_event, webContents) => watch(webContents));
        }
      }, progressActive ? { marker: own.marker } : own.marker); guard(owner);
      phase('prepare.window', owner);
      const page = await own.application.firstWindow(); own.page = page; owner.page = page; guard(owner); own.startup?.firstWindow(page);
      page.on('pageerror', error => recordIndentNativePageError(owner, error)); guard(owner);
      phase('prepare.statusbar', owner); own.startup?.statusbar();
      await expect(page.locator('.app-statusbar')).toBeVisible({ timeout: 15000 }); guard(owner); phase('prepare.metrics', owner); await source(owner, true); guard(owner); phase('prepare.done', owner); own.startup?.finish();
    },
    record: source,
    quit: async owner => {
      guard(owner); phase('close.source', owner); await source(owner); guard(owner);
      const own = captured.get(owner)!;
      if (!own.window || !own.main || own.quitting || own.closed || own.willQuit) throw Error('原应用尚未取得可用的正常退出来源');
      const exited = own.application.waitForEvent('close', { timeout: 15000 }); void exited.catch(() => undefined);
      guard(owner); own.quitting = true; // 最后一次完整source之后、发起原quit之前封存，覆盖dispose早于close投递的间隙。
      phase('close.request', owner, true);
      await own.application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); }); guard(owner, true);
      phase('close.handshake', owner, true);
      await Promise.race([owner.quitReady, exited.then(() => { if (!owner.ready) throw Error('本owner关闭但未取得will-quit'); })]); guard(owner, true);
      if (!owner.ready) throw Error('本owner正常退出握手未知');
      if (!owner.closed) { guard(owner, true); phase('close.application', owner, true); await own.application.close(); guard(owner, true); } phase('close.event', owner, true); await exited; guard(owner, true);
      if (!own.closed || !own.willQuit) throw Error('原应用真实关闭或正常退出握手未确认');
    },
    absent: async ids => {
      guard(); phase('close.pids'); let failure: unknown;
      await expect.poll(() => { try { guard(); return ids.filter(pid => { guard(); try { process.kill(pid, 0); return true; } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ESRCH') return false; throw reason; } }); } catch (reason) { failure = reason; return []; } }, { timeout: 5000, message: '本owner全部已记录PID须明确不存在' }).toEqual([]);
      guard(); if (failure) throw failure; phase('close.done');
    },
    remove: async path => { await assertDirectory(path); guard(); await rm(path, { recursive: true, force: false }); guard(); try { await lstat(path); guard(); } catch (reason) { guard(); if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return; throw reason; } throw Error('本例目录仍存在，未完成清理'); },
  }); return run;
}
