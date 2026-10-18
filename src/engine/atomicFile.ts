import { randomUUID } from 'node:crypto';
import { open, realpath, rename, rm, lstat } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import iconv from 'iconv-lite';
import { encodingName } from './files';
import { queryInsertZh as stagedText } from '../shared/queryInsertExport.zh-CN';

export interface WritableFile {
  write(buffer: Uint8Array, offset: number, length: number): Promise<{ bytesWritten: number }>;
  sync(): Promise<void>; close(): Promise<void>;
  identity?():Promise<string>;
  /** 从原open句柄启用整段生命周期保护；返回只对原目录项有效的清理能力。 */
  protectOwnership?():Promise<()=>Promise<void>>;
}
export interface AtomicFileIO {
  open(path: string): Promise<WritableFile>; rename(source: string, target: string): Promise<void>; remove(path: string): Promise<void>;
  identity?(path:string):Promise<string>;
  parentIdentity?(path:string):Promise<string>;
}
/** 同一原句柄及目录项必须具有相同身份、字节数和修改代次，拒绝符号链接与被替换的暂存。 */
function fileIdentity(value:BigIntStats):string{if(!value.isFile()||value.isSymbolicLink())throw Error(stagedText.identity);return [value.dev,value.ino,value.size,value.mtimeNs,value.ctimeNs].join(':');}
/** 原句柄固定dev/ino；只有本适配器成功写入才更新大小/时间代次，不从路径重新认领文件。 */
async function openNativeFile(path:string):Promise<WritableFile>{
  const file=await open(path,'wx');
  let expected:string;
  try{expected=fileIdentity(await file.stat({bigint:true}));}
  catch(error){await file.close();throw error;}
  let protecting=false,unknown=false,closed=false;
  const object=expected.split(':').slice(0,2).join(':');
  const handleIdentity=async()=>fileIdentity(await file.stat({bigint:true}));
  const pathIdentity=async()=>fileIdentity(await lstat(path,{bigint:true}));
  /** 任何已观察到的漂移永久撤销删除权；未知时仍关闭原句柄，但保留当前路径。 */
  const check=async()=>{try{if(unknown||await handleIdentity()!==expected||await pathIdentity()!==expected)throw Error(stagedText.identity);}catch(error){unknown=true;throw error;}};
  return{
    async protectOwnership(){
      protecting=true;await check();
      return async()=>{
        if(!closed||unknown)throw Error(stagedText.identity);
        try{if(await pathIdentity()!==expected)throw Error(stagedText.identity);}
        catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
        await rm(path,{force:true});
      };
    },
    async write(buffer,offset,length){
      if(protecting)await check();
      const result=await file.write(buffer,offset,length);
      if(protecting){
        // 快照在原写入回执内取得，外层等待期间的改写不能被下一次清理当成自有写入。
        const next=await handleIdentity();
        if(next.split(':').slice(0,2).join(':')!==object){unknown=true;throw Error(stagedText.identity);}
        expected=next;await check();
      }
      return result;
    },
    async sync(){if(protecting)await check();await file.sync();if(protecting)await check();},
    async close(){
      if(closed)return;
      let failure:unknown;
      if(protecting)try{await check();}catch(error){failure=error;}
      try{await file.close();closed=true;}catch(error){unknown=true;throw error;}
      if(failure)throw failure;
    },
    identity:handleIdentity,
  };
}
export const nativeAtomicFileIO: AtomicFileIO = {open:openNativeFile,identity:async path=>fileIdentity(await lstat(path,{bigint:true})),parentIdentity:async path=>{const value=await lstat(await realpath(dirname(resolve(path))),{bigint:true});if(!value.isDirectory())throw Error(stagedText.targetIdentity);return[value.dev,value.ino].join(':');},rename,remove:path=>rm(path,{force:true})};
const activeTargets = new Set<string>();
const targetReservations = new WeakMap<AtomicFileTargetReservation,{key:string;claimed:boolean;released:boolean}>();

/** 外层任务持有目标锁；文件清理失败时不随dispose释放，须由所属任务确认资源终态后归还。 */
export class AtomicFileTargetReservation {
  private constructor() {}
  static async reserve(target: string): Promise<AtomicFileTargetReservation> {
    const key=await exportTargetKey(target);
    if(activeTargets.has(key))throw Error('目标文件正在由另一个任务写入，请选择其他文件或等待');
    const reservation=new AtomicFileTargetReservation();
    targetReservations.set(reservation,{key,claimed:false,released:false});activeTargets.add(key);return reservation;
  }
  /** 仅私有任务协调器在确认同owner全部文件资源结束后调用；不向renderer暴露此对象。 */
  release(): void {
    const state=targetReservations.get(this);if(!state)throw Error('文件目标预留身份无效');
    if(!state.released){state.released=true;activeTargets.delete(state.key);}
  }
}

