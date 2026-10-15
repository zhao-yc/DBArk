import type {ManagedConnection} from './connection';
import type {CompletionSessionState} from '../shared/sqlCompletion';
import type {SqlLexicalMode} from '../shared/queryParameters';
import {sqlExecutableWords} from '../shared/queryParameters';
import {completionIdentifier} from '../shared/completionLexical';
export interface CompletionDatabaseState{database:string|null;known:boolean}
export interface SessionStatePacket{serverStatus?:number;stateChanges?:{schema?:string|null;systemVariables?:Record<string,string>};sql?:string}

/** 初始化只使用新连接既有诊断轮次取得的DATABASE()，不在用户执行后附加探测SQL。 */
export function initialCompletionDatabase(value:unknown):CompletionDatabaseState{return value===null?{database:null,known:true}:completionIdentifier(value)?{database:value,known:true}:{database:null,known:false};}
/** 默认库名称来自实际协议；跟踪关闭后的USE/不透明执行无报告时，旧库不能继续当真值。 */
export function observeCompletionDatabase(managed:ManagedConnection,packet:SessionStatePacket,mode:SqlLexicalMode):void{
  const state=managed.completionDatabase;if(!state)return;
  const schema=packet.stateChanges?.schema,hasName=typeof schema==='string';
  if(hasName){
    const valid=Number.isInteger(packet.serverStatus)&&Boolean(packet.serverStatus!&16384)&&(schema===''||completionIdentifier(schema));
    state.known=valid;if(valid)state.database=schema===''?null:schema;return;
  }
  if(!packet.sql||Number(packet.serverStatus)&8)return;
  try{
    const words=sqlExecutableWords(packet.sql,mode),first=words[0];
    if(['USE','CALL','EXECUTE','RESET'].includes(first)||first==='DROP'&&words.slice(1,4).some(word=>word==='DATABASE'||word==='SCHEMA'))state.known=false;
  }catch{state.known=false;}
}
/** 错误后的部分执行不可推断默认库，保留内部旧值仅供后续协议替换，绝不向界面输出。 */
export function invalidateCompletionDatabase(managed:ManagedConnection):void{if(managed.completionDatabase)managed.completionDatabase.known=false;}
/** 该读取为同步内存快照，繁忙或断开的会话不交付过程中/过期状态。 */
export function completionSessionState(managed:ManagedConnection,busy:boolean):CompletionSessionState{
  const broken=managed.broken||managed.serverStatus===undefined;if(busy||broken)return{databaseKnown:false,broken,busy};
  const state=managed.completionDatabase,known=state?.known===true;
  const sqlMode=managed.sqlMode,modes=sqlMode?.split(','),noBackslashEscapes=modes?modes.includes('NO_BACKSLASH_ESCAPES'):managed.noBackslashEscapesKnown===true?Boolean(managed.serverStatus!&512):undefined;
  return{databaseKnown:known,...(known?{database:state!.database}:{}),...(modes?{ansiQuotes:modes.includes('ANSI_QUOTES')}:{}),...(noBackslashEscapes===undefined?{}:{noBackslashEscapes}),broken:false,busy:false};
}
