import {randomUUID} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {structureSearchInputSchema,structureSearchContinueSchema,structureSearchReleaseSchema,structureSearchLimits,searchIdentifier,type StructureSearchInput,type StructureSearchKind,type StructureSearchHit,type StructureSearchPage} from '../shared/databaseSearch';
import {databaseSearchMatch} from './databaseSearchMatch';
import {completionQuery} from './completionQuery';
import type {ManagedConnection} from './connection';
import type {StructureTaskContext} from './structureDefinition';

interface Position{object:string;name:string}
interface SearchState{input:StructureSearchInput;scope:number;total:number;after?:Position}
interface CursorState{state:SearchState;expires:number}
type Control=Pick<StructureTaskContext,'checkCancelled'|'commandStarted'>;
type Run=<T>(action:(managed:ManagedConnection,control:Control)=>Promise<T>)=>Promise<T>;
const binary=(expression:string)=>'CAST('+expression+' AS BINARY)';

/** 每种类别只读取当前账号可见的名称，既不SELECT视图数据，也不调用例程和用户函数。 */
function source(kind:StructureSearchKind):string{
  const schema=(field:string)=>binary(field)+' = '+binary('?');
  switch(kind){
    case 'table':case 'view':return "SELECT TABLE_NAME AS object_name,TABLE_NAME AS match_name,'"+kind+"' AS parent_kind FROM information_schema.TABLES WHERE "+schema('TABLE_SCHEMA')+" AND TABLE_TYPE='"+(kind==='table'?'BASE TABLE':'VIEW')+"'";
    case 'column':return "SELECT C.TABLE_NAME AS object_name,C.COLUMN_NAME AS match_name,CASE WHEN T.TABLE_TYPE='VIEW' THEN 'view' ELSE 'table' END AS parent_kind FROM information_schema.COLUMNS C JOIN information_schema.TABLES T ON "+binary('C.TABLE_SCHEMA')+' = '+binary('T.TABLE_SCHEMA')+' AND '+binary('C.TABLE_NAME')+' = '+binary('T.TABLE_NAME')+' WHERE '+schema('C.TABLE_SCHEMA');
    case 'index':return "SELECT DISTINCT TABLE_NAME AS object_name,INDEX_NAME AS match_name,'table' AS parent_kind FROM information_schema.STATISTICS WHERE "+schema('TABLE_SCHEMA');
    case 'primaryKey':case 'foreignKey':return "SELECT TABLE_NAME AS object_name,CONSTRAINT_NAME AS match_name,'table' AS parent_kind FROM information_schema.TABLE_CONSTRAINTS WHERE "+schema('TABLE_SCHEMA')+" AND CONSTRAINT_TYPE='"+(kind==='primaryKey'?'PRIMARY KEY':'FOREIGN KEY')+"'";
    case 'procedure':case 'function':return "SELECT ROUTINE_NAME AS object_name,ROUTINE_NAME AS match_name,'"+kind+"' AS parent_kind FROM information_schema.ROUTINES WHERE "+schema('ROUTINE_SCHEMA')+" AND ROUTINE_TYPE='"+kind.toUpperCase()+"'";
    case 'trigger':return "SELECT TRIGGER_NAME AS object_name,TRIGGER_NAME AS match_name,'trigger' AS parent_kind FROM information_schema.TRIGGERS WHERE "+schema('TRIGGER_SCHEMA');
    case 'event':return "SELECT EVENT_NAME AS object_name,EVENT_NAME AS match_name,'event' AS parent_kind FROM information_schema.EVENTS WHERE "+schema('EVENT_SCHEMA');
  }
}

/** 目录名与搜索值全走预处理协议；游标只保存二进制排序键，不使用OFFSET累计扫描。 */
export function structureSearchQuery(kind:StructureSearchKind,database:string,pattern:StructureSearchInput['pattern'],take:number,after?:Position):{sql:string;params:(string|number)[]}{
  searchIdentifier.parse(database);
  if(!Number.isInteger(take)||take<1||take>structureSearchLimits.pageHits)throw Error('搜索批次大小无效');
  const match=databaseSearchMatch({column:'match_name',qualifier:'search_names'},pattern),params:(string|number)[]=[database,...match.params];
  let where=match.sql;
  if(after){searchIdentifier.parse(after.object);searchIdentifier.parse(after.name);where+=' AND ('+binary('object_name')+' > '+binary('?')+' OR ('+binary('object_name')+' = '+binary('?')+' AND '+binary('match_name')+' > '+binary('?')+'))';params.push(after.object,after.object,after.name);}
  return{sql:'SELECT object_name,match_name,parent_kind FROM ('+source(kind)+') AS search_names WHERE '+where+' ORDER BY '+binary('object_name')+','+binary('match_name')+' LIMIT '+(take+1),params};
}

