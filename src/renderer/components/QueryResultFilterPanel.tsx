import { useRef, useState } from 'react';
import type { QueryResultFilterBinding, QueryResultFilterMode, QueryResultFilterOperator, QueryResultFilterRule, QueryResultFilterView } from '../queryResultFilter';
import { queryResultFilterLimits, queryResultFilterNeedsUpper, queryResultFilterNeedsValue, queryResultFilterOperators } from '../queryResultFilter';
import { queryResultFilterZh as text } from '../locales/queryResultFilter.zh-CN';
import { ErrorBox } from './ui';
import '../queryResultFilter.css';

type Draft={mode:QueryResultFilterMode;rows:{id:number;rule:QueryResultFilterRule}[]};
/** 内联条件草稿不扫描结果、不触发SQL；只有显式应用才交给父级有界控制器。 */
export function QueryResultFilterPanel({binding,initial,isCurrent,onApply,onClose}:{binding:QueryResultFilterBinding;initial:QueryResultFilterView;isCurrent():boolean;onApply(rules:QueryResultFilterRule[],mode:QueryResultFilterMode):void;onClose():void}){
  const [draft,setDraft]=useState<Draft>(()=>({mode:initial.mode,rows:initial.rules.map((rule,id)=>({id,rule:{...rule}}))})),sequence=useRef(initial.rules.length),live=useRef(draft),invalid=useRef(false),composition=useRef(false),[composing,setComposing]=useState(false);live.current=draft;
  /** 首次失效永久拒绝；旧行事件必须同时属于当前草稿，不能修改移除后占据相同位置的条件。 */
  function current(expected=live.current):boolean{if(invalid.current)return false;let okay=false;try{okay=isCurrent()===true;}catch{}if(!okay)invalid.current=true;return okay&&live.current===expected;}
  /** 同步换草稿身份；应用前不改变原视图，取消直接丢弃草稿。 */
  function replace(next:Draft):void{if(!current(draft)||composition.current)return;live.current=next;setDraft(next);}
  /** 组合输入只更新自己的原值，不把Enter/空格或迟到compositionend当成应用。 */
  function input(id:number,value:string,upper=false):void{if(!current(draft))return;const next={...draft,rows:draft.rows.map(row=>row.id===id?{...row,rule:{...row.rule,[upper?'upper':'value']:value}}:row)};live.current=next;setDraft(next);}
  /** 改为单值或NULL条件时移除旧上限；重新进入区间必须明确填写上限，不能沿用隐藏值。 */
  function changeOperator(id:number,operator:QueryResultFilterOperator):void{
    replace({...draft,rows:draft.rows.map(row=>{
      if(row.id!==id)return row;
      const {upper,...base}=row.rule;
      return{...row,rule:{...base,operator,value:queryResultFilterNeedsValue(operator)?base.value:'',...(queryResultFilterNeedsUpper(operator)?{upper:upper??''}:{})}};
    })});
  }
  /** 两个端点共享组合状态和草稿租约，迟到事件不能解锁下一面板。 */
  function beginComposition():void{if(current(draft)){composition.current=true;setComposing(true);}}
  function endComposition():void{if(current()){composition.current=false;setComposing(false);}}
  const valid=current();
  return <section role="region" aria-label={text.title} className="query-result-filter-panel" onKeyDown={event=>{if(event.key==='Escape'&&!composition.current&&!event.nativeEvent.isComposing&&current()){event.preventDefault();onClose();}}}><strong>{text.title}</strong><p>{text.hint}</p><label>{text.mode}<select aria-label={text.mode} value={draft.mode} disabled={!valid||composing} onChange={event=>replace({...draft,mode:event.target.value as QueryResultFilterMode})}><option value="AND">{text.and}</option><option value="OR">{text.or}</option></select></label><div className="query-result-filter-conditions">{draft.rows.map(({id,rule},index)=>{
    const column=binding.visible.find(c=>c.key===rule.column)!,operators=queryResultFilterOperators(column),needsValue=queryResultFilterNeedsValue(rule.operator),range=queryResultFilterNeedsUpper(rule.operator);
    return <div className="query-result-filter-condition" key={id} aria-label={text.condition(index+1)}><span>{index+1}</span><select aria-label={`${text.column} ${index+1}`} value={rule.column} disabled={!valid||composing} onChange={event=>{const next=binding.visible.find(c=>c.key===event.target.value);if(next)replace({...draft,rows:draft.rows.map(row=>row.id===id?{...row,rule:{column:next.key,operator:queryResultFilterOperators(next)[0],value:''}}:row)});}}>{binding.visible.map((c,i)=><option key={c.key} value={c.key}>{i+1}. {c.name} · {c.type}</option>)}</select><select aria-label={`${text.operator} ${index+1}`} value={rule.operator} disabled={!valid||composing} onChange={event=>changeOperator(id,event.target.value as QueryResultFilterOperator)}>{operators.map(operator=><option key={operator} value={operator}>{text.operators[operator]}</option>)}</select>
      <input aria-label={`${range?text.lower:text.input} ${index+1}`} placeholder={range?text.lower:undefined} value={rule.value} maxLength={queryResultFilterLimits.valueUnits} disabled={!valid||!needsValue} onChange={event=>input(id,event.target.value)} onCompositionStart={beginComposition} onCompositionEnd={endComposition}/>
      {range&&<input aria-label={`${text.upper} ${index+1}`} placeholder={text.upper} value={rule.upper??''} maxLength={queryResultFilterLimits.valueUnits} disabled={!valid} onChange={event=>input(id,event.target.value,true)} onCompositionStart={beginComposition} onCompositionEnd={endComposition}/>}
      <button disabled={!valid||composing} aria-label={text.remove(index+1)} onClick={()=>replace({...draft,rows:draft.rows.filter(row=>row.id!==id)})}>×</button></div>;
  })}</div>{!draft.rows.length&&<p>{text.empty}</p>}{!valid&&<ErrorBox message={text.stale}/>}<div className="query-result-filter-actions"><button disabled={!valid||composing||draft.rows.length>=queryResultFilterLimits.conditions} onClick={()=>{const column=binding.visible[0];if(column)replace({...draft,rows:[...draft.rows,{id:sequence.current++,rule:{column:column.key,operator:queryResultFilterOperators(column)[0],value:''}}]});}}>{text.add}</button><button disabled={!valid||composing||!draft.rows.length} onClick={()=>replace({...draft,rows:[]})}>{text.clearDraft}</button><span className="grow"/>{composing&&<span>{text.composing}</span>}<button onClick={onClose}>{text.cancel}</button><button className="primary" disabled={!valid||composing} onClick={()=>{if(current(draft)&&!composition.current)onApply(draft.rows.map(row=>({...row.rule})),draft.mode);}}>{text.apply}</button></div></section>;
}
