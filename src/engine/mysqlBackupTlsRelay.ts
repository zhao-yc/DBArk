import { randomBytes } from 'node:crypto';
import { isIP, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { checkServerIdentity, connect, createSecureContext, TLSSocket, type SecureContextOptions } from 'node:tls';
import { readMysqlBackupHandshake, readMysqlBackupSslRequest } from './mysqlBackupHandshake';

const localHost = '127.0.0.1';

/** 私钥仅在引擎内存；原生工具只信任本任务的回环证书。该证书不用于上游验证。 */
export async function createMysqlBackupLoopbackIdentity() {
  await import('reflect-metadata');
  const { ExtendedKeyUsage, ExtendedKeyUsageExtension, PemConverter, SubjectAlternativeNameExtension, X509CertificateGenerator } =
    await import('@peculiar/x509');
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const keys = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const now = Date.now();
  const certificate = await X509CertificateGenerator.createSelfSigned({
    serialNumber: '01' + randomBytes(15).toString('hex'),
    name: 'CN=' + localHost, notBefore: new Date(now - 60_000), notAfter: new Date(now + 3_600_000),
    signingAlgorithm: algorithm, keys,
    extensions: [new SubjectAlternativeNameExtension([{ type: 'ip', value: localHost }]),
      new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth])],
  });
  const cert = certificate.toString('pem');
  const key = PemConverter.encode(await crypto.subtle.exportKey('pkcs8', keys.privateKey), 'PRIVATE KEY');
  return { cert, context: createSecureContext({ cert, key, minVersion: 'TLSv1.2' }) };
}

function waitForTls(socket: TLSSocket, event: 'secure' | 'secureConnect', signal: AbortSignal): Promise<void> {
  // 错误监听覆盖握手结束到转发器接管的间隙。预期错误由握手 Promise 对外汇报。
  socket.on('error', () => {});
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      signal.removeEventListener('abort', fail);
      socket.removeListener('error', fail);
      socket.removeListener('close', fail);
      socket.removeListener(event, ready);
      if (error) { socket.destroy(); reject(error); }
      else resolve();
    };
    const fail = () => finish(Error('备份 TLS 握手或数据库证书身份校验失败'));
    const ready = () => finish();
    socket.once('error', fail);
    socket.once('close', fail);
    socket.once(event, ready);
    signal.addEventListener('abort', fail, { once: true });
    if (signal.aborted || socket.destroyed) fail();
  });
}

/** MySQL 明文阶段只交换握手和 SSLRequest。上下游 TLS 都建立后才交付认证与转储字节。 */
export async function upgradeMysqlBackupTls(socket: Socket, channel: Duplex, options: {
  host: string; version: string; signal: AbortSignal; upstream: SecureContextOptions;
  local: Awaited<ReturnType<typeof createMysqlBackupLoopbackIdentity>>['context'];
}): Promise<{ local: TLSSocket; remote: TLSSocket }> {
  const { host, version, upstream, signal } = options;
  socket.write(await readMysqlBackupHandshake(channel, version, true, signal));
  const request = await readMysqlBackupSslRequest(socket, signal);
  signal.throwIfAborted();
  channel.write(request);
  // 使用 SSH 通道上的真实数据库地址校验证书，IP 只用于身份校验，不作为 SNI。
  const remote = connect({
    ...upstream, socket: channel, host, ...(isIP(host) ? {} : { servername: host }),
    minVersion: 'TLSv1.2', rejectUnauthorized: true, checkServerIdentity: (_name, cert) => checkServerIdentity(host, cert),
  });
  let local: TLSSocket | undefined;
  try {
    await waitForTls(remote, 'secureConnect', signal);
    local = new TLSSocket(socket, { isServer: true, secureContext: options.local });
    await waitForTls(local, 'secure', signal);
    return { local, remote };
  } catch (reason) {
    local?.destroy(); remote.destroy();
    throw reason;
  }
}
