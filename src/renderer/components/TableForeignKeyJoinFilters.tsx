import type { TableInfo, FilterMode } from '../../shared/contracts';
import { FILTER_LIMITS } from '../../shared/filtering';
import { filterOperatorLabels, type FilterDraft } from '../tableFilters';
import type { ForeignKeyJoinFilterDraft } from '../tableForeignKeyJoinFilters';
import { tableForeignKeyJoinFilterZh as text } from '../locales/tableForeignKeyJoinFilter.zh-CN';
import { UsageHelp } from './ui';

/** 所有输入均为父窗口当前草稿；没有第二份暂存状态、执行接口或隐藏的已生效条件。 */
export function TableForeignKeyJoinFilters({ child, parent, entries, mode, disabled, onAdd, onChange, onRemove, onClear, onMode }: {
  child: TableInfo; parent: TableInfo; entries: readonly ForeignKeyJoinFilterDraft[]; mode: FilterMode; disabled: boolean;
  onAdd(): void; onChange(entry: ForeignKeyJoinFilterDraft, patch: { side?: 'child' | 'parent'; enabled?: boolean; draft?: Partial<FilterDraft> }): void; onRemove(entry: ForeignKeyJoinFilterDraft): void; onClear(): void; onMode(mode: FilterMode): void;
}) {
  return <fieldset disabled={disabled} aria-label={text.title}><legend>{text.title}</legend><UsageHelp><p>{text.hint}</p></UsageHelp>
    <label>{text.mode}<select aria-label={text.mode} value={mode} disabled={disabled} onChange={event => { if (event.target.value === 'all' || event.target.value === 'any') onMode(event.target.value); }}><option value="all">{text.all}</option><option value="any">{text.any}</option></select></label>
    {!entries.length && <p>{text.empty}</p>}
    {entries.map((entry, index) => {
      const { draft } = entry, position = index + 1, columns = (entry.side === 'child' ? child : parent).columns;
      const set = draft.operator === 'IN' || draft.operator === 'NOT IN', range = draft.operator === 'BETWEEN', nil = draft.operator === 'IS NULL' || draft.operator === 'IS NOT NULL';
      return <div key={entry.id} className="join-filter-entry">
        <div className="filter-inputs"><label><input type="checkbox" aria-label={text.enabled(position)} checked={entry.enabled} disabled={disabled} onChange={event => onChange(entry, { enabled: event.target.checked })}/>{position}.</label>
          <label>{text.side(position)}<select aria-label={text.side(position)} disabled={disabled} value={entry.side} onChange={event => { const side = event.target.value; if (side === 'child' || side === 'parent') { const names = (side === 'child' ? child : parent).columns.map(column => column.name); onChange(entry, { side, draft: { column: names.includes(draft.column) ? draft.column : names[0] } }); } }}><option value="child">{text.child}</option><option value="parent">{text.parent}</option></select></label>
          <label>{text.column(position)}<select aria-label={text.column(position)} disabled={disabled} value={draft.column} onChange={event => { if (columns.some(column => column.name === event.target.value)) onChange(entry, { draft: { column: event.target.value } }); }}>{columns.map(column => <option key={column.name} value={column.name}>{column.name}</option>)}</select></label>
          <label>{text.operator(position)}<select aria-label={text.operator(position)} disabled={disabled} value={draft.operator} onChange={event => { if (Object.hasOwn(filterOperatorLabels, event.target.value)) onChange(entry, { draft: { operator: event.target.value as FilterDraft['operator'] } }); }}>{Object.entries(filterOperatorLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button type="button" aria-label={text.remove(position)} disabled={disabled} onClick={() => onRemove(entry)}>×</button>
        </div>
        {!nil && !set && <div className="filter-inputs"><label>{text.value(position)}<input aria-label={text.value(position)} disabled={disabled} maxLength={FILTER_LIMITS.valueLength} value={draft.value} onChange={event => onChange(entry, { draft: { value: event.target.value } })}/></label>{range && <label>{text.upper(position)}<input aria-label={text.upper(position)} disabled={disabled} maxLength={FILTER_LIMITS.valueLength} value={draft.upperValue} onChange={event => onChange(entry, { draft: { upperValue: event.target.value } })}/></label>}</div>}
        {set && <div className="filter-set-editor"><textarea rows={3} aria-label={text.values(position)} disabled={disabled} maxLength={FILTER_LIMITS.totalCharacters} value={draft.valuesText} onChange={event => onChange(entry, { draft: { valuesText: event.target.value } })}/><label><input type="checkbox" aria-label={text.includeEmpty(position)} disabled={disabled} checked={draft.includeEmptyString} onChange={event => onChange(entry, { draft: { includeEmptyString: event.target.checked } })}/>{text.includeEmpty(position)}</label></div>}
        <UsageHelp><p>{range ? text.rangeHint : set ? text.setHint : text.scalarHint}</p></UsageHelp>
      </div>;
    })}
    <button type="button" disabled={disabled || entries.length >= FILTER_LIMITS.conditions} onClick={onAdd}>{text.add}</button><button type="button" disabled={disabled || !entries.length} onClick={onClear}>{text.removeAll}</button>
  </fieldset>;
}
