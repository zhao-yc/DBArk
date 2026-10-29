import { useLayoutEffect, useRef, useState } from 'react';
import type { TablePreferences } from '../../shared/tablePreferences';
import { changeTablePreference, moveTableColumn, setTableFrozenThrough } from '../tableColumnPreferences';
import { errorMessage } from '../lib';
import { tableGridZh as text } from '../locales/tableGrid.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Modal, Spinner, UsageHelp } from './ui';

/** 布局即时应用到当前网格，保存和恢复明确报告真实持久化结果。 */
export function TablePreferencesDialog({ preferences, pending, dirty, error, onChange, onSave, onReset, onClose }: { preferences: TablePreferences; pending: boolean; dirty: boolean; error: string; onChange(value: TablePreferences): void; onSave(): void; onReset(): void; onClose(): void }) {
  const [localError, setLocalError] = useState(''); const [widths, setWidths] = useState<Record<string, string>>({});
  const alive = useRef(false), unavailable = useRef(pending); unavailable.current = pending;
  const source = useRef({ preferences, generation: 0 });
  if (source.current.preferences !== preferences) source.current = { preferences, generation: source.current.generation + 1 };
  const renderedSource = source.current;
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  /** 字段校验失败不改变布局，宽度草稿可以正常删除并重新输入。 */
  function change(name: string, patch: { hidden?: boolean; width?: number }) { try { onChange(changeTablePreference(preferences, name, patch)); setLocalError(''); } catch (reason) { setLocalError(errorMessage(reason)); } }
  /** 方向按钮与网格拖动共享按名字重排逻辑。 */
  function move(name: string, index: number) { onChange(moveTableColumn(preferences, name, preferences.columns[index].name)); }
  /** 冻结只改当前布局边界，不清除尚未失焦的宽度输入，也不保存或刷新表数据。 */
  function freeze(name?: string) {
    if (!alive.current || unavailable.current || source.current !== renderedSource) return;
    try { onChange(setTableFrozenThrough(preferences, name)); setLocalError(''); }
    catch (reason) { setLocalError(errorMessage(reason)); }
  }
  /** 保存前同步校验全部尚未失焦的宽度输入，不能将非法字段显示成已保存。 */
  function save() {
    try { let next = preferences; for (const [name, width] of Object.entries(widths)) next = changeTablePreference(next, name, { width: Number(width) }); onChange(next); setLocalError(''); onSave(); }
    catch (reason) { setLocalError(errorMessage(reason)); }
  }
  return <Modal title={text.preferences} wide onClose={() => { if (!pending) onClose(); }}><div className="modal-content"><UsageHelp><p>{text.layoutHint}</p><p>{text.freezeHint}</p></UsageHelp><button disabled={pending || preferences.frozenThrough === undefined} onClick={() => freeze()}>{text.unfreeze}</button><div className="table-column-preferences">{preferences.columns.map((column, index) => <div key={column.name} className="table-column-preference" style={{ flexWrap: 'wrap' }}><label style={{ flex: '1 1 220px' }}><input type="checkbox" disabled={pending} checked={!column.hidden} onChange={event => change(column.name, { hidden: !event.target.checked })}/><span>{text.visible} {column.name}{!column.hidden && preferences.frozenThrough === column.name && <small role="status" aria-label={text.frozenThrough(column.name)} style={{ display: 'block', overflowWrap: 'anywhere' }}>{text.frozenThrough(column.name)}</small>}</span></label><input type="number" aria-label={`${text.width} ${column.name}`} disabled={pending} min={64} max={2000} value={Object.hasOwn(widths, column.name) ? widths[column.name] : String(column.width ?? 165)} onChange={event => setWidths({ ...widths, [column.name]: event.target.value })} onBlur={() => { if (Object.hasOwn(widths, column.name)) change(column.name, { width: Number(widths[column.name]) }); }}/><button aria-label={`${text.up} ${column.name}`} disabled={pending || index === 0} onClick={() => move(column.name, index - 1)}>{text.up}</button><button aria-label={`${text.down} ${column.name}`} disabled={pending || index === preferences.columns.length - 1} onClick={() => move(column.name, index + 1)}>{text.down}</button><button aria-label={text.freezeThrough(column.name)} disabled={pending || column.hidden} onClick={() => freeze(column.name)}>{text.freeze}</button></div>)}</div><p className="muted small">{pending ? <Spinner text={text.saving}/> : dirty ? text.unsaved : text.saved}</p><ErrorBox message={localError || error}/></div><footer className="modal-footer"><button disabled={pending} onClick={onClose}>{zh.common.close}</button><button disabled={pending} onClick={() => { setWidths({}); setLocalError(''); onReset(); }}>{text.reset}</button><span className="grow"/><button className="primary" disabled={pending} onClick={save}>{text.save}</button></footer></Modal>;
}
