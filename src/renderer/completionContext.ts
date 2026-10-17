import type {CompletionSessionState} from '../shared/sqlCompletion';
import type {CompletionLexicalMode} from '../shared/completionLexical';
import type {ConnectionStatus} from '../shared/contracts';
import {completionCapabilitiesForServer,type CompletionScopeCapabilities} from '../shared/completionCapabilities';

/** 物理会话事实始终优先；断开、繁忙或未知版本不能借用另一连接轮次的能力。 */
export function completionContextCapabilities(state?:CompletionSessionState,opened?:Readonly<Pick<ConnectionStatus,'dialect'|'version'>>):CompletionScopeCapabilities{
  if(state)return state.busy||state.broken?{lateralDerivedTables:false,windowFunctions:false,insertRowAliases:false}:completionCapabilitiesForServer(state.dialect,state.serverVersion);
  return completionCapabilitiesForServer(opened?.dialect,opened?.version);
}
/** 初始标签库仅用于尚无查询会话的草稿；已存在会话必须采用其缓存快照。 */
export function resolveCompletionContext(initialDatabase:string|undefined,state?:CompletionSessionState,draftDatabaseUnknown=false):{database?:string;mode:CompletionLexicalMode;databaseUnknown:boolean;available:boolean;reason?:'busy'|'broken'}{
  if(!state)return{database:draftDatabaseUnknown?undefined:initialDatabase,mode:{},databaseUnknown:draftDatabaseUnknown,available:true};
  if(state.busy||state.broken)return{mode:{},databaseUnknown:true,available:false,reason:state.broken?'broken':'busy'};
  return{database:state.databaseKnown?state.database??undefined:undefined,mode:{ansiQuotes:state.ansiQuotes,noBackslashEscapes:state.noBackslashEscapes},databaseUnknown:!state.databaseKnown,available:true};
}
