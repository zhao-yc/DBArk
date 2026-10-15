import type {CompletionSessionState} from '../shared/sqlCompletion';
import type {CompletionLexicalMode} from '../shared/completionLexical';
/** 初始标签库仅用于尚无查询会话的草稿；已存在会话必须采用其缓存快照。 */
export function resolveCompletionContext(initialDatabase:string|undefined,state?:CompletionSessionState,draftDatabaseUnknown=false):{database?:string;mode:CompletionLexicalMode;databaseUnknown:boolean;available:boolean;reason?:'busy'|'broken'}{
  if(!state)return{database:draftDatabaseUnknown?undefined:initialDatabase,mode:{},databaseUnknown:draftDatabaseUnknown,available:true};
  if(state.busy||state.broken)return{mode:{},databaseUnknown:true,available:false,reason:state.broken?'broken':'busy'};
  return{database:state.databaseKnown?state.database??undefined:undefined,mode:{ansiQuotes:state.ansiQuotes,noBackslashEscapes:state.noBackslashEscapes},databaseUnknown:!state.databaseKnown,available:true};
}
