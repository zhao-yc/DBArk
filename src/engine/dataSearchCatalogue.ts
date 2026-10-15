import {Buffer} from 'node:buffer';
import {dataSearchCatalogueSchema,dataSearchCatalogueLimits,type DataSearchCataloguePage,type DataSearchCatalogueEntry} from '../shared/dataSearchCatalogue';
import {searchIdentifier} from '../shared/databaseSearch';
import {completionQuery} from './completionQuery';
import {completionPrefix} from './completionMetadata';
import type {StructureTaskContext} from './structureDefinition';

const same=(column:string)=>'CAST('+column+' AS BINARY)=CAST(? AS BINARY)';
const binaryType=/^(?:binary|varbinary|tinyblob|blob|mediumblob|longblob|bit|geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection)$/i;
/** 使用同账号、参数化、有界目录查询；列目录不执行视图或SELECT原数据。 */
export async function readDataSearchCatalogue(context:StructureTaskContext,raw:unknown):Promise<DataSearchCataloguePage>{
  const input=dataSearchCatalogueSchema.parse(raw),parameters:(string|number)[]=[];
  const read=async(sql:string,params:(string|number)[])=>{const result=(await completionQuery<Record<string,unknown>[]>(context.managed,context,sql,params)).rows;context.checkCancelled();if(Buffer.byteLength(JSON.stringify(result))>dataSearchCatalogueLimits.pageBytes)throw Error('搜索范围目录超过128KiB，请缩小前缀');return result;};
  let sql:string;
  if(input.kind==='databases'){
    sql="SELECT SCHEMA_NAME AS name,'database' AS kind FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ? ESCAPE '!'";parameters.push(completionPrefix(input.prefix));
    if(input.after!==undefined){sql+=' AND CAST(SCHEMA_NAME AS BINARY)>CAST(? AS BINARY)';parameters.push(input.after);}sql+=' ORDER BY CAST(SCHEMA_NAME AS BINARY)';
  }else if(input.kind==='objects'){
    sql="SELECT TABLE_NAME AS name,CASE WHEN TABLE_TYPE='BASE TABLE' THEN 'table' ELSE 'view' END AS kind FROM information_schema.TABLES WHERE "+same('TABLE_SCHEMA')+" AND TABLE_TYPE IN ('BASE TABLE','VIEW') AND TABLE_NAME LIKE ? ESCAPE '!'";parameters.push(input.database,completionPrefix(input.prefix));
    if(input.after!==undefined){sql+=' AND CAST(TABLE_NAME AS BINARY)>CAST(? AS BINARY)';parameters.push(input.after);}sql+=' ORDER BY CAST(TABLE_NAME AS BINARY)';
  }else{
    const relation=await read('SELECT TABLE_TYPE AS kind FROM information_schema.TABLES WHERE '+same('TABLE_SCHEMA')+' AND '+same('TABLE_NAME')+' LIMIT 2',[input.database,input.table]);
    if(relation.length!==1||relation[0].kind!==(input.objectKind==='table'?'BASE TABLE':'VIEW'))throw Error('所选范围不存在、不可见或类别已变化，请刷新目录');
    sql="SELECT COLUMN_NAME AS name,'column' AS kind,DATA_TYPE AS data_type,CHARACTER_SET_NAME AS charset,CAST(ORDINAL_POSITION AS CHAR) AS ordinal FROM information_schema.COLUMNS WHERE "+same('TABLE_SCHEMA')+' AND '+same('TABLE_NAME')+" AND COLUMN_NAME LIKE ? ESCAPE '!'";parameters.push(input.database,input.table,completionPrefix(input.prefix));
    if(input.after!==undefined){sql+=' AND ORDINAL_POSITION>?';parameters.push(Number(input.after));}sql+=' ORDER BY ORDINAL_POSITION';
  }
  const rows=await read(sql+' LIMIT '+(dataSearchCatalogueLimits.entries+1),parameters);
  if(rows.length>dataSearchCatalogueLimits.entries+1)throw Error('搜索目录返回条数超过预算');
  const entries:DataSearchCatalogueEntry[]=rows.slice(0,dataSearchCatalogueLimits.entries).map(row=>{
    const name=searchIdentifier.parse(row.name),kind=row.kind;
    if(!['database','table','view','column'].includes(String(kind))||input.kind==='databases'&&kind!=='database'||input.kind==='objects'&&!['table','view'].includes(String(kind))||input.kind==='columns'&&kind!=='column')throw Error('搜索目录类别无效');
    if(input.kind!=='columns')return{name,kind:kind as DataSearchCatalogueEntry['kind']};
    const ordinal=Number(row.ordinal);
    if(typeof row.data_type!=='string'||!/^[a-z0-9_]{1,64}$/i.test(row.data_type)||row.charset!==null&&(typeof row.charset!=='string'||!/^[a-z0-9_]{1,64}$/i.test(row.charset))||typeof row.ordinal!=='string'||!Number.isInteger(ordinal)||ordinal<1||ordinal>4096)throw Error('搜索字段目录不完整');
    // ENUM/SET目录的NULL字符集在MySQL8可能代表binary；界面保守默认HEX，执行时仍按真实协议核对。
    return{name,kind:'column',dataType:row.data_type,binary:binaryType.test(row.data_type)||row.charset==='binary'||row.charset===null&&/^(enum|set)$/i.test(row.data_type),ordinal};
  });
  if(new Set(entries.map(entry=>entry.name)).size!==entries.length)throw Error('搜索目录名称重复，请刷新');
  const hasMore=rows.length>dataSearchCatalogueLimits.entries,last=entries.at(-1);
  return{kind:input.kind,entries,hasMore,...(hasMore&&last?{next:input.kind==='columns'?String(last.ordinal):last.name}:{})};
}
