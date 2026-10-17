import { basename, dirname, resolve } from 'node:path';
import { AtomicFile, AtomicFileTargetReservation, nativeAtomicFileIO, type AtomicFileIO, type WritableFile } from './atomicFile';
import { DatabaseBackupArchiveWriter, type DatabaseBackupArchiveManifest, type DatabaseBackupArchiveManifestInput } from './databaseBackupArchive';

interface Owner { readonly taskId:string; readonly planToken:string; }
interface EndProof { owner:Owner; state:'confirmed'|'unknown'; }
interface FileRecord {
  path:string; file?:WritableFile; openSettled:boolean; closed:boolean; removed:boolean;
  closePromise?:Promise<void>; removePromise?:Promise<void>;
}
interface Hooks { checkCancelled():void; onCommitStart():void; }
type Summary={dump:DatabaseBackupArchiveManifest['dump'];archive:{bytes:string;sha256:string};manifest:DatabaseBackupArchiveManifest};

/** 同一owner的真实归档适配器；只消费已授权路径与预登记的目标预留Promise，不创建新的文件授权。 */
export class DatabaseBackupAtomicArchive {
  private readonly target:string;
  private readonly ownerValues:readonly[string,string];
  private readonly ready:Promise<AtomicFileTargetReservation>;
  private reservation?:AtomicFileTargetReservation;
  private reservationSettled=false;
  private state:'new'|'open'|'finished'|'failed'|'aborted'|'committed'='new';
  private active=false;
  private file?:AtomicFile;
  private writer?:DatabaseBackupArchiveWriter;
  private record?:FileRecord;
  private summary?:Summary;
  private abortPromise?:Promise<EndProof>;
  private rename:'none'|'pending'|'confirmed'|'unknown'='none';
  private boundary=false;
  private released=false;
  private cleanupConfirmed=false;
  private ownerInvalid=false;

