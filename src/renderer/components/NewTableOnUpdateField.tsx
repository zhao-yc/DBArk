import type { TableCreateTimeColumn } from '../../shared/tableCreateOnUpdate';
import { tableCreateOnUpdateReason, tableCreateTimeType } from '../../shared/tableCreateOnUpdate';
import { tableCreateOnUpdateZh as text } from '../locales/tableCreateOnUpdate.zh-CN';

/** 新表行事件仍由父列身份/代次守卫；类型或默认值变化不静默删除用户明确选择的属性。 */
export function NewTableOnUpdateField({ column, position, disabled, onChange }: { column: TableCreateTimeColumn; position: number; disabled: boolean; onChange(value: { onUpdate?: TableCreateTimeColumn['onUpdate'] }, remove: boolean): void }) {
  const selected = Object.hasOwn(column, 'onUpdate') ? column.onUpdate === null ? 'none' : 'current' : 'legacy';
  const reason = tableCreateOnUpdateReason(column), temporal = tableCreateTimeType(column.type), unavailable = tableCreateOnUpdateReason({ ...column, onUpdate: null });
  return <div><select aria-label={text.label(position)} value={selected} disabled={disabled} onChange={event => {
    if (disabled) return;
    const mode = event.target.value;
    if (!['legacy', 'none', 'current'].includes(mode)) return;
    if (mode === 'legacy') onChange({}, true);
    else onChange({ onUpdate: mode === 'none' ? null : { kind: 'expression', expression: 'current-timestamp', precision: temporal?.precision ?? 0 } }, false);
  }}><option value="legacy">{text.legacy}</option><option value="none" disabled={!!unavailable}>{text.none}</option><option value="current" disabled={!!unavailable}>{text.current}</option></select>
    {selected === 'current' && <select aria-label={text.precisionLabel(position)} value={column.onUpdate?.precision ?? temporal?.precision ?? 0} disabled={disabled} onChange={event => { if (!disabled && /^[0-6]$/.test(event.target.value)) onChange({ onUpdate: { kind: 'expression', expression: 'current-timestamp', precision: Number(event.target.value) } }, false); }}>{[0, 1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value}</option>)}</select>}
    <small>{reason || text.hint}</small></div>;
}
