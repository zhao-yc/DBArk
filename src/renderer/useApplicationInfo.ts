import { useEffect, useRef, useState } from 'react';
import { errorMessage, invoke } from './lib';
import { zh } from './locales/zh-CN';

interface InformationScope { live: boolean; checking: boolean; }

/** 启动只取元信息；检测结果只归原挂载代次，永远不控制LocalStore真实保护器。 */
export function useApplicationInfo(fallbackVersion: string) {
  const current = useRef<InformationScope | undefined>(undefined);
  const [version, setVersion] = useState(fallbackVersion), [platform, setPlatform] = useState('win32');
  const [runtimeError, setRuntimeError] = useState('');
  const [encryptionAvailable, setEncryptionAvailable] = useState<boolean | null>(null);
  const [checkingEncryption, setCheckingEncryption] = useState(false), [encryptionError, setEncryptionError] = useState('');
  const active = (scope: InformationScope) => scope.live && current.current === scope;

  useEffect(() => {
    const scope: InformationScope = { live: true, checking: false }; current.current = scope;
    // StrictMode重建后不能沿用旧检测的busy、成功值或失败消息。
    setCheckingEncryption(false); setEncryptionAvailable(null); setEncryptionError(''); setRuntimeError('');
    void invoke('app.runtimeInfo', {}).then(info => {
      if (!active(scope)) return;
      setVersion(info.version); setPlatform(info.platform);
    }).catch(reason => { if (active(scope)) setRuntimeError(zh.app.runtimeInfoFailed + errorMessage(reason)); });
    return () => { scope.live = false; if (current.current === scope) current.current = undefined; };
  }, []);

  /** 同步busy锁先于IPC；旧请求只能结束自己，不能释放新挂载的锁或发布迟到结果。 */
  async function checkEncryption() {
    const scope = current.current; if (!scope || !active(scope) || scope.checking) return;
    scope.checking = true; setCheckingEncryption(true); setEncryptionAvailable(null); setEncryptionError('');
    try {
      const info = await invoke('app.info', {});
      if (!active(scope)) return;
      if (!info || typeof info.encryptionAvailable !== 'boolean') throw Error(zh.app.encryptionCheckInvalid);
      setEncryptionAvailable(info.encryptionAvailable);
    } catch (reason) {
      if (active(scope)) { setEncryptionAvailable(null); setEncryptionError(zh.app.encryptionCheckFailed + errorMessage(reason)); }
    } finally {
      scope.checking = false;
      if (active(scope)) setCheckingEncryption(false);
    }
  }

  return { version, platform, runtimeError, encryptionAvailable, checkingEncryption, encryptionError, checkEncryption };
}