/** 对真实父目录归一化，防止相对路径、大小写或父目录链接绕过同目标互斥。 */
export async function exportTargetKey(target: string): Promise<string> {
  const absolute = resolve(target);
  const canonical = join(await realpath(dirname(absolute)), basename(absolute));
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

/** 同目录独占临时文件、无损编码、短写消费和明确的不可取消替换边界。 */
export class AtomicFile {
  private file?: WritableFile;
  private created = false;
  private disposed = false;
  private disposalFailure?:{reason:unknown};
  private committed = false;
  private prepared = false;
  private preparedIdentity?:string;
  private preparedParentIdentity?:string;
  private bytes = 0;
  private pendingBytes = 0;
  private pending: Uint8Array[] = [];
  private readonly temporary: string;
  private key = '';
  private ownsTarget = true;
  private removeOwned?:()=>Promise<void>;

  /** 构造不进行 IO；只有 open 成功后才拥有临时文件的删除权。 */
  private constructor(private readonly target: string, private readonly encoding: string, private readonly checkCancelled: () => void, private readonly onCommitStart: () => void, private readonly io: AtomicFileIO, private readonly maxBytes: number,private readonly protectOwnership:boolean) {
    this.temporary = `${target}.dbark-${randomUUID()}.partial`;
  }

  /** 创建或取消失败时释放目标锁，绝不删除未由本次 open 创建的文件。 */
  static async create(target: string, encoding: string, checkCancelled: () => void, onCommitStart: () => void, io: AtomicFileIO = nativeAtomicFileIO, maxBytes = 10 * 1024 ** 3, reservation?: AtomicFileTargetReservation,protectOwnership=false): Promise<AtomicFile> {
    const writer = new AtomicFile(target, encodingName(encoding), checkCancelled, onCommitStart, io, maxBytes,protectOwnership);
    writer.key = await exportTargetKey(target);
    if(reservation){
      const state=targetReservations.get(reservation);
      if(!state||state.released||state.claimed||state.key!==writer.key||!activeTargets.has(writer.key))throw Error('文件目标预留已失效、已使用或不属于当前路径');
      state.claimed=true;writer.ownsTarget=false;
    }else{
      if (activeTargets.has(writer.key)) throw new Error('目标文件正在由另一个任务写入，请选择其他文件或等待');
      activeTargets.add(writer.key);
    }
    try {
      checkCancelled(); writer.file = await io.open(writer.temporary); writer.created = true;
      // 取得句柄后先绑定原清理能力，再处理迟到取消，不能在prepare前出现无归属清理窗口。
      if(protectOwnership){if(!writer.file.protectOwnership)throw Error(stagedText.identityUnavailable);writer.removeOwned=await writer.file.protectOwnership();}
      checkCancelled();
      return writer;
    } catch (error) {
      try{await writer.dispose();}
      catch(cleanup){throw new AggregateError([error,cleanup],`${error instanceof Error?error.message:'原子文件创建失败'}；原子文件清理未确认`,{cause:error});}
      throw error;
    }
  }

  /** 字节统计只包含真实完成的磁盘写入，提交标志只在 rename 成功后为真。 */
  get bytesWritten(): number { return this.bytes; }
  get fileCommitted(): boolean { return this.committed; }

  /** 每个片段检查编码往返与总预算，并完整消费操作系统的部分写入。 */
  async write(text: string): Promise<void> {
    this.checkCancelled();
    if (!this.file || this.disposed || this.committed) throw new Error('文件写入器已关闭');
    const buffer = iconv.encode(text, this.encoding);
    if (this.encoding === 'utf16le') {
      try { new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true }).decode(buffer); }
      catch { throw new Error('所选编码无法无损表示结果中的字符，请改用 JSON 格式'); }
    }
    if (iconv.decode(buffer, this.encoding, { stripBOM: false }) !== text) throw new Error('所选编码无法无损表示结果中的字符，请改用 UTF-8 或 JSON 格式');
    await this.writeBytes(buffer);
  }

  /** 二进制 XLSX 与文本共用预算及短写保护；复制小缓冲，避免调用者改写尚未落盘的数据。 */
  async writeBytes(input: Uint8Array): Promise<void> {
    this.checkCancelled();
    if (!this.file || this.disposed || this.committed) throw new Error('文件写入器已关闭');
    if (this.bytes + this.pendingBytes + input.length > this.maxBytes) throw new Error('完整导出超过文件字节上限，原目标文件保持不变');
    const buffer = Buffer.from(input);
    // 至多 64 KiB 编码缓冲；百万行任务不需要逐行发起系统调用，大行直接有界写入。
    if (this.pendingBytes + buffer.length > 64 * 1024) await this.flush();
    if (buffer.length >= 64 * 1024) await this.writeBuffer(buffer);
    else { this.pending.push(buffer); this.pendingBytes += buffer.length; }
  }

  /** 完整消费一段已编码字节，短写和每次系统调用都在取消边界内。 */
  private async writeBuffer(buffer: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < buffer.length) {
      this.checkCancelled();
      const { bytesWritten } = await this.file!.write(buffer, offset, buffer.length - offset);
      if (!Number.isInteger(bytesWritten) || bytesWritten < 1 || bytesWritten > buffer.length - offset) throw new Error('目标文件无法继续写入');
      offset += bytesWritten; this.bytes += bytesWritten;
    }
  }

  /** 缓冲有固定上限，提交前必须写完，不能把仅进入缓冲区的数据误认为已保存。 */
  private async flush(): Promise<void> {
    if (!this.pendingBytes) return;
    const buffer = Buffer.concat(this.pending, this.pendingBytes);
    this.pending = []; this.pendingBytes = 0; await this.writeBuffer(buffer);
  }

  /** 暂存同步并关闭句柄后可等待用户确认；保留本任务目标锁，不发布或重读数据。 */
  async prepare(protectIdentity=false): Promise<void> {
    this.checkCancelled();
    if (!this.file || this.disposed || this.committed) throw new Error('文件写入器已关闭');
    await this.flush(); await this.file.sync(); this.checkCancelled();
    if(protectIdentity){if(!this.file.identity||!this.io.identity||!this.io.parentIdentity)throw Error(stagedText.identityUnavailable);this.preparedIdentity=await this.file.identity();this.preparedParentIdentity=await this.io.parentIdentity(this.target);if(await this.io.identity(this.temporary)!==this.preparedIdentity)throw Error(stagedText.identity);}
    await this.file.close(); this.file = undefined; this.checkCancelled();
    this.prepared = true;
  }

  /** 替换之前允许取消；替换开始后只能报告真实提交结果，不能声称撤销文件。 */
  async commit(): Promise<void> {
    if (!this.prepared) await this.prepare();
    this.checkCancelled();
    if (this.disposed || this.committed) throw new Error('文件写入器已关闭');
    if(this.preparedIdentity){if(await exportTargetKey(this.target)!==this.key||await this.io.parentIdentity!(this.target)!==this.preparedParentIdentity||await this.io.identity!(this.temporary)!==this.preparedIdentity)throw Error(stagedText.targetIdentity);this.checkCancelled();}
    this.onCommitStart(); await this.io.rename(this.temporary, this.target); this.committed = true;
  }

  /** 幂等关闭，仅清理自己创建且未提交的临时文件；目标锁直到清理结束才释放。 */
  async dispose(): Promise<void> {
    if (this.disposed){if(this.disposalFailure)throw this.disposalFailure.reason;return;}
    this.disposed = true;
    this.pending = []; this.pendingBytes = 0;
    try{
    let closeFailed=false,closeError:unknown;
    try { await this.file?.close(); }
    catch(error){closeFailed=true;closeError=error;}
    finally {
      this.file = undefined;
      try {
        if(closeFailed)throw closeError;
        if (this.created && !this.committed) {
          if(this.protectOwnership){
            if(!this.removeOwned)throw Error(stagedText.identityUnavailable);
            await this.removeOwned();return;
          }
          // 长等待后若目录项已被替换，只清理仍与原句柄相符的文件，不能删除外来文件。
          if(this.preparedIdentity && this.io.identity){try{if(await this.io.identity(this.temporary)!==this.preparedIdentity)return;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}}
          await this.io.remove(this.temporary);
        }
      }
      finally { if (this.key && this.ownsTarget) activeTargets.delete(this.key); }
    }
    }catch(reason){
      // 未确认的关闭/归属错误也是永久终态，后续abort不能伪报资源已清零。
      this.disposalFailure={reason};throw reason;
    }
  }
}
