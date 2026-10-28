import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { QueryResultFilterBinding, QueryResultFilterGroup, QueryResultFilterOperator, QueryResultFilterRule, QueryResultFilterView } from '../queryResultFilter';
import { assertQueryResultFilterExpressionBudget, queryResultFilterLimits, queryResultFilterNeedsUpper, queryResultFilterNeedsValue, queryResultFilterNeedsValues, queryResultFilterOperators, queryResultFilterSupportsIgnoreCase } from '../queryResultFilter';
import { captureQueryResultValueOptions, currentQueryResultValueOptions } from '../queryResultValueOptions';
import { queryResultValueOptionsZh as valueText } from '../locales/queryResultValueOptions.zh-CN';
import { QueryResultValuePicker } from './QueryResultValuePicker';
import { queryResultFilterZh as text } from '../locales/queryResultFilter.zh-CN';
import { ErrorBox } from './ui';
import '../queryResultFilter.css';

type DraftRule={id:number;kind:'rule';rule:QueryResultFilterRule};
type DraftGroup={id:number;kind:'group';mode:QueryResultFilterGroup['mode'];children:(DraftRule|DraftGroup)[]};
type ValuePickerOwner={id:number;parent:number;rule:DraftRule;draft:DraftGroup;capture:ReturnType<typeof captureQueryResultValueOptions>};
type SelectOption=Readonly<{value:string;label:string}>;
/** 只复用无事件的选项显示；逐项比较顺序、值和文案，不持有来源、权限或回调。 */
const SelectOptions=memo(function SelectOptions({options}:{options:readonly SelectOption[]}){
  return <>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</>;
},(previous,next)=>previous.options.length===next.options.length&&previous.options.every((option,index)=>option.value===next.options[index].value&&option.label===next.options[index].label));
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
export function QueryResultFilterPanel({binding,initial,seed,isCurrent,onApply,onClose}:{binding:QueryResultFilterBinding;initial:QueryResultFilterView;seed?:QueryResultFilterGroup;isCurrent():boolean;onApply(expression:QueryResultFilterGroup):void;onClose():void}){
  // 每轮复制字符串显示快照，不按源数组身份缓存，元数据原地变化也能触发选项更新。
  const columnOptions:readonly SelectOption[]=binding.visible.map((column,index)=>({value:column.key,label:`${index+1}. ${column.name} · ${column.type}`}));
  const sequence=useRef(0),[draft,setDraft]=useState<DraftGroup>(()=>copyDraft(seed??initial.expression??{mode:initial.mode,children:initial.rules},()=>sequence.current++));
  const live=useRef(draft),invalid=useRef(false),composition=useRef(false),[composing,setComposing]=useState(false);live.current=draft;
  const pickerRef=useRef<ValuePickerOwner|null>(null),[picker,setPicker]=useState<ValuePickerOwner|null>(null),[pickerError,setPickerError]=useState('');
  const destinations=useRef(new Map<number,HTMLSelectElement>()),focusAfterMove=useRef<number|null>(null);
  /** 跨组会重新挂载条件；只为原先聚焦的选择框恢复焦点，失效面板不抢其它窗口的输入。 */
  useLayoutEffect(()=>{const id=focusAfterMove.current;focusAfterMove.current=null;if(id!==null&&current())destinations.current.get(id)?.focus();});
  /** 首次失效永久拒绝，旧回调不能写入另一棵草稿或移除后占据相同位置的节点。 */
  function current(expected=live.current):boolean{if(invalid.current)return false;let okay=false;try{okay=isCurrent()===true;}catch{}if(!okay)invalid.current=true;return okay&&live.current===expected;}
  /** 同步更新根身份；组合输入期间仅允许所属输入框更新原文。 */
  function replace(next:DraftGroup,input=false):void{if(pickerRef.current||!current(draft)||composition.current&&!input)return;live.current=next;setDraft(next);}
  /** 候选来自原返回全部行；同一草稿叶及完整结果捕获共同限定所属，不受已生效筛选缩窄。 */
  function openValues(parent:number,rule:DraftRule):void{
    if(pickerRef.current||!current(draft)||composition.current)return;
    try{
      const column=binding.visible.find(column=>column.key===rule.rule.column);if(!column)return;
      const capture=captureQueryResultValueOptions(binding.columns,binding.rows,column);
      if(!current(draft))return;
      const owner={id:sequence.current++,parent,rule,draft,capture};pickerRef.current=owner;setPicker(owner);setPickerError('');
    }catch(reason){setPickerError(reason instanceof Error?reason.message:valueText.unavailable);}
  }
  /** 捕获后任何来源或父草稿漂移均不可复活；无效窗口仍可单独取消。 */
  function pickerCurrent(owner:ValuePickerOwner):boolean{return pickerRef.current===owner&&current(owner.draft)&&currentQueryResultValueOptions(owner.capture,binding.columns,binding.rows);}
  /** 只替换原条件草稿；新增NULL子组保留原启停位，完整树预算成功后才发布，不调用父onApply。 */
  function stageValues(owner:ValuePickerOwner,node:QueryResultFilterRule|QueryResultFilterGroup):void{
    if(!pickerCurrent(owner))throw Error(valueText.stale);
    const disabled=owner.rule.rule.enabled===false;
    function retainEnabled(value:QueryResultFilterRule|QueryResultFilterGroup):QueryResultFilterRule|QueryResultFilterGroup{
      return 'children'in value?{mode:value.mode,children:value.children.map(retainEnabled)}:{...value,...(value.values?{values:[...value.values]}:{}),...(disabled?{enabled:false}:{})};
    }
    const admitted=retainEnabled(node),replacement:DraftRule|DraftGroup='children'in admitted?copyDraft(admitted,()=>sequence.current++):{id:sequence.current++,kind:'rule',rule:admitted};
    let replaced=false;const next=editGroup(owner.draft,owner.parent,group=>({...group,children:group.children.map(child=>{if(child!==owner.rule)return child;replaced=true;return replacement;})}));
    if(!replaced)throw Error(valueText.stale);
    assertQueryResultFilterExpressionBudget(expressionOf(next));if(!pickerCurrent(owner))throw Error(valueText.stale);
    pickerRef.current=null;setPicker(null);setPickerError('');live.current=next;setDraft(next);
  }
  /** 迟到取消只关闭自己的候选，不关闭较新候选或外层筛选面板。 */
  function closeValues(owner:ValuePickerOwner):void{if(pickerRef.current===owner){pickerRef.current=null;setPicker(null);}}
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
  /** 在同组原条件之后创建独立副本；旧草稿、组合输入和总条件上限仍由原租约保护。 */
  function duplicateRule(parent:number,id:number):void{
    if(!current(draft)||composition.current||numbers.size>=queryResultFilterLimits.conditions)return;
    replace(editGroup(draft,parent,group=>{
      const index=group.children.findIndex(child=>child.kind==='rule'&&child.id===id),source=group.children[index];
      if(!source||source.kind!=='rule')return group;
      const children=group.children.slice(),rule={...source.rule,...(source.rule.values?{values:[...source.rule.values]}:{})};
      children.splice(index+1,0,{id:sequence.current++,kind:'rule',rule});return{...group,children};
    }));
  }
  /** 只在当前草稿内移动原叶节点；保留稳定ID及完整原值，空原组仍由既有应用校验明确处理。 */
  function moveRule(parent:number,id:number,destination:string):void{
    if(!current(draft)||composition.current||!/^(0|[1-9]\d*)$/.test(destination))return;
    const target=Number(destination);if(!Number.isSafeInteger(target)||target===parent||!groupNames.has(target))return;
    let source:DraftRule|undefined;
    function find(group:DraftGroup):void{if(group.id===parent){const node=group.children.find(child=>child.kind==='rule'&&child.id===id);if(node?.kind==='rule')source=node;}else for(const node of group.children)if(node.kind==='group')find(node);}
    find(draft);if(!source)return;
    const control=destinations.current.get(id);if(control&&control.ownerDocument.activeElement===control)focusAfterMove.current=id;
    const removed=editGroup(draft,parent,group=>({...group,children:group.children.filter(child=>child.id!==id)}));
    replace(editGroup(removed,target,group=>({...group,children:[...group.children,source!]})));
  }
  /** 批量启停只修改当前草稿的启用位；保留所有层级、稳定ID、成员与原文，不应用或扫描结果。 */
  function setAllEnabled(enabled:boolean):void{
    if(!current(draft)||composition.current||!numbers.size||(enabled?enabledCount===numbers.size:enabledCount===0))return;
    function change(group:DraftGroup):DraftGroup{
      return{...group,children:group.children.map(child=>{
        if(child.kind==='group')return change(child);
        const{enabled:previous,...rule}=child.rule;
        return{...child,rule:enabled?rule:{...rule,enabled:false}};
      })};
    }
    replace(change(draft));
  }
  /** 输入法组合不会变成应用或跨面板解锁。 */
  function beginComposition():void{if(current(draft)){composition.current=true;setComposing(true);}}
  function endComposition():void{if(current()){composition.current=false;setComposing(false);}}
  /** 按钮与显式快捷键共用原草稿租约，组合输入结束前不得提交。 */
  function applyDraft():void{if(!pickerRef.current&&current(draft)&&!composition.current)onApply(expressionOf(draft));}
  /** 只处理未被子控件消费的明确命令；普通Enter、组合Esc、输入法确认和长按不提交。 */
  function keyDown(event:KeyboardEvent<HTMLElement>):void{
    if(pickerRef.current)return;
    if(event.defaultPrevented||composition.current||event.nativeEvent.isComposing||event.keyCode===229)return;
    const apply=event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey;
    const cancel=event.key==='Escape'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey;
    if(!apply&&!cancel)return;
    event.preventDefault();event.stopPropagation();
    if(event.repeat)return;
    if(apply)applyDraft();else if(current(draft))onClose();
  }
  const valid=current()&&!picker,numbers=new Map<number,number>(),groupNames=new Map<number,string>();let groups=0,enabledCount=0;
  /** 展示编号按树顺序连续排列，编辑身份始终使用稳定ID而非展示位置。 */
  function count(group:DraftGroup,path=''):void{groups++;groupNames.set(group.id,path?text.group(path):text.rootGroup);let childGroup=0;for(const child of group.children)if(child.kind==='group')count(child,path?path+'.'+(++childGroup):String(++childGroup));else{numbers.set(child.id,numbers.size+1);if(child.rule.enabled!==false)enabledCount++;}}
  count(draft);
  /** 各组独立组合；新增子组自带一个可见条件，空子组应用时由控制器明确拒绝。 */
  function groupActions(group:DraftGroup,path:string,depth:number){return <div className="query-result-filter-group-actions"><button disabled={!valid||composing||numbers.size>=queryResultFilterLimits.conditions||!binding.visible.length} onClick={()=>replace(editGroup(draft,group.id,node=>({...node,children:[...node.children,newRule()]})))}>{path?text.addInGroup(path):text.add}</button><button disabled={!valid||composing||numbers.size>=queryResultFilterLimits.conditions||groups>=queryResultFilterLimits.groups||depth>=queryResultFilterLimits.depth||!binding.visible.length} onClick={()=>replace(editGroup(draft,group.id,node=>({...node,children:[...node.children,{id:sequence.current++,kind:'group',mode:'OR',children:[newRule()]}]})))}>{path?text.addGroupInGroup(path):text.addGroup}</button>
    {!path&&<><button type="button" aria-label={text.enableAll} title={text.bulkHint} disabled={!valid||composing||enabledCount===numbers.size} onClick={()=>setAllEnabled(true)}>{text.enableAllLabel}</button><button type="button" aria-label={text.disableAll} title={text.bulkHint} disabled={!valid||composing||enabledCount===0} onClick={()=>setAllEnabled(false)}>{text.disableAllLabel}</button></>}
  </div>;}
  /** 递归渲染深度受草稿构造和控制器双重限制，不拼接SQL或解析括号文本。 */
  function renderGroup(group:DraftGroup,path:string,depth:number):ReactNode{let childGroup=0;return <><label>{path?text.groupMode(path):text.mode}<select aria-label={path?text.groupMode(path):text.mode} value={group.mode} disabled={!valid||composing} onChange={event=>replace(editGroup(draft,group.id,node=>({...node,mode:event.target.value as QueryResultFilterGroup['mode']})))}><option value="AND">{text.and}</option><option value="OR">{text.or}</option></select></label>{group.children.map(child=>{
    if(child.kind==='group'){const childPath=path?`${path}.${++childGroup}`:String(++childGroup);return <fieldset className="query-result-filter-group" aria-label={text.group(childPath)} key={child.id}><legend>{text.group(childPath)}</legend>{renderGroup(child,childPath,depth+1)}<button aria-label={text.removeGroup(childPath)} disabled={!valid||composing} onClick={()=>replace(editGroup(draft,group.id,node=>({...node,children:node.children.filter(node=>node.id!==child.id)})))}>{text.removeGroup(childPath)}</button></fieldset>;}
    const{id,rule}=child,index=numbers.get(id)!,column=binding.visible.find(c=>c.key===rule.column)!,operators=queryResultFilterOperators(column),needsValue=queryResultFilterNeedsValue(rule.operator),range=queryResultFilterNeedsUpper(rule.operator),members=queryResultFilterNeedsValues(rule.operator);
    const operatorOptions:readonly SelectOption[]=operators.map(operator=>({value:operator,label:text.operators[operator]}));
    return <div className="query-result-filter-condition" key={id} aria-label={text.condition(index)}><span>{index}</span><label className="query-result-filter-enable" title={text.enabledHint}><input type="checkbox" aria-label={text.enabled(index)} checked={rule.enabled!==false} disabled={!valid||composing} onChange={event=>changeRule(group.id,id,rule=>{const{enabled,...base}=rule;return event.target.checked?base:{...base,enabled:false};})}/>{text.enabledLabel}</label><select aria-label={`${text.column} ${index}`} value={rule.column} disabled={!valid||composing} onChange={event=>{const next=binding.visible.find(c=>c.key===event.target.value);if(next)changeRule(group.id,id,rule=>({column:next.key,operator:queryResultFilterOperators(next)[0],value:'',...(rule.enabled===false?{enabled:false}:{})}));}}><SelectOptions options={columnOptions}/></select><select aria-label={`${text.operator} ${index}`} value={rule.operator} disabled={!valid||composing} onChange={event=>changeOperator(group.id,id,event.target.value as QueryResultFilterOperator)}><SelectOptions options={operatorOptions}/></select>
      {queryResultFilterSupportsIgnoreCase(column,rule.operator)&&<label title={text.ignoreCaseHint}><input type="checkbox" aria-label={text.ignoreCase(index)} checked={rule.ignoreCase===true} disabled={!valid||composing} onChange={event=>changeRule(group.id,id,rule=>{const{ignoreCase,...base}=rule;return event.target.checked?{...base,ignoreCase:true}:base;})}/>{text.ignoreCaseLabel}</label>}
      {groups>1&&<label className="query-result-filter-destination" title={text.moveHint}>{text.destinationLabel}<select aria-label={text.destination(index)} value={String(group.id)} disabled={!valid||composing} ref={node=>{if(node)destinations.current.set(id,node);else destinations.current.delete(id);}} onChange={event=>{if(current(draft)&&!composition.current)moveRule(group.id,id,event.target.value);}}>{[...groupNames].map(([id,label])=><option key={id} value={String(id)}>{label}</option>)}</select></label>}
      {!members&&<input aria-label={`${range?text.lower:text.input} ${index}`} placeholder={range?text.lower:undefined} value={rule.value} maxLength={queryResultFilterLimits.valueUnits} disabled={!valid||!needsValue} onChange={event=>changeRule(group.id,id,rule=>({...rule,value:event.target.value}),true)} onCompositionStart={beginComposition} onCompositionEnd={endComposition}/>}
      {range&&<input aria-label={`${text.upper} ${index}`} placeholder={text.upper} value={rule.upper??''} maxLength={queryResultFilterLimits.valueUnits} disabled={!valid} onChange={event=>changeRule(group.id,id,rule=>({...rule,upper:event.target.value}),true)} onCompositionStart={beginComposition} onCompositionEnd={endComposition}/>}
      {members&&<div className="query-result-filter-members"><p>{text.membersHint}</p>{(rule.values??[]).map((value,member)=><div className="query-result-filter-member" key={member}><textarea rows={1} aria-label={text.member(index,member+1)} value={value} maxLength={queryResultFilterLimits.valueUnits} disabled={!valid} onChange={event=>changeRule(group.id,id,rule=>({...rule,values:rule.values?.map((value,position)=>position===member?event.target.value:value)}),true)} onCompositionStart={beginComposition} onCompositionEnd={endComposition}/><button aria-label={text.removeMember(index,member+1)} disabled={!valid||composing||(rule.values?.length??0)<=1} onClick={()=>changeRule(group.id,id,rule=>({...rule,values:rule.values?.filter((_,position)=>position!==member)}))}>×</button></div>)}<button aria-label={text.addMember(index)} disabled={!valid||composing||(rule.values?.length??0)>=queryResultFilterLimits.members} onClick={()=>changeRule(group.id,id,rule=>({...rule,values:[...(rule.values??[]),'']}))}>{text.addValue}</button><span className="muted">{text.memberCount(rule.values?.length??0,queryResultFilterLimits.members)}</span></div>}
      <button disabled={!valid||composing||!operators.includes('eq')} aria-label={valueText.openCondition(index)} onClick={()=>openValues(group.id,child)}>{valueText.open}</button>
      <button disabled={!valid||composing||numbers.size>=queryResultFilterLimits.conditions} aria-label={text.duplicate(index)} onClick={()=>duplicateRule(group.id,id)}>{text.duplicateLabel}</button><button disabled={!valid||composing} aria-label={text.remove(index)} onClick={()=>replace(editGroup(draft,group.id,node=>({...node,children:node.children.filter(node=>node.id!==id)})))}>×</button>{(rule.operator==='like'||rule.operator==='notLike')&&<p className="query-result-filter-pattern-hint">{text.patternHint}</p>}</div>;
  })}{path&&!group.children.length&&<p>{text.emptyGroup}</p>}{path&&groupActions(group,path,depth)}</>;}
  return <section role="region" aria-label={text.title} className="query-result-filter-panel" onKeyDown={keyDown}><strong>{text.title}</strong><p>{text.hint}</p><p>{text.groupsHint}</p><p>{text.shortcuts}</p><div className="query-result-filter-conditions">{renderGroup(draft,'',1)}</div>{!draft.children.length&&<p>{text.empty}</p>}{!current()&&<ErrorBox message={text.stale}/>}<ErrorBox message={pickerError}/>{picker&&<><p>{binding.truncated?text.truncated:valueText.scope}</p><QueryResultValuePicker key={picker.id} capture={picker.capture} isCurrent={()=>pickerCurrent(picker)} onApply={node=>stageValues(picker,node)} onClose={()=>closeValues(picker)}/></>}<div className="query-result-filter-actions">{groupActions(draft,'',1)}<button disabled={!valid||composing||!draft.children.length} onClick={()=>replace({...draft,children:[]})}>{text.clearDraft}</button><span className="grow"/>{composing&&<span>{text.composing}</span>}<button disabled={!!picker} onClick={onClose}>{text.cancel}</button><button className="primary" aria-keyshortcuts="Control+Enter Meta+Enter" disabled={!valid||composing} onClick={applyDraft}>{text.apply}</button></div></section>;
}
