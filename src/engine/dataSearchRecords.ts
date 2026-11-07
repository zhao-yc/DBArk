import{Buffer}from'node:buffer';
import{createHash}from'node:crypto';
import{dataSearchRecordLimits as limits,type DataSearchRecord,type DataSearchNavigationReason}from'../shared/dataSearchRecords';
import type{DataSearchTargetMetadata,DataSearchTarget}from'../shared/dataSearch';
import type{CellValue}from'../shared/contracts';
import type{StructureTaskContext}from'./structureDefinition';
import{completionQuery}from'./completionQuery';
import{readDataSearchTarget}from'./dataSearchPlan';
import{identifier,qualified,serializeCell,deserializeCell}from'./sql';
import{tableDefinitionTokens}from'./tableColumnDefinition';
import{definitionOmittingSqlModes}from'../shared/tableColumnPatches';

import { DataSearchReferences, type RecordPreparation } from './dataSearchReferences';
export type { RecordPreparation } from './dataSearchReferences';

type Context=Pick<StructureTaskContext,'managed'|'checkCancelled'|'commandStarted'>;
class IdentityBudgetError extends Error{}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(column:string)=>'CAST('+column+' AS BINARY)=CAST(? AS BINARY)';
/** 仅明确的权限拒绝或目录缺失可使导航不可用，断线和取消必须继续向上传播。 */
function knownIdentityFailure(error:unknown):DataSearchNavigationReason|undefined{const failure=error as {code?:string;errno?:number};if([1044,1142,1143,1227].includes(failure?.errno??0))return'identity-permission';if([1054,1109,1146].includes(failure?.errno??0))return'identity-unproven';}
type Parameter=ReturnType<typeof deserializeCell>;
/** 原生键条件保留索引查找，再核精确表示；不能为避免精度损失而把常用主键退化为整表扫描。 */
export function buildDataSearchRecordWhere(metadata:DataSearchTargetMetadata,keyValues:readonly CellValue[],epochs?:readonly(string|null)[]){
 if(!metadata.keyColumns.length||keyValues.length!==metadata.keyColumns.length)throw Error('可靠定位键不完整');const conditions:string[]=[],params:Parameter[]=[];
 metadata.keyColumns.forEach((column,index)=>{
  const name=identifier(column.name),value=keyValues[index];if(value===null)throw Error('可靠键不能包含NULL');
  if(column.dataType.toLowerCase()==='timestamp'){
   const epoch=epochs?.[index];if(typeof epoch!=='string'||!/^\d{1,12}(?:\.\d{1,6})?$/.test(epoch)||typeof value!=='string')throw Error('TIMESTAMP定位精度信息已失效');
   if(/^0(?:\.0+)?$/.test(epoch)){conditions.push('CAST('+name+' AS CHAR)=?');params.push(value);}else{
    // 某些服务器的FROM_UNIXTIME有效范围小于TIMESTAMP存储范围；NULL时保留内部秒数精确路径。
    const instant='FROM_UNIXTIME(CAST(? AS DECIMAL(20,6)))';conditions.push('('+name+'='+instant+' OR '+instant+' IS NULL) AND UNIX_TIMESTAMP('+name+')=CAST(? AS DECIMAL(20,6))');params.push(epoch,epoch,epoch);
   }
  }else if(column.binary){
   const raw=deserializeCell(value);if(!Buffer.isBuffer(raw))throw Error('二进制定位键不完整');
   if(/^(?:binary|varbinary)$/i.test(column.dataType)){conditions.push(name+'=? AND CAST('+name+' AS BINARY)=?');params.push(raw,raw);}else{conditions.push('CAST('+name+' AS BINARY)=?');params.push(raw);}
  }else{
   if(typeof value!=='string')throw Error('精确定位键必须保持服务器原文');const canonical='CAST(CONVERT('+name+' USING utf8mb4) AS BINARY)=CAST(? AS BINARY)';
   if(/^(?:tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|fixed|year)$/i.test(column.dataType)){
    if(!/^[+-]?\d+(?:\.\d+)?$/.test(value))throw Error('精确数值键格式不完整');const scale=value.includes('.')?value.length-value.indexOf('.')-1:0;if(scale>38||value.replace(/[+-.]/g,'').length>65)throw Error('精确数值键超过数据库范围');conditions.push(name+'=CAST(? AS DECIMAL(65,'+scale+')) AND '+canonical);params.push(value,value);
   }else if(/^(?:char|varchar|text|tinytext|mediumtext|longtext|enum|set|date|datetime|time)$/i.test(column.dataType)){conditions.push(name+'=? AND '+canonical);params.push(value,value);}else{conditions.push(canonical);params.push(value);}
  }
 });return{sql:conditions.map(sql=>'('+sql+')').join(' AND '),params};
}

