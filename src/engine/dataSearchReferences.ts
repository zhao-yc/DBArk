import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { dataSearchRecordLimits as limits, dataSearchRecordReadSchema, dataSearchRecordsReleaseSchema, type DataSearchNavigationReason } from '../shared/dataSearchRecords';
import type { DataSearchTargetMetadata, DataSearchRow, PostgresSearchRowIdentity, SqliteSearchRowIdentity } from '../shared/dataSearch';
import type { CellValue } from '../shared/contracts';

interface Identity{server:string;tableId:string;definition:string}
export type RecordPreparation={identity:Identity}|{reason:DataSearchNavigationReason};
interface Locator{connectionId:string;sourceTaskId:string;metadata:DataSearchTargetMetadata;keyValues:CellValue[];timestampEpochs?:(string|null)[];postgresIdentity?:PostgresSearchRowIdentity;sqliteIdentity?:SqliteSearchRowIdentity;mysqlEditStamp?:string;identity:Identity;searchedAt:string;expires:number;bytes:number}
/** 引用只保留有界键和摘要，不保留数据库连接；窗口、新搜索、到期和连接更改均可清理。 */
export class DataSearchReferences{
 private entries=new Map<string,Locator>();private bytes=0;private timer?:ReturnType<typeof setTimeout>;
 /** 到期定时器可停止，不把已经关闭窗口的键无限留在工具进程中。 */
 private prune(){const now=Date.now();for(const[id,entry]of this.entries)if(entry.expires<=now){this.bytes-=entry.bytes;this.entries.delete(id);}if(this.timer)clearTimeout(this.timer);this.timer=undefined;if(this.entries.size){const expiry=Math.min(...[...this.entries.values()].map(entry=>entry.expires));this.timer=setTimeout(()=>this.prune(),Math.max(1,expiry-now));this.timer.unref();}}
 /** 全局任务编号仍有定位引用时不能复用，防止旧窗口清理影响新来源。 */
 assertNewSource(input:{connectionId:string;taskId:string}){this.prune();if([...this.entries.values()].some(entry=>entry.sourceTaskId===input.taskId))throw Error('搜索编号仍有定位引用，请释放旧来源或使用新的编号');}
 /** 每条引用独立绑定来源搜索与连接；键值只来自真实驱动解码。 */
 capture(connectionId:string,sourceTaskId:string,metadata:DataSearchTargetMetadata,row:DataSearchRow,prepared:RecordPreparation):{recordRef?:string;navigationReason?:DataSearchNavigationReason}{
  this.prune();if(!row.keyValues)return{navigationReason:'no-key'};if('reason'in prepared)return{navigationReason:prepared.reason};
  if([...this.entries.values()].some(entry=>entry.sourceTaskId===sourceTaskId&&entry.connectionId!==connectionId))throw Error('记录来源不属于此连接');
  const data={connectionId,sourceTaskId,metadata,keyValues:row.keyValues,timestampEpochs:row.timestampEpochs,postgresIdentity:row.postgresIdentity,sqliteIdentity:row.sqliteIdentity,mysqlEditStamp:row.mysqlEditStamp,identity:prepared.identity,searchedAt:new Date().toISOString(),expires:Date.now()+limits.retentionMs},bytes=Buffer.byteLength(JSON.stringify(data));
  if(this.entries.size>=limits.references||this.bytes+bytes>limits.bytes)return{navigationReason:'budget'};
  const recordRef=randomUUID();this.entries.set(recordRef,{...structuredClone(data),bytes});this.bytes+=bytes;this.prune();return{recordRef};
 }
 /** 删除前完整核对来源归属，未知旧引用可幂等释放，不影响其它连接。 */
 release(raw:unknown){const input=dataSearchRecordsReleaseSchema.parse(raw);this.prune();const matches=[...this.entries].filter(([,entry])=>entry.sourceTaskId===input.sourceTaskId);if(matches.some(([,entry])=>entry.connectionId!==input.connectionId))throw Error('记录引用不属于此连接');for(const[id,entry]of matches){this.entries.delete(id);this.bytes-=entry.bytes;}this.prune();}
 /** 连接目标保存或关闭后，旧目标的定位引用必须全部失效。 */
 releaseConnection(connectionId:string){for(const[id,entry]of this.entries)if(entry.connectionId===connectionId){this.entries.delete(id);this.bytes-=entry.bytes;}this.prune();}
 /** 工具进程退出前取消本地到期计时，数据库任务由引擎另行等待。 */
 close(){if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.entries.clear();this.bytes=0;}
 /** 定位读取先取得原引用，返回前再次核对引用没有被关闭或过期。 */
 lookup(raw:unknown) {
  const input=dataSearchRecordReadSchema.parse(raw);this.prune();const entry=this.entries.get(input.recordRef);
  if(!entry)throw Error('记录定位已过期或已释放，请重新搜索');
  if(entry.connectionId!==input.connectionId)throw Error('记录引用不属于此连接');
  return entry;
 }
}
