import type {FieldPacket,Query} from 'mysql2';
import type {ManagedConnection} from './connection';
import {identifier,qualified} from './sql';
import {completionIdentifier} from '../shared/completionLexical';
import {sessionObjectLimits,type SessionObjectColumn,type SessionObjectReadResult} from '../shared/sessionObjects';
export interface SessionObjectReadControl{start():void;check():void;finish():Promise<void>}

/** 显式元数据读取也分行接收并限制字节，不向SQL结果区或任务记录发送定义/默认值。 */
async function rows<T>(managed:ManagedConnection,sql:string,maximum:number,project:(row:Record<string,unknown>)=>T,control:SessionObjectReadControl):Promise<T[]>{
  control.start();const output:T[]=[];let bytes=0,count=0,fields:FieldPacket[]=[],failure:Error|undefined;
  try{
    await new Promise<void>((resolve,reject)=>{
      let settled=false;const done=(error?:Error)=>{if(settled)return;settled=true;managed.connection.removeListener('error',fatal);error?reject(error):resolve();},fatal=(error:Error)=>done(error);
      managed.connection.once('error',fatal);let query:Query;try{query=managed.connection.query({sql,rowsAsArray:true});}catch(error){done(error instanceof Error?error:new Error('会话结构读取未能开始'));return;}
      query.on('fields',(value:FieldPacket[]|undefined)=>{if(!value)return;if(fields.length)failure=new Error('会话结构读取收到额外结果集');fields=value;});
      query.on('result',(raw:unknown)=>{
        if(!Array.isArray(raw)||failure)return;count++;bytes+=raw.reduce<number>((sum,value)=>sum+(typeof value==='string'?Buffer.byteLength(value):Buffer.isBuffer(value)?value.length:16),0);
        if(count>maximum||bytes>sessionObjectLimits.metadataBytes){failure=new Error('会话对象结构超过读取预算，未替换已有字段缓存');return;}
        try{output.push(project(Object.fromEntries(fields.map((field,index)=>[field.name,raw[index]]))));}catch(error){failure=error instanceof Error?error:new Error('会话对象结构格式无效');}
      });
      query.once('error',fatal).once('end',()=>done());
    });
    control.check();if(failure)throw failure;return output;
  }finally{await control.finish();}
}

/** 用户明确点击读取时在原会话确认临时身份及实际列；自动补全绝不调用此函数。 */
export async function readSessionObject(managed:ManagedConnection,input:{database:string;table:string},control:SessionObjectReadControl):Promise<SessionObjectReadResult>{
  const catalog=managed.sessionObjects;if(!catalog)throw new Error('当前会话对象目录尚未初始化');
  if(!completionIdentifier(input.database)||!completionIdentifier(input.table))throw new Error('会话对象名称无效');
  const ddl=await rows(managed,'SHOW CREATE TABLE '+qualified(input.database,input.table),1,row=>{
    const entry=Object.entries(row).find(([key])=>key.toLowerCase()==='create table');if(!entry||typeof entry[1]!=='string')throw new Error('当前对象没有可识别的表定义');
    return /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?TEMPORARY\s+TABLE\b/i.test(entry[1]);
  },control);
  if(ddl.length!==1)throw new Error('当前会话对象定义不存在');
  if(!ddl[0]){catalog.confirm(input.database,input.table,null);return{temporary:false,...input,revision:catalog.revision,columns:0};}
  const columns=await rows<SessionObjectColumn>(managed,'SHOW FULL COLUMNS FROM '+identifier(input.table)+' FROM '+identifier(input.database),sessionObjectLimits.columns,row=>{
    if(!completionIdentifier(row.Field)||typeof row.Type!=='string'||typeof row.Extra!=='string')throw new Error('当前会话字段格式无效');
    const type=/^[A-Za-z0-9_]+/.exec(row.Type)?.[0].toLowerCase();return{name:row.Field,...(type?{dataType:type}:{}),visible:!/(?:^|\s)INVISIBLE(?:\s|$)/i.test(row.Extra)};
  },control);
  if(!columns.length||new Set(columns.map(column=>column.name.toLowerCase())).size!==columns.length)throw new Error('当前会话字段为空或重复，未替换已有缓存');
  control.check();catalog.confirm(input.database,input.table,columns);return{temporary:true,...input,revision:catalog.revision,columns:columns.length};
}
