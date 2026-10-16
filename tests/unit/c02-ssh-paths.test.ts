import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep, win32 } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { c02SshCanonicalPaths } from '../integration/helpers/c02-ssh-paths';
import { c02SshAssertSeparatePaths } from '../integration/helpers/c02-ssh-policy';

const connection = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => connection);
// 默认委托真实文件系统，仅四个对象替换故障用例临时覆盖lstat返回；ESM内置模块不能spyOn。
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

const cache = resolve('.cache');
let root: string, keyPath: string, identity: string, outside: string;

/** 只在本克隆生成普通文本与目录；从不使用真实身份、环境或网络。 */
beforeEach(async () => {
  vi.clearAllMocks();
  await mkdir(cache, { recursive: true });
  root = await mkdtemp(join(cache, 'c02-ssh-paths-'));
  identity = join(root, 'identity'); outside = join(root, 'outside'); keyPath = join(identity, 'not-a-key.txt');
  await mkdir(identity); await mkdir(outside); await writeFile(keyPath, '仅用于路径检查的普通文本');
});

/** 删除目标固定为本例新建的直接子目录，先核绝对边界，junction目标也都在本例目录内。 */
afterEach(async () => {
  const target = resolve(root), child = relative(cache, target);
  assert.equal(dirname(target), cache);
  assert.ok(child && !child.includes(sep) && /^c02-ssh-paths-[A-Za-z0-9]+$/.test(basename(target)));
  await rm(target, { recursive: true, force: false });
});

/** Windows用junction验证真实祖先解析；其它平台使用目录符号链接。 */
async function alias(target: string, name: string): Promise<string> {
  const path = join(root, name);
  await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');
  return path;
}

/** 管理连接会被本地桩明确拒绝，测试只能证明拒绝之前的路径门，不模拟认证成功。 */
function environment(key: string, parent: string): NodeJS.ProcessEnv {
  return { DBARK_INTEGRATION_ENABLED: '1', DBARK_C02_SSH_UI_ENABLED: '1', DBARK_C02_SSH_ROOT_CONFIRM: 'server-200/192.168.31.200/c02-ssh', DBARK_C02_SSH_ALIAS: 'server-200', DBARK_C02_SSH_HOST: '192.168.31.200', DBARK_C02_SSH_DB_HOST: '192.168.31.200', DBARK_C02_SSH_DB_PORT: '13384', DBARK_C02_SSH_PORT: '22', DBARK_C02_SSH_USER: '虚构用户', DBARK_C02_SSH_KEY_MODE: 'existing-unencrypted', DBARK_C02_SSH_KEY_PATH: key, DBARK_C02_SSH_TEMP_PARENT: parent, DBARK_C02_SSH_HOST_SHA256: 'SHA256:' + Buffer.alloc(32, 7).toString('base64').replace(/=+$/, ''), DBARK_C02_SSH_ADMIN_USER: '虚构账号', DBARK_C02_SSH_ADMIN_PASSWORD: '虚构口令', DBARK_C02_SSH_DB_UUID: '01234567-89ab-cdef-0123-456789abcdef' };
}

