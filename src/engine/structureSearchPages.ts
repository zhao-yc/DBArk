import { randomUUID } from 'node:crypto';
import { structureSearchInputSchema, structureSearchContinueSchema, structureSearchReleaseSchema, structureSearchLimits,
  type StructureSearchInput, type StructureSearchPage } from '../shared/databaseSearch';

export interface StructureSearchState {
  input: StructureSearchInput;
  scope: number;
  total: number;
  after?: { object: string; name: string };
  scannedDefinitions?: number;
  sqliteFile?: { path: string; device: string; inode: string; schemaVersion: string };
}
type SearchState = StructureSearchState;
interface CursorState { state: SearchState; expires: number }

/** 服务端随机续页句柄绑定连接；每次只消费一次，过期/关闭/改目标后不能复用。 */
export class StructureSearchPages{
  private readonly cursors=new Map<string,CursorState>();
  private readonly active = new Set<{ connectionId: string; invalidated: boolean }>();
  /** 时钟只控制小型续页状态的到期，不延长实际数据库任务生命周期。 */
  constructor(private readonly now:()=>number=Date.now){}
  /** 到期清理只丢弃小型目录位置，不存在后台连接或后台继续扫描。 */
  private prune(){for(const [cursor,value]of this.cursors)if(value.expires<=this.now())this.cursors.delete(cursor);}
  /** 配置保存、断连和退出时统一使该目标的继续搜索失效。 */
  releaseConnection(connectionId:string){
    for(const [cursor,value]of this.cursors)if(value.state.input.connectionId===connectionId)this.cursors.delete(cursor);
    for(const read of this.active)if(read.connectionId===connectionId)read.invalidated=true;
  }
  /** 仅释放属于请求连接的句柄，不允许跨连接清除另一个搜索。 */
  release(raw:unknown){const input=structureSearchReleaseSchema.parse(raw),entry=this.cursors.get(input.cursor);if(entry&&entry.state.input.connectionId!==input.connectionId)throw Error('搜索不属于当前连接');this.cursors.delete(input.cursor);}
  /** 在任务连接真正关闭后才发布下一页句柄，取消/错误不保留可继续状态。 */
  private async run(state:SearchState,read:(state:SearchState)=>Promise<StructureSearchPage>):Promise<StructureSearchPage>{
    this.prune();if(this.cursors.size+this.active.size>=structureSearchLimits.cursors)throw Error('搜索已达上限，请关闭旧搜索后重试');
    const pending = { connectionId: state.input.connectionId, invalidated: false };
    this.active.add(pending);
    try{
      const page=await read(state);
      // 断开可能发生在短连接收尾与游标发布之间。原连接回包不能在断开后重新生成续页。
      if (pending.invalidated) throw Error('搜索连接已断开或变化，请重新搜索');
      if(!page.limitReached&&!page.stoppedOnError&&state.scope<page.scopeCount){const cursor=randomUUID(),expires=this.now()+structureSearchLimits.cursorMs;this.cursors.set(cursor,{state,expires});page.cursor=cursor;page.expiresAt=new Date(expires).toISOString();}
      // 定义位置、摘要、对象名及续页元数据共同占128KiB；失败不泄漏已生成的游标。
      if((state.input.searchIn==='definition'||state.input.dialect)&&Buffer.byteLength(JSON.stringify(page))>structureSearchLimits.pageBytes){if(page.cursor)this.cursors.delete(page.cursor);throw Error('结构搜索批次及元数据超过128KiB');}
      return page;
    }finally{this.active.delete(pending);}
  }
  startPage(raw:unknown,dialect:StructureSearchInput['dialect'],read:(state:SearchState)=>Promise<StructureSearchPage>){
    const input=structureSearchInputSchema.parse(raw);
    if(input.dialect!==dialect)throw Error('搜索方言与保存的连接不匹配');
    return this.run({input,scope:0,total:0},read);
  }

  nextPage(raw:unknown,dialect:StructureSearchInput['dialect'],read:(state:SearchState)=>Promise<StructureSearchPage>){
    this.prune();
    const input=structureSearchContinueSchema.parse(raw),entry=this.cursors.get(input.cursor);
    if(!entry)throw Error('搜索已过期或已继续，请重新搜索');
    if(entry.state.input.connectionId!==input.connectionId||entry.state.input.dialect!==dialect)throw Error('搜索不属于当前连接');
    this.cursors.delete(input.cursor);
    return this.run(entry.state,read);
  }
}