/** 规范定义只忽略表级自增计数；字段自增属性、注释和其它全部SQL语义仍进入摘要。 */
export function recordDefinitionDigest(source:string,mode:string,dialect:'mysql'|'mariadb'){
 const tokens=tableDefinitionTokens(source,{dialect,mode:{noBackslashEscapes:mode.split(',').includes('NO_BACKSLASH_ESCAPES'),ansiQuotes:mode.split(',').includes('ANSI_QUOTES')}}),parts:unknown[]=[];let depth=0;
 for(let index=0;index<tokens.length;index++){const token=tokens[index];if(depth===0&&token.kind==='word'&&token.value.toUpperCase()==='AUTO_INCREMENT'&&tokens[index+1]?.value==='='&&tokens[index+2]?.kind==='number'){index+=2;continue;}parts.push([token.kind,token.kind==='word'?token.value.toUpperCase():token.value]);if(token.kind==='symbol'&&token.value==='(')depth++;if(token.kind==='symbol'&&token.value===')')depth--;if(depth<0)throw Error('定位表定义括号不完整');}
 if(depth!==0)throw Error('定位表定义括号不完整');return digest(parts);
}
/** 在已经读取目标的只读事务中核对真实InnoDB实例编号，绝不把DDL摘要本身当作物理身份。 */
export async function prepareDataSearchRecord(context:Context,target:DataSearchTarget):Promise<RecordPreparation>{
 if(target.kind!=='table'||![/^[A-Za-z0-9_]+$/].every(pattern=>pattern.test(target.database)&&pattern.test(target.table)))return{reason:'identity-unproven'};
 const read=async(sql:string,params:(string|number)[]=[])=>{const result=await completionQuery<Record<string,unknown>[]>(context.managed,context,sql,params);context.checkCancelled();if(Buffer.byteLength(JSON.stringify(result.rows))>limits.definitionBytes+16384)throw new IdentityBudgetError('记录定位元数据超过预算');return result.rows;};
 try{
  const facts=(await read('SELECT @@hostname AS host,@@port AS port,@@server_id AS serverId,CURRENT_USER() AS account,@@lower_case_table_names AS lowerNames,@@version_compile_os AS os,@@SESSION.sql_mode AS mode'))[0];
  if(!facts||typeof facts.host!=='string'||typeof facts.account!=='string'||typeof facts.mode!=='string'||Number(facts.lowerNames)!==0||typeof facts.os!=='string'||!['linux','debian-linux-gnu'].includes(facts.os.toLowerCase()))return{reason:'identity-unproven'};
  const relation=await read('SELECT ENGINE AS engine FROM information_schema.TABLES WHERE '+same('TABLE_SCHEMA')+' AND '+same('TABLE_NAME')+' LIMIT 2',[target.database,target.table]);
  if(relation.length!==1||relation[0].engine!=='InnoDB')return{reason:'identity-unproven'};
  const partitions=await read('SELECT PARTITION_NAME AS name FROM information_schema.PARTITIONS WHERE '+same('TABLE_SCHEMA')+' AND '+same('TABLE_NAME')+' LIMIT 2',[target.database,target.table]);
  if(partitions.length!==1||partitions[0].name!==null)return{reason:'identity-unproven'};
  const mysql=context.managed.status.dialect==='mysql',version=context.managed.status.version.replace(/^5\.5\.5-/,'');
  const catalogue=mysql&&/^8\.(?:0|4)\./.test(version)?'INNODB_TABLES':mysql&&/^5\.7\./.test(version)||!mysql&&/^(?:10\.11|11\.4)\./.test(version)?'INNODB_SYS_TABLES':undefined;
  if(!catalogue)return{reason:'identity-unproven'};
  const physical=await read('SELECT CAST(TABLE_ID AS CHAR) AS id,NAME AS name FROM information_schema.'+catalogue+' WHERE '+same('NAME')+' LIMIT 2',[target.database+'/'+target.table]);
  if(physical.length!==1||typeof physical[0].id!=='string'||!/^[1-9]\d{0,19}$/.test(physical[0].id)||physical[0].name!==target.database+'/'+target.table)return{reason:'identity-unproven'};
  const uuid=mysql?(await read('SELECT @@server_uuid AS uuid'))[0]?.uuid:undefined;if(mysql&&(typeof uuid!=='string'||!uuid))return{reason:'identity-unproven'};
  if(!/^[A-Z0-9_,]*$/i.test(facts.mode))return{reason:'identity-unproven'};const omitted=new Set<string>(definitionOmittingSqlModes),mode=facts.mode.split(',').filter(value=>!omitted.has(value.toUpperCase())).join(',');
  // 完整定义只在独立只读会话规范化，不能让NO_FIELD_OPTIONS等隐藏结构变化。
  if(mode!==facts.mode)await read('SET SESSION sql_mode = ?',[mode]);
  await read('SET SESSION sql_quote_show_create = 1');const definition=(await read('SHOW CREATE TABLE '+qualified(target.database,target.table)))[0]?.['Create Table'];if(typeof definition!=='string'||Buffer.byteLength(definition)>limits.definitionBytes)return{reason:'identity-unproven'};
  const profile=context.managed.profile;
  // SQL模式也绑定定位语义，尤其CHAR填充等行为，不能把新会话的不同表示当成旧键。
  return{identity:{server:digest([facts.host,facts.port,facts.serverId,facts.account,uuid,context.managed.status.dialect,context.managed.status.version,mode,profile.host,profile.port,profile.user,profile.ssh?.host,profile.ssh?.hostFingerprint]),tableId:physical[0].id,definition:recordDefinitionDigest(definition,mode,context.managed.status.dialect)}};
 }catch(error){context.checkCancelled();const reason=error instanceof IdentityBudgetError?'budget':knownIdentityFailure(error);if(!reason||context.managed.broken)throw error;return{reason};}
}

