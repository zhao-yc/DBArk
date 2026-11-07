import { useEffect, useRef, useState } from 'react';
import { fullQueryExportProfileLimits, type FullQueryExportDialect, type FullQueryExportOptions, type FullQueryExportProfile, type FullQueryExportProfileMutation } from '../../shared/fullQueryExportProfiles';
import { errorMessage, invoke } from '../lib';
import { fullQueryExportProfilesZh as text } from '../locales/fullQueryExportProfiles.zh-CN';
import { ErrorBox, Field } from './ui';

export function FullQueryExportProfiles({ dialect, options, disabled, onApply }: {
  dialect: FullQueryExportDialect;
  options?: FullQueryExportOptions;
  disabled: boolean;
  onApply(options: FullQueryExportOptions): boolean;
}) {
  const [profiles, setProfiles] = useState<FullQueryExportProfile[]>();
  const [selection, setSelection] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const writing = useRef(false);

  useEffect(() => {
    let active = true;
    void invoke('queryExportProfiles.list', { dialect }).then(result => {
      if (active) setProfiles(result);
    }).catch(reason => {
      if (active) setError(errorMessage(reason));
    });
    return () => { active = false; };
  }, [dialect, reload]);

  const selected = profiles?.find(item => item.name === selection);
  const blocked = disabled || saving || !profiles;
  const canSave = !blocked && !!options && !!name.trim();

  /** 只在主进程完成写盘后更新列表和回执，失败时保留方案及导出草稿。 */
  async function change(kind: FullQueryExportProfileMutation['kind']) {
    if (blocked || writing.current) return;
    const target = selected && { name: selected.name, revision: selected.revision };
    const profile = options && { name: name.trim(), options };
    let input: FullQueryExportProfileMutation;
    if (kind === 'delete' && target) input = { dialect, kind, selected: target };
    else if (kind === 'update' && target && profile?.name) input = { dialect, kind, selected: target, profile };
    else if (kind === 'add' && profile?.name) input = { dialect, kind, profile };
    else return;

    writing.current = true;
    setSaving(true); setError(''); setNotice('');
    try {
      setProfiles(await invoke('queryExportProfiles.mutate', input));
      const savedName = input.kind === 'delete' ? '' : input.profile.name;
      setSelection(savedName); setName(savedName);
      setNotice(input.kind === 'delete' ? text.deleted : text.saved);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { writing.current = false; setSaving(false); }
  }

  return <details>
    <summary>{text.title}</summary>
    <p className="muted small">{text.hint}</p>
    {!profiles && !error && <p>{text.loading}</p>}
    <Field label={text.select}><select aria-label={text.select} value={selected?.name ?? ''} disabled={blocked} onChange={event => {
      setSelection(event.target.value); setName(event.target.value); setError(''); setNotice('');
    }}>
      <option value="">{text.placeholder}</option>
      {profiles?.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
    </select></Field>
    <div className="inline-field">
      <button disabled={blocked || !selected} onClick={() => { if (selected && onApply(selected.options)) setNotice(text.applied); }}>{text.apply}</button>
      <button disabled={blocked || !selected} onClick={() => void change('delete')}>{text.delete}</button>
    </div>
    <Field label={text.name}><input value={name} maxLength={fullQueryExportProfileLimits.name} disabled={blocked}
      onChange={event => setName(event.target.value)}/></Field>
    <div className="inline-field">
      <button disabled={!canSave || (profiles?.length ?? 0) >= fullQueryExportProfileLimits.count} onClick={() => void change('add')}>{text.add}</button>
      <button disabled={!canSave || !selected} onClick={() => void change('update')}>{text.update}</button>
    </div>
    <p className="muted small" aria-live="polite">{notice}</p>
    <ErrorBox message={error}/>
    {error && <button disabled={disabled || saving} onClick={() => {
      setError(''); setProfiles(undefined); setSelection(''); setReload(value => value + 1);
    }}>{text.reload}</button>}
  </details>;
}
