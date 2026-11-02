import type { ColumnInfo, FilterGroup, FilterMode, FilterRule, TableInfo } from '../shared/contracts';
import { copyFilterRules, validateFilterGroup } from '../shared/filtering';
import { assertTableReadUnicode, buildTableFilterSql, tableReadTextLiteral } from '../shared/tableReadSql';
import { filterRuleFromDraft, type FilterDraft } from './tableFilters';
import type { ForeignKeyJoinSummaryOutput } from './tableForeignKeyJoinSummary';
import { tableForeignKeyJoinHavingZh as text } from './locales/tableForeignKeyJoinHaving.zh-CN';

export interface ForeignKeyJoinHaving { filters: readonly FilterRule[]; mode?: FilterMode; group?: FilterGroup; }
export interface ForeignKeyJoinHavingTarget extends ForeignKeyJoinSummaryOutput { id: string; label: string; }
export interface ForeignKeyJoinHavingDraft { id: string; enabled: boolean; targetLabel: string; draft: FilterDraft; }

/** HAVING对象只接受自有数据属性，不把继承/访问器条件当作缺省而退化成无筛选。 */
function copy(raw: unknown): {filters:FilterRule[];mode:FilterMode;group:FilterGroup|undefined} {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error(text.invalid);
  const prototype=Object.getPrototypeOf(raw);if(prototype!==Object.prototype&&prototype!==null)throw Error(text.invalid);
  const keys=Reflect.ownKeys(raw);if(keys.some(key=>typeof key!=='string'||!['filters','mode','group'].includes(key)))throw Error(text.invalid);
  const values:Record<string,unknown>=Object.create(null);for(const key of ['filters','mode','group']){const descriptor=Object.getOwnPropertyDescriptor(raw,key);if(!descriptor){if(key==='filters'||key in raw)throw Error(text.invalid);continue;}if(!descriptor.enumerable||!('value' in descriptor))throw Error(text.invalid);values[key]=descriptor.value;}
  const filters=copyFilterRules(values.filters as FilterRule[]),mode=values.mode===undefined?'all':values.mode;if(mode!=='all'&&mode!=='any')throw Error(text.invalid);const group=validateFilterGroup(filters,mode,values.group as FilterGroup|undefined);return{filters,mode,group};
}

/** 只引用纯编译器已声明的输出原表达式；与源列同名的别名也不会改绑到输入列。 */
export function buildForeignKeyJoinHaving(outputs: readonly ForeignKeyJoinSummaryOutput[], raw: unknown, sqlUnits: number): string | undefined {
  const {filters,mode,group}=copy(raw),references=new Map(outputs.map(output=>[output.alias,output.expression]));
  const columns:ColumnInfo[]=outputs.map(output=>({name:output.alias,type:/^(?:FLOAT|DOUBLE|REAL)\b/i.test(output.type)?'DECIMAL':output.type,nullable:true,generated:false,extra:'',comment:'',defaultValue:null}));
  for(const rule of filters){assertTableReadUnicode(rule.column);for(const value of rule.values??(rule.value===undefined?[]:[rule.value]))assertTableReadUnicode(value);}
  let units=0;
  const result=buildTableFilterSql({columns} as TableInfo,filters,mode,group,value=>{const literal=tableReadTextLiteral(value);units+=literal.length;if(units>sqlUnits)throw Error(text.budget);return literal;},name=>{const expression=references.get(name);if(!expression)throw Error(text.invalid);return expression;}).where;
  if(result&&result.length>sqlUnits)throw Error(text.budget);return result;
}

/** 界面按稳定输出ID绑定；改名跟随原输出，移除后重建同名指标不能接管旧条件。 */
export function foreignKeyJoinHavingFromDraft(entries: readonly ForeignKeyJoinHavingDraft[], outputs: readonly ForeignKeyJoinHavingTarget[]): FilterRule[] {
  return entries.map(entry=>{const output=outputs.find(output=>output.id===entry.draft.column);if(!output)throw Error(text.targetMissing);return{...filterRuleFromDraft({...entry.draft,column:output.alias},outputs.map(output=>output.alias)),...(entry.enabled?{}:{enabled:false})};});
}