describe('C02 SSH 实际身份目录隔离', () => {
  it('放行独立普通父目录并返回规范实际路径', async () => {
    expect(await c02SshCanonicalPaths({ keyPath, tempParent: outside })).toEqual({ keyPath: await realpath(keyPath), tempParent: await realpath(outside) });
  });
  it.each(['', 'temporary', '..ordinary-child'])('拒绝同一身份目录或任意子目录：%s', async child => {
    const parent = child ? join(identity, child) : identity;
    await mkdir(parent, { recursive: true });
    await expect(c02SshCanonicalPaths({ keyPath, tempParent: parent })).rejects.toThrow('原身份目录');
  });
  it('拒绝祖先junction绕过，末级仍是普通文件和普通目录', async () => {
    const parent = join(identity, 'temporary'); await mkdir(parent);
    const path = join(await alias(identity, 'identity-alias'), 'temporary');
    expect((await lstat(path)).isSymbolicLink()).toBe(false);
    expect((await lstat(keyPath)).isFile()).toBe(true);
    await expect(c02SshCanonicalPaths({ keyPath, tempParent: path })).rejects.toThrow('原身份目录');
  });
  it('拒绝身份路径自身的祖先别名指向实际临时目录的父级', async () => {
    const path = join(await alias(identity, 'identity-alias'), 'not-a-key.txt');
    const parent = join(identity, 'temporary'); await mkdir(parent);
    await expect(c02SshCanonicalPaths({ keyPath: path, tempParent: parent })).rejects.toThrow('原身份目录');
  });
  it('拒绝身份与临时目录分经两个祖先别名落入同一实际身份目录', async () => {
    const key = join(await alias(identity, 'key-alias'), 'not-a-key.txt');
    await mkdir(join(identity, 'nested')); const parent = join(await alias(identity, 'parent-alias'), 'nested');
    await expect(c02SshCanonicalPaths({ keyPath: key, tempParent: parent })).rejects.toThrow('原身份目录');
  });
  it('拒绝多级祖先链接内的身份子目录', async () => {
    await mkdir(join(identity, 'nested', 'temporary'), { recursive: true });
    const first = await alias(identity, 'first'), second = await alias(first, 'second');
    await expect(c02SshCanonicalPaths({ keyPath, tempParent: join(second, 'nested', 'temporary') })).rejects.toThrow('原身份目录');
  });
  it('放行独立临时目录祖先别名，userData实际创建在已核对的父目录', async () => {
    const temporary = join(outside, 'temporary'); await mkdir(temporary);
    const parent = join(await alias(outside, 'outside-alias'), 'temporary');
    const paths = await c02SshCanonicalPaths({ keyPath, tempParent: parent });
    expect(paths.tempParent).toBe(await realpath(temporary));
    const created = await mkdtemp(join(paths.tempParent, 'dbark-c02-ui-'));
    expect(dirname(await realpath(created))).toBe(paths.tempParent);
    expect(relative(await realpath(identity), await realpath(created)).startsWith(`..${sep}`)).toBe(true);
  });
  it('放行身份祖先别名与独立临时目录，并返回实际身份路径', async () => {
    const key = join(await alias(identity, 'key-alias'), 'not-a-key.txt');
    expect(await c02SshCanonicalPaths({ keyPath: key, tempParent: outside })).toEqual({ keyPath: await realpath(keyPath), tempParent: await realpath(outside) });
  });
  it('放行名称共享前缀的兄弟目录', async () => {
    const parent = join(root, 'identity-other'); await mkdir(parent);
    expect((await c02SshCanonicalPaths({ keyPath, tempParent: parent })).tempParent).toBe(await realpath(parent));
  });
  it('末级临时目录junction仍被拒绝，不因指向独立目录而放行', async () => {
    const parent = await alias(outside, 'final-alias');
    await expect(c02SshCanonicalPaths({ keyPath, tempParent: parent })).rejects.toThrow('不是普通目录');
  });
  it('身份目录冒充文件、临时普通文件及不存在路径均拒绝', async () => {
    await expect(c02SshCanonicalPaths({ keyPath: identity, tempParent: outside })).rejects.toThrow('不是普通文件');
    await expect(c02SshCanonicalPaths({ keyPath, tempParent: keyPath })).rejects.toThrow('不是普通目录');
    await expect(c02SshCanonicalPaths({ keyPath, tempParent: join(root, 'absent') })).rejects.toThrow('元数据核对失败');
  });
  it.each([['身份inode', 'key', 'ino'], ['身份设备', 'key', 'dev'], ['临时目录inode', 'parent', 'ino'], ['临时目录设备', 'parent', 'dev']] as const)('解析后%s变化时拒绝', async (_, object, field) => {
    const key = await lstat(keyPath), parent = await lstat(outside), original = object === 'key' ? key : parent;
    const changed = Object.assign(Object.create(Object.getPrototypeOf(original)), original, { [field]: original[field] + 1 });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const spy = vi.mocked(lstat).mockResolvedValueOnce(key).mockResolvedValueOnce(parent).mockResolvedValueOnce(object === 'key' ? changed : key).mockResolvedValueOnce(object === 'parent' ? changed : parent);
    try { await expect(c02SshCanonicalPaths({ keyPath, tempParent: outside })).rejects.toThrow('对象身份发生变化'); }
    finally { spy.mockReset(); spy.mockImplementation(actual.lstat); }
  });
  it('危险祖先别名在首次建连与回调前被拒绝', async () => {
    const { withC02SshLease } = await import('../integration/helpers/c02-ssh-fixture');
    await mkdir(join(identity, 'temporary')); const parent = join(await alias(identity, 'identity-alias'), 'temporary');
    const callback = vi.fn(async () => {});
    await expect(withC02SshLease(environment(keyPath, parent), callback)).rejects.toThrow('原身份目录');
    expect(connection.connect).not.toHaveBeenCalled(); expect(connection.execute).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
  });
  it('安全身份别名在建连入口已转换实际路径，桩明确失败后不执行SQL或UI', async () => {
    const { withC02SshLease } = await import('../integration/helpers/c02-ssh-fixture');
    const key = join(await alias(identity, 'key-alias'), 'not-a-key.txt'), callback = vi.fn(async () => {});
    connection.connect.mockRejectedValueOnce(new Error('本地测试拒绝建连'));
    await expect(withC02SshLease(environment(key, outside), callback)).rejects.toThrow('C02 SSH 失败');
    expect(connection.connect).toHaveBeenCalledTimes(1);
    expect(connection.connect.mock.calls[0][0].ssh.privateKeyPath).toBe(await realpath(keyPath));
    expect(connection.execute).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
  });
});

describe('C02 SSH Windows路径规则（各平台均检查纯路径）', () => {
  it.each(['C:\\IDENTITY', 'c:\\Identity\\nested', 'C:\\identity\\..ordinary-child'])('拒绝大小写不同的同目录及子目录：%s', parent => {
    expect(() => c02SshAssertSeparatePaths('C:\\identity\\not-a-key.txt', parent, win32)).toThrow('原身份目录');
  });
  it.each(['C:\\identity-other', 'C:\\', 'D:\\identity\\temporary', 'C:\\outside\\..ordinary-child'])('放行兄弟、父目录、跨盘及独立..子名前缀：%s', parent => {
    expect(() => c02SshAssertSeparatePaths('C:\\identity\\not-a-key.txt', parent, win32)).not.toThrow();
  });
});
