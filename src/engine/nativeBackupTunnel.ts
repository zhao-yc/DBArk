import { createServer, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

/** 一次只接纳一个本地客户端，首个连接登记后即撤销监听，转发目标由原 SSH 会话固定。 */
export async function openNativeBackupTunnel(host: '127.0.0.1' | '::1', openChannel: () => Promise<Duplex>,
  cancelOpening: () => void, inspect?: (channel: Duplex) => Promise<void>) {
  let local: Socket | undefined, remote: Duplex | undefined, opening: Promise<void> | undefined;
  let closing: Promise<void> | undefined, stopping = false, failed = false, forwardingStarted = false;
  const stopListening = () => closing ??= new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  const server = createServer({ pauseOnConnect: true }, socket => {
    if (local || stopping) { socket.destroy(); return; }
    local = socket;
    void stopListening().catch(() => socket.destroy());
    socket.on('error', () => remote?.destroy());
    socket.once('close', () => remote?.destroy());
    opening = (async () => {
      try {
        const channel = remote = await openChannel();
        channel.on('error', () => socket.destroy());
        channel.once('close', () => socket.destroy());
        if (stopping || socket.destroyed) { channel.destroy(); return; }
        await inspect?.(channel);
        if (stopping || socket.destroyed) { channel.destroy(); return; }
        forwardingStarted = true;
        socket.pipe(channel).pipe(socket);
        socket.resume();
      } catch {
        failed = !stopping;
        socket.destroy();
        remote?.destroy();
      }
    })();
  });
  server.on('error', () => { failed = !stopping; local?.destroy(); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port: 0, host, ...(host === '::1' ? { ipv6Only: true } : {}) }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await stopListening();
    throw Error('备份 SSH 回环端口未建立');
  }
  return {
    host, port: address.port,
    get failed() { return failed; },
    get forwardingStarted() { return forwardingStarted; },
    async close() {
      stopping = true;
      local?.destroy();
      remote?.destroy();
      if (opening && !remote) cancelOpening();
      await Promise.all([stopListening(), opening]);
    },
  };
}
