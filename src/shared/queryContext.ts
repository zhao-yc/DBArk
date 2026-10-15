import type {CompletionSessionState} from './sqlCompletion';

/** 查询的已知空库与未知状态必须分开持久化，未知时不能回退连接配置的默认库。 */
export type QueryDatabaseContext = {state:'known';database:string|null}|{state:'unknown'};

/** 仅兼容旧草稿的初始库；显式上下文始终优先，包括空库和未知状态。 */
export function resolveQueryDatabase(database?:string,context?:QueryDatabaseContext,profileDatabase?:string):QueryDatabaseContext{
  if(context)return {...context};
  return {state:'known',database:database||profileDatabase||null};
}

/** 协议缓存不可用时保守保存未知，不使用较早的默认库推测当前执行目标。 */
export function queryDatabaseFromSession(state?:CompletionSessionState):QueryDatabaseContext{
  return state?.databaseKnown&&!state.broken&&!state.busy&&state.database!==undefined?{state:'known',database:state.database}:{state:'unknown'};
}

/** 同时更新旧版展示字段与新上下文，防止旧库在保存或重开时重新出现。 */
export function queryDatabasePatch(context:QueryDatabaseContext):{database?:string;databaseContext:QueryDatabaseContext}{
  return {database:context.state==='known'?context.database??undefined:undefined,databaseContext:{...context}};
}

/** 建连必须区分空库与省略参数；未知上下文需由用户先明确选择。 */
export function queryConnectionDatabase(context:QueryDatabaseContext):string|null{
  if(context.state==='unknown')throw new Error('默认库待确认，请先选择重连数据库，再执行查询');
  return context.database;
}
