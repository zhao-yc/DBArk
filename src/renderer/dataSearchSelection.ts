import {dataSearchLimits,type DataSearchScope} from '../shared/dataSearch';
import type {DataSearchCatalogueEntry} from '../shared/dataSearchCatalogue';

export interface DataSearchSelection{database:string;table:string;kind:'table'|'view';columns:{name:string;representation:'text'|'hex';ordinal:number}[]}
/** 选择按服务器字段顺序保留，分页不会覆盖其它表或只留下最后一页。 */
export function selectDataSearchColumns(previous:DataSearchSelection[],target:Omit<DataSearchSelection,'columns'>,entries:DataSearchCatalogueEntry[],checked:boolean,representation?:'text'|'hex'):DataSearchSelection[]{
  const key=(value:Omit<DataSearchSelection,'columns'>)=>JSON.stringify([value.database,value.table]);
  const existing=previous.find(value=>key(value)===key(target)),columns=new Map(existing?.columns.map(column=>[column.name,column]));
  for(const entry of entries){
    if(entry.kind!=='column'||!Number.isInteger(entry.ordinal)||entry.ordinal!<1||entry.ordinal!>4096)throw Error('字段目录不完整，请重新读取');
    if(checked)columns.set(entry.name,{name:entry.name,representation:representation??(entry.binary?'hex':'text'),ordinal:entry.ordinal!});else columns.delete(entry.name);
  }
  const next=previous.filter(value=>key(value)!==key(target));if(columns.size)next.push({...target,columns:[...columns.values()].sort((a,b)=>a.ordinal-b.ordinal)});
  if(next.length>dataSearchLimits.targets||next.some(value=>value.columns.length>dataSearchLimits.columns)||next.reduce((sum,value)=>sum+value.columns.length,0)>dataSearchLimits.totalColumns)throw Error('搜索范围超过64个对象、每对象4096列或合计16384列的上限');return next;
}
/** 目录顺序只用于选择；公开请求严格只含显式列名和表示层，不夹带目录内部属性。 */
export function dataSearchScopes(selection:DataSearchSelection[]):DataSearchScope[]{return selection.map(target=>({...target,columns:target.columns.map(({name,representation})=>({name,representation}))}));}