/** 单页读取的连接由引擎登记并收尾；只有用户继续时才查询下一页，不预取或堆积IPC批次。 */
async function readPage(state:SearchState,managed:ManagedConnection,control:Control):Promise<StructureSearchPage>{
  const {input}=state,page:StructureSearchPage={hits:[],failures:[],totalHits:state.total,completedScopes:state.scope,scopeCount:input.databases.length*input.kinds.length,limitReached:false,stoppedOnError:false};
  let queries=0,bytes=0;
  while(state.scope<page.scopeCount&&page.hits.length<structureSearchLimits.pageHits&&state.total<input.maxResults&&queries<structureSearchLimits.pageQueries){
    control.checkCancelled();
    const database=input.databases[Math.floor(state.scope/input.kinds.length)],kind=input.kinds[state.scope%input.kinds.length];
    const take=Math.min(structureSearchLimits.pageHits-page.hits.length,input.maxResults-state.total),query=structureSearchQuery(kind,database,input.pattern,take,state.after);
    queries++;
    let rows:Record<string,unknown>[];
    try{rows=(await completionQuery<Record<string,unknown>[]>(managed,control,query.sql,query.params)).rows;control.checkCancelled();}
    catch(error){
      control.checkCancelled();if(managed.broken)throw error;
      const message=error instanceof Error?error.message:String(error);
      page.failures.push({database,kind,message:message.slice(0,1024)});state.scope++;delete state.after;
      if(input.onError==='stop'){page.stoppedOnError=true;break;}continue;
    }
    if(rows.length>take+1)throw Error('服务器结构搜索超出批次预算');
    for(const row of rows.slice(0,take)){
      const object=searchIdentifier.parse(row.object_name),name=searchIdentifier.parse(row.match_name);
      if(!['table','view','procedure','function','trigger','event'].includes(String(row.parent_kind)))throw Error('服务器结构搜索返回未知对象类别');
      const hit:StructureSearchHit={database,kind,object,name,parentKind:row.parent_kind as StructureSearchHit['parentKind']};
      bytes+=Buffer.byteLength(JSON.stringify(hit));if(bytes>structureSearchLimits.pageBytes)throw Error('结构搜索批次超过128KiB，请缩小范围');
      page.hits.push(hit);state.total++;state.after={object,name};
    }
    if(rows.length<=take){state.scope++;delete state.after;}
  }
  control.checkCancelled();page.totalHits=state.total;page.completedScopes=state.scope;
  page.limitReached=!page.stoppedOnError&&state.total>=input.maxResults&&state.scope<page.scopeCount;
  return page;
}

/** 服务端随机续页句柄绑定连接；每次只消费一次，过期/关闭/改目标后不能复用。 */
export class StructureSearches{
  private readonly cursors=new Map<string,CursorState>();
  private active=0;
  /** 时钟只控制小型续页状态的到期，不延长实际数据库任务生命周期。 */
  constructor(private readonly now:()=>number=Date.now){}
  /** 到期清理只丢弃小型目录位置，不存在后台连接或后台继续扫描。 */
  private prune(){for(const [cursor,value]of this.cursors)if(value.expires<=this.now())this.cursors.delete(cursor);}
  /** 配置保存、断连和退出时统一使该目标的继续搜索失效。 */
  releaseConnection(connectionId:string){for(const [cursor,value]of this.cursors)if(value.state.input.connectionId===connectionId)this.cursors.delete(cursor);}
  /** 仅释放属于请求连接的句柄，不允许跨连接清除另一个搜索。 */
  release(raw:unknown){const input=structureSearchReleaseSchema.parse(raw),entry=this.cursors.get(input.cursor);if(entry&&entry.state.input.connectionId!==input.connectionId)throw Error('搜索不属于当前连接');this.cursors.delete(input.cursor);}
  /** 在任务连接真正关闭后才发布下一页句柄，取消/错误不保留可继续状态。 */
  private async run(state:SearchState,run:Run):Promise<StructureSearchPage>{
    this.prune();if(this.cursors.size+this.active>=structureSearchLimits.cursors)throw Error('搜索已达上限，请关闭旧搜索后重试');
    this.active++;
    try{
      const page=await run((managed,control)=>readPage(state,managed,control));
      if(!page.limitReached&&!page.stoppedOnError&&state.scope<page.scopeCount){const cursor=randomUUID(),expires=this.now()+structureSearchLimits.cursorMs;this.cursors.set(cursor,{state,expires});page.cursor=cursor;page.expiresAt=new Date(expires).toISOString();}
      return page;
    }finally{this.active--;}
  }
  /** 初始范围复制后保存在引擎，客户端后续不能偷偷修改搜索条件或定位键。 */
  start(raw:unknown,run:Run){const input=structureSearchInputSchema.parse(raw);return this.run({input,scope:0,total:0},run);}
  /** 先核对归属再消费；同时重复点击只能让一个请求获得此页。 */
  next(raw:unknown,run:Run){this.prune();const input=structureSearchContinueSchema.parse(raw),entry=this.cursors.get(input.cursor);if(!entry)throw Error('搜索已过期或已继续，请重新搜索');if(entry.state.input.connectionId!==input.connectionId)throw Error('搜索不属于当前连接');this.cursors.delete(input.cursor);return this.run(entry.state,run);}
}
