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
import { EditorIndentNativeRun, type IndentNativeOwner } from './editor-indentation-native-owner';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';

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
export function createEditorIndentNativeRun(binding: { assertCurrent(): void }): EditorIndentNativeRun {
  let parent = '', run!: EditorIndentNativeRun, identity: Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>> | undefined;
  const captured = new WeakMap<IndentNativeOwner, { application: IndentNativeOwner['application']; child: ReturnType<IndentNativeOwner['application']['process']>; main: number; page?: IndentNativeOwner['page']; marker: string; window?: { id: number; contents: number }; pids: Set<number> }>();
  /** 只做同步归属检查；run.assert再叠加sticky retained，避免递归调用授权门。 */
  function base(owner?: IndentNativeOwner) {
    binding.assertCurrent(); if (!owner) return;
    const own = captured.get(owner);
    if (!own || owner.application !== own.application || owner.page !== own.page || own.application.process() !== own.child || own.child.pid !== own.main || [...own.pids].some(pid => !owner.ids.has(pid))) throw Error('原应用/page/主PID身份已变化，保留资源');
  }
  const guard = (owner?: IndentNativeOwner, closed = false) => run.assert(owner, closed);
  /** 目录读取完成后先查完整门，随后才可继续下一次IO或launch/rm。 */
  async function assertDirectory(path: string) {
    guard(); const stat = await lstat(path); guard(); const actual = await realpath(path); guard();
    if (dirname(resolve(path)) !== parent || !basename(path).startsWith('dbark-indent-') || !stat.isDirectory() || stat.isSymbolicLink() || actual !== resolve(path)) throw Error('缩进原生专项目录归属未知，保留现场');
  }
  /** 清单摘要来自Root，首次捕获后不可用当时的新字节重签；每次启动前后复核。 */
  async function verified() {
    guard();
    if (!identity) {
      identity = await sealEditorIndentLaunchIdentity(process.env.DBARK_EDITOR_INDENT_MANIFEST!, process.env.DBARK_EDITOR_INDENT_MANIFEST_SHA256!, resolve(__dirname, '../..'), {
        stat: async path => { const value = await lstat(path); return { file: value.isFile(), directory: value.isDirectory(), link: value.isSymbolicLink() }; }, real: realpath, list: readdir, bytes: readFile,
      }, () => guard()); guard();
    }
    await identity.assertCurrent(); guard();
    if (process.env.DBARK_EXECUTABLE_PATH && (identity.manifest.kind !== 'installed' || resolve(process.env.DBARK_EXECUTABLE_PATH) !== identity.manifest.executable)) throw Error('环境安装路径不匹配Root批准清单');
    return identity;
  }
  /** 实际主进程、BrowserWindow(page)、URL和renderer PID共同证明返回的是批准的应用。 */
  async function source(owner: IndentNativeOwner): Promise<number[]> {
    guard(owner); const own = captured.get(owner)!;
    const actual = await own.application.evaluate(({ app, BrowserWindow }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid, metrics: app.getAppMetrics().map(value => value.pid), windows: BrowserWindow.getAllWindows().map(window => ({ id: window.id, contents: window.webContents.id, renderer: window.webContents.getOSProcessId() })) })); guard(owner);
    await identity!.assertActual(actual); guard(owner);
    if (actual.pid !== own.main || !actual.metrics.length || actual.metrics.some(pid => !Number.isSafeInteger(pid) || pid <= 0)) throw Error('本owner实际主进程或metrics PID未知');
    if (own.page) {
      const handle = await own.application.browserWindow(own.page); guard(owner);
      const window = await handle.evaluate(value => ({ id: value.id, contents: value.webContents.id, renderer: value.webContents.getOSProcessId(), url: value.webContents.getURL(), destroyed: value.isDestroyed() })); guard(owner);
      const url = new URL(window.url);
      if (window.destroyed || !Number.isSafeInteger(window.renderer) || window.renderer <= 0 || !actual.metrics.includes(window.renderer) || !actual.windows.some(value => value.id === window.id && value.contents === window.contents && value.renderer === window.renderer) || own.window && (own.window.id !== window.id || own.window.contents !== window.contents) || own.page.url() !== window.url || url.protocol !== 'file:' || url.search || url.hash || resolve(fileURLToPath(url)) !== join(identity!.manifest.appPath, 'dist/renderer/index.html')) throw Error('本owner返回页面/renderer来源未知');
      own.window ??= { id: window.id, contents: window.contents };
    }
    for (const pid of [own.main, ...actual.metrics]) { own.pids.add(pid); owner.ids.add(pid); }
    return [own.main, ...actual.metrics];
  }
  run = new EditorIndentNativeRun({
    assertCurrent: base,
    preflight: async () => { await verified(); guard(); await requireIndentOfflinePort(process.env); guard(); },
    directory: async () => { guard(); parent = await realpath(tmpdir()); guard(); const path = await mkdtemp(join(parent, 'dbark-indent-')); run.acquiredDirectory(path); guard(); return path; }, assertDirectory,
    launch: async path => {
      await assertDirectory(path); guard(); const seal = await verified(); guard();
      const env = Object.fromEntries(Object.entries({ ...process.env, DBARK_USER_DATA: path }).filter((entry): entry is [string, string] => entry[1] !== undefined));
      guard(); const application = await electron.launch({ executablePath: seal.manifest.executable, args: seal.manifest.kind === 'source' ? [seal.manifest.root] : [], cwd: seal.manifest.root, env, chromiumSandbox: true });
      // 即使原期限在launch等待时结束，也先登记原句柄及主PID，再停链；不能留下未登记实例。
      let ready!: () => void; const child = application.process(), main = child.pid, marker = 'DBARK_INDENT_QUIT:' + randomUUID();
      const owner: IndentNativeOwner = { application, page: undefined!, ids: new Set(main && Number.isSafeInteger(main) ? [main] : []), closed: false, confirmed: false, ready: false, errors: [], quitReady: new Promise(done => { ready = done; }) };
      captured.set(owner, { application, child, main: main!, marker, pids: new Set(owner.ids) }); run.acquiredOwner(owner);
      application.on('close', () => { owner.closed = true; }); application.on('console', message => { if (message.text() === marker) { owner.ready = true; ready(); } });
      guard(owner); if (!Number.isSafeInteger(main) || main! <= 0) throw Error('新应用主PID未知'); await verified(); guard(owner); await source(owner); guard(owner); return owner;
    },
    prepare: async owner => {
      guard(owner); const own = captured.get(owner)!;
      await own.application.evaluate(({ app }, marker) => { app.once('will-quit', () => console.log(marker)); }, own.marker); guard(owner);
      const page = await own.application.firstWindow(); own.page = page; owner.page = page; guard(owner);
      page.on('pageerror', error => owner.errors.push(error.name)); guard(owner);
      await expect(page.locator('.app-statusbar')).toBeVisible({ timeout: 15000 }); guard(owner); await source(owner); guard(owner);
    },
    record: source,
    quit: async owner => {
      guard(owner); await source(owner); guard(owner);
      const exited = owner.application.waitForEvent('close', { timeout: 15000 }); void exited.catch(() => undefined);
      guard(owner); await owner.application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); }); guard(owner, true);
      await Promise.race([owner.quitReady, exited.then(() => { if (!owner.ready) throw Error('本owner关闭但未取得will-quit'); })]); guard(owner, true);
      if (!owner.ready) throw Error('本owner正常退出握手未知');
      if (!owner.closed) { guard(owner, true); await owner.application.close(); guard(owner, true); } await exited; guard(owner, true);
    },
    absent: async ids => {
      guard(); let failure: unknown;
      await expect.poll(() => { try { guard(); return ids.filter(pid => { guard(); try { process.kill(pid, 0); return true; } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ESRCH') return false; throw reason; } }); } catch (reason) { failure = reason; return []; } }, { timeout: 5000, message: '本owner全部已记录PID须明确不存在' }).toEqual([]);
      guard(); if (failure) throw failure;
    },
    remove: async path => { await assertDirectory(path); guard(); await rm(path, { recursive: true, force: false }); guard(); try { await lstat(path); guard(); } catch (reason) { guard(); if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return; throw reason; } throw Error('本例目录仍存在，未完成清理'); },
  }); return run;
}
