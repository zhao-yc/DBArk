import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { createContext, runInContext } from 'node:vm';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { ConnectionTransfer } from '../../src/main/connectionTransfer';
import { ConnectionConfigManager } from '../../src/main/connectionConfig';
import { LocalStore } from '../../src/main/storage';
import { revokeConnectionFiles, resolveFileToken } from '../../src/main/fileTokens';
import { connectionReplacementText } from '../../src/shared/connectionTransferMessages';
import { connectionReplacementAcknowledgements } from '../../src/shared/connectionTransfer';
import { validateCommand } from '../../src/shared/validation';
import type { Command, ConnectionProfile } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';

const io = vi.hoisted(() => ({ connect: vi.fn(), tableInfo: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: io.connect, execute: vi.fn() }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: io.tableInfo }));
import { Engine } from '../../src/engine';

const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
const original: ConnectionProfile = { id: 'local-target', name: '本机原目标', group: '', color: '#123456', dialect: 'mysql', host: 'original.invalid', port: 3306, user: 'user', password: '合成旧凭据', rememberPassword: false };
let directory: string, store: LocalStore, engine: Engine, context: ReturnType<typeof createContext>;
let request: ReturnType<typeof vi.fn>;

/** 只替换驱动端口，Engine的真实活动登记、prepareSave及主进程事务处理器全部执行。 */
function managed(): ManagedConnection { return { profile: original, connection: new EventEmitter(), status: { dialect: 'mysql', version: '合成版本' }, close: vi.fn(async () => undefined) } as unknown as ManagedConnection; }

/** 从AST抽生产分派/文件操作函数和实际Manager构造配置，不能另写更宽松的活动守卫。 */
function mainFixture() {
  const text = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('main.ts', text, ts.ScriptTarget.Latest, true);
  const functions: string[] = []; let manager = '';
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && ['dispatch', 'queryFileOperation', 'validateMainCommand'].includes(node.name?.text ?? '')) functions.push(node.getText(tree));
    if (ts.isNewExpression(node) && node.expression.getText(tree) === 'ConnectionConfigManager') manager = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); if (!manager || functions.length !== 3) throw Error('缺少生产处理器');
  request = vi.fn((command: string, input: unknown) => engine.handle(command as Parameters<Engine['handle']>[0], input as never));
  const port = createContext({
    // 未打开结果写入用途时的真实初始空协调器，不登记任务、预览或写入能力。
    resultInserts: { observe() {}, invalidateConnection(_connectionId: string) {}, engineExited() {}, has: (_taskId: string) => false },
     Error, Date, Map, Set, ConnectionConfigManager, revokeConnectionFiles, connectionReplacementText, resolveFileToken, validateCommand, store, broker: { request },
    shuttingDown: false, rendererSettingsCurrent: true, rendererHasSettings: true, stateFlushed: undefined,
    sessions: new Map(), preparingTasks: new Map(), structureTokens: new Map(), tasks: new Map(), completionTasks: new Set(), pendingQueryHistory: new Map(), exportProgress: new Map(), structureProgress: new Map(), files: new Map(), queryFileOperations: new Set(),
  });
  runInContext(ts.transpileModule(functions.join('\n') + '\nglobalThis.connectionConfig=' + manager + ';globalThis.handlers={dispatch,validateMainCommand};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, port);
  port.connectionTransfer = new ConnectionTransfer(store, Date.now, undefined, port.connectionConfig);
  return port;
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'dbark-c03-main-')); store = await LocalStore.open(join(directory, 'local.sqlite'), wasm, { available: () => false, encrypt: () => '', decrypt: value => value }); store.saveConnection(original);
  io.connect.mockReset().mockImplementation(async () => managed()); io.tableInfo.mockReset(); engine = new Engine(); context = mainFixture();
});
/** 本用例只关闭合成Engine资源；清理限定唯一非链接临时目录。 */
afterEach(async () => {
  await engine.closeAll(); store.close(); const actual = resolve(directory), info = lstatSync(actual);
  if (info.isSymbolicLink() || !info.isDirectory() || dirname(actual) !== resolve(tmpdir()) || !/^dbark-c03-main-[a-zA-Z0-9]+$/.test(basename(actual)) || dirname(realpathSync(actual)) !== realpathSync(tmpdir())) throw Error('拒绝清理非本例目录');
  rmSync(actual, { recursive: true, force: true });
});
async function dispatch(command: Command, input: unknown): Promise<any> { return context.handlers.dispatch(command, context.handlers.validateMainCommand(command, input)); }
async function ready() {
  const source = join(directory, 'source.json');
  writeFileSync(source, JSON.stringify({ format: 'DBArk-connections', version: 1, connections: [{ id: 'source', name: '新端点', group: '', color: '#abcdef', dialect: 'mysql', host: 'new.invalid', port: 3307, user: 'fresh' }] }));
  context.files.set('import', { path: source, purpose: 'connection-import', format: 'json' });
  const preview = await dispatch('connections.importPreview', { fileToken: 'import' });
  const decisions = [{ sourceId: 'source', action: 'replace', targetId: original.id }];
  const review = await dispatch('connections.importReview', { previewToken: preview.previewToken, decisions });
  return { previewToken: preview.previewToken, decisions, confirmationToken: review.confirmationToken, acknowledgements: [...connectionReplacementAcknowledgements], allowIncomplete: true };
}

