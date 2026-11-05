import { useLayoutEffect, useRef, useState } from 'react';
import type { TablePreferences } from '../../shared/tablePreferences';
import { changeTablePreference, moveTableColumn, setTableColumnWidths, setTableFrozenThrough, setVisibleTableColumnWidths, visibleTableKeys } from '../tableColumnPreferences';
import { errorMessage } from '../lib';
import { tableGridZh as text } from '../locales/tableGrid.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Modal, Spinner, UsageHelp } from './ui';
import { GridColumnWidthBatch } from './GridColumnWidthBatch';
import { GridRowHeightField } from './GridRowHeightField';
import { defaultGridRowHeight, type GridRowHeight } from '../../shared/gridRowHeight';
import { fitGridColumnWidths, type GridColumnFitSource } from '../gridColumnFit';
import { gridColumnWidthBatchZh as widthText } from '../locales/gridColumnWidthBatch.zh-CN';

/** 布局即时应用到当前网格，保存和恢复明确报告真实持久化结果。 */
export function TablePreferencesDialog({ preferences, pending, dirty, error, onChange, onSave, onReset, onClose, title = text.preferences, hint = text.layoutHint, maximumNameLength = 256, defaultWidth = 165, onReload, reloadLabel, fitSource, resetPrompt, reloadPrompt, cleanNotice = text.saved }: { preferences: TablePreferences; pending: boolean; dirty: boolean; error: string; onChange(value: TablePreferences): void; onSave(): void; onReset(): void; onClose(): void; title?: string; hint?: string; maximumNameLength?: number; defaultWidth?: number; onReload?(): void; reloadLabel?: string; fitSource?(): GridColumnFitSource | undefined; resetPrompt?: string; reloadPrompt?: string; cleanNotice?: string }) {
  const [localError, setLocalError] = useState(''); const [widths, setWidths] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [confirmation, setConfirmation] = useState<'reset' | 'reload'>();
  const needle = search.trim().toLocaleLowerCase();
  const matches = preferences.columns.flatMap((column, index) => column.name.toLocaleLowerCase().includes(needle) ? [{ column, index }] : []);
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
    try { onChange(setTableFrozenThrough(preferences, name, maximumNameLength)); setLocalError(''); }
    catch (reason) { setLocalError(errorMessage(reason)); }
  }
  /** 标准档继续沿用缺省记录；改行高保留单列宽度草稿和原布局。 */
  function changeRowHeight(rowHeight: GridRowHeight) {
    if (!alive.current || unavailable.current || source.current !== renderedSource) return;
    const { rowHeight: _previous, ...base } = preferences;
    onChange(rowHeight === defaultGridRowHeight ? base : { ...base, rowHeight });
  }
  /** 只替换本次设置范围内的宽度，搜索和隐藏列不改变批量范围。 */
  function applyVisibleWidths(width?: number, column?: string) {
    if (!alive.current || unavailable.current || source.current !== renderedSource) return;
    try {
      const keys = new Set(visibleTableKeys(preferences));
      if (column !== undefined) {
        if (!keys.has(column)) return;
        keys.clear();
        keys.add(column);
      }
      let next: TablePreferences;
      if (width === undefined) {
        const data = fitSource?.();
        if (!data) return;
        const fitted = fitGridColumnWidths(data, keys);
        if (!fitted.size) return;
        next = setTableColumnWidths(preferences, fitted);
      } else next = setVisibleTableColumnWidths(preferences, width);
      setWidths(current => Object.fromEntries(Object.entries(current).filter(([name]) => !keys.has(name))));
      onChange(next);
      setLocalError('');
    } catch (reason) { setLocalError(width === undefined ? widthText.fitUnavailable : errorMessage(reason)); }
  }
  /** 保存前同步校验全部尚未失焦的宽度输入，不能将非法字段显示成已保存。 */
  function save() {
    try { let next = preferences; for (const [name, width] of Object.entries(widths)) next = changeTablePreference(next, name, { width: Number(width) }); onChange(next); setLocalError(''); onSave(); }
    catch (reason) { setLocalError(errorMessage(reason)); }
  }
  /** 恢复默认及丢弃未保存布局可由调用方要求在同一窗口再次确认。 */
  function changeSource(kind: 'reset' | 'reload') {
    setConfirmation(undefined);
    if (kind === 'reset' || reloadPrompt !== undefined) { setWidths({}); setLocalError(''); }
    if (kind === 'reset') onReset();
    else onReload?.();
  }
  return <Modal title={title} wide onClose={() => { if (!pending) onClose(); }}><div className="modal-content"><UsageHelp><p>{hint}</p><p>{text.freezeHint}</p></UsageHelp><GridColumnWidthBatch disabled={pending || !preferences.columns.some(column => !column.hidden)} onApply={applyVisibleWidths} onFit={fitSource ? () => applyVisibleWidths() : undefined}/><div className="table-preferences-display-controls"><GridRowHeightField value={preferences.rowHeight} disabled={pending} onChange={changeRowHeight}/><button disabled={pending || preferences.frozenThrough === undefined} onClick={() => freeze()}>{text.unfreeze}</button><label>{text.columnSearch}<input type="search" aria-label={text.columnSearch} value={search} disabled={pending} onChange={event => setSearch(event.target.value)}/></label></div>
    <div className="table-column-preferences">{matches.map(({ column, index }) => <div key={column.name} className="table-column-preference" style={{ flexWrap: 'wrap' }}><label style={{ flex: '1 1 220px', minWidth: 0 }}><input type="checkbox" disabled={pending} checked={!column.hidden} onChange={event => change(column.name, { hidden: !event.target.checked })}/><span style={{ overflowWrap: 'anywhere' }}>{text.visible} {column.name}{!column.hidden && preferences.frozenThrough === column.name && <small role="status" aria-label={text.frozenThrough(column.name)} style={{ display: 'block', overflowWrap: 'anywhere' }}>{text.frozenThrough(column.name)}</small>}</span></label><input type="number" aria-label={`${text.width} ${column.name}`} disabled={pending} min={64} max={2000} value={Object.hasOwn(widths, column.name) ? widths[column.name] : String(column.width ?? defaultWidth)} onChange={event => setWidths({ ...widths, [column.name]: event.target.value })} onBlur={() => { if (Object.hasOwn(widths, column.name)) change(column.name, { width: Number(widths[column.name]) }); }}/>{fitSource && <button aria-label={widthText.fitColumn(column.name)} title={widthText.fitHint} disabled={pending || column.hidden} onClick={() => applyVisibleWidths(undefined, column.name)}>{widthText.fitOne}</button>}<button aria-label={`${text.up} ${column.name}`} disabled={pending || index === 0} onClick={() => move(column.name, index - 1)}>{text.up}</button><button aria-label={`${text.down} ${column.name}`} disabled={pending || index === preferences.columns.length - 1} onClick={() => move(column.name, index + 1)}>{text.down}</button><button aria-label={text.freezeThrough(column.name)} disabled={pending || column.hidden} onClick={() => freeze(column.name)}>{text.freeze}</button></div>)}{!matches.length && <p className="muted small">{text.noMatchingColumns}</p>}</div><p className="muted small">{pending ? <Spinner text={text.saving}/> : dirty ? text.unsaved : cleanNotice}</p><ErrorBox message={localError || error}/>
    {confirmation && <div className="info-strip" role="group" aria-label={text.confirmLayout}>
      <p>{confirmation === 'reset' ? resetPrompt : reloadPrompt}</p>
      <button disabled={pending} onClick={() => setConfirmation(undefined)}>{zh.common.cancel}</button>
      <button className="danger" disabled={pending} onClick={() => changeSource(confirmation)}>{text.confirmLayout}</button>
    </div>}</div><footer className="modal-footer"><button disabled={pending} onClick={onClose}>{zh.common.close}</button><button disabled={pending || !!confirmation} onClick={() => resetPrompt ? setConfirmation('reset') : changeSource('reset')}>{text.reset}</button>{onReload && <button disabled={pending || !!confirmation} onClick={() => reloadPrompt && dirty ? setConfirmation('reload') : changeSource('reload')}>{reloadLabel}</button>}<span className="grow"/><button className="primary" disabled={pending || !!confirmation} onClick={save}>{text.save}</button></footer></Modal>;
}