  /** reservation必须是任务同步登记后启动的AtomicFileTargetReservation.reserve原Promise，不能在清理时临时分配。 */
  constructor(readonly owner:Owner,target:string,reservation:Promise<AtomicFileTargetReservation>,private readonly hooks:Hooks,private readonly io:AtomicFileIO=nativeAtomicFileIO,private readonly artifactToken?:string) {
    this.target=resolve(target);this.ownerValues=[owner.taskId,owner.planToken];
    if(!owner.taskId||!owner.planToken||owner.taskId.length>200||owner.planToken.length>200)throw Error('备份归档所属任务无效');
    this.ready=reservation.then(value=>{this.reservation=value;this.reservationSettled=true;return value;},reason=>{this.reservationSettled=true;throw reason;});
    void this.ready.catch(()=>{});
  }
  /** 所有回执始终属于原对象和原编号；字段变化也不能把旧资源交给新任务。 */
  private assertOwner():void {
    if(this.ownerInvalid||this.owner.taskId!==this.ownerValues[0]||this.owner.planToken!==this.ownerValues[1]){this.ownerInvalid=true;throw Error('备份归档owner已变化');}
  }
  private check():void {this.assertOwner();this.hooks.checkCancelled();if(this.state==='failed'||this.state==='aborted')throw Error('备份归档已停链');}
  /** 不排队隐藏重入；原调用失败前后都保留已分配句柄，清理只能在其完全离开后开始。 */
  private async operation<T>(allowed:readonly string[],work:()=>Promise<T>):Promise<T>{
    this.assertOwner();
    if(this.active||!allowed.includes(this.state)){this.state='failed';throw Error('备份归档操作顺序或并发无效');}
    this.active=true;
    try{return await work();}catch(error){this.state='failed';throw error;}finally{this.active=false;}
  }
  /** 包装真实文件回执；即使AtomicFile丢弃内部引用，失败的原句柄和原清理Promise仍可观察。 */
  private trackedIO():AtomicFileIO {
    return {
      open:async path=>{
        if(this.record||dirname(path)!==dirname(this.target)||!basename(path).startsWith(basename(this.target)+'.dbark-')||!path.endsWith('.partial'))throw Error('备份临时文件路径或分配次数无效');
        const record:FileRecord={path,openSettled:false,closed:false,removed:false};this.record=record;
        try{
          const file=await this.io.open(path);record.file=file;record.openSettled=true;
          return {write:(bytes,offset,length)=>file.write(bytes,offset,length),sync:()=>file.sync(),close:()=>{
            record.closePromise??=Promise.resolve().then(()=>file.close()).then(()=>{record.closed=true;});
            return record.closePromise;
          }};
        }catch(error){record.openSettled=true;throw error;}
      },
      rename:async(source,target)=>{
        if(source!==this.record?.path||target!==this.target||!this.record.closed||this.rename!=='none')throw Error('备份原子替换归属或文件关闭事实无效');
        this.rename='pending';
        try{await this.io.rename(source,target);this.rename='confirmed';}catch(error){this.rename='unknown';throw error;}
      },
      remove:async path=>{
        if(path!==this.record?.path||this.boundary)throw Error('备份提交开始后不能删除未知归档');
        this.record.removePromise??=Promise.resolve().then(()=>this.io.remove(path)).then(()=>{this.record!.removed=true;});
        await this.record.removePromise;
      }
    };
  }
  /** 先捕获目标预留及AtomicFile，再开始固定dump条目；任何迟到分配都保留在原实例。 */
  open():Promise<void>{return this.operation(['new'],async()=>{
    this.check();const reservation=await this.ready;this.check();
    this.file=await AtomicFile.create(this.target,'utf8',()=>this.check(),()=>{this.boundary=true;this.hooks.onCommitStart();},this.trackedIO(),10*1024**3,reservation);
    this.check();this.writer=new DatabaseBackupArchiveWriter(this.file,()=>this.check());await this.writer.startDump();this.check();this.state='open';
  });}
  /** 每片保持64KiB上限，真实背压沿writer和AtomicFile传递，不解码或重写SQL。 */
  writeDump(bytes:Uint8Array):Promise<void>{return this.operation(['open'],async()=>{this.check();await this.writer!.writeDump(bytes);this.check();});}
  finish(manifest:DatabaseBackupArchiveManifestInput):Promise<Summary>{return this.operation(['open'],async()=>{
    this.check();const result=await this.writer!.finish(manifest);this.check();this.summary=result;this.state='finished';return structuredClone(result);
  });}
  /** rename边界开始后即保留未知；成功后还要确认AtomicFile清理完成才发放closed事实。 */
  commit():Promise<void>{return this.operation(['finished'],async()=>{
    this.check();await this.file!.commit();
    if(!this.file!.fileCommitted||this.rename!=='confirmed')throw Error('备份归档发布事实不完整');
    await this.file!.dispose();this.assertOwner();this.cleanupConfirmed=true;this.state='committed';
  });}
  /** 不在仍运行的写入或提交未知期间补发dispose；重复调用复用第一次真实清理承诺。 */
  abort():Promise<EndProof>{
    this.assertOwner();
    if(this.cleanupConfirmed&&this.snapshot().closed)return Promise.resolve({owner:this.owner,state:'confirmed'});
    if(this.active||this.boundary)return Promise.resolve({owner:this.owner,state:'unknown'});
    this.abortPromise??=(async()=>{
      this.state='aborted';
      await this.file?.dispose();this.assertOwner();this.cleanupConfirmed=true;
      return {owner:this.owner,state:this.snapshot().closed?'confirmed':'unknown'} as EndProof;
    })();
    return this.abortPromise;
  }
  /** 本地快照不替代显式close回执；无句柄返回的open失败仍保持unknown。 */
  snapshot(){
    this.assertOwner();const committed=this.rename==='confirmed'||this.file?.fileCommitted===true;
    const record=this.record,filesClosed=!record||(record.openSettled&&!!record.file&&record.closed&&(record.removed||committed));
    const closed=this.reservationSettled&&!this.active&&filesClosed&&this.cleanupConfirmed;
    return {owner:this.owner,fileCommitted:committed,closed,...(committed&&this.summary?{artifactToken:this.artifactToken,bytes:this.summary.archive.bytes,sha256:this.summary.archive.sha256}:{})};
  }
  /** 目标预留与普通CSV/JSON共享互斥；只有同owner清理已证实后才显式归还。 */
  async releaseTarget():Promise<EndProof>{
    this.assertOwner();if(!this.snapshot().closed)return {owner:this.owner,state:'unknown'};
    if(!this.released){this.reservation?.release();this.released=true;}
    return {owner:this.owner,state:'confirmed'};
  }
}