describe('C03真实主进程及Engine活动事实', () => {
  it('真实处理器仅做离线存储替换并提升原修订，清除旧结构令牌，不开启驱动连接', async () => {
    const input = await ready(), revision = store.connectionRevision(); context.structureTokens.set('old-structure', { connectionId: original.id, expires: Date.now() + 100000, kind: 'preview', purpose: 'tableAutoIncrement' });
    context.structureTokens.set('unrelated', { connectionId: 'other', expires: Date.now() + 100000, kind: 'preview', purpose: 'tableAutoIncrement' });
    await expect(dispatch('connections.importApply', input)).resolves.toMatchObject({ replaced: 1, replacementIds: [original.id] });
    expect(store.resolveConnection(original.id)).toMatchObject({ host: 'new.invalid', rememberPassword: false }); expect(store.resolveConnection(original.id).password).toBeUndefined(); expect(store.connectionRevision()).toBe(revision + 1);
    expect(io.connect).not.toHaveBeenCalled(); expect(request.mock.calls.map(([command]) => command)).toEqual(['__connections.prepareSave']);
    expect(context.structureTokens.has('old-structure')).toBe(false); expect(context.structureTokens.has('unrelated')).toBe(true); expect(context.queryFileOperations.size).toBe(0);
  });

  it.each(['标签', '主进程会话', '准备中长任务', '标签事实保存失败'])('%s存在时以主进程事实拒绝，不依赖渲染busy且不自动关闭/取消', async channel => {
    const input = await ready(), before = readFileSync(join(directory, 'local.sqlite'));
    if (channel === '标签') store.saveSettings({ ...store.settings(), tabs: [{ id: 'tab', kind: 'table', title: '未运行表标签', connectionId: original.id, database: 'db', table: 't' }] });
    if (channel === '主进程会话') context.sessions.set('session', { connectionId: original.id });
    if (channel === '准备中长任务') context.preparingTasks.set('task', { cancelled: false, connectionIds: [original.id] });
    if (channel === '标签事实保存失败') { const fail = vi.spyOn(store, 'saveSettings').mockImplementationOnce(() => { throw Error('合成布局写盘失败'); }); await expect(dispatch('settings.save', store.settings())).rejects.toThrow('合成布局写盘失败'); fail.mockRestore(); expect(context.rendererSettingsCurrent).toBe(false); }
    await expect(dispatch('connections.importApply', input)).rejects.toThrow('打开的标签'); expect(request).not.toHaveBeenCalled(); expect(io.connect).not.toHaveBeenCalled(); expect(store.resolveConnection(original.id).host).toBe('original.invalid');
    if (channel !== '标签') expect(readFileSync(join(directory, 'local.sqlite'))).toEqual(before);
    await expect(dispatch('connections.importApply', input)).rejects.toThrow('预览已失效');
  });

  it('引擎有真实打开会话而主进程会话表为空时仍拒绝，保留会话与旧秘密', async () => {
    await engine.handle('connections.open', { id: original.id, profile: store.resolveConnection(original.id) }); const session = await engine.handle('sessions.open', { connectionId: original.id });
    const input = await ready(), opened = io.connect.mock.calls.length;
    await expect(dispatch('connections.importApply', input)).rejects.toThrow('打开的会话'); expect(context.sessions.size).toBe(0); expect(io.connect).toHaveBeenCalledTimes(opened);
    expect(store.resolveConnection(original.id).password).toBe(original.password); await expect(engine.handle('query.sessionState', { sessionId: session.sessionId })).resolves.toBeDefined();
    expect(request.mock.calls.map(([command]) => command)).toEqual(['__connections.prepareSave']);
  });

  it('真实Engine建连登记在首个await前；尚未入会话表的活动也拒绝替换，不取消连接', async () => {
    let finish!: (value: ManagedConnection) => void; io.connect.mockImplementationOnce(() => new Promise<ManagedConnection>(resolve => { finish = resolve; }));
    const opening = engine.handle('connections.test', original), input = await ready();
    await expect(dispatch('connections.importApply', input)).rejects.toThrow('正在执行'); expect(store.resolveConnection(original.id).password).toBe(original.password);
    const connection = managed(); finish(connection); await opening; expect(connection.close).toHaveBeenCalledOnce(); expect(request.mock.calls.map(([command]) => command)).toEqual(['__connections.prepareSave']);
  });

  it('主进程检查等待时新标签已保存也令替换失败，配置锁在解析旧凭据前阻断新建连', async () => {
    const input = await ready(); let finish!: () => void; request.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const replacing = dispatch('connections.importApply', input); expect(context.queryFileOperations.size).toBe(1);
    const resolveSecret = vi.spyOn(store, 'resolveConnection'); await expect(dispatch('connections.open', { id: original.id })).rejects.toThrow('正在保存'); expect(resolveSecret).not.toHaveBeenCalled(); resolveSecret.mockRestore();
    await dispatch('settings.save', { ...store.settings(), tabs: [{ id: 'new-tab', kind: 'query', title: '实际新标签', connectionId: original.id }] }); finish();
    await expect(replacing).rejects.toThrow('打开的标签'); expect(store.resolveConnection(original.id).host).toBe('original.invalid'); expect(context.queryFileOperations.size).toBe(0); expect(() => context.connectionConfig.assertAvailable(original.id)).not.toThrow();
  });
  it('标签清单校验失败也撤销空闲依据；成功保存完整当前清单后才允许重新预览替换', async () => {
    const input = await ready(); await expect(dispatch('settings.save', { ...store.settings(), unknown: true })).rejects.toThrow(); expect(context.rendererSettingsCurrent).toBe(false);
    await expect(dispatch('connections.importApply', input)).rejects.toThrow('打开的标签'); expect(request).not.toHaveBeenCalled();
    await dispatch('settings.save', store.settings()); expect(context.rendererSettingsCurrent).toBe(true); const fresh = await ready(); await expect(dispatch('connections.importApply', fresh)).resolves.toMatchObject({ replaced: 1 });
  });
});
