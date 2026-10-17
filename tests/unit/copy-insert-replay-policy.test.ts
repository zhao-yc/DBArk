import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { copyInsertReplayDatabase, copyInsertReplayEnabled, copyInsertReplayModes, copyInsertReplayProfile, assertCopyInsertReplayTables } from '../helpers/copyInsertReplayPolicy';
import { cleanupD02Copy } from '../integration/helpers/d02-copy-source-policy';

const owner = 'a'.repeat(32), tables = () => ['source', 'target'].map(name => ({ name, kind: 'BASE TABLE', comment: 'dbark-copy-insert-owner:' + owner }));
const env = (port = 13384): NodeJS.ProcessEnv => ({ DBARK_INTEGRATION_ENABLED: '1', DBARK_COPY_INSERT_REPLAY_ENABLED: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: String(port), DBARK_TEST_USER: '合成既有管理员', DBARK_TEST_PASSWORD: '仅内存替身', DBARK_TEST_TLS: port === 13484 ? '1' : '0', ...(port === 13484 ? { DBARK_TEST_CA: 'D:/合成原CA路径/ca.pem' } : {}) });

describe('复制INSERT实库回放准备门与保留策略（实际外部操作0）', () => {
  it.each([13357, 13380, 13384, 13310, 13311, 13484])('端口%s的双门四组合及列表均不触发配置读取', port => {
    for (const integration of ['0', '1']) for (const replay of ['0', '1']) {
      const source = { DBARK_INTEGRATION_ENABLED: integration, DBARK_COPY_INSERT_REPLAY_ENABLED: replay };
      const config = new Proxy(source, { get(target, key) { if (!(key in target)) throw Error('不准读取其它配置'); return target[key as keyof typeof target]; } });
      expect(copyInsertReplayEnabled(config, [])).toBe(integration === '1' && replay === '1');
      for (const argv of [['node', 'list'], ['node', '--list'], ['node', '--list=true']]) expect(copyInsertReplayEnabled(new Proxy({}, { get() { throw Error('列表不读任何环境'); } }), argv)).toBe(false);
    }
    const profile = copyInsertReplayProfile(env(port), '合成配置'); expect(profile.port).toBe(port); expect(profile.user).toBe('合成既有管理员');
  });
  it.each(['host', 'port', 'user', 'ssh', 'tls', 'ca', 'disabled'])('%s未准备时不接受profile', condition => {
    const value = env(13484);
    if (condition === 'host') value.DBARK_TEST_HOST = '127.0.0.1'; else if (condition === 'port') value.DBARK_TEST_PORT = '3306'; else if (condition === 'user') delete value.DBARK_TEST_USER; else if (condition === 'ssh') value.DBARK_TEST_SSH = '1'; else if (condition === 'tls') value.DBARK_TEST_TLS = '0'; else if (condition === 'ca') delete value.DBARK_TEST_CA; else value.DBARK_COPY_INSERT_REPLAY_ENABLED = '0';
    expect(() => copyInsertReplayProfile(value, '合成配置')).toThrow();
  });
  it('两个模式显式保留严格值校验，且只改独立会话', () => {
    expect(copyInsertReplayModes).toEqual([{ name: '普通模式', sqlMode: 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION' }, { name: 'ANSI_QUOTES与NO_BACKSLASH_ESCAPES', sqlMode: 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION,ANSI_QUOTES,NO_BACKSLASH_ESCAPES' }]);
  });
  it('只接受本轮12hex库和两个带令牌普通表，未知对象或注释漂移拒绝', () => {
    expect(copyInsertReplayDatabase('0123456789ab')).toBe('dbark_colperm_0123456789ab');
    for (const suffix of ['其它', 'a'.repeat(11), 'A'.repeat(12), 'a'.repeat(13)]) expect(() => copyInsertReplayDatabase(suffix)).toThrow();
    expect(() => assertCopyInsertReplayTables(tables(), owner)).not.toThrow();
    for (const changed of [[], [tables()[0]], [...tables(), { name: 'foreign', kind: 'BASE TABLE', comment: '' }], [tables()[0], tables()[0]], [{ ...tables()[0], kind: 'VIEW' }, tables()[1]], [{ ...tables()[0], comment: '其它归属' }, tables()[1]]]) expect(() => assertCopyInsertReplayTables(changed, owner)).toThrow('归属未知');
  });
  /** 直接复用已审清理器；假端口确认未知结果、关闭失败及归属拒绝都不能补DROP。 */
  function cleanupPort() {
    const calls: string[] = [], error = Error('合成首因');
    const actions = { user: 'absent' as const, database: 'confirmed' as 'confirmed' | 'unknown', closeConnections: vi.fn(async () => { calls.push('strict-close'); }), verifyThreadsGone: vi.fn(async () => { calls.push('threads-zero'); }), dropUser: vi.fn(async () => { calls.push('drop-user'); }), dropDatabase: vi.fn(async () => { calls.push('drop-owned'); }), closeAdmin: vi.fn(async () => { calls.push('strict-admin'); }), removeTemporaryFiles: vi.fn(async () => {}) };
    return { actions, calls, error };
  }
  it.each(['unknown-create', 'unknown-command', 'original', 'close', 'threads', 'owner'])('%s后禁止任何后续DROP，严格关闭观察连接', async condition => {
    const p = cleanupPort();
    if (condition === 'unknown-create') p.actions.database = 'unknown';
    if (condition === 'close') p.actions.closeConnections.mockRejectedValue(p.error);
    if (condition === 'threads') p.actions.verifyThreadsGone.mockRejectedValue(p.error);
    if (condition === 'owner') p.actions.dropDatabase.mockImplementation(async () => { throw p.error; });
    await expect(cleanupD02Copy(p.actions, condition === 'unknown-command', condition === 'original' ? p.error : undefined)).rejects.toThrow();
    expect(p.calls).not.toContain('drop-user'); expect(p.calls).not.toContain('drop-owned'); expect(p.actions.closeAdmin).toHaveBeenCalledTimes(1);
  });
  it('正常顺序严格关业务连接、线程清零、精确删本轮库、严格关观察连接', async () => {
    const p = cleanupPort(); await cleanupD02Copy(p.actions, false); expect(p.calls).toEqual(['strict-close', 'threads-zero', 'drop-owned', 'strict-admin']); expect(p.actions.dropUser).not.toHaveBeenCalled();
  });
  /** 从真实集成定义提取连接观察器，仅在RAM替换生产connect，验证新增strict边界。 */
  it.each(['closed', 'missing', 'changed', 'not-closed', 'close-error'])('实际连接观察器%s时必须保持strict和同一流证明', async condition => {
    const source = readFileSync(new URL('../integration/engine-copy-insert-replay.integration.test.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('integration.ts', source, ts.ScriptTarget.Latest, true);
    let factory = '';
    function visit(node: ts.Node) { if (ts.isCallExpression(node) && node.expression.getText(tree) === 'vi.mock') factory = node.arguments[1].getText(tree); ts.forEachChild(node, visit); }
    visit(tree); expect(factory).not.toBe('');
    const stream = { closed: false }, native = { stream: condition === 'missing' ? undefined : stream }, reason = Error('合成strict失败');
    const close = vi.fn(async () => { if (condition === 'close-error') throw reason; if (condition === 'changed') native.stream = { closed: true }; else if (condition !== 'not-closed') stream.closed = true; });
    const managed = { connection: native, close }, actualConnect = vi.fn(async () => managed), observed = { connections: new Set(), retain: false };
    const context = createContext({ observed, Error, importOriginal: async () => ({ connect: actualConnect }) });
    const patched = await runInContext(ts.transpileModule('(' + factory + ')(importOriginal)', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const result = await patched.connect('合成配置'); expect(actualConnect).toHaveBeenCalledExactlyOnceWith('合成配置'); expect(observed.connections.has(managed)).toBe(true);
    if (condition === 'closed') { await result.close(); expect(observed.retain).toBe(false); }
    else { const pending = result.close(); if (condition === 'close-error') await expect(pending).rejects.toBe(reason); else await expect(pending).rejects.toThrow(); expect(observed.retain).toBe(true); }
    if (condition === 'missing') expect(close).not.toHaveBeenCalled(); else expect(close).toHaveBeenCalledExactlyOnceWith({ strict: true });
  });
  it('真实命令观察器在等待中被保留后拒绝迟到成功，后续命令不发送', async () => {
    const source = readFileSync(new URL('../integration/engine-copy-insert-replay.integration.test.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('integration.ts', source, ts.ScriptTarget.Latest, true);
    let definition = '';
    function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'observe') definition = node.getText(tree); ts.forEachChild(node, visit); }
    visit(tree); expect(definition).not.toBe('');
    const observed = { retain: false }, context = createContext({ observed, pending: 0, failure: undefined, Error });
    runInContext(ts.transpileModule(definition, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    let finish!: (value: number) => void; const pending = new Promise<number>(resolve => { finish = resolve; });
    const request = context.observe(() => pending); expect(context.pending).toBe(1); observed.retain = true; finish(1);
    await expect(request).rejects.toThrow('停链'); expect(context.pending).toBe(0);
    const next = vi.fn(async () => 2); await expect(context.observe(next)).rejects.toThrow('保留现场'); expect(next).not.toHaveBeenCalled();
  });
});
