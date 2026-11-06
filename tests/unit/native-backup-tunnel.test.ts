import { createConnection } from 'node:net';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { openNativeBackupTunnel } from '../../src/engine/nativeBackupTunnel';

describe('原生备份单次 SSH 回环转发', () => {
  it('关闭时取消正在建立的原通道，并等待原开通流程退出', async () => {
    let begin!: () => void;
    const started = new Promise<void>(resolve => { begin = resolve; });
    let release!: (channel: PassThrough) => void;
    const delayed = new Promise<PassThrough>(resolve => { release = resolve; });
    let cancelled = false;
    const channel = new PassThrough();
    const tunnel = await openNativeBackupTunnel('127.0.0.1', () => { begin(); return delayed; }, () => {
      cancelled = true;
      release(channel);
    });
    const client = createConnection(tunnel.port, tunnel.host);
    try {
      await started;
      await tunnel.close();
      expect(cancelled).toBe(true);
      expect(channel.destroyed).toBe(true);
      expect(tunnel.forwardingStarted).toBe(false);
    } finally { client.destroy(); await tunnel.close(); }
  });

  it('完成首个连接登记后拒绝第二个连接', async () => {
    const channel = new PassThrough();
    const tunnel = await openNativeBackupTunnel('127.0.0.1', async () => channel, () => {});
    const first = createConnection(tunnel.port, tunnel.host);
    try {
      const echoed = once(first, 'data');
      first.write('已转发');
      expect((await echoed)[0].toString()).toBe('已转发');
      expect(tunnel.forwardingStarted).toBe(true);
      const next = createConnection(tunnel.port, tunnel.host);
      try { await expect(once(next, 'connect')).rejects.toMatchObject({ code: 'ECONNREFUSED' }); }
      finally { next.destroy(); }
    } finally { first.destroy(); await tunnel.close(); }
  });
});
