import type { Duplex } from 'node:stream';

const clientSsl = 0x0800;

/** 在凭据经通道发送前，只检查协议版本、来源版本和 TLS 能力。保留原始握手字节给转储工具。 */
export function inspectMysqlBackupHandshake(channel: Duplex, version: string, tls: boolean): Promise<void> {
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
    }
    function fail() {
      cleanup();
      reject(Error('无法确认 SSH 转发的数据库版本或 TLS 能力'));
    }
    function read() {
      try {
        header ??= channel.read(4) as Buffer | undefined;
        if (!header) return;
        if (header.length !== 4 || header[3] !== 0) { fail(); return; }
        const length = header.readUIntLE(0, 3);
        if (length < 18 || length > 4096) { fail(); return; }
        const body = channel.read(length) as Buffer | null;
        if (!body) return;
        const end = body.indexOf(0, 1);
        if (body.length !== length || body[0] !== 10 || end < 2 || end + 16 > length) { fail(); return; }
        const source = body.toString('ascii', 1, end);
        const expected = version.includes('MariaDB') ? version.replace(/^5\.5\.5-/, '') : version;
        const actual = version.includes('MariaDB') ? source.replace(/^5\.5\.5-/, '') : source;
        if (actual !== expected || tls && !(body.readUInt16LE(end + 14) & clientSsl)) { fail(); return; }
        cleanup();
        channel.unshift(Buffer.concat([header, body]));
        resolve();
      } catch { fail(); }
    }
    channel.on('readable', read);
    channel.once('end', fail);
    channel.once('close', fail);
    channel.once('error', fail);
    read();
  });
}
