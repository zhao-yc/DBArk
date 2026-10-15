import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { C02FixtureError, c02Config, c02Enabled, c02Failure, c02Names, c02OpenSslCommands, c02OwnsTables, c02OwnsUser, c02RootConfirmation, cleanupC02, type C02CleanupActions } from '../integration/helpers/c02-mtls-policy';

/** 仅提供虚构路径和占位值，不创建材料，不读取凭据，不建立数据库连接。 */
function environment(): NodeJS.ProcessEnv {
  return {
    DBARK_INTEGRATION_ENABLED: '1', DBARK_C02_MTLS_ENABLED: '1', DBARK_C02_ROOT_CONFIRM: c02RootConfirmation,
    DBARK_C02_HOST: '192.168.31.200', DBARK_C02_PORT: '13484', DBARK_C02_SERVER_UUID: '01234567-89ab-cdef-0123-456789abcdef',
    DBARK_C02_ADMIN_USER: '占位账号', DBARK_C02_ADMIN_PASSWORD: '占位口令',
    DBARK_C02_CA_PATH: join(process.cwd(), '不存在的CA.pem'), DBARK_C02_CA_KEY_PATH: join(process.cwd(), '不存在的CA-key.pem'), DBARK_C02_OPENSSL_PATH: join(process.cwd(), '不存在的openssl'),
  };
}

/** 自主动作只验证清理控制流，不把替身当成真实认证或真实资源清零证据。 */
function cleanupActions(): { actions: C02CleanupActions; calls: string[] } {
  const calls: string[] = [];
  const mark = (name: string) => vi.fn(async () => { calls.push(name); });
  return { calls, actions: { user: 'confirmed', database: 'confirmed', closeConnections: mark('close'), verifyThreadsGone: mark('verify'), dropUser: mark('dropUser'), dropDatabase: mark('dropDatabase'), closeAdmin: mark('closeAdmin'), removeTemporaryFiles: mark('removeFiles') } };
}

