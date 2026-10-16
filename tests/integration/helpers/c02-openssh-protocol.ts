import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'ssh2';
import type { ConnectionProfile } from '../../../src/shared/contracts';
import { withC02UiLifetime } from './c02-mtls-policy';
import { c02OpenSshCheck as check } from './c02-openssh-policy';

/** 后续实际OpenSSH协议边界：只连接本片新账号，不用agent、命令行ssh或现有Root身份。 */
export async function verifyC02OpenSshChannels(profile: ConnectionProfile): Promise<void> {
  const config = profile.ssh!, client = new Client(); let closed = false;
  client.on('close', () => { closed = true; }); client.on('error', () => {});
  const privateKey = config.privateKeyPath ? await readFile(config.privateKeyPath) : undefined;
  const budget = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => { client.destroy(); reject(Error('C02通道边界步骤超时，不能计为策略拒绝')); }, 15000); })]); }
    finally { clearTimeout(timer); }
  };
  // 复用首因与关闭失败聚合器；这个纯Node协议入口不会启动任何UI。
  await withC02UiLifetime(async () => {
    await budget(new Promise<void>((resolve, reject) => {
      client.once('ready', resolve); client.once('error', reject);
      client.connect({ host: config.host, port: config.port, username: config.user, password: config.password, privateKey, passphrase: config.passphrase, readyTimeout: 15000, hostVerifier: (key: Buffer) => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '') === config.hostFingerprint });
    }));
    // 只请求本隔离容器的loopback:13384。若配置错误，也不会探测宿主其它服务或其它DB端口。
    const forwardDenied = await budget(new Promise<boolean>(resolve => client.forwardOut('127.0.0.1', 0, '127.0.0.1', 13384, (error, stream) => { stream?.close(); resolve((error as Error & { reason?: number } | undefined)?.reason === 1); })));
    check(forwardDenied && !closed, 'C02转发目标不是明确的管理策略拒绝');
    const sessionDenied = await budget(new Promise<boolean>(resolve => client.exec('/bin/false', (error, stream) => { stream?.close(); resolve((error as Error & { reason?: number } | undefined)?.reason === 1); })));
    check(sessionDenied && !closed, 'C02shell/exec会话未在开通道时被拒绝');
    const sftpDenied = await budget(new Promise<boolean>(resolve => client.sftp(error => resolve((error as Error & { reason?: number } | undefined)?.reason === 1))));
    check(sftpDenied && !closed, 'C02SFTP会话未在开通道时被拒绝');
  }, async () => {
    if (closed) return;
    await budget(new Promise<void>(resolve => { client.once('close', resolve); client.end(); }));
  });
}
