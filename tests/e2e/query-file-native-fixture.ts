import { lstat, realpath, mkdir, open, readdir, unlink, rmdir } from 'node:fs/promises';
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

/** 只读原run登记目录的SQLite9；路径、父目录与同一只读句柄在读前后固定，不跟随文件链接。 */
export async function readQueryFileNativeDatabase(path: string, guard: Guard, run: EditorIndentNativeRun) {
  /** 原调用者仍须处于stopped；这里额外绑定原目录，不能以有效时间门读取另一个路径。 */
  const authorize = () => { guard(); if (!run || run.path !== path || resolve(path) !== path || !basename(path).startsWith('dbark-indent-')) throw Error('SQLite读取缺少原run目录归属'); run.assert(); };
  authorize();
  const databasePath = join(path, 'dbark.sqlite'), limit = 16 * 1024 * 1024;
  /** 父目录不允许链接、身份未知或路径重定向；固定版本也捕获读取期间的目录替换。 */
  const parentStamp = (value: BigIntStats) => {
    if (!value.isDirectory() || value.isSymbolicLink() || typeof value.dev !== 'bigint' || value.dev < 0n || typeof value.ino !== 'bigint' || value.ino <= 0n || typeof value.mtimeNs !== 'bigint' || typeof value.ctimeNs !== 'bigint') throw Error('SQLite父目录身份或链接未知');
    return JSON.stringify([String(value.dev), String(value.ino), String(value.mtimeNs), String(value.ctimeNs)]);
  };
  /** 不把缺失的版本元数据字符串化为相同的unknown身份。 */
  const fileStamp = (value: BigIntStats) => {
    if (typeof value.dev !== 'bigint' || value.dev < 0n || typeof value.ino !== 'bigint' || typeof value.nlink !== 'bigint' || typeof value.size !== 'bigint' || typeof value.mtimeNs !== 'bigint' || typeof value.ctimeNs !== 'bigint') throw Error('SQLite文件版本身份未知');
    return stamp(value);
  };
  const parent = parentStamp(await checked(authorize, () => lstat(path, { bigint: true })));
  if (await checked(authorize, () => realpath(path)) !== path) throw Error('SQLite父目录真实路径不属于原run');
  const named = await checked(authorize, () => lstat(databasePath, { bigint: true })), version = fileStamp(named);
  if (named.size < 100n || named.size > BigInt(limit)) throw Error('SQLite证据大小不在有界读取范围');
  if (await checked(authorize, () => realpath(databasePath)) !== databasePath) throw Error('SQLite文件真实路径或链接归属未知');
  /** 每次路径复核仍使用首次封存的版本，不能给变化后的文件或父目录重新签名。 */
  async function samePaths() {
    if (parentStamp(await checked(authorize, () => lstat(path, { bigint: true }))) !== parent || await checked(authorize, () => realpath(path)) !== path) throw Error('SQLite父目录身份或真实路径已变化');
    if (fileStamp(await checked(authorize, () => lstat(databasePath, { bigint: true }))) !== version || await checked(authorize, () => realpath(databasePath)) !== databasePath) throw Error('SQLite文件版本或真实路径已变化');
  }
  await samePaths(); authorize();
  const file = await open(databasePath, 'r');
  let db: InstanceType<Awaited<ReturnType<typeof initSqlJs>>['Database']> | undefined;
  try {
    authorize();
    if (fileStamp(await checked(authorize, () => file.stat({ bigint: true }))) !== version) throw Error('SQLite只读句柄身份与原路径不一致');
    await samePaths();
    const bytes = Buffer.alloc(Number(named.size));
    for (let offset = 0; offset < bytes.length;) {
      const length = Math.min(64 * 1024, bytes.length - offset), result = await checked(authorize, () => file.read(bytes, offset, length, offset));
      if (!Number.isSafeInteger(result.bytesRead) || result.bytesRead <= 0 || result.bytesRead > length) throw Error('SQLite读取截断或字节预算未知');
      offset += result.bytesRead;
    }
    const end = await checked(authorize, () => file.read(Buffer.alloc(1), 0, 1, bytes.length));
    if (end.bytesRead !== 0 || fileStamp(await checked(authorize, () => file.stat({ bigint: true }))) !== version) throw Error('SQLite读取期间版本或大小已变化');
    await samePaths();
    const SQL = await checked(authorize, () => initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') }));
    // WASM初始化也可能迟到；解析前再次核同一句柄和原路径，异常时绝不解析已取字节。
    if (fileStamp(await checked(authorize, () => file.stat({ bigint: true }))) !== version) throw Error('SQLite解析前原句柄版本已变化');
    await samePaths(); authorize(); db = new SQL.Database(bytes); authorize();
    const sources = (db.exec('SELECT tab_id,id,revision,data FROM query_file_sources')[0]?.values ?? []).map(([tabId, id, revision, data]) => {
      authorize(); const value = privateQueryFileSourceSchema.parse(JSON.parse(String(data))); if (value.tabId !== tabId || value.ref.id !== id || value.ref.revision !== revision) throw Error('SQLite9来源索引与记录不一致'); return value;
    });
    const result = { schema: Number(db.exec('PRAGMA user_version')[0].values[0][0]), settings: JSON.parse(String(db.exec('SELECT data FROM settings WHERE id=1')[0].values[0][0])) as AppSettings, sources };
    authorize(); return result;
  } finally {
    db?.close();
    // 撤销后只允许关闭已取得的本句柄；关闭前后仍检查原门，不再做路径IO、解析或删除。
    let revoked: unknown; try { authorize(); } catch (reason) { revoked = reason; }
    await file.close(); if (revoked) throw revoked; authorize();
  }
}
