import { lstat, realpath, mkdir, open, readdir, unlink, rmdir, readFile } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import initSqlJs from 'sql.js';
import type { AppSettings } from '../../src/shared/contracts';
import { privateQueryFileSourceSchema } from '../../src/main/queryFileSourceRecords';
import type { EditorIndentNativeRun, IndentNativeOwner } from './editor-indentation-native-owner';
import { queryFileNativeRecipe as recipe, queryFileNativeBytes, type QueryFileNativeStage } from './query-file-native-gate';

type Guard = () => void;
const fixtureCapabilities = new WeakSet<object>();
/** 每次资源await两侧消费同一run/原TestInfo门；未知时由外层run停链保留现场。 */
async function checked<T>(guard: Guard, action: () => Promise<T>): Promise<T> { guard(); const result = await action(); guard(); return result; }
/** 只有本fixture的单链接普通文件可读写，身份包含纳秒时间以检测同字节重写。 */
function stamp(value: BigIntStats) {
  if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1n || value.ino <= 0n) throw Error('合成SQL物理身份未知，保留现场');
  return JSON.stringify([String(value.dev), String(value.ino), String(value.size), String(value.mtimeNs), String(value.ctimeNs)]);
}

/** 只在本run真实userdata下独占新建固定fixture；无环境路径、已有文件或递归删除入口。 */
export async function createQueryFileNativeFixture(run: EditorIndentNativeRun, guard: Guard) {
  guard(); run.assert(); const userdata = run.path; if (!userdata) throw Error('原run尚未登记userdata');
  const root = resolve(userdata), directory = join(root, recipe.directory), path = join(directory, recipe.name);
  if (root !== userdata || !basename(root).startsWith('dbark-indent-')) throw Error('fixture不属于原run私有userdata');
  const rootStat = await checked(guard, () => lstat(root));
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await checked(guard, () => realpath(root)) !== root) throw Error('userdata目录归属未知');
  await checked(guard, () => mkdir(directory, { recursive: false, mode: 0o700 }));
  const directoryStat = await checked(guard, () => lstat(directory, { bigint: true }));
  const directoryIdentity = JSON.stringify([String(directoryStat.dev), String(directoryStat.ino)]);
  let observed: string | undefined, removed = false;
  /** 每次打开文件前重新确认原目录不是链接，且仍是首次创建的同一目录。 */
  async function own(check: Guard) {
    check(); if (removed) throw Error('fixture已经清理，不得复用');
    const value = await checked(check, () => lstat(directory, { bigint: true }));
    if (!value.isDirectory() || value.isSymbolicLink() || JSON.stringify([String(value.dev), String(value.ino)]) !== directoryIdentity || await checked(check, () => realpath(directory)) !== directory || await checked(check, () => realpath(root)) !== root) throw Error('fixture目录身份变化，保留现场');
  }
  await own(guard); guard(); const created = await open(path, 'wx', 0o600);
  try { guard(); await checked(guard, () => created.writeFile(queryFileNativeBytes('initial'))); await checked(guard, () => created.sync()); }
  finally { await created.close(); } // 失效时也只关闭已取得的本句柄，不继续路径读写或清理。
  /** 字节期望仅由Root批准配方产生；strict时连物理身份也必须保持，不能用相同正文掩盖覆盖。 */
  async function verify(stage: QueryFileNativeStage, check: Guard, strict = false) {
    await own(check); const before = stamp(await checked(check, () => lstat(path, { bigint: true })));
    if (strict && before !== observed) throw Error('合成SQL被意外替换或改写，保留现场');
    check(); const file = await open(path, 'r');
    try {
      check(); const held = stamp(await checked(check, () => file.stat({ bigint: true })));
      if (held !== before) throw Error('合成SQL打开期间身份变化');
      const bytes = await checked(check, () => file.readFile());
      if (stamp(await checked(check, () => lstat(path, { bigint: true }))) !== held || !bytes.equals(queryFileNativeBytes(stage))) throw Error('合成SQL字节或身份不符，不重签当前正文');
      observed = held; return { stage, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), physical: held };
    } finally { await file.close(); }
  }
  await verify('initial', guard);
  const capability = Object.freeze({ path, userdata: root,
    verify,
    /** 外改仅重写刚核准的本fixture同一文件句柄；不触碰Main/store/model或任意路径。 */
    async external(check: Guard) {
      await verify('saved', check, true); check(); const file = await open(path, 'r+');
      try {
        check(); if (stamp(await checked(check, () => file.stat({ bigint: true }))) !== observed) throw Error('外改fixture句柄归属未知');
        await checked(check, () => file.truncate(0)); await checked(check, () => file.writeFile(queryFileNativeBytes('external'))); await checked(check, () => file.sync());
      } finally { await file.close(); }
      return verify('external', check);
    },
    /** 仅两owner退出/PID闭合后的stopped回调调用；先精确清fixture，再由原run清userdata。 */
    async cleanup(stoppedPath: string, check: Guard) {
      check(); run.assert();
      if (stoppedPath !== root || run.path !== root) throw Error('清理路径不是原userdata');
      if (run.owners.length !== 2 || run.owners.some(owner => !owner.confirmed || !owner.closed || !owner.ready || !owner.ids.size)) throw Error('fixture清理缺少两owner正常退出/PID闭合');
      await verify('restarted', check, true);
      const names = await checked(check, () => readdir(directory)); if (names.length !== 1 || names[0] !== recipe.name) throw Error('fixture目录出现未知文件，保留现场');
      await checked(check, () => unlink(path)); await checked(check, () => rmdir(directory));
      try { await checked(check, () => lstat(directory)); } catch (reason) { check(); if ((reason as NodeJS.ErrnoException).code === 'ENOENT') { removed = true; return; } throw reason; }
      throw Error('fixture目录仍存在，未完成清理');
    },
  });
  fixtureCapabilities.add(capability); return capability;
}

