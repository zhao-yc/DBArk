import { FILTER_LIMITS } from '../../shared/filtering';
import type { FilterMode } from '../../shared/contracts';
import { filterOperatorLabels, type FilterDraft } from '../tableFilters';
import type { ForeignKeyJoinHavingDraft, ForeignKeyJoinHavingTarget } from '../tableForeignKeyJoinHaving';
import { tableForeignKeyJoinHavingZh as text } from '../locales/tableForeignKeyJoinHaving.zh-CN';
import { tableForeignKeyJoinFilterZh as filterText } from '../locales/tableForeignKeyJoinFilter.zh-CN';
import { UsageHelp } from './ui';

/** 条件字段使用稳定输出ID，不根据别名或下标绑定；所有草稿归父窗口持有。 */
export function TableForeignKeyJoinHaving({entries,targets,mode,disabled,onAdd,onChange,onRemove,onClear,onMode}:{
  entries:readonly ForeignKeyJoinHavingDraft[];targets:readonly ForeignKeyJoinHavingTarget[];mode:FilterMode;disabled:boolean;
  onAdd():void;onChange(entry:ForeignKeyJoinHavingDraft,patch:{enabled?:boolean;draft?:Partial<FilterDraft>;targetLabel?:string}):void;onRemove(entry:ForeignKeyJoinHavingDraft):void;onClear():void;onMode(mode:FilterMode):void;
}){
  return <fieldset disabled={disabled} aria-label={text.title}><legend>{text.title}</legend><UsageHelp><p>{text.hint}</p></UsageHelp><label>{text.mode}<select aria-label={text.mode} disabled={disabled} value={mode} onChange={event=>{if(event.target.value==='all'||event.target.value==='any')onMode(event.target.value);}}><option value="all">{text.all}</option><option value="any">{text.any}</option></select></label>
    {!entries.length&&<p>{text.empty}</p>}{entries.map((entry,index)=>{const n=index+1,draft=entry.draft,set=draft.operator==='IN'||draft.operator==='NOT IN',range=draft.operator==='BETWEEN',nil=draft.operator==='IS NULL'||draft.operator==='IS NOT NULL';return <div key={entry.id}>
      <div className="filter-inputs"><label><input type="checkbox" aria-label={text.enabled(n)} checked={entry.enabled} disabled={disabled} onChange={event=>onChange(entry,{enabled:event.target.checked})}/>{n}.</label>
      <label>{text.target(n)}<select aria-label={text.target(n)} disabled={disabled} value={draft.column} onChange={event=>{const target=targets.find(target=>target.id===event.target.value);if(target)onChange(entry,{draft:{column:target.id},targetLabel:target.label});}}>{!targets.some(target=>target.id===draft.column)&&<option value={draft.column} disabled>{text.stale(entry.targetLabel)}</option>}{targets.map(target=><option key={target.id} value={target.id}>{target.label}</option>)}</select></label>
      <label>{text.operator(n)}<select aria-label={text.operator(n)} disabled={disabled} value={draft.operator} onChange={event=>{if(Object.hasOwn(filterOperatorLabels,event.target.value))onChange(entry,{draft:{operator:event.target.value as FilterDraft['operator']}});}}>{Object.entries(filterOperatorLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button type="button" disabled={disabled} aria-label={text.remove(n)} onClick={()=>onRemove(entry)}>×</button></div>
      {!nil&&!set&&<div className="filter-inputs"><label>{text.value(n)}<input aria-label={text.value(n)} disabled={disabled} maxLength={FILTER_LIMITS.valueLength} value={draft.value} onChange={event=>onChange(entry,{draft:{value:event.target.value}})}/></label>{range&&<label>{text.upper(n)}<input aria-label={text.upper(n)} disabled={disabled} maxLength={FILTER_LIMITS.valueLength} value={draft.upperValue} onChange={event=>onChange(entry,{draft:{upperValue:event.target.value}})}/></label>}</div>}
      {set&&<div className="filter-set-editor"><textarea rows={3} aria-label={text.values(n)} disabled={disabled} maxLength={FILTER_LIMITS.totalCharacters} value={draft.valuesText} onChange={event=>onChange(entry,{draft:{valuesText:event.target.value}})}/><label><input type="checkbox" aria-label={text.includeEmpty(n)} disabled={disabled} checked={draft.includeEmptyString} onChange={event=>onChange(entry,{draft:{includeEmptyString:event.target.checked}})}/>{text.includeEmpty(n)}</label></div>}
      <UsageHelp><p>{range?filterText.rangeHint:set?filterText.setHint:filterText.scalarHint}</p></UsageHelp>
    </div>;})}<button type="button" disabled={disabled||entries.length>=FILTER_LIMITS.conditions||!targets.length} onClick={onAdd}>{text.add}</button><button type="button" disabled={disabled||!entries.length} onClick={onClear}>{text.clear}</button>
  </fieldset>;
}
