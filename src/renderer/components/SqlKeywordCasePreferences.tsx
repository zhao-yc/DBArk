import { useEffect, useRef, useState } from 'react';
import { defaultSqlKeywordCase, readSqlKeywordCase } from '../../shared/sqlKeywordCase';
import { flushSettings, useWorkspace } from '../store';
import { sqlFormattingZh as text } from '../locales/sqlFormatting.zh-CN';
import { ErrorBox, Field } from './ui';

/** 集中在原全局偏好弹窗；草稿、恢复默认和取消都不触碰已有模型或SQL。 */
export function SqlKeywordCasePreferences() {
  const current = useWorkspace(state => readSqlKeywordCase(state.settings.sqlKeywordCase));
  const [draft, setDraft] = useState<string>(current), [saving, setSaving] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const alive = useRef(true), pending = useRef<object | undefined>(undefined);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current = undefined; }; }, []);
  /** 只合并这一字段，沿原settings队列落盘；迟到回包不能更新新弹窗或还原旧SQL。 */
  async function save() {
    if (!alive.current || pending.current) return;
    if (draft !== 'preserve' && draft !== 'upper' && draft !== 'lower') { setError(text.invalidPreference); return; }
    const token = {}; pending.current = token; setSaving(true); setError(''); setSaved(false);
    try {
      useWorkspace.getState().updateSettings({ sqlKeywordCase: draft }); await flushSettings();
      if (alive.current && pending.current === token) setSaved(true);
    } catch { if (alive.current && pending.current === token) setError(text.preferenceFailed); }
    finally { if (alive.current && pending.current === token) { pending.current = undefined; setSaving(false); } }
  }
  /** 改草稿不触发store、自动保存、编辑器或格式化。 */
  function change(value: string) { setDraft(value); setError(''); setSaved(false); }
  return <section className="full" aria-label={text.preferences}>
    <h3>{text.preferences}</h3><Field label={text.keywordCase}><select aria-label={text.keywordCase} value={draft} disabled={saving} onChange={event => change(event.target.value)}><option value="preserve">{text.preserve}</option><option value="upper">{text.upper}</option><option value="lower">{text.lower}</option></select></Field>
    <p className="muted small">{text.preferenceHint}</p><p className="muted small">{text.resetHint}</p>
    <button type="button" disabled={saving} onClick={() => change(defaultSqlKeywordCase)}>{text.reset}</button><button type="button" disabled={saving} onClick={() => change(current)}>{text.cancelDraft}</button><button type="button" disabled={saving} onClick={() => void save()}>{saving ? text.saving : text.save}</button>
    {saved && <p role="status">{text.saved}</p>}<ErrorBox message={error}/>
  </section>;
}
