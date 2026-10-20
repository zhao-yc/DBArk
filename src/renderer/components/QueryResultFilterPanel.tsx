import { useRef, useState, type ReactNode } from 'react';
import type { QueryResultFilterBinding, QueryResultFilterGroup, QueryResultFilterOperator, QueryResultFilterRule, QueryResultFilterView } from '../queryResultFilter';
import { queryResultFilterLimits, queryResultFilterNeedsUpper, queryResultFilterNeedsValue, queryResultFilterNeedsValues, queryResultFilterOperators, queryResultFilterSupportsIgnoreCase } from '../queryResultFilter';
import { queryResultFilterZh as text } from '../locales/queryResultFilter.zh-CN';
import { ErrorBox } from './ui';
import '../queryResultFilter.css';

type DraftRule={id:number;kind:'rule';rule:QueryResultFilterRule};
type DraftGroup={id:number;kind:'group';mode:QueryResultFilterGroup['mode'];children:(DraftRule|DraftGroup)[]};
/** 树编辑只作用于当前草稿；稳定节点ID与根身份同时保护移除、嵌套和迟到输入。 */
function editGroup(group:DraftGroup,id:number,change:(group:DraftGroup)=>DraftGroup):DraftGroup{
  return group.id===id?change(group):{...group,children:group.children.map(child=>child.kind==='group'?editGroup(child,id,change):child)};
}
/** 已生效表达式转独立草稿，成员数组也复制，不共享用户后续编辑的容器。 */
function copyDraft(expression:QueryResultFilterGroup,nextId:()=>number):DraftGroup{
  return{id:nextId(),kind:'group',mode:expression.mode,children:expression.children.map(child=>'children'in child?copyDraft(child,nextId):{id:nextId(),kind:'rule',rule:{...child,...(child.values?{values:[...child.values]}:{})}})};
}
/** 输出仅含协议条件和分组，草稿节点ID不进入控制器或文件。 */
function expressionOf(group:DraftGroup):QueryResultFilterGroup{
  return{mode:group.mode,children:group.children.map(child=>child.kind==='group'?expressionOf(child):{...child.rule,...(child.rule.values?{values:[...child.rule.values]}:{})})};
}
/** 内联条件树不扫描结果、不触发SQL；只有显式应用才交给父级有界控制器。 */
export function QueryResultFilterPanel({binding,initial,isCurrent,onApply,onClose}:{binding:QueryResultFilterBinding;initial:QueryResultFilterView;isCurrent():boolean;onApply(expression:QueryResultFilterGroup):void;onClose():void}){
  const sequence=useRef(0),[draft,setDraft]=useState<DraftGroup>(()=>copyDraft(initial.expression??{mode:initial.mode,children:initial.rules},()=>sequence.current++));
  const live=useRef(draft),invalid=useRef(false),composition=useRef(false),[composing,setComposing]=useState(false);live.current=draft;
  /** 首次失效永久拒绝，旧回调不能写入另一棵草稿或移除后占据相同位置的节点。 */
  function current(expected=live.current):boolean{if(invalid.current)return false;let okay=false;try{okay=isCurrent()===true;}catch{}if(!okay)invalid.current=true;return okay&&live.current===expected;}
  /** 同步更新根身份；组合输入期间仅允许所属输入框更新原文。 */
  function replace(next:DraftGroup,input=false):void{if(!current(draft)||composition.current&&!input)return;live.current=next;setDraft(next);}
  /** 规则输入沿父组与稳定ID定位，成员和端点都共享整棵草稿租约。 */
  function changeRule(parent:number,id:number,change:(rule:QueryResultFilterRule)=>QueryResultFilterRule,input=false):void{
    replace(editGroup(draft,parent,group=>({...group,children:group.children.map(child=>child.kind==='rule'&&child.id===id?{...child,rule:change(child.rule)}:child)})),input);
  }
  /** 新条件从首个可见字段开始，不读取数据内容或猜测字面类型。 */
  function newRule():DraftRule{const column=binding.visible[0];return{id:sequence.current++,kind:'rule',rule:{column:column.key,operator:queryResultFilterOperators(column)[0],value:''}};}
  /** 离开区间或列表移除隐藏输入；列表正反切换保留当前可见成员。 */
  function changeOperator(parent:number,id:number,operator:QueryResultFilterOperator):void{
    changeRule(parent,id,rule=>{const{upper,values,ignoreCase,...base}=rule;const column=binding.visible.find(column=>column.key===base.column)!;return{...base,operator,value:queryResultFilterNeedsValue(operator)?base.value:'',...(queryResultFilterNeedsUpper(operator)?{upper:upper??''}:{}),...(queryResultFilterNeedsValues(operator)?{values:values?[...values]:[base.value]}:{}),...(ignoreCase&&queryResultFilterSupportsIgnoreCase(column,operator)?{ignoreCase:true}:{})};});
  }
  /** 输入法组合不会变成应用或跨面板解锁。 */
  function beginComposition():void{if(current(draft)){composition.current=true;setComposing(true);}}
  function endComposition():void{if(current()){composition.current=false;setComposing(false);}}
  const valid=current(),numbers=new Map<number,number>();let groups=0;
  /** 展示编号按树顺序连续排列，编辑身份始终使用稳定ID而非展示位置。 */
  function count(group:DraftGroup):void{groups++;for(const child of group.children)if(child.kind==='group')count(child);else numbers.set(child.id,numbers.size+1);}
  count(draft);
  /** 各组独立组合；新增子组自带一个可见条件，空子组应用时由控制器明确拒绝。 */
  function groupActions(group:DraftGroup,path:string,depth:number){return <div className="query-result-filter-group-actions"><button disabled={!valid||composing||numbers.size>=queryResultFilterLimits.conditions||!binding.visible.length} onClick={()=>replace(editGroup(draft,group.id,node=>({...node,children:[...node.children,newRule()]})))}>{path?text.addInGroup(path):text.add}</button><button disabled={!valid||composing||numbers.size>=queryResultFilterLimits.conditions||groups>=queryResultFilterLimits.groups||depth>=queryResultFilterLimits.depth||!binding.visible.length} onClick={()=>replace(editGroup(draft,group.id,node=>({...node,children:[...node.children,{id:sequence.current++,kind:'group',mode:'OR',children:[newRule()]}]})))}>{path?text.addGroupInGroup(path):text.addGroup}</button></div>;}
  /** 递归渲染深度受草稿构造和控制器双重限制，不拼接SQL或解析括号文本。 */
  function renderGroup(group:DraftGroup,path:string,depth:number):ReactNode{let childGroup=0;return <><label>{path?text.groupMode(path):text.mode}<select aria-label={path?text.groupMode(path):text.mode} value={group.mode} disabled={!valid||composing} onChange={event=>replace(editGroup(draft,group.id,node=>({...node,mode:event.target.value as QueryResultFilterGroup['mode']})))}><option value="AND">{text.and}</option><option value="OR">{text.or}</option></select></label>{group.children.map(child=>{
    if(child.kind==='group'){const childPath=path?`${path}.${++childGroup}`:String(++childGroup);return <fieldset className="query-result-filter-group" aria-label={text.group(childPath)} key={child.id}><legend>{text.group(childPath)}</legend>{renderGroup(child,childPath,depth+1)}<button aria-label={text.removeGroup(childPath)} disabled={!valid||composing} onClick={()=>replace(editGroup(draft,group.id,node=>({...node,children:node.children.filter(node=>node.id!==child.id)})))}>{text.removeGroup(childPath)}</button></fieldset>;}
    const{id,rule}=child,index=numbers.get(id)!,column=binding.visible.find(c=>c.key===rule.column)!,operators=queryResultFilterOperators(column),needsValue=queryResultFilterNeedsValue(rule.operator),range=queryResultFilterNeedsUpper(rule.operator),members=queryResultFilterNeedsValues(rule.operator);
    return <div className="query-result-filter-condition" key={id} aria-label={text.condition(index)}><span>{index}</span><select aria-label={`${text.column} ${index}`} value={rule.column} disabled={!valid||composing} onChange={event=>{const next=binding.visible.find(c=>c.key===event.target.value);if(next)changeRule(group.id,id,()=>({column:next.key,operator:queryResultFilterOperators(next)[0],value:''}));}}>{binding.visible.map((c,i)=><option key={c.key} value={c.key}>{i+1}. {c.name} · {c.type}</option>)}</select><select aria-label={`${text.operator} ${index}`} value={rule.operator} disabled={!valid||composing} onChange={event=>changeOperator(group.id,id,event.target.value as QueryResultFilterOperator)}>{operators.map(operator=><option key={operator} value={operator}>{text.operators[operator]}</option>)}</select>
      {queryResultFilterSupportsIgnoreCase(column,rule.operator)&&<label title={text.ignoreCaseHint}><input type="checkbox" aria-label={text.ignoreCase(index)} checked={rule.ignoreCase===true} disabled={!valid||composing} onChange={event=>changeRule(group.id,id,rule=>{const{ignoreCase,...base}=rule;return event.target.checked?{...base,ignoreCase:true}:base;})}/>{text.ignoreCaseLabel}</label>}
      {!members&&<input aria-label={`${range?text.lower:text.input} ${index}`} placeholder={range?text.lower:undefined} value={rule.value} maxLength={queryResultFilterLimits.valueUnits} disabled={!valid||!needsValue} onChange={event=>changeRule(group.id,id,rule=>({...rule,value:event.target.value}),true)} onCompositionStart={beginComposition} onCompositionEnd={endComposition}/>}
      {range&&<input aria-label={`${text.upper} ${index}`} placeholder={text.upper} value={rule.upper??''} maxLength={queryResultFilterLimits.valueUnits} disabled={!valid} onChange={event=>changeRule(group.id,id,rule=>({...rule,upper:event.target.value}),true)} onCompositionStart={beginComposition} onCompositionEnd={endComposition}/>}
      {members&&<div className="query-result-filter-members"><p>{text.membersHint}</p>{(rule.values??[]).map((value,member)=><div className="query-result-filter-member" key={member}><textarea rows={1} aria-label={text.member(index,member+1)} value={value} maxLength={queryResultFilterLimits.valueUnits} disabled={!valid} onChange={event=>changeRule(group.id,id,rule=>({...rule,values:rule.values?.map((value,position)=>position===member?event.target.value:value)}),true)} onCompositionStart={beginComposition} onCompositionEnd={endComposition}/><button aria-label={text.removeMember(index,member+1)} disabled={!valid||composing||(rule.values?.length??0)<=1} onClick={()=>changeRule(group.id,id,rule=>({...rule,values:rule.values?.filter((_,position)=>position!==member)}))}>×</button></div>)}<button aria-label={text.addMember(index)} disabled={!valid||composing||(rule.values?.length??0)>=queryResultFilterLimits.members} onClick={()=>changeRule(group.id,id,rule=>({...rule,values:[...(rule.values??[]),'']}))}>{text.addValue}</button><span className="muted">{text.memberCount(rule.values?.length??0,queryResultFilterLimits.members)}</span></div>}
      <button disabled={!valid||composing} aria-label={text.remove(index)} onClick={()=>replace(editGroup(draft,group.id,node=>({...node,children:node.children.filter(node=>node.id!==id)})))}>×</button></div>;
  })}{path&&!group.children.length&&<p>{text.emptyGroup}</p>}{path&&groupActions(group,path,depth)}</>;}
  return <section role="region" aria-label={text.title} className="query-result-filter-panel" onKeyDown={event=>{if(event.key==='Escape'&&!composition.current&&!event.nativeEvent.isComposing&&current()){event.preventDefault();onClose();}}}><strong>{text.title}</strong><p>{text.hint}</p><p>{text.groupsHint}</p><div className="query-result-filter-conditions">{renderGroup(draft,'',1)}</div>{!draft.children.length&&<p>{text.empty}</p>}{!valid&&<ErrorBox message={text.stale}/>}<div className="query-result-filter-actions">{groupActions(draft,'',1)}<button disabled={!valid||composing||!draft.children.length} onClick={()=>replace({...draft,children:[]})}>{text.clearDraft}</button><span className="grow"/>{composing&&<span>{text.composing}</span>}<button onClick={onClose}>{text.cancel}</button><button className="primary" disabled={!valid||composing} onClick={()=>{if(current(draft)&&!composition.current)onApply(expressionOf(draft));}}>{text.apply}</button></div></section>;
}
