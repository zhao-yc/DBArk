import { useState } from 'react';
import type { TablePreferences } from '../../shared/tablePreferences';
import { changeTablePreference, moveTableColumn } from '../tableColumnPreferences';
import { errorMessage } from '../lib';
import { tableGridZh as text } from '../locales/tableGrid.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Modal, Spinner } from './ui';

/** 布局即时应用到当前网格，保存和恢复明确报告真实持久化结果。 */
export function TablePreferencesDialog({ preferences, pending, dirty, error, onChange, onSave, onReset, onClose }: { preferences: TablePreferences; pending: boolean; dirty: boolean; error: string; onChange(value: TablePreferences): void; onSave(): void; onReset(): void; onClose(): void }) {
  const [localError, setLocalError] = useState(''); const [widths, setWidths] = useState<Record<string, string>>({});
  /** 字段校验失败不改变布局，宽度草稿可以正常删除并重新输入。 */
  function change(name: string, patch: { hidden?: boolean; width?: number }) { try { onChange(changeTablePreference(preferences, name, patch)); setLocalError(''); } catch (reason) { setLocalError(errorMessage(reason)); } }
  /** 方向按钮与网格拖动共享按名字重排逻辑。 */
  function move(name: string, index: number) { onChange(moveTableColumn(preferences, name, preferences.columns[index].name)); }
  /** 保存前同步校验全部尚未失焦的宽度输入，不能将非法字段显示成已保存。 */
  function save() {
    try { let next = preferences; for (const [name, width] of Object.entries(widths)) next = changeTablePreference(next, name, { width: Number(width) }); onChange(next); setLocalError(''); onSave(); }
    catch (reason) { setLocalError(errorMessage(reason)); }
  }
  return <Modal title={text.preferences} wide onClose={() => { if (!pending) onClose(); }}><div className="modal-content"><p>{text.layoutHint}</p><div className="table-column-preferences">{preferences.columns.map((column, index) => <div key={column.name} className="table-column-preference"><label><input type="checkbox" disabled={pending} checked={!column.hidden} onChange={event => change(column.name, { hidden: !event.target.checked })}/><span>{text.visible} {column.name}</span></label><input type="number" aria-label={`${text.width} ${column.name}`} disabled={pending} min={64} max={2000} value={Object.hasOwn(widths, column.name) ? widths[column.name] : String(column.width ?? 165)} onChange={event => setWidths({ ...widths, [column.name]: event.target.value })} onBlur={() => { if (Object.hasOwn(widths, column.name)) change(column.name, { width: Number(widths[column.name]) }); }}/><button aria-label={`${text.up} ${column.name}`} disabled={pending || index === 0} onClick={() => move(column.name, index - 1)}>{text.up}</button><button aria-label={`${text.down} ${column.name}`} disabled={pending || index === preferences.columns.length - 1} onClick={() => move(column.name, index + 1)}>{text.down}</button></div>)}</div><p className="muted small">{pending ? <Spinner text={text.saving}/> : dirty ? text.unsaved : text.saved}</p><ErrorBox message={localError || error}/></div><footer className="modal-footer"><button disabled={pending} onClick={onClose}>{zh.common.close}</button><button disabled={pending} onClick={() => { setWidths({}); setLocalError(''); onReset(); }}>{text.reset}</button><span className="grow"/><button className="primary" disabled={pending} onClick={save}>{text.save}</button></footer></Modal>;
}
