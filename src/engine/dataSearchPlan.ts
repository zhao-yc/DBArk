import {Buffer} from 'node:buffer';
import {TextDecoder} from 'node:util';
import {dataSearchLimits,dataSearchTargetSchema,dataSearchMatcherSchema,type DataSearchTargetMetadata,type DataSearchColumnMetadata,type DataSearchRow} from '../shared/dataSearch';
import type {CellValue} from '../shared/contracts';
import {identifier,qualified} from './sql';
import {databaseSearchMatch} from './databaseSearchMatch';
import {completionQuery} from './completionQuery';
import type {ManagedConnection} from './connection';
import type {StructureTaskContext} from './structureDefinition';

type Control=Pick<StructureTaskContext,'checkCancelled'|'commandStarted'>;
const binaryType=/^(?:binary|varbinary|tinyblob|blob|mediumblob|longblob|bit|geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection)$/i;
const exact=(field:string)=>'CAST('+field+' AS BINARY)=CAST(? AS BINARY)';
/** 长度仅用于预览状态，保留服务器十进制计数字符串，不转换BIGINT或单元格数值。 */
function lengthText(value:CellValue):string|null{if(value===null)return null;const text=String(value);if(!/^\d{1,20}$/.test(text))throw Error('搜索预览长度不完整');return text;}

