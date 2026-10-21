import type {CompletionSessionState} from '../shared/sqlCompletion';
import type {CompletionLexicalMode} from '../shared/completionLexical';
import type {ConnectionStatus} from '../shared/contracts';
import {completionCapabilitiesForServer,type CompletionScopeCapabilities} from '../shared/completionCapabilities';
export interface SqlCompletionScope{connectionId:string;connectionVersion:number;database?:string;databaseUnknown?:boolean;sessionId?:string}

/** 已提交的编辑目标逐项核对；新对象但同一作用域不重置，换会话／库绝不复用旧结果。 */
export function sameCompletionScope(left:SqlCompletionScope|undefined,right:SqlCompletionScope|undefined):boolean {
  return !!left && !!right && left.connectionId===right.connectionId && left.connectionVersion===right.connectionVersion && left.database===right.database && left.databaseUnknown===right.databaseUnknown && left.sessionId===right.sessionId;
}
/** 同一物理会话的模式、对象代次及默认库都必须保持，不把迟到元数据交给新上下文。 */
export function sameCompletionState(left:CompletionSessionState,right:CompletionSessionState):boolean {
  return !right.busy&&!right.broken&&left.databaseKnown===right.databaseKnown&&left.database===right.database&&left.objectsRevision===right.objectsRevision&&left.dialect===right.dialect&&left.serverVersion===right.serverVersion&&left.ansiQuotes===right.ansiQuotes&&left.noBackslashEscapes===right.noBackslashEscapes;
}

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
