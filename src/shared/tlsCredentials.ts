/** 私钥口令按原字符保存，不trim；有界输入避免秘密经IPC或存储无限放大。 */
export const tlsPassphraseMaxLength = 1024;
export const tlsPassphraseMaxBytes = 1024;
export const tlsCredentialMessages = {
  invalid: 'TLS 私钥口令必须为文本，UTF-8编码不能超过1024字节',
  saveFailed: 'TLS 私钥口令加密保存失败，修改未保存',
  hidden: '[已隐藏的TLS私钥口令]',
  connectionFailed: 'TLS 连接失败，请核对客户端私钥和口令',
};

/** 先检查UTF-16长度再编码，避免超大输入为字节校验额外分配内存。 */
export function validTlsPassphrase(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string' && value.length <= tlsPassphraseMaxLength && new TextEncoder().encode(value).byteLength <= tlsPassphraseMaxBytes;
}
/** 主进程校验之外，存储和utility入口也拒绝越界秘密，错误不回显口令。 */
export function assertTlsPassphrase(value: unknown): asserts value is string | undefined {
  if (!validTlsPassphrase(value)) throw new Error(tlsCredentialMessages.invalid);
}
