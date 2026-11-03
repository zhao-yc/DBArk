import { useState } from 'react';
import { tablePreferencesLimits } from '../../shared/tablePreferences';
import { gridColumnWidthBatchZh as text } from '../locales/gridColumnWidthBatch.zh-CN';

/** 输入一次即可修改可见列草稿；实际保存仍由宿主原流程处理。 */
export function GridColumnWidthBatch({ disabled, onApply }: { disabled: boolean; onApply(width: number): void }) {
  const [input, setInput] = useState('');
  const width = Number(input);
  const valid = /^\d+$/.test(input) && width >= tablePreferencesLimits.minWidth && width <= tablePreferencesLimits.maxWidth;
  return <div className="inline-field">
    <label className="inline-field">{text.width}<input aria-label={text.width} aria-invalid={!!input && !valid} title={text.hint} placeholder={text.range} inputMode="numeric" maxLength={16} size={8} disabled={disabled} value={input} onChange={event => setInput(event.target.value)}/></label>
    <button type="button" title={text.hint} disabled={disabled || !valid} onClick={() => { if (!disabled && valid) onApply(width); }}>{text.apply}</button>
  </div>;
}
