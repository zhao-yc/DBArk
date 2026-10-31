import type { SslOptions } from 'mysql2';
import type { NetworkConnectionProfile } from '../shared/contracts';
import { assertTlsPassphrase, tlsCredentialMessages } from '../shared/tlsCredentials';

export type ConnectionTlsOptions = Pick<SslOptions, 'ca' | 'cert' | 'key' | 'passphrase' | 'rejectUnauthorized' | 'verifyIdentity'>;
/** 原生文件材料与文本口令保持分离；mysql2据此把口令送入Node TLS的真实SecureContext。 */
export function connectionTlsOptions(config: NetworkConnectionProfile['tls'], material: { ca?: Buffer; cert?: Buffer; key?: Buffer }): ConnectionTlsOptions | undefined {
  assertTlsPassphrase(config?.passphrase);
  return config?.enabled ? { rejectUnauthorized: config.rejectUnauthorized, verifyIdentity: config.rejectUnauthorized, ...material, passphrase: config.passphrase } : undefined;
}

/** 连接异常只公开脱敏消息，不携带可能保留口令的原异常属性、堆栈或cause。 */
export function tlsConnectionError(reason: unknown, passphrase: string | undefined): unknown {
  if (!passphrase) return reason;
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : tlsCredentialMessages.connectionFailed;
  return new Error(message.split(passphrase).join(tlsCredentialMessages.hidden));
}