describe('C02 mTLS 默认关闭及目标门禁的纯检查', () => {
  it('关闭或只开一个开关时，在读取任何路径、凭据之前拒绝', () => {
    for (const flags of [{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_C02_MTLS_ENABLED: '1' }]) {
      const env = new Proxy(flags, { get(target, key) { if (!['DBARK_INTEGRATION_ENABLED', 'DBARK_C02_MTLS_ENABLED'].includes(String(key))) throw new Error('不应读取其它环境项'); return Reflect.get(target, key); } });
      expect(c02Enabled(env)).toBe(false); expect(() => c02Config(env)).toThrow('尚未显式启用');
    }
  });
  it.each(['13357', '13380', '13384', '13310', '13311', '3306', '013484'])('拒绝其它端口 %s，通用实库环境不能作为备用配置', port => {
    const env = environment(); env.DBARK_C02_PORT = port; env.DBARK_TEST_PORT = '13484';
    expect(() => c02Config(env)).toThrow('仅允许');
  });
  it('要求精确主机、ROOT标记与服务器 UUID，不接受域名或其它IP', () => {
    for (const [name, value] of [['DBARK_C02_HOST', 'deve-server.yinzon.com'], ['DBARK_C02_HOST', '127.0.0.1'], ['DBARK_C02_ROOT_CONFIRM', '1'], ['DBARK_C02_SERVER_UUID', '']]) {
      expect(() => c02Config({ ...environment(), [name]: value })).toThrow();
    }
    expect(c02Config(environment())).toMatchObject({ host: '192.168.31.200', port: 13484 });
  });
  it.each(['DBARK_C02_CA_PATH', 'DBARK_C02_CA_KEY_PATH', 'DBARK_C02_OPENSSL_PATH', 'DBARK_C02_TEMP_PARENT'])('显式 %s 拒绝相对路径与空字符', name => {
    for (const value of ['./相对路径.pem', join(process.cwd(), '坏\n路径')]) expect(() => c02Config({ ...environment(), [name]: value })).toThrow('绝对路径');
  });
  it('只允许 stdin 可表达的 CA 口令，不输出非法原值', () => {
    const secret = '勿输出\nCA私钥口令'; let error: unknown;
    try { c02Config({ ...environment(), DBARK_C02_CA_KEY_PASSPHRASE: secret }); } catch (reason) { error = reason; }
    expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain(secret);
  });
  it('拒绝注入后缀与范围外对象名', () => {
    expect(c02Names('012345abcdef')).toEqual({ user: 'cp_012345abcdef', account: "'cp_012345abcdef'@'%'", database: 'dbark_colperm_012345abcdef' });
    for (const value of ['root', '012345ABCDEF', '012345abcdef`', '012345abcdef/../']) expect(() => c02Names(value)).toThrow();
  });
  it('OpenSSL argv没有任何口令，固定一天/client扩展，不在 CA 目录创建序号文件', () => {
    const config = c02Config(environment()), files = { key: '/临时/client-key.pem', csr: '/临时/client.csr', cert: '/临时/client-cert.pem', config: '/临时/openssl.cnf' };
    const commands = c02OpenSslCommands(config, files, '012345abcdef', '0123456789abcdef0123456789abcdef');
    expect(commands[0]).toContain('-aes-256-cbc'); expect(commands[0].slice(-2)).toEqual(['-pass', 'stdin']);
    expect(commands[1]).toContain('stdin'); expect(commands[2]).toContain('stdin'); expect(commands[2]).toContain('-set_serial');
    expect(commands[2].slice(commands[2].indexOf('-days'), commands[2].indexOf('-days') + 2)).toEqual(['-days', '1']);
    expect(commands[2]).toContain('client_ext'); expect(commands.flat().join(' ')).not.toMatch(/pass:|env:|CAcreateserial|占位口令/);
  });
  it('脱敏错误保留原 errno/code 和因果层级，移除原消息、SQL、堆栈和附加属性', () => {
    const secret = '一次性私钥口令不能回显', raw = Object.assign(new Error(secret, { cause: Object.assign(new TypeError(secret), { code: 'ERR_OSSL_BAD_DECRYPT' }) }), { errno: 1045, code: 'ER_ACCESS_DENIED_ERROR', sql: `CREATE USER ${secret}`, password: secret });
    const safe = c02Failure('真实连接失败', raw), cause = safe.cause as Error;
    expect(cause).toMatchObject({ errno: 1045, code: 'ER_ACCESS_DENIED_ERROR', cause: { name: 'TypeError', code: 'ERR_OSSL_BAD_DECRYPT' } });
    expect(cause).not.toHaveProperty('sql'); expect(cause).not.toHaveProperty('password');
    expect(JSON.stringify(safe)).not.toContain(secret); expect(cause.stack).not.toContain(secret); expect((cause.cause as Error).stack).not.toContain(secret);
  });
  it('保留夹具自己的阶段说明，外部原文仍不进入 cause', () => {
    const safe = c02Failure('核心验收失败', c02Failure('真实建连失败', new Error('原始秘密')));
    expect((safe.cause as Error).message).toBe('真实建连失败'); expect(((safe.cause as Error).cause as Error).message).not.toContain('原始秘密');
    expect(c02Failure('清理失败', new C02FixtureError('所有权令牌不匹配')).cause).toMatchObject({ message: '所有权令牌不匹配' });
  });
  it('库已确认创建后也拒绝额外表、替换后的同名表、视图和错误令牌', () => {
    const owner = '0123456789abcdef0123456789abcdef', own = { name: 'subject', comment: `dbark-c02-owner:${owner}` };
    expect(c02OwnsTables([], owner)).toBe(true); expect(c02OwnsTables([own], owner)).toBe(true);
    for (const rows of [[own, own], [{ ...own, name: 'other' }], [{ ...own, comment: 'VIEW' }], [{ ...own, comment: '其它任务的表' }]]) expect(c02OwnsTables(rows, owner)).toBe(false);
    expect(c02OwnsTables([], '错误令牌')).toBe(false);
  });
  it('用户必须具有本次精确令牌；未知 CREATE 即使有令牌也由上层禁止 DROP', () => {
    const owner = '0123456789abcdef0123456789abcdef';
    expect(c02OwnsUser([{ owner }], owner)).toBe(true);
    for (const rows of [[], [{ owner: '其它任务' }], [{ owner }, { owner }]]) expect(c02OwnsUser(rows, owner)).toBe(false);
  });
});