export class DataSearchRecords extends DataSearchReferences {
 /** 重新持有目标MDL后核身份和定义，读取当前行；结果只有所选字段与键，始终只读。 */
 async read(context:Context,raw:unknown):Promise<DataSearchRecord>{
  const entry=this.lookup(raw);
  if(entry.postgresIdentity||entry.sqliteIdentity)throw Error('记录定位方言与保存的连接不匹配');
  const query=async(sql:string,values:Parameter[]=[])=>completionQuery<Record<string,unknown>[]>(context.managed,context,sql,values);
  await query('SET SESSION time_zone = \'+00:00\'');await query('START TRANSACTION READ ONLY');
  const metadata=await readDataSearchTarget(context.managed,entry.metadata.target,context),prepared=await prepareDataSearchRecord(context,entry.metadata.target);
  if('reason'in prepared||JSON.stringify(prepared.identity)!==JSON.stringify(entry.identity))throw Error('表的服务器、实例或定义已变化，或会话模式不一致；未读取同名新对象的记录，请重新搜索');
  if(JSON.stringify(metadata.keyColumns)!==JSON.stringify(entry.metadata.keyColumns)||JSON.stringify(metadata.columns)!==JSON.stringify(entry.metadata.columns))throw Error('记录定位字段或权限已变化，请重新搜索');
  const columns=[...metadata.columns];for(const key of metadata.keyColumns)if(!columns.some(column=>column.name===key.name))columns.push(key);
  const characters=Math.min(limits.fieldCharacters,Math.floor((limits.recordBytes-16384)/(6*Math.max(1,columns.length)))),projections:string[]=[];
  columns.forEach((column,index)=>{const name=identifier(column.name),expression=column.binary?'CAST('+name+' AS BINARY)':'CONVERT('+name+' USING utf8mb4)';projections.push('LEFT('+expression+','+characters+') AS v'+index,'CHAR_LENGTH('+expression+') AS n'+index);});
  const where=buildDataSearchRecordWhere(metadata,entry.keyValues,entry.timestampEpochs);
  const result=await query('SELECT '+projections.join(',')+' FROM '+qualified(metadata.target.database,metadata.target.table)+' WHERE '+where.sql+' LIMIT 2',where.params);context.checkCancelled();
  if(result.rows.length===0)throw Error('命中记录已删除或定位键已改变，请重新搜索');if(result.rows.length!==1)throw Error('定位条件不再唯一，未选择任意一条记录');
  const row=result.rows[0],fields=columns.map((column,index)=>{const value=serializeCell(row['v'+index]),count=row['n'+index];if(value===null){if(count!==null)throw Error('定位字段NULL状态不一致');return{name:column.name,dataType:column.dataType,value,characters:null,truncated:false,binary:column.binary};}if((typeof count!=='string'&&typeof count!=='number')||!/^\d{1,20}$/.test(String(count)))throw Error('定位字段长度信息不完整');return{name:column.name,dataType:column.dataType,value,characters:String(count),truncated:BigInt(String(count))>BigInt(characters),binary:column.binary};});
  const output:DataSearchRecord={target:metadata.target,fields,timeZone:'+00:00',searchedAt:entry.searchedAt,readAt:new Date().toISOString(),readOnly:true};if(Buffer.byteLength(JSON.stringify(output))>limits.recordBytes)throw Error('定位记录超过1MiB，请缩小所选字段范围');await query('ROLLBACK');return output;
 }
}
