import { gridRowHeights, isGridRowHeight, readGridRowHeight, type GridRowHeight } from '../../shared/gridRowHeight';
import { gridRowHeightZh as text } from '../locales/gridRowHeight.zh-CN';
import '../gridRowHeight.css';

/** 表格和结果布局共享三档预设；设置只修改当前宿主的显示状态。 */
export function GridRowHeightField({ value, disabled, onChange }: { value?: GridRowHeight; disabled: boolean; onChange(value: GridRowHeight): void }) {
  return <label className="inline-field">{text.label}<select aria-label={text.label} value={readGridRowHeight(value)} disabled={disabled} onChange={event => {
    const next = Number(event.target.value);
    if (!disabled && isGridRowHeight(next)) onChange(next);
  }}>{gridRowHeights.map(height => <option key={height} value={height}>{text.options[height]}</option>)}</select></label>;
}
