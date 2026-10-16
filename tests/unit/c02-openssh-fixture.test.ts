import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join, resolve } from 'node:path';

const memory = vi.hoisted(() => ({ queries: [] as string[], closed: 0, database: '', user: '', marker: '', scope: '', injection: 'none', grantReads: 0, unknownCreate: false }));
// 所有数据库与材料端口均为内存替身；绝不读取/生成材料、读取当前env或建连。
vi.mock('../../src/engine/connection', () => ({
  connect: vi.fn(async () => ({ connection: { threadId: 900, destroy() {} }, close: async () => { memory.closed++; }, broken: false })),
  execute: vi.fn(async (_connection: unknown, source: string, params: unknown[] = []) => {
    memory.queries.push(source);
    if (source.startsWith('CREATE DATABASE')) { memory.database = source.match(/`([^`]+)`/)![1]; if (memory.unknownCreate) throw Error('纯合成CREATE未知'); }
    if (source.startsWith('INSERT INTO')) memory.marker = String(params[0]);
    if (source.startsWith('CREATE USER')) memory.user = source.match(/'([^']+)'/)![1];
    const tainted = () => memory.injection === 'initial' || memory.injection === 'after-use' && memory.grantReads >= 2 || memory.injection === 'cleanup' && memory.grantReads >= 3 || memory.injection === 'once' && memory.grantReads === 2 || memory.injection === 'failed-use' && memory.grantReads >= 2;
    let rows: unknown[] = [];
    if (source.startsWith('SELECT VERSION()')) rows = [{ version: '8.4.9', uuid: '11111111-2222-3333-4444-555555555555', roles: '' }];
    else if (source.startsWith('SELECT Process_priv')) rows = [{ allowed: 'Y' }];
    else if (source.startsWith('SELECT TABLE_SCHEMA')) {
      memory.grantReads++;
      if (memory.injection === 'read-failure' && memory.grantReads >= 2) throw Error('纯合成授权读取失败');
      rows = [{ db: memory.database, name: 'subject', privilege: 'SELECT', grantable: 'NO' }, ...(tainted() && memory.scope === 'TABLE' ? [{ db: memory.database, name: 'subject', privilege: 'UPDATE', grantable: 'NO' }] : [])];
    } else if (source.includes('information_schema.') && source.includes('_PRIVILEGES')) rows = tainted() && source.includes(`information_schema.${memory.scope}_PRIVILEGES`) ? [{ privilege: 'EXTRA' }] : [];
    else if (source.includes('mysql.role_edges')) rows = tainted() && memory.scope === 'ROLE' ? [{ value: 1 }] : [];
    else if (source.includes('information_schema.USER_ATTRIBUTES')) rows = [{ owner: memory.marker }];
    else if (source.startsWith('SELECT TABLE_NAME')) rows = [{ name: 'subject', comment: `dbark-c02-owner:${memory.marker}` }];
    return { rows };
  }),
}));
vi.mock('../integration/helpers/c02-openssh-materials', () => ({
  readC02OpenSshMaterials: vi.fn(async () => ({ manifest: { purpose: 'dbark-c02-openssh-v1', run: 'a'.repeat(32), user: 'c02_' + 'a'.repeat(12), port: 22384, fingerprint: 'SHA256:' + Buffer.alloc(32, 1).toString('base64').replace(/=+$/, ''), clientPublic: 'ssh-ed25519 YWJj dbark-c02-client' }, keyPath: '纯内存不读取', password: '纯合成', passphrase: '纯合成' })),
  readC02OpenSshProofRecord: vi.fn(async () => ({ purpose: 'dbark-c02-openssh-v1', run: 'a'.repeat(32), host: '192.168.31.200', hostname: '纯测试', machineHash: 'b'.repeat(64), socket: '1:2', daemon: '纯测试', container: 'c'.repeat(64), image: 'sha256:' + 'd'.repeat(64), port: 22384, fingerprint: 'SHA256:' + Buffer.alloc(32, 1).toString('base64').replace(/=+$/, ''), nonce: 'e'.repeat(32), checkedAt: Date.now(), restricted: true, openSshVersion: 'OpenSSH_10.2p1', maxSessions: 0 })),
}));
import { withC02OpenSshLease } from '../integration/helpers/c02-openssh-fixture';

/** 只注入合成参数；从不传process.env或读取真实Root身份。 */
function fakeEnv(): NodeJS.ProcessEnv {
  const directory = resolve('纯内存', 'dbark-c02-openssh-' + 'a'.repeat(32));
  return { DBARK_INTEGRATION_ENABLED: '1', DBARK_C02_OPENSSH_CORE_ENABLED: '1', DBARK_C02_OPENSSH_ROOT_CONFIRM: 'server-200/192.168.31.200/isolated-openssh', DBARK_C02_OPENSSH_CLIENT_DIR: directory, DBARK_C02_OPENSSH_PROOF_PATH: join(directory, 'server-proof.json'), DBARK_C02_OPENSSH_PROOF_NONCE: 'e'.repeat(32), DBARK_C02_OPENSSH_MACHINE_SHA256: 'b'.repeat(64), DBARK_C02_OPENSSH_SOCKET_ID: '1:2', DBARK_C02_OPENSSH_HOSTNAME: '纯测试', DBARK_C02_OPENSSH_DAEMON_ID: '纯测试', DBARK_C02_OPENSSH_DB_HOST: '192.168.31.200', DBARK_C02_OPENSSH_DB_PORT: '13384', DBARK_C02_OPENSSH_DB_UUID: '11111111-2222-3333-4444-555555555555', DBARK_C02_OPENSSH_ADMIN_USER: '纯合成', DBARK_C02_OPENSSH_ADMIN_PASSWORD: '纯合成非凭据' };
}
const drops = () => memory.queries.filter(source => source.startsWith('DROP '));
beforeEach(() => Object.assign(memory, { queries: [], closed: 0, database: '', user: '', marker: '', scope: '', injection: 'none', grantReads: 0, unknownCreate: false }));

describe('授权失效不可复位，精确归还不删除异常现场', () => {
  it('正常归还仍精确删除两个对象并严格关闭原管理者与独立观察者', async () => {
    const result = await withC02OpenSshLease(fakeEnv(), 'CORE', async lease => { expect(lease.serverPolicy).toEqual({ openSshVersion: 'OpenSSH_10.2p1', maxSessions: 0 }); });
    expect(result.databaseFixtureCleaned).toBe(true); expect(drops()).toEqual([`DROP USER '${memory.user}'@'%'`, `DROP DATABASE \`${memory.database}\``]); expect(memory.closed).toBe(2);
  });
  it.each(['TABLE', 'SCHEMA', 'COLUMN', 'USER', 'ROLE'])('初次或使用后观察到额外%s授权均零DROP', async scope => {
    for (const when of ['initial', 'after-use']) {
      memory.grantReads = 0; memory.queries = []; memory.closed = 0; memory.scope = scope; memory.injection = when;
      await expect(withC02OpenSshLease(fakeEnv(), 'CORE', async () => { if (when === 'initial') throw Error('不得进入使用回调'); })).rejects.toThrow('授权失效 true');
      expect(drops()).toEqual([]); expect(memory.closed).toBe(2);
    }
  });
  it.each(['TABLE', 'SCHEMA', 'COLUMN', 'USER', 'ROLE'])('最终删除门才出现额外%s授权也不得DROP', async scope => {
    memory.scope = scope; memory.injection = 'cleanup';
    await expect(withC02OpenSshLease(fakeEnv(), 'CORE', async () => {})).rejects.toThrow('授权失效 true'); expect(drops()).toEqual([]);
  });
  it('一度观察到额外权限，即便下一次读取可恢复也不能重置失效事实', async () => {
    memory.scope = 'TABLE'; memory.injection = 'once';
    await expect(withC02OpenSshLease(fakeEnv(), 'CORE', async () => {})).rejects.toThrow('授权失效 true'); expect(drops()).toEqual([]); expect(memory.grantReads).toBe(2);
  });
  it('普通认证/用例失败仍核权限后归还，而非一概放弃删除', async () => {
    await expect(withC02OpenSshLease(fakeEnv(), 'CORE', async () => { throw Error('纯合成认证阶段失败'); })).rejects.toThrow('未完成');
    expect(drops()).toHaveLength(2); expect(memory.grantReads).toBe(2); expect(memory.closed).toBe(2);
  });
  it.each(['TABLE', 'SCHEMA', 'COLUMN', 'USER', 'ROLE'])('用例失败也须核到额外%s权限并保留', async scope => {
    memory.scope = scope; memory.injection = 'failed-use';
    await expect(withC02OpenSshLease(fakeEnv(), 'CORE', async () => { throw Error('纯合成用例失败'); })).rejects.toThrow('授权失效 true'); expect(drops()).toEqual([]);
  });
  it('授权核验读取失败不能视为合法范围，且保留CREATE真实状态及精确对象', async () => {
    memory.injection = 'read-failure'; const error = await withC02OpenSshLease(fakeEnv(), 'CORE', async () => {}).catch(error => error);
    expect(error.message).toContain(`精确用户 ${memory.user}、库 ${memory.database}`); expect(error.message).toContain('用户 confirmed、库 confirmed'); expect(error.message).toContain('授权失效 true'); expect(drops()).toEqual([]);
  });
  it('CREATE结果未知仍零DROP，不重新发送CREATE', async () => {
    memory.unknownCreate = true;
    await expect(withC02OpenSshLease(fakeEnv(), 'CORE', async () => {})).rejects.toThrow('库 unknown'); expect(drops()).toEqual([]); expect(memory.queries.filter(source => source.startsWith('CREATE DATABASE'))).toHaveLength(1);
  });
});
