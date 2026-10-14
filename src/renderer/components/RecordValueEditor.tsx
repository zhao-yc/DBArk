import { useEffect, useId, useRef } from 'react';
import type { ColumnInfo } from '../../shared/contracts';
import type { RecordInput, RecordMode } from '../recordViews';
import { recordInputLimits } from '../recordViews';
import { recordViewZh as text } from '../locales/recordViews.zh-CN';

/** 文本域保留词法内容与输入法行为，只读模式仍可聚焦、选择和复制。 */
export function RecordValueEditor({ column, input, inserted, reason, focus, onChange }: { column: ColumnInfo; input: RecordInput; inserted: boolean; reason: string; focus: boolean; onChange(input: RecordInput): void }) {
  const id = useId(); const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (focus) field.current?.focus(); }, [focus]);
  return <div className="record-value-editor">
    <label htmlFor={`${id}-mode`}>{text.mode}</label>
    <select id={`${id}-mode`} value={input.mode} disabled={!!reason} onChange={event => onChange({ ...input, mode: event.target.value as RecordMode })}>
      <option value="text">{text.text}</option><option value="json">{text.json}</option><option value="binary">{text.binary}</option>
      <option value="null" disabled={!column.nullable}>{text.null}</option><option value="default" disabled={!inserted}>{text.default}</option>
    </select>
    <label htmlFor={`${id}-value`}>{column.name} · {text.value}</label>
    <textarea id={`${id}-value`} ref={field} className="record-field-input" aria-describedby={`${id}-reason`} readOnly={!!reason || input.mode === 'null' || input.mode === 'default'} value={input.text} onChange={event => onChange({ ...input, text: event.target.value })}/>
    <span id={`${id}-reason`} className="muted small">{reason || (input.mode === 'null' ? text.null : input.mode === 'default' ? text.default : `${input.text.length} / ${recordInputLimits.field}`)}</span>
  </div>;
}