/** 同一账号重核目录与零行协议描述；视图必须先明确确认，其服务端处理可能涉及函数。 */
export async function readDataSearchTarget(managed:ManagedConnection,raw:unknown,control:Control,options:{allowViews?:boolean}={}):Promise<DataSearchTargetMetadata>{
  const target=dataSearchTargetSchema.parse(raw);
  if(target.kind==='view'&&!options.allowViews)throw Error('请明确确认视图范围，视图处理可能执行其中函数');
  const read=async(sql:string,params:(string|number)[])=>{const rows=(await completionQuery<Record<string,unknown>[]>(managed,control,sql,params)).rows;if(Buffer.byteLength(JSON.stringify(rows))>dataSearchLimits.metadataBytes)throw Error('数据搜索元数据超过128KiB，请缩小范围');control.checkCancelled();return rows;};
  const relation=await read('SELECT TABLE_TYPE AS kind FROM information_schema.TABLES WHERE '+exact('TABLE_SCHEMA')+' AND '+exact('TABLE_NAME')+' LIMIT 2',[target.database,target.table]);
  if(relation.length!==1||relation[0].kind!==(target.kind==='view'?'VIEW':'BASE TABLE'))throw Error('所选对象不存在、不可见或类别已变化，请刷新范围');
  const indices=target.kind==='view'?[]:await read('SELECT INDEX_NAME AS index_name,COLUMN_NAME AS column_name,SEQ_IN_INDEX AS ordinal,SUB_PART AS prefix_length FROM information_schema.STATISTICS WHERE '+exact('TABLE_SCHEMA')+' AND '+exact('TABLE_NAME')+' AND NON_UNIQUE=0 ORDER BY CASE WHEN INDEX_NAME=\'PRIMARY\' THEN 0 ELSE 1 END,CAST(INDEX_NAME AS BINARY),SEQ_IN_INDEX LIMIT '+(dataSearchLimits.indexRows+1),[target.database,target.table]);
  if(indices.length>dataSearchLimits.indexRows+1)throw Error('唯一键目录超出预算');
  const incomplete=indices.length>dataSearchLimits.indexRows,last=incomplete?indices.at(-1)?.index_name:undefined;
  const groups=new Map<string,{names:string[];valid:boolean}>();
  for(const row of indices){
    if(typeof row.index_name!=='string'||row.index_name.length>64)throw Error('唯一键目录名称不完整');
    // 截断的最后一个索引整组弃用；不能把复合键的前半段误当成可靠唯一键。
    if(row.index_name===last)continue;
    const group=groups.get(row.index_name)??{names:[],valid:true};groups.set(row.index_name,group);
    if(typeof row.column_name!=='string'||row.column_name.length<1||row.column_name.length>64||row.prefix_length!==null||Number(row.ordinal)!==group.names.length+1)group.valid=false;
    if(typeof row.column_name==='string')group.names.push(row.column_name);
  }
  const requested=[...new Set([...target.columns.map(column=>column.name),...[...groups.values()].filter(group=>group.valid).flatMap(group=>group.names)])];
  if(requested.length>dataSearchLimits.indexRows+dataSearchLimits.projectionColumns)throw Error('字段目录超出预算');
  const rows=await read('SELECT COLUMN_NAME AS name,DATA_TYPE AS data_type,CHARACTER_SET_NAME AS character_set,IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE '+exact('TABLE_SCHEMA')+' AND '+exact('TABLE_NAME')+' AND CAST(COLUMN_NAME AS BINARY) IN ('+requested.map(()=>'CAST(? AS BINARY)').join(',')+') LIMIT '+(requested.length+1),[target.database,target.table,...requested]);
  if(rows.length>requested.length)throw Error('字段目录与所选名称不一致');
  const columns=new Map<string,DataSearchColumnMetadata>();
  for(const row of rows){if(typeof row.name!=='string'||!requested.includes(row.name)||typeof row.data_type!=='string'||!/^[a-z0-9_]{1,64}$/i.test(row.data_type)||row.character_set!==null&&(typeof row.character_set!=='string'||!/^[a-z0-9_]{1,64}$/i.test(row.character_set))||!['YES','NO'].includes(String(row.nullable))||columns.has(row.name))throw Error('搜索字段目录不完整');columns.set(row.name,{name:row.name,dataType:row.data_type,binary:binaryType.test(row.data_type)||row.character_set==='binary',nullable:row.nullable==='YES'});}
  if(target.columns.some(choice=>!columns.has(choice.name)))throw Error('所选字段不存在或不可见，请刷新范围');
  // MySQL8对binary ENUM的目录字符集与真实列协议可能不一致；按实际零行描述识别，不能仅凭目录强制UTF-8转换。
  const described=new Set<string>();
  /** 必选搜索列先独立验证；附加定位键无权读取时不能阻断已有SELECT权限的范围。 */
  async function describe(names:string[]){
    const pending=names.filter(name=>!described.has(name));if(!pending.length)return;
    const description=await completionQuery<Record<string,unknown>[]>(managed,control,'SELECT '+pending.map(identifier).join(',')+' FROM '+qualified(target.database,target.table)+' LIMIT 0',[]);
    control.checkCancelled();if(description.rows.length!==0||description.fields.length!==pending.length)throw Error('数据搜索零行描述与目录不一致');
    description.fields.forEach((field,index)=>{if(field.name!==pending[index]||typeof field.characterSet!=='number'||!Number.isInteger(field.characterSet)||field.characterSet<1||field.characterSet>65535)throw Error('数据搜索协议字段不完整');const column=columns.get(pending[index])!;if(/^(?:char|varchar|tinytext|text|mediumtext|longtext|enum|set)$/i.test(column.dataType)&&field.characterSet===63)column.binary=true;});
    pending.forEach(name=>described.add(name));
  }
  await describe(target.columns.map(column=>column.name));
  const selected=target.columns.map(choice=>{const column=columns.get(choice.name);if(!column)throw Error('所选字段不存在或不可见，请刷新范围');if(column.binary&&choice.representation!=='hex')throw Error('二进制字段必须明确选择HEX文本，避免强制字符解码');return column;});
  let keyColumns:DataSearchColumnMetadata[]=[],unsupported=false,unreadable=false;
  for(const group of groups.values()){
    if(!group.valid||group.names.length===0)continue;const candidate=group.names.map(name=>columns.get(name));
    if(candidate.some(column=>!column||column.nullable))continue;
    // FLOAT/DOUBLE的服务器文本化不能恢复相邻值；此类键保留只读定位状态，不伪造精确键。
    if(candidate.some(column=>/^(?:float|double|real)$/i.test(column!.dataType))){unsupported=true;continue;}
    try{await describe(group.names);}catch(error){
      control.checkCancelled();const failure=error as {code?:string;errno?:number};
      // 只对服务器明确的列/表SELECT拒绝弃用此候选；取消、断线及其它SQL错误不能冒充只读降级。
      if(managed.broken||!(['ER_COLUMNACCESS_DENIED_ERROR','ER_TABLEACCESS_DENIED_ERROR'].includes(failure?.code??'')||[1143,1142].includes(failure?.errno??0)))throw error;
      unreadable=true;continue;
    }
    keyColumns=candidate as DataSearchColumnMetadata[];break;
  }
  return{target,columns:selected,keyColumns,indexMetadataIncomplete:incomplete,...(!keyColumns.length?{keyUnavailableReason:unreadable?'key-not-selectable' as const:unsupported?'unsupported-key-type' as const:'no-key' as const}:{})};
}

