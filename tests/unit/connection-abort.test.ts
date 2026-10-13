import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from '../../src/shared/contracts';
const mocks = vi.hoisted(() => ({ create: vi.fn(), ssh: vi.fn() }));
vi.mock('mysql2', () => ({ default: { createConnection: mocks.create } }));
vi.mock('ssh2', () => ({ Client: mocks.ssh }));
import { connect } from '../../src/engine/connection';
const profile: ConnectionProfile = { id: 'c', name: '取消建连', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'test' };
beforeEach(() => { mocks.create.mockReset(); mocks.ssh.mockReset(); });
describe('建连阶段的真实取消边界', () => {
  it('取消发生在入口前，不创建网络资源', async () => { const controller = new AbortController(); controller.abort(); await expect(connect(profile, undefined, controller.signal)).rejects.toThrow('取消'); expect(mocks.create).not.toHaveBeenCalled(); });
  it('mysql握手没有回调时取消也能结束等待并销毁底层流', async () => {
    let callback!: Function;
    const connection = { connect: vi.fn(done => { callback = done; }), destroy: vi.fn(), stream: { destroy: vi.fn() }, query: vi.fn() };
    mocks.create.mockReturnValue(connection); const controller = new AbortController();
    const pending = connect(profile, undefined, controller.signal); const failure = expect(pending).rejects.toThrow('取消'); controller.abort(); await failure;
    expect(connection.destroy).toHaveBeenCalled(); expect(connection.stream.destroy).toHaveBeenCalled(); callback(null); expect(connection.query).not.toHaveBeenCalled();
  });
  it('SSH转发迟到的channel立即销毁，不创建迟到mysql连接', async () => {
    let forward!: Function;
    const ssh = Object.assign(new EventEmitter(), { connect: vi.fn(), destroy: vi.fn(), forwardOut: vi.fn((...args: unknown[]) => { forward = args.at(-1) as Function; }) });
    mocks.ssh.mockImplementation(function () { return ssh; }); const controller = new AbortController();
    const pending = connect({ ...profile, ssh: { enabled: true, host: 'ssh.invalid', port: 22, user: 'test', hostFingerprint: 'SHA256:test' } }, undefined, controller.signal); const failure = expect(pending).rejects.toThrow('取消');
    ssh.emit('ready'); await vi.waitFor(() => expect(forward).toBeDefined()); controller.abort(); await failure;
    const channel = { destroy: vi.fn() }; forward(null, channel); expect(channel.destroy).toHaveBeenCalledOnce(); expect(ssh.destroy).toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
});
