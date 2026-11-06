import type { Duplex } from 'node:stream';

const clientSsl = 0x0800;

function readMysqlHandshakePacket(channel: Duplex, sequence: number, min: number, max: number, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let header: Buffer | undefined;
    const timer = setTimeout(fail, 15_000);
    timer.unref();
    function cleanup() {
      clearTimeout(timer);
      channel.removeListener('readable', read);
      channel.removeListener('end', fail);
      channel.removeListener('close', fail);
      channel.removeListener('error', fail);
      signal?.removeEventListener('abort', fail);
    }
    function fail() {
      cleanup();
      reject(Error('备份握手未收到完整的预期报文'));
    }
    function read() {
      try {
        header ??= channel.read(4) as Buffer | undefined;
        if (!header) return;
        if (header.length !== 4 || header[3] !== sequence) { fail(); return; }
        const length = header.readUIntLE(0, 3);
        if (length < min || length > max) { fail(); return; }
        const body = channel.read(length) as Buffer | null;
        if (!body) return;
        if (body.length !== length) { fail(); return; }
        cleanup();
        resolve(Buffer.concat([header, body]));
      } catch { fail(); }
    }
    channel.on('readable', read);
    channel.once('end', fail);
    channel.once('close', fail);
    channel.once('error', fail);
    signal?.addEventListener('abort', fail, { once: true });
    if (channel.destroyed || channel.readableEnded || signal?.aborted) fail();
    else read();
  });
}

/** 在凭据经通道发送前，固定协议版本、来源版本和 TLS 能力，保留原始握手字节。 */
export async function readMysqlBackupHandshake(channel: Duplex, version: string, tls: boolean, signal?: AbortSignal): Promise<Buffer> {
  const packet = await readMysqlHandshakePacket(channel, 0, 18, 4096, signal);
  const body = packet.subarray(4), end = body.indexOf(0, 1);
  const fail = () => Error('无法确认 SSH 转发的数据库版本或 TLS 能力');
  if (body[0] !== 10 || end < 2 || end + 16 > body.length) throw fail();
  const source = body.toString('ascii', 1, end);
  const canonical = (value: string) => version.includes('MariaDB') ? value.replace(/^5\.5\.5-/, '') : value;
  if (canonical(source) !== canonical(version) || tls && !(body.readUInt16LE(end + 14) & clientSsl)) throw fail();
  return packet;
}

export async function inspectMysqlBackupHandshake(channel: Duplex, version: string, tls: boolean): Promise<void> {
  let packet: Buffer;
  try { packet = await readMysqlBackupHandshake(channel, version, tls); }
  catch { throw Error('无法确认 SSH 转发的数据库版本或 TLS 能力'); }
  channel.unshift(packet);
}

/** 只转发不含用户名和密码的 4.1 SSLRequest，拒绝任何明文认证报文。 */
export async function readMysqlBackupSslRequest(channel: Duplex, signal: AbortSignal): Promise<Buffer> {
  const packet = await readMysqlHandshakePacket(channel, 1, 32, 32, signal);
  const protocol41 = 0x0200, required = clientSsl | protocol41;
  if ((packet.readUInt32LE(4) & required) !== required) throw Error('转储工具未请求 MySQL TLS');
  return packet;
}