/** 固定投影只传有界文字预览及独立可靠键，原始大字段不进入驱动结果；匹配本身仍由服务器对完整值执行。 */
export function buildDataSearchPlan(metadata:DataSearchTargetMetadata,rawMatcher:unknown,rows:number):{sql:string;params:string[]}{
  const target=dataSearchTargetSchema.parse(metadata.target),matcher=dataSearchMatcherSchema.parse(rawMatcher);
  if(!Number.isInteger(rows)||rows<1||rows>dataSearchLimits.rows+1)throw Error('数据搜索行预算无效');
  if(metadata.columns.length!==target.columns.length||metadata.columns.some((column,index)=>column.name!==target.columns[index].name))throw Error('数据搜索字段与元数据目标不一致');
  if(metadata.columns.some((column,index)=>column.binary&&target.columns[index].representation!=='hex'))throw Error('二进制字段必须明确选择HEX文本');
  const projections:string[]=[],predicates:string[]=[],projectionParams:string[]=[],whereParams:string[]=[];
  for(let index=0;index<target.columns.length;index++){
    const choice=target.columns[index],column=identifier(choice.name),expression=choice.representation==='hex'?'HEX('+column+')':'CONVERT('+column+' USING utf8mb4)';
    const predicate=matcher.kind==='null'?{sql:column+' IS NULL',params:[]}:databaseSearchMatch({column:choice.name,representation:choice.representation},matcher.pattern);
    projections.push('('+predicate.sql+') AS m'+index,'LEFT('+expression+','+dataSearchLimits.previewCharacters+') AS p'+index,'CHAR_LENGTH('+expression+') AS n'+index);
    projectionParams.push(...predicate.params);predicates.push('('+predicate.sql+')');whereParams.push(...predicate.params);
  }
  for(let index=0;index<metadata.keyColumns.length;index++){
    const column=metadata.keyColumns[index],expression=column.binary?identifier(column.name):'CONVERT('+identifier(column.name)+' USING utf8mb4)';
    projections.push('LEFT(CAST('+expression+' AS BINARY),'+(dataSearchLimits.keyBytes+1)+') AS k'+index,'OCTET_LENGTH('+expression+') AS z'+index);
    // TIMESTAMP原显示值保持不变，另取内部UTC秒数供跨会话定位，不能对已文本化日期反推时区。
    if(column.dataType.toLowerCase()==='timestamp')projections.push('CONVERT(UNIX_TIMESTAMP('+identifier(column.name)+') USING utf8mb4) AS e'+index);
  }
  return{sql:'SELECT '+projections.join(',')+' FROM '+qualified(target.database,target.table)+' WHERE ('+predicates.join(' OR ')+') LIMIT '+rows,params:[...projectionParams,...whereParams]};
}

/** 解码位置字段，保留NULL/空串/JSON原文与精确文本；截断的大键只能返回只读状态。 */
export function decodeDataSearchRow(metadata:DataSearchTargetMetadata,values:CellValue[]):DataSearchRow{
  if(values.length!==metadata.columns.length*3+metadata.keyColumns.reduce((count,column)=>count+(column.dataType.toLowerCase()==='timestamp'?3:2),0))throw Error('数据搜索结果列数与计划不一致');
  const cells=metadata.columns.map((_,index)=>{
    const [matched,preview,count]=values.slice(index*3,index*3+3);if(![0,1,'0','1',null].includes(matched as string|number|null)||preview!==null&&typeof preview!=='string'||typeof preview==='string'&&Buffer.byteLength(preview)>dataSearchLimits.previewCharacters*4)throw Error('数据搜索预览字段不完整');
    const characters=lengthText(count);if((preview===null)!==(characters===null))throw Error('数据搜索NULL与长度不一致');
    return{matched:matched===1||matched==='1',preview:preview as string|null,characters,truncated:characters!==null&&BigInt(characters)>BigInt(dataSearchLimits.previewCharacters)};
  });
  if(!cells.some(cell=>cell.matched))throw Error('服务器返回了没有匹配字段的数据行');
  let keyValues:CellValue[]|null=metadata.keyColumns.length?[]:null,tooLarge=false,offset=metadata.columns.length*3;const timestampEpochs:(string|null)[]=[];
  for(let index=0;index<metadata.keyColumns.length;index++){
    const value=values[offset],count=lengthText(values[offset+1]),timestamp=metadata.keyColumns[index].dataType.toLowerCase()==='timestamp';offset+=2;
    if(timestamp){const epoch=values[offset++];if(typeof epoch!=='string'||!/^\d{1,12}(?:\.\d{1,6})?$/.test(epoch))throw Error('TIMESTAMP定位所需的UTC精度信息不完整');timestampEpochs.push(epoch);}else timestampEpochs.push(null);
    if(count===null||!value||typeof value!=='object'||value.type!=='binary')throw Error('可靠键的原始字节不完整');
    if(BigInt(count)>BigInt(dataSearchLimits.keyBytes)){tooLarge=true;continue;}
    const bytes=Buffer.from(value.base64,'base64');if(BigInt(bytes.length)!==BigInt(count))throw Error('可靠键字节已被截断');
    keyValues!.push(metadata.keyColumns[index].binary?value:new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }
  if(keyValues&&Buffer.byteLength(JSON.stringify(keyValues))>dataSearchLimits.keyBytes)tooLarge=true;
  if(tooLarge)keyValues=null;
  const result:DataSearchRow={cells,keyValues,...(timestampEpochs.some(value=>value!==null)?{timestampEpochs}:{}),...(!keyValues?{keyUnavailableReason:tooLarge?'key-too-large':metadata.keyUnavailableReason??'no-key'}:{})};
  if(Buffer.byteLength(JSON.stringify(result))>dataSearchLimits.rowBytes)throw Error('数据搜索单行超过32KiB，未传送不完整结果');
  return result;
}
