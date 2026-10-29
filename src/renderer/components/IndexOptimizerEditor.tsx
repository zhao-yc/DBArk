import { UsageHelp } from './ui';
import type { TableIndexView } from '../../shared/tableIndexPatches';
import { indexPatchZh as text } from '../locales/indexPatches.zh-CN';

/** 只编辑一个布尔意图；回调的快照及代次守卫由宿主负责，不在此生成SQL。 */
export function IndexOptimizerEditor({ index, visible, dialect, disabled, onChange, onSave, onClose }: { index: TableIndexView; visible: boolean; dialect?: 'mysql' | 'mariadb'; disabled: boolean; onChange(visible: boolean): void; onSave(): void; onClose(): void }) {
  const original = index.optimizer;
  return <section className="index-patch-editor" aria-label={text.optimizerTitle}>
    <h3>{text.optimizerTitle} · {index.name}</h3><pre className="index-patch-raw" aria-label={text.original}>{index.rawSql}</pre>
    <p>{text.optimizerCurrent}：{typeof original?.visible === 'boolean' ? original.visible ? text.optimizerVisible : text.optimizerHidden : text.optimizerUnknown}</p>
    <UsageHelp><p>{dialect === 'mariadb' ? text.optimizerMaria : text.optimizerMysql}</p></UsageHelp><p className="warning-text">{text.optimizerScope}</p>
    <label><input type="checkbox" aria-label={text.optimizerToggle} disabled={disabled || original?.access.allowed !== true} checked={visible} onChange={event => onChange(event.target.checked)}/>{text.optimizerToggle}</label>
    <button type="button" disabled={disabled || typeof original?.visible !== 'boolean' || original.access.allowed !== true || visible === original.visible} onClick={() => { if (typeof original?.visible === 'boolean') onChange(original.visible); }}>{text.optimizerRestore}</button>
    {original?.access.reasons.map((reason, index) => <p key={index} className="warning-text">{reason}</p>)}
    <footer><button disabled={disabled} onClick={onClose}>{text.editorCancel}</button><button disabled={disabled} onClick={onSave}>{text.rowSave}</button></footer>
  </section>;
}
