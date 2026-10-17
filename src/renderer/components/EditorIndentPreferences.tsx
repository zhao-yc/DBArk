import { useEffect, useRef, useState } from 'react';
import { editorIndentationLimits, isEditorTabSize, readEditorInsertSpaces, readEditorTabSize } from '../../shared/editorIndentation';
import { flushSettings, useWorkspace } from '../store';
import { editorIndentationZh as text } from '../locales/editorIndentation.zh-CN';
import { ErrorBox, Field, Modal } from './ui';

/** 独立的缩进入口，仅向App报告模态变化，不重写字号或换行入口。 */
export function EditorIndentPreferences({ onVisibilityChange }: { onVisibilityChange(): void }) {
  const [open, setOpen] = useState(false);
  /** 沿用工作台模态门，开启/关闭均让原导航意图失效。 */
  function show() { if (document.querySelector('[role="dialog"]')) return; onVisibilityChange(); setOpen(true); }
  return <><button type="button" onClick={show}>{text.entry}</button>{open && <IndentDialog onClose={() => { onVisibilityChange(); setOpen(false); }}/>}</>;
}

/** 只暂存两个缩进字段；保存时合并当前store，不携带打开时的SQL或标签快照。 */
function IndentDialog({ onClose }: { onClose(): void }) {
  const width = useWorkspace(state => readEditorTabSize(state.settings.editorTabSize));
  const spaces = useWorkspace(state => readEditorInsertSpaces(state.settings.editorInsertSpaces));
  const [draftWidth, setDraftWidth] = useState(String(width)), [draftStyle, setDraftStyle] = useState(spaces ? 'spaces' : 'tabs');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), closed = useRef(false), pending = useRef<object | undefined>(undefined);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current = undefined; }; }, []);
  /** 关闭权限同步消费，旧保存回调及迟到回包不能关闭后来打开的弹窗。 */
  function close() { if (!alive.current || closed.current) return; closed.current = true; pending.current = undefined; onClose(); }
  /** 两字段一次合并与持久化；回包只更新本弹窗状态，从不还原旧settings。 */
  async function save() {
    if (!alive.current || closed.current || pending.current) return;
    const value = draftWidth.trim() ? Number(draftWidth) : NaN;
    if (!isEditorTabSize(value) || !['spaces', 'tabs'].includes(draftStyle)) { setError(text.invalid); return; }
    const token = {}; pending.current = token; setSaving(true); setError('');
    try {
      useWorkspace.getState().updateSettings({ editorTabSize: value, editorInsertSpaces: draftStyle === 'spaces' });
      await flushSettings();
      if (alive.current && !closed.current && pending.current === token) close();
    } catch { if (alive.current && !closed.current && pending.current === token) setError(text.failed); }
    finally { if (alive.current && !closed.current && pending.current === token) { pending.current = undefined; setSaving(false); } }
  }
  return <Modal title={text.title} onClose={close}><div className="modal-content form-grid">
    <p className="full" role="status">{text.current(width, spaces)}</p>
    <Field label={text.width}><input aria-label={text.width} type="number" min={editorIndentationLimits.min} max={editorIndentationLimits.max} step="1" value={draftWidth} disabled={saving} onChange={event => { setDraftWidth(event.target.value); setError(''); }}/></Field>
    <Field label={text.style}><select aria-label={text.style} value={draftStyle} disabled={saving} onChange={event => { setDraftStyle(event.target.value); setError(''); }}><option value="spaces">{text.spaces}</option><option value="tabs">{text.tabs}</option></select></Field>
    <p className="full muted small">{text.hint}</p><button type="button" disabled={saving} onClick={() => { setDraftWidth(String(editorIndentationLimits.defaultTabSize)); setDraftStyle('spaces'); setError(''); }}>{text.reset}</button><p className="full muted small">{text.draft}</p><div className="full"><ErrorBox message={error}/></div>
  </div><footer className="modal-footer"><button type="button" onClick={close}>{text.cancel}</button><span className="grow"/><button type="button" className="primary" disabled={saving} onClick={() => void save()}>{saving ? text.saving : text.save}</button></footer></Modal>;
}
