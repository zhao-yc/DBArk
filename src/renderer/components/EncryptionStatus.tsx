import { zh } from '../locales/zh-CN';
import { ErrorBox } from './ui';

/** 未检测、检测中、真实可用/不可用分开显示；打开偏好设置不会自动探测系统密钥。 */
export function EncryptionStatus({ available, busy, error, onCheck }: { available: boolean | null; busy: boolean; error: string; onCheck(): Promise<void> }) {
  return <div className="full"><p className="muted small" role="status">{zh.app.text023}{busy ? zh.app.encryptionChecking : available === null ? zh.app.encryptionUnchecked : available ? zh.app.text024 : zh.app.text025}</p><button type="button" disabled={busy} onClick={() => void onCheck()}>{busy ? zh.app.encryptionChecking : zh.app.checkEncryption}</button><ErrorBox message={error}/></div>;
}
