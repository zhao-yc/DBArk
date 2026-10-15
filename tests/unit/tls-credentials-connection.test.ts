import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from '../../src/shared/contracts';
const boundary = vi.hoisted(() => ({ create: vi.fn() }));
// 这里只验证真实connect失败边界不泄密；成功解密及真实mysql2初始化另由无mock的engine套件验证。
vi.mock('mysql2', () => ({ default: { createConnection: boundary.create } }));
import { connect } from '../../src/engine/connection';
const profile: ConnectionProfile = { id: 'c', name: 'TLS失败边界', group: '', color: '#123456', dialect: 'mysql', host: 'no-network.invalid', port: 1, user: 'test', tls: { enabled: true, rejectUnauthorized: true, passphrase: '仅失败边界TLS测试值' } };
beforeEach(() => { boundary.create.mockReset(); });
describe('正式utility连接选项与失败脱敏', () => {
  it('真实connect把独立口令交给ssl，失败消息和cause不会带回该秘密', async () => {
    boundary.create.mockImplementation(() => { throw new Error('驱动失败 ' + profile.tls!.passphrase, { cause: { passphrase: profile.tls!.passphrase } }); });
    let failure: any; try { await connect(profile); } catch (error) { failure = error; }
    expect(boundary.create.mock.calls[0][0].ssl.passphrase === profile.tls?.passphrase).toBe(true);
    expect(failure).toBeInstanceOf(Error); expect(String(failure).includes(profile.tls!.passphrase!)).toBe(false); expect(failure).not.toHaveProperty('cause');
  });
  it('越界口令在创建任何连接前拒绝，不回显值或调用驱动', async () => {
    await expect(connect({ ...profile, tls: { ...profile.tls!, passphrase: 'x'.repeat(1025) } })).rejects.toThrow('不能超过'); expect(boundary.create).not.toHaveBeenCalled();
  });
});
