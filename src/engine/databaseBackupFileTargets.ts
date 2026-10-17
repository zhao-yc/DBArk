import { isAbsolute, resolve } from 'node:path';
import { AtomicFileTargetReservation, type AtomicFileIO } from './atomicFile';
import { DatabaseBackupAtomicArchive } from './databaseBackupAtomicArchive';
import type { DatabaseBackupExecutionArchive, DatabaseBackupExecutionOwner, DatabaseBackupTargetReservation } from './databaseBackupExecution';
import type { DatabaseBackupRunBindings } from './databaseBackupPlan';

export interface AuthorizedBackupFile {
  purpose:'database-backup'; fileToken:string; outputLease:string; revision:string; filePath:string; artifactToken:string;
}
interface TargetRecord {
  owner:DatabaseBackupExecutionOwner; ownerValues:readonly[string,string]; binding:DatabaseBackupRunBindings;
  authority:AuthorizedBackupFile; handle:DatabaseBackupTargetReservation; ready:Promise<AtomicFileTargetReservation>;
  reservation?:AtomicFileTargetReservation; settled:boolean; allocated:boolean; released:boolean; stale:boolean; invalidOwner:boolean;
  archive?:DatabaseBackupAtomicArchive;
}

/** 仅连接私有文件授权表与执行器；文件路径不来自renderer或未校验的计划内容。 */
export class DatabaseBackupFileTargets {
  private readonly records=new Map<string,TargetRecord>();
  private readonly handles=new WeakMap<DatabaseBackupTargetReservation,TargetRecord>();
  constructor(private readonly authorized:(binding:DatabaseBackupRunBindings)=>AuthorizedBackupFile,private readonly io?:AtomicFileIO){}
  /** 只复制白名单原始值；授权读取必须是主进程注入后的私有表查询，不进行新的文件选择。 */
  private authority(binding:DatabaseBackupRunBindings):AuthorizedBackupFile {
    const value=this.authorized(binding),out=binding.output;
    if(!value||value.purpose!=='database-backup'||out.format!=='dbark-backup-zip'||out.writable!==true||value.fileToken!==out.fileToken||value.outputLease!==out.outputLease||value.revision!==out.revision||typeof value.filePath!=='string'||!isAbsolute(value.filePath)||value.filePath.includes('\0')||value.filePath.length>32767||typeof value.artifactToken!=='string'||!value.artifactToken||value.artifactToken.length>200||value.artifactToken.includes('\0'))throw Error('备份文件授权或修订已失效');
    return {purpose:'database-backup',fileToken:value.fileToken,outputLease:value.outputLease,revision:value.revision,filePath:resolve(value.filePath),artifactToken:value.artifactToken};
  }
  private owner(record:TargetRecord):void {
    if(record.invalidOwner||record.owner.taskId!==record.ownerValues[0]||record.owner.planToken!==record.ownerValues[1]){record.invalidOwner=true;throw Error('备份文件目标owner已失效');}
  }
  /** 清理只核原归属；写入还须核活授权，观察到撤销后不因恢复原值而复活。 */
  private current(record:TargetRecord):void {
    this.owner(record);
    if(record.stale||record.released)throw Error('备份文件授权已撤销');
    try{
      const next=this.authority(record.binding),original=record.authority;
      if(next.filePath!==original.filePath||next.fileToken!==original.fileToken||next.outputLease!==original.outputLease||next.revision!==original.revision||next.artifactToken!==original.artifactToken)throw Error('备份文件授权发生变化');
    }catch(error){record.stale=true;throw error;}
  }
  /** 在首个目录归一化await前登记目标；迟到的原预留仍留在同一有界记录。 */
  reserve(owner:DatabaseBackupExecutionOwner,binding:DatabaseBackupRunBindings):DatabaseBackupTargetReservation {
    if(this.records.size>=8||this.records.has(owner.taskId))throw Error('备份文件目标容量已满或任务已登记');
    if(owner.planToken!==binding.plan.planToken)throw Error('备份文件计划归属不符');
    const authority=this.authority(binding);
    let record:TargetRecord,accept!:(value:AtomicFileTargetReservation)=>void,refuse!:(error:unknown)=>void;
    const ready=new Promise<AtomicFileTargetReservation>((resolve,reject)=>{accept=resolve;refuse=reject;});
    const handle:DatabaseBackupTargetReservation={owner,release:()=>this.release(record)};
    record={owner,ownerValues:[owner.taskId,owner.planToken],binding,authority,handle,ready,settled:false,allocated:false,released:false,stale:false,invalidOwner:false};
    this.records.set(owner.taskId,record);this.handles.set(record.handle,record);
    void AtomicFileTargetReservation.reserve(authority.filePath).then(reservation=>{record.reservation=reservation;record.settled=true;accept(reservation);},error=>{record.settled=true;refuse(error);});
    void record.ready.catch(()=>{});return record.handle;
  }
  /** 仅绑定一次真实适配器，后续所有文件操作沿同一授权、预留与计划预算执行。 */
  allocateArchive(owner:DatabaseBackupExecutionOwner,binding:DatabaseBackupRunBindings,target:DatabaseBackupTargetReservation,hooks:{checkCancelled():void;onCommitStart():void}):DatabaseBackupExecutionArchive {
    const record=this.handles.get(target);
    if(!record||record.owner!==owner||record.binding!==binding||record.allocated||record.released)throw Error('备份文件目标不能换绑或重复领取');
    this.current(record);record.allocated=true;
    try{
      record.archive=new DatabaseBackupAtomicArchive(owner,record.authority.filePath,record.ready,{checkCancelled:()=>{this.current(record);hooks.checkCancelled();},onCommitStart:()=>{this.current(record);hooks.onCommitStart();}},this.io,record.authority.artifactToken,binding.plan.maxBytes);
      return record.archive;
    }catch(error){record.allocated=false;throw error;}
  }
  /** 未确认的记录不按TTL驱逐；归还幂等且不能误删相同任务号后来的新目标记录。 */
  private async release(record:TargetRecord):Promise<{owner:DatabaseBackupExecutionOwner;state:'confirmed'|'unknown'}>{
    this.owner(record);
    if(record.released)return {owner:record.owner,state:'confirmed'};
    if(!record.settled)return {owner:record.owner,state:'unknown'};
    if(record.archive){const proof=await record.archive.releaseTarget();if(proof.owner!==record.owner||proof.state!=='confirmed')return {owner:record.owner,state:'unknown'};}
    else if(record.allocated)return {owner:record.owner,state:'unknown'};
    else record.reservation?.release();
    record.released=true;if(this.records.get(record.owner.taskId)===record)this.records.delete(record.owner.taskId);
    return {owner:record.owner,state:'confirmed'};
  }
}
