import { useRef, useState } from 'react';
import { queryBindingZh as t } from '../locales/queryBinding.zh-CN';
import { errorMessage } from '../lib';
import { UsageHelp, ErrorBox, Field, Modal, Spinner  } from './ui';

/** 两个动作分别明确命名；失败保留名称和旧来源，用户可改为另存。 */
export function QueryBindingDialog({ initialName, bound, onSave, onClose }: { initialName: string; bound: boolean; onSave(action: 'update' | 'create', name: string): Promise<void>; onClose(): void }) {
  const [name, setName] = useState(initialName), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef(false);
  /** 点击时捕获操作和名称，互斥一直持续到来源绑定及恢复状态处理结束。 */
  async function save(action: 'update' | 'create') {
    if (active.current) return;
    if (!name.trim()) { setError(t.empty); return; }
    active.current = true; setBusy(true); setError('');
    try { await onSave(action, name.trim()); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { active.current = false; setBusy(false); }
  }
  return <Modal title={t.title} onClose={() => { if (!active.current) onClose(); }}><div className="modal-content">
    <p className="muted small">{bound ? t.bound : t.unbound}</p><Field label={t.name}><input value={name} maxLength={256} disabled={busy} onChange={event => setName(event.target.value)}/></Field>
    <UsageHelp><p>{t.hint}</p></UsageHelp><ErrorBox message={error}/>
  </div><footer className="modal-footer">{busy && <Spinner/>}<button disabled={busy} onClick={onClose}>{t.cancel}</button><span className="grow"/>
    <button disabled={busy} onClick={() => void save('create')}>{t.create}</button>{bound && <button className="primary" disabled={busy} onClick={() => void save('update')}>{t.update}</button>}
  </footer></Modal>;
}
