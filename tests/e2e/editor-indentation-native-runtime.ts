import { _electron as electron, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, lstat, rm, readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import type { AppSettings } from '../../src/shared/contracts';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { EditorIndentNativeRun, type IndentNativeOwner } from './editor-indentation-native-owner';

/** 复用原socket脚本，不重新实现拒连逻辑；子进程正常完成才有原socket关闭证明。 */
export async function requireIndentOfflinePort(env: NodeJS.ProcessEnv) {
  await promisify(execFile)(process.execPath, [resolve(__dirname, '../../scripts/check-offline-query-port.mjs')], { env, timeout: 10000, windowsHide: true });
}
/** 调用方须先取得本run的stopped许可，只读本例配置库，不连接任何业务数据库。 */
export async function readIndentNativeSettings(path: string): Promise<{ settings: AppSettings; schema: number }> {
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  const db = new SQL.Database(await readFile(join(path, 'dbark.sqlite')));
  try { return { settings: JSON.parse(String(db.exec('SELECT data FROM settings WHERE id=1')[0].values[0][0])) as AppSettings, schema: Number(db.exec('PRAGMA user_version')[0].values[0][0]) }; }
  finally { db.close(); }
}
/** 原生适配器仅在显式门通过后动态加载；默认/列表不创建应用或目录。 */
export function createEditorIndentNativeRun(binding: { assertCurrent(): void }): EditorIndentNativeRun {
  let parent = '';
  const markers = new WeakMap<IndentNativeOwner, string>();
  /** 每次敏感操作前复核真实目录，拒绝父目录、链接替换或跨盘。 */
  async function assertDirectory(path: string) {
    const stat = await lstat(path);
    if (dirname(resolve(path)) !== parent || !basename(path).startsWith('dbark-indent-') || !stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== resolve(path)) throw Error('缩进原生专项目录归属未知，保留现场');
  }
  return new EditorIndentNativeRun({
    assertCurrent: () => binding.assertCurrent(),
    preflight: () => requireIndentOfflinePort(process.env),
    directory: async () => { parent = await realpath(tmpdir()); return mkdtemp(join(parent, 'dbark-indent-')); }, assertDirectory,
    launch: async path => {
      await assertDirectory(path); binding.assertCurrent();
      const env = Object.fromEntries(Object.entries({ ...process.env, DBARK_USER_DATA: path }).filter((entry): entry is [string, string] => entry[1] !== undefined));
      const executablePath = env.DBARK_EXECUTABLE_PATH;
      const application = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env, chromiumSandbox: true });
      let ready!: () => void; const owner: IndentNativeOwner = { application, page: undefined!, ids: new Set(), closed: false, confirmed: false, ready: false, errors: [], quitReady: new Promise(done => { ready = done; }) };
      application.on('close', () => { owner.closed = true; });
      // 主句柄到手即返回给专属run登记，后续准备失败也不能丢失已启动实例。
      const marker = 'DBARK_INDENT_QUIT:' + randomUUID();
      application.on('console', message => { if (message.text() === marker) { owner.ready = true; ready(); } });
      markers.set(owner, marker); return owner;
    },
    prepare: async owner => {
      const { application } = owner, marker = markers.get(owner)!;
      await application.evaluate(({ app }, marker) => { app.once('will-quit', () => console.log(marker)); }, marker); binding.assertCurrent();
      owner.page = await application.firstWindow(); binding.assertCurrent();
      owner.page.on('pageerror', error => owner.errors.push(error.name));
      await expect(owner.page.locator('.app-statusbar')).toBeVisible({ timeout: 15000 }); binding.assertCurrent();
    },
    record: async owner => { const ids = await owner.application.evaluate(({ app }) => app.getAppMetrics().map(metric => metric.pid)); const main = owner.application.process().pid; if (!Array.isArray(ids) || !ids.length || ids.some(pid => !Number.isSafeInteger(pid) || pid <= 0) || !Number.isSafeInteger(main) || main! <= 0) throw Error('本owner主进程或metrics PID未知'); return [main!, ...ids]; },
    quit: async owner => {
      const exited = owner.application.waitForEvent('close', { timeout: 15000 }); void exited.catch(() => undefined);
      await owner.application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); });
      // 意外close不能代替will-quit；在同一个有界窗口内取得正常握手，随后才断开调试。
      await Promise.race([owner.quitReady, exited.then(() => { if (!owner.ready) throw Error('本owner关闭但未取得will-quit'); })]); binding.assertCurrent();
      if (!owner.ready) throw Error('本owner正常退出握手未知');
      if (!owner.closed) await owner.application.close(); await exited;
    },
    absent: async ids => {
      let failure: unknown;
      await expect.poll(() => { try { binding.assertCurrent(); return ids.filter(pid => { try { process.kill(pid, 0); return true; } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ESRCH') return false; throw reason; } }); } catch (reason) { failure = reason; return []; } }, { timeout: 5000, message: '本owner全部已记录PID须明确不存在' }).toEqual([]);
      if (failure) throw failure;
    },
    remove: async path => { await assertDirectory(path); binding.assertCurrent(); await rm(path, { recursive: true, force: false }); try { await lstat(path); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return; throw reason; } throw Error('本例目录仍存在，未完成清理'); },
  });
}
