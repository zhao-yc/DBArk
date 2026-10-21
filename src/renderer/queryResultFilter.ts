import type { CellValue, QueryResult, ResultColumn } from '../shared/contracts';
import { queryResultFilterKind, queryResultFilterKey, queryResultFilterLiteral, compareQueryResultFilterKeys, type QueryResultSortView } from './queryResultSort';
import { queryResultFilterZh as text } from './locales/queryResultFilter.zh-CN';
import { compileQueryResultWildcard } from './queryResultWildcard';

export const queryResultFilterLimits = Object.freeze({ rows:100000, columns:1024, conditions:32, groups:16, depth:8, members:128, work:2000000, textWork:32*1024*1024, valueUnits:4096, units:8*1024*1024 });
export type QueryResultFilterOperator = 'contains'|'notContains'|'startsWith'|'notStartsWith'|'endsWith'|'notEndsWith'|'like'|'notLike'|'empty'|'notEmpty'|'eq'|'ne'|'gt'|'gte'|'lt'|'lte'|'between'|'notBetween'|'in'|'notIn'|'null'|'notNull';
export type QueryResultFilterMode = 'AND'|'OR';
export interface QueryResultFilterRule { column:string;operator:QueryResultFilterOperator;value:string;upper?:string;values?:readonly string[];ignoreCase?:boolean;enabled?:boolean; }
export interface QueryResultFilterGroup { readonly mode:QueryResultFilterMode;readonly children:readonly (QueryResultFilterRule|QueryResultFilterGroup)[]; }
export interface QueryResultFilterView { readonly result:QueryResult;readonly sourceIndices:readonly number[];readonly rules:readonly Readonly<QueryResultFilterRule>[];readonly mode:QueryResultFilterMode;readonly expression:QueryResultFilterGroup; }
export interface QueryResultFilterBinding {
  readonly source:QueryResult;readonly rows:QueryResult['rows'];readonly columns:ResultColumn[];readonly rowRefs:readonly QueryResult['rows'][number][];readonly columnRefs:readonly ResultColumn[];
  readonly metadata:readonly ResultColumn[];readonly truncated:boolean;readonly context:readonly unknown[];readonly visible:ResultColumn[];readonly visibleRefs:readonly ResultColumn[];
}
type Snapshot = { column:ResultColumn;values:CellValue[];binary:readonly (readonly unknown[]|undefined)[] };
/** 字节仅留自有属性描述符的值身份，NULL条件也可发现原包装漂移，不解码/调用getter。 */
function binaryStamp(value:CellValue):readonly unknown[]|undefined{return value&&typeof value==='object'?[Object.getOwnPropertyDescriptor(value,'type')?.value,Object.getOwnPropertyDescriptor(value,'base64')?.value]:undefined;}
const fail=()=>Error(text.stale);
type FilterShape={readonly mode:QueryResultFilterMode;readonly children:readonly (number|FilterShape)[]};
/** 分组只接受自有数据属性；先限制深度、节点和条件数，再读取有界子数组，拒绝循环及空子组。 */
function prepareExpression(expression:QueryResultFilterGroup):{rules:QueryResultFilterRule[];shape:FilterShape}{
  const rules:QueryResultFilterRule[]=[],ancestors=new Set<object>();let groups=0;
  function own(node:object,key:string,required=false):unknown{
    const descriptor=Object.getOwnPropertyDescriptor(node,key);
    if(!descriptor){if(required)throw Error(text.invalid);return undefined;}
    if(!('value'in descriptor))throw Error(text.invalid);return descriptor.value;
  }
  function group(node:QueryResultFilterGroup,depth:number):FilterShape{
    if(!node||typeof node!=='object'||Array.isArray(node))throw Error(text.invalid);
    if(depth>queryResultFilterLimits.depth||++groups>queryResultFilterLimits.groups)throw Error(text.budget);
    if(ancestors.has(node))throw Error(text.invalid);
    const mode=own(node,'mode',true),source=own(node,'children',true);
    if(mode!=='AND'&&mode!=='OR'||!Array.isArray(source)||['column','operator','value','upper','values','ignoreCase','enabled'].some(key=>Object.hasOwn(node,key)))throw Error(text.invalid);
    const count=source.length;
    if(!Number.isSafeInteger(count)||count<0)throw Error(text.invalid);
    if(count>queryResultFilterLimits.conditions+queryResultFilterLimits.groups)throw Error(text.budget);
    if(!count&&depth>1)throw Error(text.emptyGroup);
    ancestors.add(node);const children:(number|FilterShape)[]=[];
    for(let index=0;index<count;index++){
      const child=own(source,String(index),true);
      if(!child||typeof child!=='object'||Array.isArray(child))throw Error(text.invalid);
      if(Object.hasOwn(child,'children'))children.push(group(child as QueryResultFilterGroup,depth+1));
      else{
        if(rules.length>=queryResultFilterLimits.conditions)throw Error(text.budget);
        if(Object.hasOwn(child,'mode'))throw Error(text.invalid);
        const rule={column:own(child,'column',true),operator:own(child,'operator',true),value:own(child,'value',true),upper:own(child,'upper'),values:own(child,'values'),ignoreCase:own(child,'ignoreCase'),enabled:own(child,'enabled')} as QueryResultFilterRule;
        children.push(rules.length);rules.push(rule);
      }
    }
    if(source.length!==count)throw Error(text.invalid);
    ancestors.delete(node);return Object.freeze({mode,children:Object.freeze(children)});
  }
  return{rules,shape:group(expression,1)};
}
/** 停用叶及仅含停用叶的组均不参与组合；避免空OR组被误当true扩大结果。 */
function matchExpression(shape:FilterShape,matches:readonly (boolean|undefined)[]):boolean|undefined{
  const values=shape.children.map(child=>typeof child==='number'?matches[child]:matchExpression(child,matches)).filter((value):value is boolean=>value!==undefined);
  if(!values.length)return undefined;
  return shape.mode==='AND'?values.every(Boolean):values.some(Boolean);
}
/** 冻结分组与已规范化的独立条件，避免面板重开后改变已生效树。 */
function freezeExpression(shape:FilterShape,rules:readonly Readonly<QueryResultFilterRule>[]):QueryResultFilterGroup{
  return Object.freeze({mode:shape.mode,children:Object.freeze(shape.children.map(child=>typeof child==='number'?rules[child]:freezeExpression(child,rules)))});
}
/** 为已生效条件追加AND叶；OR根保留为括号子组，开草稿前先核全部结构预算，不扫描结果。 */
export function appendQueryResultFilterRule(expression:QueryResultFilterGroup,rule:QueryResultFilterRule):QueryResultFilterGroup{
  const previous=prepareExpression(expression),addition=prepareExpression({mode:'AND',children:[rule]}),index=previous.rules.length;
  const shape:FilterShape=!previous.shape.children.length?{mode:'AND',children:[index]}:previous.shape.mode==='AND'?{mode:'AND',children:[...previous.shape.children,index]}:{mode:'AND',children:[previous.shape,index]};
  const next=freezeExpression(shape,[...previous.rules,...addition.rules].map(item=>Object.freeze({...item})));
  prepareExpression(next);return next;
}
/** 比较方式来自协议类型；未知/二进制元数据仍可做NULL判断，不按外观猜类型。 */
export function queryResultFilterOperators(column:ResultColumn):readonly QueryResultFilterOperator[]{
  const kind=queryResultFilterKind(column);
  return kind==='text'?['contains','notContains','startsWith','notStartsWith','endsWith','notEndsWith','like','notLike','eq','ne','in','notIn','empty','notEmpty','null','notNull']:kind?['eq','ne','gt','gte','lt','lte','between','notBetween','in','notIn','null','notNull']:['null','notNull'];
}
/** NULL、空文本和列表条件不接受隐藏单值；面板与控制器共用同一输入要求。 */
export function queryResultFilterNeedsValue(operator:QueryResultFilterOperator):boolean{return !['null','notNull','empty','notEmpty','in','notIn'].includes(operator);}
/** 区间使用独立上下限原文，不复用分隔符或把精确值转成浮点数。 */
export function queryResultFilterNeedsUpper(operator:QueryResultFilterOperator):boolean{return operator==='between'||operator==='notBetween';}
/** 成员使用独立原文数组，逗号、换行、引号和NULL字样不承担分隔或SQL语义。 */
export function queryResultFilterNeedsValues(operator:QueryResultFilterOperator):boolean{return operator==='in'||operator==='notIn';}
/** 仅有实际文本原值比较时提供大小写选项，NULL和空文本判断不保留隐藏选项。 */
export function queryResultFilterSupportsIgnoreCase(column:ResultColumn,operator:QueryResultFilterOperator):boolean{return queryResultFilterKind(column)==='text'&&queryResultFilterOperators(column).includes(operator)&&!['null','notNull','empty','notEmpty'].includes(operator);}
/** 只读取自有数据属性；访问器不执行，NULL判断也不解码二进制。 */
function cell(row:QueryResult['rows'][number],column:ResultColumn):CellValue {const d=Object.getOwnPropertyDescriptor(row,column.key);if(!d||!('value'in d))throw Error(text.value);return d.value;}
/** 当前完整源的单向租约；过滤保存原行引用，连被排除行的活动条件键也观察漂移。 */
export class QueryResultFilter {
  private binding?:QueryResultFilterBinding;private projection?:QueryResultFilterView;private snapshots?:Snapshot[];
  /** 撤销不修改原结果；同对象恢复也不复活旧owner。 */
  invalidate():void{this.binding=undefined;this.projection=undefined;this.snapshots=undefined;}
  /** 单独限制筛选准入；拒绝不会扩大或代替旧选择/导出/详情的各自预算。 */
  bind(source:QueryResult|undefined,context:readonly unknown[],visible=source?.columns):QueryResultFilterBinding|undefined{
    if(!source||!source.columns.length||!visible||source.rows.length>queryResultFilterLimits.rows||source.columns.length>queryResultFilterLimits.columns){this.invalidate();return;}
    const old=this.binding;if(old&&this.current(old)&&old.source===source&&old.visible===visible&&context.length===old.context.length&&context.every((v,i)=>Object.is(v,old.context[i])))return old;
    this.invalidate();const keys=source.columns.map(c=>c.key);
    if(keys.some(k=>typeof k!=='string'||!k||k.length>4096)||new Set(keys).size!==keys.length||new Set(source.rows).size!==source.rows.length||new Set(visible.map(c=>c.key)).size!==visible.length||visible.some(c=>!source.columns.includes(c)))return;
    const binding:QueryResultFilterBinding={source,rows:source.rows,columns:source.columns,rowRefs:source.rows.slice(),columnRefs:source.columns.slice(),metadata:source.columns.map(c=>({...c})),truncated:source.truncated,context:[...context],visible,visibleRefs:visible.slice()};
    this.binding=binding;this.projection=this.project(binding,[], 'AND',source.rows.map((_,i)=>i));return binding;
  }
  /** 源数组/原位置/元数据/活动条件值一旦漂移就永久撤销，旧owner不能撤销较新owner。 */
  current(binding:QueryResultFilterBinding|undefined):binding is QueryResultFilterBinding{
    if(!binding||this.binding!==binding)return false;
    if(binding.source.rows!==binding.rows||binding.source.columns!==binding.columns||binding.source.truncated!==binding.truncated||binding.rows.length!==binding.rowRefs.length||binding.columns.length!==binding.metadata.length||binding.rows.some((r,i)=>r!==binding.rowRefs[i])||binding.columns.some((c,i)=>c!==binding.columnRefs[i]||c.key!==binding.metadata[i].key||c.name!==binding.metadata[i].name||c.type!==binding.metadata[i].type)||binding.visible.length!==binding.visibleRefs.length||binding.visible.some((c,i)=>c!==binding.visibleRefs[i])){this.invalidate();return false;}
    try{if(this.snapshots?.some(({column,values,binary})=>binding.rows.some((row,i)=>{const value=cell(row,column),stamp=binaryStamp(value);return !Object.is(value,values[i])||!!stamp&&(!binary[i]||stamp.some((part,j)=>!Object.is(part,binary[i]![j])));}))){this.invalidate();return false;}}catch{this.invalidate();return false;}return true;
  }
  /** 只提供同一有效租约视图。 */
  view(binding:QueryResultFilterBinding|undefined):QueryResultFilterView|undefined{return this.current(binding)?this.projection:undefined;}
  /** 无条件返回准确原source；有条件仅创建冻结的原行引用数组与源位置映射。 */
  private project(binding:QueryResultFilterBinding,rules:readonly QueryResultFilterRule[],mode:QueryResultFilterMode,indices:number[],shape:FilterShape={mode,children:rules.map((_,index)=>index)}):QueryResultFilterView{
    const active=rules.some(rule=>rule.enabled!==false),rows=active?Object.freeze(indices.map(i=>binding.rows[i])) as unknown as QueryResult['rows']:binding.rows;
    const saved=Object.freeze(rules.map(r=>Object.freeze({...r,...(r.values?{values:Object.freeze([...r.values])}:{})})));
    return Object.freeze({result:active?Object.freeze({...binding.source,rows}):binding.source,sourceIndices:Object.freeze(indices),rules:saved,mode,expression:freezeExpression(shape,saved)});
  }
  /** 保留原平铺AND／OR入口，统一进入有界分组执行，不维护第二套比较器。 */
  apply(binding:QueryResultFilterBinding,previous:QueryResultFilterView,rules:readonly QueryResultFilterRule[],mode:QueryResultFilterMode):QueryResultFilterView{
    if(!this.current(binding)||this.projection!==previous)throw fail();
    if(rules.length>queryResultFilterLimits.conditions)throw Error(text.budget);
    return this.applyExpression(binding,previous,{mode,children:rules});
  }
  /** 全树先准入再完整扫描；分组不增加原叶条件或比较预算，失败保留旧视图。 */
  applyExpression(binding:QueryResultFilterBinding,previous:QueryResultFilterView,expression:QueryResultFilterGroup):QueryResultFilterView{
    if(!this.current(binding)||this.projection!==previous)throw fail();
    const {rules,shape}=prepareExpression(expression),mode=shape.mode;
    // 成员数先受硬上限约束再读取，每项必须是自有数据属性；稀疏值或访问器不能跳过验证。
    const memberSets=rules.map(rule=>{
      if(!queryResultFilterNeedsValues(rule.operator)){if(rule.values!==undefined)throw Error(text.invalid);return undefined;}
      const source=rule.values;if(!Array.isArray(source))throw Error(text.invalid);const count=source.length;
      if(!Number.isSafeInteger(count)||count<1)throw Error(text.invalid);if(count>queryResultFilterLimits.members)throw Error(text.budget);
      const values:string[]=[];
      for(let index=0;index<count;index++){const item=Object.getOwnPropertyDescriptor(source,index);if(!item||!('value'in item)||typeof item.value!=='string')throw Error(text.invalid);values.push(item.value);}
      if(source.length!==count)throw Error(text.invalid);
      return values;
    });
    const comparisons=rules.reduce((sum,rule,index)=>sum+(rule.enabled===false?0:memberSets[index]?.length??(queryResultFilterNeedsUpper(rule.operator)?2:1)),0);
    if(comparisons*binding.rows.length>queryResultFilterLimits.work)throw Error(text.budget);
    let units=0,textWork=0;
    /** 通配状态转移与既有比较共享工作预算；编译和空结果也核模式，不能跳过无效输入。 */
    function spendWildcard(work:number):void{ textWork+=work;if(textWork>queryResultFilterLimits.textWork)throw Error(text.budget); }
    /** 使用无locale的Unicode小写映射；原文与映射文本共同计费，扩展长度也受原上限限制。 */
    function fold(value:string):string{const folded=value.toLowerCase();units+=folded.length;if(folded.length>queryResultFilterLimits.valueUnits||units>queryResultFilterLimits.units)throw Error(text.budget);return folded;}
    // 停用输入仍完整计费并核结构；仅生效条件解析字面值、通配模式及读取源单元格。
    const admitted=rules.map((rule,index)=>({...rule,...(memberSets[index]?{values:memberSets[index]}:{})}));
    const compiled=admitted.flatMap((rule,index)=>{
      const column=binding.visible.find(c=>c.key===rule.column);if(!column||!queryResultFilterOperators(column).includes(rule.operator)||typeof rule.value!=='string')throw Error(text.invalid);
      if(rule.enabled!==undefined&&typeof rule.enabled!=='boolean')throw Error(text.invalid);
      if(rule.ignoreCase!==undefined&&(typeof rule.ignoreCase!=='boolean'||!queryResultFilterSupportsIgnoreCase(column,rule.operator)))throw Error(text.invalid);
      const nullable=rule.operator==='null'||rule.operator==='notNull',range=queryResultFilterNeedsUpper(rule.operator);
      if((!queryResultFilterNeedsValue(rule.operator)&&rule.value!=='')||(range?typeof rule.upper!=='string':rule.upper!==undefined))throw Error(text.invalid);
      const memberInputs=memberSets[index];
      for(const value of memberInputs??(range?[rule.value,rule.upper!]:[rule.value])){
        if(value.length>queryResultFilterLimits.valueUnits)throw Error(text.budget);units+=value.length;if(units>queryResultFilterLimits.units)throw Error(text.budget);
      }
      if(rule.enabled===false)return [];
      let literal:CellValue|null,upper:CellValue|null,key:ReturnType<typeof queryResultFilterKey>|null,upperKey:ReturnType<typeof queryResultFilterKey>|null;
      let members:{input:string;literal:CellValue;key:ReturnType<typeof queryResultFilterKey>}[]|undefined;
      try{
        literal=nullable||memberInputs?null:queryResultFilterLiteral(column,rule.value);key=nullable||memberInputs?null:queryResultFilterKey(column,literal!);
        upper=range?queryResultFilterLiteral(column,rule.upper!):null;upperKey=range?queryResultFilterKey(column,upper!):null;
        members=memberInputs?.map(input=>{const literal=queryResultFilterLiteral(column,input);return{input,literal,key:queryResultFilterKey(column,literal)};});
      }catch{throw Error(text.value);}
      // 仅转换控制器自有比较键，保存的规则、源单元格和后续排序仍保留原文。
      if(rule.ignoreCase){literal=members?null:fold(literal as string);key=literal;members=members?.map(member=>{const literal=fold(member.literal as string);return{...member,literal,key:literal};});}
      // 下限大于上限时完整拒绝，不能猜测交换端点或把否定区间变成全量结果。
      if(range&&compareQueryResultFilterKeys(key,upperKey)>0)throw Error(text.rangeOrder);
      const wildcard=rule.operator==='like'||rule.operator==='notLike'?compileQueryResultWildcard(literal as string,spendWildcard):undefined;
      return[{rule,index,column,nullable,range,literal,key,upper,upperKey,members,wildcard}];
    });
    if(!compiled.length){
      if(!this.current(binding)||this.projection!==previous)throw fail();this.snapshots=undefined;
      return this.projection=this.project(binding,admitted,mode,binding.rows.map((_,index)=>index),shape);
    }
    const snapshots:Snapshot[]=[...new Map(compiled.map(c=>[c.column.key,c.column])).values()].map(column=>{const values=binding.rows.map(row=>cell(row,column));return{column,values,binary:values.map(binaryStamp)};});
    const prepared=new Map(snapshots.map(s=>{
      const scalar=compiled.some(c=>c.column===s.column&&!c.nullable);
      return[s.column.key,s.values.map(value=>{if(!scalar)return null;units+=typeof value==='string'?value.length:1;if(typeof value==='string'&&value.length>queryResultFilterLimits.valueUnits||units>queryResultFilterLimits.units)throw Error(text.budget);try{return queryResultFilterKey(s.column,value);}catch{throw Error(text.value);}})] as const;
    }));
    // 同一文本列的忽略大小写键只生成一次；大小写敏感条件继续使用原键。
    const folded=new Map<string,(string|null)[]>(snapshots.filter(s=>compiled.some(c=>c.column===s.column&&c.rule.ignoreCase)).map(s=>[s.column.key,s.values.map(value=>value===null?null:fold(value as string))]));
    const data=new Map(snapshots.map(s=>[s.column.key,s.values])),indices:number[]=[];
    for(let i=0;i<binding.rows.length;i++){
      const activeMatches=compiled.map(({rule,column,nullable,range,literal,key,upper,upperKey,members,wildcard})=>{
        const value=data.get(column.key)![i];if(nullable)return rule.operator==='null'?value===null:value!==null;if(value===null)return false;
        const comparable=rule.ignoreCase?folded.get(column.key)![i]:value,cellKey=rule.ignoreCase?comparable as string:prepared.get(column.key)![i];
        // 包含及其否定按最坏匹配量计费；前后缀按原文和条件长度计费，共用同一工作预算。
        const size=typeof comparable==='string'?comparable.length:1,input=typeof literal==='string'?literal.length:1;
        if(members){
          // 即使提前匹配也比较所有成员并计费，否定集合仍排除前面处理的NULL。
          let matched=false;
          for(const member of members){textWork+=size+(typeof member.literal==='string'?member.literal.length:1);if(textWork>queryResultFilterLimits.textWork)throw Error(text.budget);if(compareQueryResultFilterKeys(cellKey,member.key)===0)matched=true;}
          return rule.operator==='in'?matched:!matched;
        }
        const containing=rule.operator==='contains'||rule.operator==='notContains',starting=rule.operator==='startsWith'||rule.operator==='notStartsWith',ending=rule.operator==='endsWith'||rule.operator==='notEndsWith';
        textWork+=containing?(input?Math.max(1,size)*input:1):size+input;
        if(range)textWork+=size+(typeof upper==='string'?upper.length:1);
        if(textWork>queryResultFilterLimits.textWork)throw Error(text.budget);
        if(wildcard){
          if(typeof comparable!=='string')throw Error(text.value);
          const matched=wildcard(comparable);return rule.operator==='notLike'?!matched:matched;
        }
        if(containing||starting||ending){
          if(typeof comparable!=='string'||typeof literal!=='string')throw Error(text.value);
          // 可选小写映射后仍按字面匹配；否定排除NULL，不解析正则或SQL通配符。
          const matched=containing?comparable.includes(literal):starting?comparable.startsWith(literal):comparable.endsWith(literal);
          return rule.operator==='notContains'||rule.operator==='notStartsWith'||rule.operator==='notEndsWith'?!matched:matched;
        }
        const order=compareQueryResultFilterKeys(cellKey,key);
        if(range){
          const upperOrder=compareQueryResultFilterKeys(prepared.get(column.key)![i],upperKey);
          return rule.operator==='between'?order>=0&&upperOrder<=0:order<0||upperOrder>0;
        }
        return rule.operator==='eq'||rule.operator==='empty'?order===0:rule.operator==='ne'||rule.operator==='notEmpty'?order!==0:rule.operator==='gt'?order>0:rule.operator==='gte'?order>=0:rule.operator==='lt'?order<0:order<=0;
      });
      const matches:(boolean|undefined)[]=new Array(rules.length);
      compiled.forEach((entry,index)=>{matches[entry.index]=activeMatches[index];});
      if(matchExpression(shape,matches)??true)indices.push(i);
    }
    if(!this.current(binding)||this.projection!==previous)throw fail();this.snapshots=snapshots;
    return this.projection=this.project(binding,admitted,mode,indices,shape);
  }
}
/** 排序位置相对过滤结果；这里显式合成为原返回位置，仍共享同一个最终QueryResult容器。 */
export function queryResultFilteredSortView(filtered:QueryResultFilterView|undefined,sorted:QueryResultSortView|undefined):{readonly result:QueryResult;readonly sourceIndices:readonly number[]}|undefined{
  if(!filtered)return sorted;if(!sorted)return filtered;
  if(sorted.sourceIndices.some((index,i)=>!Number.isSafeInteger(index)||index<0||index>=filtered.sourceIndices.length||sorted.result.rows[i]!==filtered.result.rows[index])||sorted.result.rows.length!==sorted.sourceIndices.length)throw fail();
  return Object.freeze({result:sorted.result,sourceIndices:Object.freeze(sorted.sourceIndices.map(i=>filtered.sourceIndices[i]))});
}
