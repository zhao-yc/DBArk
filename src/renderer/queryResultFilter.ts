import type { CellValue, QueryResult, ResultColumn } from '../shared/contracts';
import { queryResultFilterKind, queryResultFilterKey, queryResultFilterLiteral, compareQueryResultFilterKeys, type QueryResultSortView } from './queryResultSort';
import { queryResultFilterZh as text } from './locales/queryResultFilter.zh-CN';

export const queryResultFilterLimits = Object.freeze({ rows:100000, columns:1024, conditions:32, members:128, work:2000000, textWork:32*1024*1024, valueUnits:4096, units:8*1024*1024 });
export type QueryResultFilterOperator = 'contains'|'notContains'|'startsWith'|'notStartsWith'|'endsWith'|'notEndsWith'|'empty'|'notEmpty'|'eq'|'ne'|'gt'|'gte'|'lt'|'lte'|'between'|'notBetween'|'in'|'notIn'|'null'|'notNull';
export type QueryResultFilterMode = 'AND'|'OR';
export interface QueryResultFilterRule { column:string;operator:QueryResultFilterOperator;value:string;upper?:string;values?:readonly string[]; }
export interface QueryResultFilterView { readonly result:QueryResult;readonly sourceIndices:readonly number[];readonly rules:readonly Readonly<QueryResultFilterRule>[];readonly mode:QueryResultFilterMode; }
export interface QueryResultFilterBinding {
  readonly source:QueryResult;readonly rows:QueryResult['rows'];readonly columns:ResultColumn[];readonly rowRefs:readonly QueryResult['rows'][number][];readonly columnRefs:readonly ResultColumn[];
  readonly metadata:readonly ResultColumn[];readonly truncated:boolean;readonly context:readonly unknown[];readonly visible:ResultColumn[];readonly visibleRefs:readonly ResultColumn[];
}
type Snapshot = { column:ResultColumn;values:CellValue[];binary:readonly (readonly unknown[]|undefined)[] };
/** 字节仅留自有属性描述符的值身份，NULL条件也可发现原包装漂移，不解码/调用getter。 */
function binaryStamp(value:CellValue):readonly unknown[]|undefined{return value&&typeof value==='object'?[Object.getOwnPropertyDescriptor(value,'type')?.value,Object.getOwnPropertyDescriptor(value,'base64')?.value]:undefined;}
const fail=()=>Error(text.stale);
/** 比较方式来自协议类型；未知/二进制元数据仍可做NULL判断，不按外观猜类型。 */
export function queryResultFilterOperators(column:ResultColumn):readonly QueryResultFilterOperator[]{
  const kind=queryResultFilterKind(column);
  return kind==='text'?['contains','notContains','startsWith','notStartsWith','endsWith','notEndsWith','eq','ne','in','notIn','empty','notEmpty','null','notNull']:kind?['eq','ne','gt','gte','lt','lte','between','notBetween','in','notIn','null','notNull']:['null','notNull'];
}
/** NULL、空文本和列表条件不接受隐藏单值；面板与控制器共用同一输入要求。 */
export function queryResultFilterNeedsValue(operator:QueryResultFilterOperator):boolean{return !['null','notNull','empty','notEmpty','in','notIn'].includes(operator);}
/** 区间使用独立上下限原文，不复用分隔符或把精确值转成浮点数。 */
export function queryResultFilterNeedsUpper(operator:QueryResultFilterOperator):boolean{return operator==='between'||operator==='notBetween';}
/** 成员使用独立原文数组，逗号、换行、引号和NULL字样不承担分隔或SQL语义。 */
export function queryResultFilterNeedsValues(operator:QueryResultFilterOperator):boolean{return operator==='in'||operator==='notIn';}
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
  private project(binding:QueryResultFilterBinding,rules:readonly QueryResultFilterRule[],mode:QueryResultFilterMode,indices:number[]):QueryResultFilterView{
    const rows=rules.length?Object.freeze(indices.map(i=>binding.rows[i])) as unknown as QueryResult['rows']:binding.rows;
    return Object.freeze({result:rules.length?Object.freeze({...binding.source,rows}):binding.source,sourceIndices:Object.freeze(indices),rules:Object.freeze(rules.map(r=>Object.freeze({...r,...(r.values?{values:Object.freeze([...r.values])}:{})}))),mode});
  }
  /** 全条件先准入再完整扫描；不短路绕过坏值或总预算，失败不部分采用草稿。 */
  apply(binding:QueryResultFilterBinding,previous:QueryResultFilterView,rules:readonly QueryResultFilterRule[],mode:QueryResultFilterMode):QueryResultFilterView{
    if(!this.current(binding)||this.projection!==previous)throw fail();if(!['AND','OR'].includes(mode))throw Error(text.invalid);
    if(rules.length>queryResultFilterLimits.conditions)throw Error(text.budget);
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
    const comparisons=rules.reduce((sum,rule,index)=>sum+(memberSets[index]?.length??(queryResultFilterNeedsUpper(rule.operator)?2:1)),0);
    if(comparisons*binding.rows.length>queryResultFilterLimits.work)throw Error(text.budget);
    let units=0;
    const compiled=rules.map((rule,index)=>{
      const column=binding.visible.find(c=>c.key===rule.column);if(!column||!queryResultFilterOperators(column).includes(rule.operator)||typeof rule.value!=='string')throw Error(text.invalid);
      const nullable=rule.operator==='null'||rule.operator==='notNull',range=queryResultFilterNeedsUpper(rule.operator);
      if((!queryResultFilterNeedsValue(rule.operator)&&rule.value!=='')||(range?typeof rule.upper!=='string':rule.upper!==undefined))throw Error(text.invalid);
      const memberInputs=memberSets[index];
      for(const value of memberInputs??(range?[rule.value,rule.upper!]:[rule.value])){
        if(value.length>queryResultFilterLimits.valueUnits)throw Error(text.budget);units+=value.length;if(units>queryResultFilterLimits.units)throw Error(text.budget);
      }
      let literal:CellValue|null,upper:CellValue|null,key:ReturnType<typeof queryResultFilterKey>|null,upperKey:ReturnType<typeof queryResultFilterKey>|null;
      let members:{input:string;literal:CellValue;key:ReturnType<typeof queryResultFilterKey>}[]|undefined;
      try{
        literal=nullable||memberInputs?null:queryResultFilterLiteral(column,rule.value);key=nullable||memberInputs?null:queryResultFilterKey(column,literal!);
        upper=range?queryResultFilterLiteral(column,rule.upper!):null;upperKey=range?queryResultFilterKey(column,upper!):null;
        members=memberInputs?.map(input=>{const literal=queryResultFilterLiteral(column,input);return{input,literal,key:queryResultFilterKey(column,literal)};});
      }catch{throw Error(text.value);}
      // 下限大于上限时完整拒绝，不能猜测交换端点或把否定区间变成全量结果。
      if(range&&compareQueryResultFilterKeys(key,upperKey)>0)throw Error(text.rangeOrder);
      return{rule,column,nullable,range,literal,key,upper,upperKey,members};
    });
    const snapshots:Snapshot[]=[...new Map(compiled.map(c=>[c.column.key,c.column])).values()].map(column=>{const values=binding.rows.map(row=>cell(row,column));return{column,values,binary:values.map(binaryStamp)};});
    const prepared=new Map(snapshots.map(s=>{
      const scalar=compiled.some(c=>c.column===s.column&&!c.nullable);
      return[s.column.key,s.values.map(value=>{if(!scalar)return null;units+=typeof value==='string'?value.length:1;if(typeof value==='string'&&value.length>queryResultFilterLimits.valueUnits||units>queryResultFilterLimits.units)throw Error(text.budget);try{return queryResultFilterKey(s.column,value);}catch{throw Error(text.value);}})] as const;
    }));
    const data=new Map(snapshots.map(s=>[s.column.key,s.values])),indices:number[]=[];
    let textWork=0;
    for(let i=0;i<binding.rows.length;i++){
      const matches=compiled.map(({rule,column,nullable,range,literal,key,upper,upperKey,members})=>{
        const value=data.get(column.key)![i];if(nullable)return rule.operator==='null'?value===null:value!==null;if(value===null)return false;
        // 包含及其否定按最坏匹配量计费；前后缀按原文和条件长度计费，共用同一工作预算。
        const size=typeof value==='string'?value.length:1,input=typeof literal==='string'?literal.length:1;
        if(members){
          // 即使提前匹配也比较所有成员并计费，否定集合仍排除前面处理的NULL。
          let matched=false;
          for(const member of members){textWork+=size+(typeof member.literal==='string'?member.literal.length:1);if(textWork>queryResultFilterLimits.textWork)throw Error(text.budget);if(compareQueryResultFilterKeys(prepared.get(column.key)![i],member.key)===0)matched=true;}
          return rule.operator==='in'?matched:!matched;
        }
        const containing=rule.operator==='contains'||rule.operator==='notContains',starting=rule.operator==='startsWith'||rule.operator==='notStartsWith',ending=rule.operator==='endsWith'||rule.operator==='notEndsWith';
        textWork+=containing?(input?Math.max(1,size)*input:1):size+input;
        if(range)textWork+=size+(typeof upper==='string'?upper.length:1);
        if(textWork>queryResultFilterLimits.textWork)throw Error(text.budget);
        if(containing||starting||ending){
          if(typeof value!=='string'||typeof literal!=='string')throw Error(text.value);
          // 只按UTF-16原文匹配；否定仍排除前面已处理的NULL，不解析正则或SQL通配符。
          const matched=containing?value.includes(literal):starting?value.startsWith(literal):value.endsWith(literal);
          return rule.operator==='notContains'||rule.operator==='notStartsWith'||rule.operator==='notEndsWith'?!matched:matched;
        }
        const order=compareQueryResultFilterKeys(prepared.get(column.key)![i],key);
        if(range){
          const upperOrder=compareQueryResultFilterKeys(prepared.get(column.key)![i],upperKey);
          return rule.operator==='between'?order>=0&&upperOrder<=0:order<0||upperOrder>0;
        }
        return rule.operator==='eq'||rule.operator==='empty'?order===0:rule.operator==='ne'||rule.operator==='notEmpty'?order!==0:rule.operator==='gt'?order>0:rule.operator==='gte'?order>=0:rule.operator==='lt'?order<0:order<=0;
      });
      if(!compiled.length||(mode==='AND'?matches.every(Boolean):matches.some(Boolean)))indices.push(i);
    }
    if(!this.current(binding)||this.projection!==previous)throw fail();this.snapshots=snapshots;
    return this.projection=this.project(binding,compiled.map(({rule,members})=>members?{...rule,values:members.map(member=>member.input)}:rule),mode,indices);
  }
}
/** 排序位置相对过滤结果；这里显式合成为原返回位置，仍共享同一个最终QueryResult容器。 */
export function queryResultFilteredSortView(filtered:QueryResultFilterView|undefined,sorted:QueryResultSortView|undefined):{readonly result:QueryResult;readonly sourceIndices:readonly number[]}|undefined{
  if(!filtered)return sorted;if(!sorted)return filtered;
  if(sorted.sourceIndices.some((index,i)=>!Number.isSafeInteger(index)||index<0||index>=filtered.sourceIndices.length||sorted.result.rows[i]!==filtered.result.rows[index])||sorted.result.rows.length!==sorted.sourceIndices.length)throw fail();
  return Object.freeze({result:sorted.result,sourceIndices:Object.freeze(sorted.sourceIndices.map(i=>filtered.sourceIndices[i]))});
}
