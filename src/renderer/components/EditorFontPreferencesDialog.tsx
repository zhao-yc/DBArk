import { useEffect, useRef, useState } from 'react';
import { editorFontLimits, isEditorFontSize, readEditorFontSize } from '../../shared/editorFont';
import { flushSettings, useWorkspace } from '../store';
import { editorFontZh as text } from '../locales/editorFont.zh-CN';
import { ErrorBox, Field, Modal } from './ui';

/** 仅暂存字号；显式保存时合并最新工作区，绝不携带打开弹窗时的SQL/标签快照。 */
export function EditorFontPreferencesDialog({ onClose }: { onClose(): void }) {
  const current = useWorkspace(state => readEditorFontSize(state.settings.editorFontSize));
  const [draft, setDraft] = useState(String(current)), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), closed = useRef(false), pending = useRef<object | undefined>(undefined);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current = undefined; }; }, []);
  /** 所有关闭先同步单向消费本弹窗权限；不等待React卸载，也不回滚已发出的保存。 */
  function close() {
    if (!alive.current || closed.current) return;
    closed.current = true; pending.current = undefined;
    onClose();
  }
  /** 只修改一个偏好并复用既有持久化；回包不回写settings，不覆盖保存期间的新正文/标签。 */
  async function save() {
    if (!alive.current || closed.current || pending.current) return;
    const value = draft.trim() ? Number(draft) : NaN;
    if (!isEditorFontSize(value)) { setError(text.invalid); return; }
    const token = {}; pending.current = token; setSaving(true); setError('');
    try {
      // 同步状态通知也可能结束弹窗；合并字号前再核本次领取权限。
      if (!alive.current || closed.current || pending.current !== token) return;
      useWorkspace.getState().updateSettings({ editorFontSize: value });
      await flushSettings();
      if (alive.current && !closed.current && pending.current === token) close();
    } catch { if (alive.current && !closed.current && pending.current === token) setError(text.failed); }
    finally { if (alive.current && !closed.current && pending.current === token) { pending.current = undefined; setSaving(false); } }
  }
  return <Modal title={text.title} onClose={close}><div className="modal-content form-grid">
    <p className="full" role="status">{text.current(current)}</p><Field label={text.field} full><input aria-label={text.field} type="number" min={editorFontLimits.min} max={editorFontLimits.max} step="1" value={draft} disabled={saving} onChange={event => { setDraft(event.target.value); setError(''); }}/></Field>
    <p className="full muted small">{text.hint}</p><button type="button" disabled={saving} onClick={() => { setDraft(String(editorFontLimits.defaultSize)); setError(''); }}>{text.reset}</button><p className="full muted small">{text.draft}</p><div className="full"><ErrorBox message={error}/></div>
  </div><footer className="modal-footer"><button type="button" onClick={close}>{text.cancel}</button><span className="grow"/><button type="button" className="primary" disabled={saving} onClick={() => void save()}>{saving ? text.saving : text.save}</button></footer></Modal>;
}
