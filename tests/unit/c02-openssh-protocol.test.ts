import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const port = vi.hoisted(() => ({ forward: 1 as number | undefined, exec: 2 as number | undefined, sftp: 2 as number | undefined, message: '普通合成连接错误', messageAt: '', errorAt: '', closeAt: '', calls: [] as string[] }));
// 只替换SSH协议端口；不读取key、打开socket或执行命令。通道错误形状来自固定ssh2源码。
vi.mock('ssh2', () => ({ Client: class extends EventEmitter {
  connect() { port.calls.push('认证就绪'); queueMicrotask(() => this.emit('ready')); return this; }
  reject(name: 'forward' | 'exec' | 'sftp', done: (error?: Error) => void) {
    port.calls.push(name);
    if (port.errorAt === name) this.emit('error', Error('纯合成传输失败'));
    if (port.closeAt === name) this.emit('close');
    done(port[name] === undefined ? undefined : Object.assign(Error(port.messageAt === name ? port.message : '(SSH) Channel open failure: 纯合成拒绝'), { reason: port[name] }));
  }
  forwardOut(_a: string, _b: number, _c: string, _d: number, done: (error?: Error) => void) { this.reject('forward', done); }
  exec(_text: string, done: (error?: Error) => void) { this.reject('exec', done); }
  sftp(done: (error?: Error) => void) { this.reject('sftp', done); }
  end() { port.calls.push('关闭'); this.emit('close'); }
  destroy() { this.emit('close'); }
} }));

import { verifyC02OpenSshChannels } from '../integration/helpers/c02-openssh-protocol';
const profile = { ssh: { enabled: true, host: '仅内存不建连', port: 22384, user: '仅合成', password: '仅合成' } } as Parameters<typeof verifyC02OpenSshChannels>[0];
const policy = { openSshVersion: 'OpenSSH_10.2p1', maxSessions: 0 } as const;
beforeEach(() => Object.assign(port, { forward: 1, exec: 2, sftp: 2, message: '普通合成连接错误', messageAt: '', errorAt: '', closeAt: '', calls: [] }));

describe('固定OpenSSH版本按通道类型验证拒绝，不计真实互通', () => {
  it('受禁转发1、exec/SFTP开session为2才逐项通过，同一认证连接严格关闭', async () => {
    await expect(verifyC02OpenSshChannels(profile, policy)).resolves.toBeUndefined();
    expect(port.calls).toEqual(['认证就绪', 'forward', 'exec', 'sftp', '关闭']);
  });
  it.each([2, 3, 4, undefined])('转发错误%j不得冒充管理策略拒绝', async value => {
    port.forward = value; await expect(verifyC02OpenSshChannels(profile, policy)).rejects.toThrow('转发目标'); expect(port.calls).not.toContain('exec');
  });
  it.each(['exec', 'sftp'] as const)('%s的错误原因1不得冒充固定MaxSessions=0拒绝', async name => {
    port[name] = 1; await expect(verifyC02OpenSshChannels(profile, policy)).rejects.toThrow(name === 'exec' ? 'shell/exec' : 'SFTP');
  });
  it.each(['exec', 'sftp'] as const)('%s已开通或普通网络错误附带reason2均失败', async name => {
    port[name] = undefined; await expect(verifyC02OpenSshChannels(profile, policy)).rejects.toThrow(name === 'exec' ? 'shell/exec' : 'SFTP');
    port[name] = 2; port.messageAt = name; await expect(verifyC02OpenSshChannels(profile, policy)).rejects.toThrow(name === 'exec' ? 'shell/exec' : 'SFTP');
  });
  it.each(['exec', 'sftp'] as const)('%s回正确原因但同一传输已报错或关闭仍失败', async name => {
    port.errorAt = name; await expect(verifyC02OpenSshChannels(profile, policy)).rejects.toThrow();
    port.errorAt = ''; port.closeAt = name; await expect(verifyC02OpenSshChannels(profile, policy)).rejects.toThrow();
  });
  it('缺少实际固定版本或MaxSessions证明时，构造SSH客户端前拒绝', async () => {
    await expect(verifyC02OpenSshChannels(profile, { ...policy, maxSessions: 1 } as never)).rejects.toThrow('策略证明');
    await expect(verifyC02OpenSshChannels(profile, { ...policy, openSshVersion: '其它版本' } as never)).rejects.toThrow('策略证明');
    expect(port.calls).toEqual([]);
  });
});
