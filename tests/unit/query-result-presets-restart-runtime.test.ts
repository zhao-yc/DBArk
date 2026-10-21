import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { closeMysqlConnection } from '../../src/engine/connection';
import { assertQueryResultColumnsUiIdentity, closeQueryResultColumnsObserver } from '../helpers/queryResultColumnsUi';
import { c02DesktopEnvironment } from '../e2e/c02-mtls-ui-policy';
import { EditorIndentNativeRun } from '../e2e/editor-indentation-native-owner';
import { sealEditorIndentLaunchIdentity } from '../e2e/editor-indentation-native-identity';

const sourceUrl = new URL('../e2e/query-result-presets-restart-runtime.ts', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8'), tree = ts.createSourceFile('runtime.ts', source, ts.ScriptTarget.Latest, true);
const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createQueryResultPresetsRestartRun');
if (!declaration) throw Error('未找到原方案重启runtime，禁止维护手写副本');
const code = ts.transpileModule(declaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

/** 仅RAM边界可暂停；生产状态机、身份清单、身份结果校验及严格关闭函数均运行原实现。 */
function fixture() {
  const project = resolve('RAM-result-presets-source'), parent = resolve('RAM-result-presets-parent'), directory = join(parent, 'dbark-result-presets-RAM');
  const executable = join(resolve('RAM-result-presets-electron'), 'electron.exe'), resources = join(dirname(executable), 'resources');
  const manifestPath = resolve('RAM-result-presets-approved.json'), bytes = new Map<string, Buffer>();
  const put = (path: string, text: string) => bytes.set(path, Buffer.from(text));
  put(executable, '批准Electron字节'); put(join(project, 'scripts/check-offline-query-port.mjs'), '批准清单既有脚本');
  put(join(project, 'package.json'), '{"main":"dist/main/index.cjs"}'); put(join(project, 'dist/main/index.cjs'), '批准Main字节'); put(join(project, 'dist/renderer/index.html'), '批准Renderer字节'); put(join(resources, 'default_app.asar'), '批准Bootstrap字节');
  const manifest = { version: 1, kind: 'source', root: project, executable, appPath: project, resources, files: [...bytes].map(([path, data]) => ({ path, sha256: createHash('sha256').update(data).digest('hex') })) };
  put(manifestPath, JSON.stringify(manifest));
  const approval = { manifestPath, approvedHash: createHash('sha256').update(bytes.get(manifestPath)!).digest('hex') };
  const target = { host: '192.168.31.200', port: 13384, user: '合成只读用户', password: '合成密码_不得传子进程', uuid: '11111111-2222-4333-8444-555555555555', output: 'RAM', csv: 'RAM.csv', json: 'RAM.json' };
  let active = true, exists = false, directoryLink = false, directoryInode = 1, ownedReads = 0;
  let connectHook = async (_observer: any) => {}, queryHook = async (_observer: any) => {}, launchHook = async (_application: any) => {};
  let pauseAt = 0, enter!: () => void, release!: () => void, waiting = Promise.resolve();
  const applications: any[] = [], observers: any[] = [], events: string[] = [];
  const binding = { target, assertCurrent: vi.fn(() => { if (!active) throw Error('原TestInfo授权已失效'); }) };
  const connect = vi.fn(async (options: unknown) => {
    const stream = new EventEmitter() as any; stream.closed = false;
    stream.end = vi.fn((done?: (error?: Error) => void) => { events.push('stream.end'); stream.closed = true; done?.(); stream.emit('close'); });
    stream.destroy = vi.fn(() => { stream.closed = true; stream.emit('close'); });
    const native = { stream, end: vi.fn((done: () => void) => { events.push('native.end'); done(); }), destroy: vi.fn() };
    const observer: any = { connection: native, query: vi.fn(async (sql: string) => { events.push('identity.query'); await queryHook(observer); return [[{ version: '8.4.11', os: 'Linux', names: 0, uuid: target.uuid }], []]; }), options };
    observers.push(observer); events.push('connect'); await connectHook(observer); return observer;
  });
  let context: any;
  const launch = vi.fn(async () => {
    const launcher = 101 + applications.length * 1000, renderer = launcher + 101;
    const application = new EventEmitter() as any, app = new EventEmitter() as any, page = new EventEmitter() as any;
    const window = { id: applications.length + 1, webContents: { id: applications.length + 11, getOSProcessId: () => renderer, getURL: () => page.url() }, isDestroyed: () => false };
    const child = { pid: launcher };
    context.process.pid = launcher + 202; context.process.ppid = launcher;
    app.getAppMetrics = () => [{ pid: renderer }]; app.getAppPath = () => project; app.isPackaged = false; app.quit = () => app.emit('will-quit');
    page.url = () => pathToFileURL(join(project, 'dist/renderer/index.html')).href; page.locator = () => ({ visible: true });
    application.runtime = app; application.page = page; application.window = window;
    application.process = () => child; application.firstWindow = async () => page;
    application.evaluate = async (action: Function, argument: unknown) => action({ app, BrowserWindow: { getAllWindows: () => [window] } }, argument);
    application.browserWindow = async (value: unknown) => { expect(value).toBe(page); return { evaluate: async (action: Function) => action(window) }; };
    application.waitForEvent = () => new Promise(done => application.once('close', done));
    application.close = vi.fn(async () => { expect(app.listenerCount('will-quit')).toBe(0); events.push('app.close'); application.emit('close'); });
    applications.push(application); events.push('launch'); await launchHook(application); return application;
  });
  const removed = vi.fn(async () => { exists = false; events.push('remove'); });
  const probe = vi.fn((_pid: number, _signal: number) => { throw Object.assign(Error('合成不存在'), { code: 'ESRCH' }); });
  const poll = (read: () => unknown) => ({ toEqual: async (expected: unknown) => expect(await read()).toEqual(expected), toBe: async (expected: unknown) => { let actual: unknown; for (let index = 0; index < 3; index++) { actual = await read(); if (actual === expected) return; } expect(actual).toBe(expected); } });
  const nativeExpect = Object.assign((locator: { visible: boolean }) => ({ toBeVisible: async () => { expect(locator.visible).toBe(true); } }), { poll });
  context = {
    exports: {}, EditorIndentNativeRun, sealEditorIndentLaunchIdentity, closeMysqlConnection, closeQueryResultColumnsObserver, assertQueryResultColumnsUiIdentity, c02DesktopEnvironment,
    mysql: { createConnection: connect }, electron: { launch }, expect: nativeExpect, binding, approval,
    randomUUID: () => 'RAM-quit-marker', WeakMap, Set, URL, fileURLToPath, dirname, basename, resolve, join, __dirname: join(project, 'tests/e2e'), tmpdir: () => parent,
    realpath: async (path: string) => path, mkdtemp: vi.fn(async () => { exists = true; return directory; }),
    lstat: async (path: string) => {
      if (path === directory) {
        ownedReads++; if (ownedReads === pauseAt) { enter(); await waiting; }
        if (!exists) throw Object.assign(Error('合成不存在'), { code: 'ENOENT' });
        return { dev: 1, ino: directoryInode, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => directoryLink };
      }
      const file = bytes.has(path), isKnownDirectory = [project, resources, ...[...bytes.keys()].flatMap(value => { const parents: string[] = []; while (dirname(value) !== value) { value = dirname(value); parents.push(value); } return parents; })].includes(path);
      if (!file && !isKnownDirectory) throw Object.assign(Error('合成不存在'), { code: 'ENOENT' });
      return { isFile: () => file, isDirectory: () => isKnownDirectory && !file, isSymbolicLink: () => false };
    },
    readdir: async (path: string) => [...new Set([...bytes.keys()].filter(value => value.startsWith(path + (process.platform === 'win32' ? '\\' : '/'))).map(value => value.slice(path.length + 1).split(/[\\/]/u)[0]))],
    readFile: async (path: string) => { if (!bytes.has(path)) throw Error('未批准文件'); return bytes.get(path)!; }, rm: removed,
    process: { env: { SystemRoot: 'RAM-system', DBARK_TEST_PASSWORD: target.password, DBARK_ROOT_PASSWORD: '不可继承的管理口令', ELECTRON_RUN_AS_NODE: '1' }, platform: 'win32', pid: 303, ppid: 101, execPath: executable, resourcesPath: resources, kill: probe },
    setTimeout: (callback: () => void) => callback(), console: { log: (message: string) => applications.at(-1).emit('console', { text: () => message }) }
  };
  const run = runInNewContext(code + '\ncreateQueryResultPresetsRestartRun(binding,approval)', context) as EditorIndentNativeRun;
  return { run, binding, context, target, approval, applications, observers, events, connect, launch, probe, removed, bytes, executable, directory, manifestPath,
    invalidate: () => { active = false; }, setDirectoryLink: () => { directoryLink = true; }, replaceDirectory: () => { directoryInode++; },
    onConnect: (hook: typeof connectHook) => { connectHook = hook; }, onQuery: (hook: typeof queryHook) => { queryHook = hook; }, onLaunch: (hook: typeof launchHook) => { launchHook = hook; },
    pauseDirectory: (offset: number) => { pauseAt = ownedReads + offset; waiting = new Promise(done => { release = done; }); return { entered: new Promise<void>(done => { enter = done; }), release: () => release() }; }
  };
}

describe('命名结果方案双owner实库重启runtime的真实控制器与RAM物理边界', () => {
  it('每代只读身份及同流关闭完成后才启动，两真实owner各自willquit/close/PID后才能删除同一目录', async () => {
    const f = fixture(), first = await f.run.launch(); await f.run.close(first);
    const second = await f.run.launch(); expect(second.application).not.toBe(first.application); expect(first.confirmed).toBe(true);
    await f.run.close(second); await f.run.stopped(async path => { expect(path).toBe(f.directory); }); await f.run.finish();
    expect(f.connect).toHaveBeenCalledTimes(2); expect(f.launch).toHaveBeenCalledTimes(2); expect(f.observers.every(observer => observer.connection.stream.closed)).toBe(true);
    for (const observer of f.observers) {
      expect(observer.query).toHaveBeenCalledExactlyOnceWith('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid');
      expect(observer.connection.end).toHaveBeenCalledOnce(); expect(observer.connection.stream.end).toHaveBeenCalledOnce(); expect(observer.connection.destroy).not.toHaveBeenCalled();
    }
    expect(f.events.indexOf('stream.end')).toBeLessThan(f.events.indexOf('launch'));
    expect(f.connect).toHaveBeenCalledWith({ host: '192.168.31.200', port: 13384, user: f.target.user, password: f.target.password, connectTimeout: 15000 });
    for (const [options] of f.launch.mock.calls as unknown as [{ env: Record<string, string>; cwd: string; args: string[] }][]) {
      expect(options.env).toEqual({ DBARK_USER_DATA: f.directory, SystemRoot: 'RAM-system' }); expect(options.cwd).toBe(resolve('RAM-result-presets-source')); expect(options.args).toEqual([options.cwd]);
    }
    expect(f.run.owners.every(owner => owner.ready && owner.closed && owner.confirmed)).toBe(true); expect(f.probe).toHaveBeenCalledTimes(6);
    expect(f.removed).toHaveBeenCalledExactlyOnceWith(f.directory, { recursive: true, force: false }); expect(f.run.removed).toBe(true);
  });

  it.each(['host', 'port', 'uuid'] as const)('目标%s不准确时不连接数据库、不创建目录或启动', async key => {
    const f = fixture(); Object.assign(f.target, { [key]: key === 'port' ? 3306 : '错误目标' });
    await expect(f.run.launch()).rejects.toThrow('准确实库目标'); expect(f.connect).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled(); expect(f.context.mkdtemp).not.toHaveBeenCalled(); expect(f.run.retained).toBe(true);
  });

  it('预检身份错误保留原观察连接，不关闭、不重试、不启动', async () => {
    const f = fixture();
    // 首次query的返回值由真实SQL结果边界提供，固定错误身份而非放宽产品身份断言。
    f.onConnect(async observer => { observer.query.mockResolvedValue([[{ version: '8.4.11', os: 'Linux', names: 0, uuid: '另一个UUID' }], []]); });
    await expect(f.run.launch()).rejects.toThrow('身份'); expect(f.observers).toHaveLength(1); expect(f.observers[0].connection.end).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled();
    await expect(f.run.launch()).rejects.toThrow(); expect(f.connect).toHaveBeenCalledOnce(); expect(f.removed).not.toHaveBeenCalled();
  });

  it('createConnection迟到返回先留原对象，原门失效后不得query或关闭该流', async () => {
    const f = fixture(); f.onConnect(async () => { f.invalidate(); });
    await expect(f.run.launch()).rejects.toThrow('授权已失效'); expect(f.observers).toHaveLength(1); expect(f.observers[0].query).not.toHaveBeenCalled(); expect(f.observers[0].connection.end).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled(); expect(f.run.retained).toBe(true);
  });

  it('query完成时原门失效保留连接与首因，不通过finally补关闭', async () => {
    const f = fixture(); f.onQuery(async () => { f.invalidate(); });
    await expect(f.run.launch()).rejects.toThrow('授权已失效'); expect(f.observers[0].query).toHaveBeenCalledOnce(); expect(f.observers[0].connection.end).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled(); expect(f.run.retained).toBe(true);
  });

  it('同流被替换不借另一个已关闭流通过，不启动也不清除原线索', async () => {
    const f = fixture(); f.onQuery(async observer => { observer.connection.stream = { closed: true }; });
    await expect(f.run.launch()).rejects.toThrow('同流归属'); expect(f.launch).not.toHaveBeenCalled(); expect(f.observers[0].connection.end).not.toHaveBeenCalled(); expect(f.run.retained).toBe(true);
  });

  it('strict close原QUIT失败保持失败，不因随后stream关闭而启动', async () => {
    const f = fixture(); f.onConnect(async observer => { observer.connection.end.mockImplementation((done: (error: Error) => void) => done(Error('合成QUIT失败'))); observer.connection.destroy.mockImplementation(() => observer.connection.stream.destroy()); });
    await expect(f.run.launch()).rejects.toThrow('正常退出失败'); expect(f.observers[0].connection.end).toHaveBeenCalledOnce(); expect(f.launch).not.toHaveBeenCalled(); expect(f.run.retained).toBe(true); expect(f.removed).not.toHaveBeenCalled();
  });

  it('late launch先登记原应用与正PID，失效后不prepare、不退出、不删目录', async () => {
    const f = fixture(); f.onLaunch(async () => { f.invalidate(); });
    await expect(f.run.launch()).rejects.toThrow('授权已失效'); expect(f.run.owners).toHaveLength(1); expect([...f.run.owners[0].ids]).toEqual([101]); expect(f.applications[0].close).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled();
  });

  it('已返回应用的process读取失败仍登记原句柄，不丢掉未知启动资源', async () => {
    const f = fixture(); f.onLaunch(async application => { application.process = () => { throw Error('原SDK来源已失效'); }; });
    await expect(f.run.launch()).rejects.toThrow('SDK来源已失效'); expect(f.run.owners).toHaveLength(1); expect(f.run.owners[0].application).toBe(f.applications[0]); expect(f.applications[0].close).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled(); expect(f.run.retained).toBe(true);
  });

  it('上一owner未正常退出不能启动下一代；旧owner也不能操作新代', async () => {
    const f = fixture(), first = await f.run.launch(); await expect(f.run.launch()).rejects.toThrow('前次owner未正常退出'); expect(f.connect).toHaveBeenCalledOnce(); expect(f.run.retained).toBe(true);
    const g = fixture(), old = await g.run.launch(); await g.run.close(old); await g.run.launch(); const forbidden = vi.fn(async () => { throw Error('旧owner不得进入动作'); });
    await expect(g.run.step(old, forbidden)).rejects.toThrow('owner已失效'); expect(forbidden).not.toHaveBeenCalled(); expect(g.run.retained).toBe(true); expect(first.confirmed).toBe(false);
  });

  it.each(['main', 'renderer', 'page', 'public-exit'] as const)('%s来源漂移不能授权退出或清理，保留PID线索', async change => {
    const f = fixture(), owner = await f.run.launch(), app = f.applications[0];
    if (change === 'main') f.context.process.pid = 909;
    if (change === 'renderer') { app.window.webContents.getOSProcessId = () => 707; app.runtime.getAppMetrics = () => [{ pid: 202 }]; }
    if (change === 'page') app.page.url = () => 'file:///different.html';
    if (change === 'public-exit') owner.ready = true;
    await expect(f.run.close(owner)).rejects.toThrow(); expect(owner.confirmed).toBe(false); expect(app.close).not.toHaveBeenCalled(); expect(f.probe).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled(); expect(f.run.retained).toBe(true);
    if (change === 'main') expect(owner.ids.has(909)).toBe(true);
    if (change === 'renderer') expect(owner.ids.has(707)).toBe(true);
  });

  it('原生close早于willquit不能追认为正常退出', async () => {
    const f = fixture(), owner = await f.run.launch(); f.applications[0].runtime.quit = () => f.applications[0].emit('close');
    await expect(f.run.close(owner)).rejects.toThrow('未取得will-quit'); expect(owner.closed).toBe(true); expect(owner.ready).toBe(false); expect(owner.confirmed).toBe(false); expect(f.probe).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled();
  });

  it('PID探测EPERM不解释为不存在，原owner退出保持未确认', async () => {
    const f = fixture(), owner = await f.run.launch(); f.probe.mockImplementation(() => { throw Object.assign(Error('合成权限错误'), { code: 'EPERM' }); });
    await expect(f.run.close(owner)).rejects.toMatchObject({ code: 'EPERM' }); expect(owner.confirmed).toBe(false); expect(f.run.retained).toBe(true); expect(f.removed).not.toHaveBeenCalled();
  });

  it('清单批准字节在两代间变化，第二代不能重新签发身份或再连接', async () => {
    const f = fixture(), owner = await f.run.launch(); await f.run.close(owner); f.bytes.set(f.executable, Buffer.from('相同路径的替换程序'));
    await expect(f.run.launch()).rejects.toThrow('批准'); expect(f.launch).toHaveBeenCalledOnce(); expect(f.connect).toHaveBeenCalledOnce(); expect(f.run.retained).toBe(true);
  });

  it('目录链接或inode替换拒绝启动及删除，不借同路径确认身份', async () => {
    const f = fixture(); f.setDirectoryLink(); await expect(f.run.launch()).rejects.toThrow('目录归属未知'); expect(f.launch).not.toHaveBeenCalled();
    const g = fixture(), first = await g.run.launch(); await g.run.close(first); const second = await g.run.launch(); await g.run.close(second); g.replaceDirectory();
    await expect(g.run.finish()).rejects.toThrow('目录归属未知'); expect(g.removed).not.toHaveBeenCalled(); expect(g.run.removed).toBe(false);
  });

  it('remove目录检查await返回时已停链，不执行rm或补写清理成功', async () => {
    const f = fixture(), first = await f.run.launch(); await f.run.close(first); const second = await f.run.launch(); await f.run.close(second);
    const pause = f.pauseDirectory(2), operation = f.run.finish().catch(reason => reason); await pause.entered; f.invalidate(); pause.release();
    expect(await operation).toBeInstanceOf(Error); expect(f.removed).not.toHaveBeenCalled(); expect(f.run.removed).toBe(false); expect(f.run.retained).toBe(true);
  });
});
