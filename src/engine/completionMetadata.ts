import {completionLimits,type CompletionMetadataInput,type CompletionMetadataOutput,type CompletionMetadataEntry} from '../shared/sqlCompletion';
import type {ManagedConnection} from './connection';
import type {StructureTaskContext} from './structureDefinition';
import {completionQuery} from './completionQuery';
import {completionIdentifier} from '../shared/completionLexical';

/** LIKE使用独立!转义，不依赖会话反斜线模式；百分号、下划线和!都是普通名称字符。 */
export function completionPrefix(prefix:string):string{return prefix.replaceAll('!','!!').replaceAll('%','!%').replaceAll('_','!_')+'%';}
/** 仅可取消的短连接执行固定目录查询；每次服务器命令分别登记生命周期。 */
export async function completionMetadata(managed:ManagedConnection,input:CompletionMetadataInput,control:Pick<StructureTaskContext,'checkCancelled'|'commandStarted'>):Promise<CompletionMetadataOutput>{
  async function query(sql:string,values:(string|number)[]=[]):Promise<Record<string,unknown>[]> {
    return(await completionQuery<Record<string,unknown>[]>(managed,control,sql,values)).rows;
  }
  const values:(string|number)[]=[completionPrefix(input.prefix)];let sql:string;
  if(input.kind==='databases')sql="SELECT SCHEMA_NAME AS name,'database' AS kind FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ? ESCAPE '!' ORDER BY BINARY SCHEMA_NAME LIMIT "+(completionLimits.entries+1);
  else{
    const modes=await query('SELECT @@lower_case_table_names AS mode'),rawMode=modes[0]?.mode;
    if(![0,1,2,'0','1','2'].includes(rawMode as string|number))throw Error('无法确认数据库对象名称大小写规则');
    const mode=Number(rawMode);
    // 目录的比较排序规则不能代替服务器对象规则，尤其Linux允许区分大小写的库和表。
    const same=(field:string)=>mode===0?'BINARY '+field+' = BINARY ?':'LOWER('+field+') = LOWER(?)';
    values.unshift(input.database);
    if(input.kind==='columns'){
      values.splice(1,0,input.table);
      sql="SELECT COLUMN_NAME AS name,'column' AS kind,DATA_TYPE AS dataType FROM information_schema.COLUMNS WHERE "+same('TABLE_SCHEMA')+' AND '+same('TABLE_NAME')+" AND COLUMN_NAME LIKE ? ESCAPE '!' ORDER BY ORDINAL_POSITION LIMIT "+(completionLimits.entries+1);
    }else if(input.objectKind==='relation')sql="SELECT TABLE_NAME AS name,CASE WHEN TABLE_TYPE='BASE TABLE' THEN 'table' ELSE 'view' END AS kind FROM information_schema.TABLES WHERE "+same('TABLE_SCHEMA')+" AND TABLE_NAME LIKE ? ESCAPE '!' ORDER BY BINARY TABLE_NAME LIMIT "+(completionLimits.entries+1);
    else{
      values.splice(1,0,input.objectKind==='function'?'FUNCTION':'PROCEDURE');
      sql="SELECT ROUTINE_NAME AS name,LOWER(ROUTINE_TYPE) AS kind FROM information_schema.ROUTINES WHERE "+same('ROUTINE_SCHEMA')+" AND ROUTINE_TYPE=? AND ROUTINE_NAME LIKE ? ESCAPE '!' ORDER BY BINARY ROUTINE_NAME LIMIT "+(completionLimits.entries+1);
    }
  }
  const rows=await query(sql,values);control.checkCancelled();
  if(rows.length>completionLimits.entries+1)throw Error('服务器补全目录超出返回预算');
  const allowed=new Set(input.kind==='databases'?['database']:input.kind==='columns'?['column']:input.objectKind==='relation'?['table','view']:[input.objectKind]);
  const entries=rows.slice(0,completionLimits.entries).map(row=>{
    if(!completionIdentifier(row.name)||typeof row.kind!=='string'||!allowed.has(row.kind)||row.dataType!==undefined&&(typeof row.dataType!=='string'||row.dataType.length>64))throw Error('服务器补全目录不完整或超过名称预算');
    return {name:row.name,kind:row.kind as CompletionMetadataEntry['kind'],...(row.dataType!==undefined?{dataType:row.dataType as string}:{})};
  });
  return{entries,incomplete:rows.length>completionLimits.entries};
}