describe('C02 mTLS 精确清理与未知结果的纯控制流', () => {
  it('先关闭和确认线程清零，再精确删用户/库，最后关观察连接和删本轮文件', async () => {
    const { actions, calls } = cleanupActions(); await cleanupC02(actions);
    expect(calls).toEqual(['close', 'verify', 'dropUser', 'dropDatabase', 'closeAdmin', 'removeFiles']);
  });
  it.each(['user', 'database'] as const)('%s CREATE结果未知时禁止对应DROP，其它已确认对象仍独立收尾', async kind => {
    const { actions } = cleanupActions(); actions[kind] = 'unknown';
    await expect(cleanupC02(actions)).rejects.toThrow('CREATE 结果未知');
    expect(kind === 'user' ? actions.dropUser : actions.dropDatabase).not.toHaveBeenCalled();
    expect(kind === 'user' ? actions.dropDatabase : actions.dropUser).toHaveBeenCalledOnce();
    expect(actions.removeTemporaryFiles).toHaveBeenCalledOnce();
  });
  it('线程未归零时不删除任何服务端资源，仍关观察连接及清临时文件', async () => {
    const { actions } = cleanupActions(), failed = new Error('残留线程'); actions.verifyThreadsGone = vi.fn(async () => { throw failed; });
    await expect(cleanupC02(actions)).rejects.toBe(failed); expect(actions.dropUser).not.toHaveBeenCalled(); expect(actions.dropDatabase).not.toHaveBeenCalled(); expect(actions.closeAdmin).toHaveBeenCalledOnce(); expect(actions.removeTemporaryFiles).toHaveBeenCalledOnce();
  });
  it('CREATE前发现碰撞或尚未尝试创建时，没有任何DROP', async () => {
    const { actions } = cleanupActions(); actions.user = 'absent'; actions.database = 'absent'; await cleanupC02(actions);
    expect(actions.dropUser).not.toHaveBeenCalled(); expect(actions.dropDatabase).not.toHaveBeenCalled();
  });
  it('保留原失败为首因；DROP或finally失败不重试，也不阻止后续独立收尾', async () => {
    const { actions } = cleanupActions(), first = new Error('最早真实失败'), drop = new Error('DROP结果未知'), final = new Error('文件删除失败');
    actions.dropUser = vi.fn(async () => { throw drop; }); actions.removeTemporaryFiles = vi.fn(async () => { throw final; });
    let caught: unknown; try { await cleanupC02(actions, first); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ cause: first, errors: [first, drop, final] }); expect(actions.dropUser).toHaveBeenCalledOnce(); expect(actions.dropDatabase).toHaveBeenCalledOnce(); expect(actions.closeAdmin).toHaveBeenCalledOnce();
  });
  it('关闭失败仍查线程；查证归零才允许删对象，并继续保留关闭失败', async () => {
    const { actions } = cleanupActions(), failed = new Error('关闭返回失败'); actions.closeConnections = vi.fn(async () => { throw failed; });
    await expect(cleanupC02(actions)).rejects.toBe(failed); expect(actions.dropUser).toHaveBeenCalledOnce(); expect(actions.dropDatabase).toHaveBeenCalledOnce();
  });
});
