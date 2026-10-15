/** 私钥口令按原字符保存，不trim；有界输入避免秘密经IPC或存储无限放大。 */
export const tlsPassphraseMaxLength = 1024;
export const tlsPassphraseMaxBytes = 1024;
export const tlsCredentialMessages = {
  invalid: 'TLS 私钥口令必须为有效 Unicode 文本，UTF-8编码不能超过1024字节',
  saveFailed: 'TLS 私钥口令加密保存失败，修改未保存',
  hidden: '[已隐藏的TLS私钥口令]',
  connectionFailed: 'TLS 连接失败，请核对客户端私钥和口令',
};

/** 先限制长度并线性检查UTF-16配对，拒绝UTF-8编码会静默替换的孤立代理项；不改写原字符。 */
export function validTlsPassphrase(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  if (typeof value !== 'string' || value.length > tlsPassphraseMaxLength) return false;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index++; // 有效高低代理对整体保留，下一轮不能把其中低位误判为孤立项。
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return new TextEncoder().encode(value).byteLength <= tlsPassphraseMaxBytes;
}
/** 主进程校验之外，存储和utility入口也拒绝越界秘密，错误不回显口令。 */
export function assertTlsPassphrase(value: unknown): asserts value is string | undefined {
  if (!validTlsPassphrase(value)) throw new Error(tlsCredentialMessages.invalid);
}
