import { useRef, useState } from 'react';
import type { SavedQueryOrganizationSnapshot, SavedQueryOrganizationOperation } from '../../shared/savedQueryOrganization';
import { savedQueryOrganizationLimits } from '../../shared/savedQueryOrganization';
import { previewSavedQueryOrganization, savedQueryOrganizationTree, type SelectedSavedQuery, type SavedQueryOrganizationPreview } from '../savedQueryOrganizationUi';
import { savedQueryOrganizationZh as text } from '../locales/savedQueryOrganization.zh-CN';
import { ErrorBox, UsageHelp } from './ui';
import { errorMessage } from '../lib';

export interface SavedQueryOrganizationEdit { kind: SavedQueryOrganizationOperation['kind']; id?: string; }
interface Props { snapshot: SavedQueryOrganizationSnapshot; edit: SavedQueryOrganizationEdit; selected: readonly SelectedSavedQuery[]; busy: boolean; onConfirm(preview: SavedQueryOrganizationPreview): void; onCancel(): void; }

/** 独立草稿先完整规划再确认；旧预览、旧props及A→B→A编辑均不能再次提交。 */
export function SavedQueryOrganizationEditor({ snapshot, edit, selected, busy, onConfirm, onCancel }: Props) {
  const group = snapshot.groups.find(item => item.id === edit.id), [name, setName] = useState(edit.kind === 'create' ? '' : group?.name ?? ''), [parent, setParent] = useState(edit.kind === 'create' ? edit.id ?? '' : group?.parentId ?? ''), [preview, setPreview] = useState<SavedQueryOrganizationPreview>(), [error, setError] = useState('');
  const original = useRef({ snapshot, edit, selected }), activePreview = useRef<SavedQueryOrganizationPreview | undefined>(undefined), confirmed = useRef(false);
  const current = () => original.current.snapshot === snapshot && original.current.edit === edit && original.current.selected === selected;
  if (!current()) activePreview.current = undefined;
  /** 每次草稿变化同步撤销旧预览，确认永远只使用已展示的冻结补丁。 */
  function change(action: () => void) { if (busy || !current() || confirmed.current) return; activePreview.current = undefined; setPreview(undefined); setError(''); action(); }
  function prepare() {
    if (busy || !current() || confirmed.current) return;
    try {
      let operation: SavedQueryOrganizationOperation;
      if (edit.kind === 'create') operation = { kind: 'create', name, parentId: parent || null };
      else if (edit.kind === 'rename') operation = { kind: 'rename', id: edit.id!, name };
      else if (edit.kind === 'moveGroup') operation = { kind: 'moveGroup', id: edit.id!, parentId: parent || null };
      else if (edit.kind === 'dissolve') operation = { kind: 'dissolve', id: edit.id! };
      else operation = { kind: 'moveQueries', queries: selected.map(({ id, digest }) => ({ id, digest })), groupId: parent || null };
      const next = previewSavedQueryOrganization(snapshot, operation); activePreview.current = next; setPreview(next); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  const title = text[edit.kind], tree = savedQueryOrganizationTree(snapshot);
  return <section className="saved-query-organization-editor" role="group" aria-label={title}><h3>{title}</h3><UsageHelp><p>{text.metadataOnly}</p></UsageHelp>
    {(edit.kind === 'create' || edit.kind === 'rename') && <label>{text.groupName}<input aria-label={text.groupName} maxLength={savedQueryOrganizationLimits.name} disabled={busy} value={name} onChange={event => change(() => setName(event.target.value))}/></label>}
    {(edit.kind === 'create' || edit.kind === 'moveGroup' || edit.kind === 'moveQueries') && <label>{edit.kind === 'moveQueries' ? text.destination : text.parent}<select aria-label={edit.kind === 'moveQueries' ? text.destination : text.parent} value={parent} disabled={busy} onChange={event => change(() => setParent(event.target.value))}><option value="">{edit.kind === 'moveQueries' ? text.unfiled : text.root}</option>{tree.map(item => <option value={item.id} key={item.id}>{item.path}</option>)}</select></label>}
    {edit.kind === 'dissolve' && <p className="warning-text">{text.dissolveWarning}</p>}
    {edit.kind === 'moveQueries' && <p>{text.queries(selected.length)}</p>}
    <ErrorBox message={error}/>{preview && <div role="region" aria-label={text.previewTitle}><h4>{text.previewTitle}</h4><p>{text.source}：{preview.before}</p><p>{text.target}：{preview.after}</p><p>{text.members(preview.groupCount, preview.queryCount)}</p>{edit.kind === 'dissolve' && <p className="warning-text">{text.dissolveWarning}</p>}{edit.kind === 'moveQueries' && <ul>{selected.map(item => <li key={item.id}>{item.name}</li>)}</ul>}</div>}
    <footer><button disabled={busy} onClick={() => { if (!busy && !confirmed.current) { activePreview.current = undefined; onCancel(); } }}>{text.cancel}</button><span className="grow"/>{preview ? <><button disabled={busy} onClick={() => change(() => {})}>{text.back}</button><button className="primary" disabled={busy || !current()} onClick={() => { if (busy || !current() || confirmed.current || activePreview.current !== preview) return; confirmed.current = true; onConfirm(preview); }}>{text.confirm}</button></> : <button disabled={busy || !current()} onClick={prepare}>{text.preview}</button>}</footer>
  </section>;
}