/** 只替换Electron dialog文件选择端口，原Main文件命令/IO均照常执行；不能证明OS选择器。 */
export async function installQueryFileNativeDialog(owner: IndentNativeOwner, fixture: Awaited<ReturnType<typeof createQueryFileNativeFixture>>, guard: Guard, allowed: 0 | 1) {
  guard(); if (!fixtureCapabilities.has(fixture)) throw Error('文件选择端口拒绝未由本run创建的fixture');
  const fixturePath = fixture.path;
  const handle = await checked(guard, () => owner.application.browserWindow(owner.page));
  const windowId = await checked(guard, () => handle.evaluate(window => window.id));
  await checked(guard, () => owner.application.evaluate(({ app, dialog, BrowserWindow }, input) => {
    const root = globalThis as typeof globalThis & { __queryFileNativeDialog?: any };
    if (root.__queryFileNativeDialog) throw Error('已有文件选择测试端口，不覆盖');
    const window = BrowserWindow.fromId(input.windowId); if (!window || window.isDestroyed() || app.getPath('userData') !== input.userdata) throw Error('文件选择端口所属窗口或userdata未知');
    const state: any = { open: 0, save: 0, unexpected: 0, returned: [], oldOpen: dialog.showOpenDialog, oldSave: dialog.showSaveDialog };
    state.openPort = async (...args: any[]) => {
      state.open++;
      const options = args[1];
      if (state.open > input.allowed || args.length !== 2 || args[0] !== window || options?.title !== '打开SQL文件' || JSON.stringify(options.properties) !== '["openFile"]' || !options.filters?.some((filter: any) => JSON.stringify(filter.extensions) === '["sql"]')) { state.unexpected++; throw Error('文件选择调用不在批准次数或用途内'); }
      state.returned.push(input.path); return { canceled: false, filePaths: [input.path] };
    };
    state.savePort = async () => { state.save++; state.unexpected++; throw Error('本case禁止任何保存选择调用'); };
    dialog.showOpenDialog = state.openPort; dialog.showSaveDialog = state.savePort; root.__queryFileNativeDialog = state;
  }, { path: fixturePath, userdata: fixture.userdata, windowId, allowed }));
  return async () => checked(guard, () => owner.application.evaluate(({ dialog }, input) => {
    const root = globalThis as typeof globalThis & { __queryFileNativeDialog?: any }, value = root.__queryFileNativeDialog;
    if (!value || dialog.showOpenDialog !== value.openPort || dialog.showSaveDialog !== value.savePort || value.open !== input.allowed || value.save !== 0 || value.unexpected !== 0 || value.returned.length !== input.allowed || value.returned.some((path: string) => path !== input.path)) throw Error('文件选择端口调用证明缺失');
    dialog.showOpenDialog = value.oldOpen; dialog.showSaveDialog = value.oldSave; delete root.__queryFileNativeDialog;
    return { opens: value.open as number, saves: value.save as number, unexpected: value.unexpected as number, exactFixturePathOnly: true, osNativeSelectorProven: false };
  }, { path: fixturePath, allowed }));
}

/** 只在原run.stopped内读SQLite9，不执行用户SQL；来源路径只与本fixture做精确比较。 */
export async function readQueryFileNativeDatabase(path: string, guard: Guard) {
  const SQL = await checked(guard, () => initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') }));
  const bytes = await checked(guard, () => readFile(join(path, 'dbark.sqlite'))), db = new SQL.Database(bytes);
  try {
    guard(); const sources = (db.exec('SELECT tab_id,id,revision,data FROM query_file_sources')[0]?.values ?? []).map(([tabId, id, revision, data]) => {
      guard(); const value = privateQueryFileSourceSchema.parse(JSON.parse(String(data))); if (value.tabId !== tabId || value.ref.id !== id || value.ref.revision !== revision) throw Error('SQLite9来源索引与记录不一致'); return value;
    });
    return { schema: Number(db.exec('PRAGMA user_version')[0].values[0][0]), settings: JSON.parse(String(db.exec('SELECT data FROM settings WHERE id=1')[0].values[0][0])) as AppSettings, sources };
  } finally { db.close(); }
}
