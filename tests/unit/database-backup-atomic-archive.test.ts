import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AtomicFile, AtomicFileTargetReservation, type AtomicFileIO } from '../../src/engine/atomicFile';
import { DatabaseBackupAtomicArchive } from '../../src/engine/databaseBackupAtomicArchive';
import { inspectDatabaseBackupArchive, type DatabaseBackupArchiveManifestInput } from '../../src/engine/databaseBackupArchive';

const reservations:AtomicFileTargetReservation[]=[];
// 仅回收本进程RAM夹具的互斥键；未知断言保持原事实，不据此声称真实文件资源已清理。
afterEach(()=>{for(const item of reservations.splice(0))item.release();});
function deferred<T=void>(){let finish!:(value:T)=>void;const promise=new Promise<T>(resolve=>{finish=resolve;});return{promise,resolve:(value?:T)=>finish(value as T)};}
const manifest=():DatabaseBackupArchiveManifestInput=>({format:'dbark-backup-zip-store-v1',schemaVersion:1,family:'mysql',serverVersion:'8.4.11',toolVersion:'8.4.11',toolSuiteSha256:'a'.repeat(64),toolRegistryRevision:'ram-suite',database:'ram_backup',objects:[{kind:'table',name:'subject',definitionSha256:'b'.repeat(64),engine:'InnoDB'}],consistency:{profileId:'ram-lock',acquiredAt:'2026-10-17T10:00:00Z',completedAt:'2026-10-17T10:00:01Z',allObjectsFrozen:true},externalDependencies:[],resourcesConfirmed:true,restoreVerified:false});

/** 数据/句柄/替换均走RAM IO，只有既有父目录归一化复用真实AtomicFile的只读realpath。 */
async function fixture(){
  const target=join(process.cwd(),'ram-backup-'+randomUUID()+'.zip'),owner={taskId:randomUUID(),planToken:randomUUID()};
  const storage=new Map<string,Buffer>([[target,Buffer.from('原目标')]]),counts={open:0,write:0,close:0,remove:0,rename:0,boundary:0};
  const control={cancelled:false,writeGate:undefined as Promise<void>|undefined,renameGate:undefined as Promise<void>|undefined,closeError:undefined as Error|undefined,renameError:undefined as Error|undefined,shortWrite:0};
  const io:AtomicFileIO={
    open:async path=>{counts.open++;storage.set(path,Buffer.alloc(0));let closed=false;return{
      write:async(input,offset,length)=>{counts.write++;await control.writeGate;if(closed)throw Error('RAM句柄已关闭');const count=control.shortWrite?Math.min(control.shortWrite,length):length;storage.set(path,Buffer.concat([storage.get(path)!,Buffer.from(input.subarray(offset,offset+count))]));return{bytesWritten:count};},
      sync:async()=>{},close:async()=>{counts.close++;if(control.closeError)throw control.closeError;closed=true;}
    };},
    rename:async(source,destination)=>{counts.rename++;await control.renameGate;if(control.renameError)throw control.renameError;storage.set(destination,storage.get(source)!);storage.delete(source);},
    remove:async path=>{counts.remove++;storage.delete(path);}
  };
  const reservation=await AtomicFileTargetReservation.reserve(target);reservations.push(reservation);
  const hooks={checkCancelled:()=>{if(control.cancelled)throw Error('RAM取消');},onCommitStart:()=>{counts.boundary++;}};
  const archive=new DatabaseBackupAtomicArchive(owner,target,Promise.resolve(reservation),hooks,io,'ram-artifact');
  return{target,owner,storage,counts,control,io,reservation,hooks,archive};
}

describe('备份归档与原子文件真实适配协议',()=>{
  it('提交入口守卫拒绝时未发rename，仍可明确清理并保留原目标',async()=>{
    const f=await fixture(),reason=Error('提交授权已撤销');await f.archive.open();await f.archive.writeDump(Buffer.from('SELECT 1;'));await f.archive.finish(manifest());
    f.hooks.onCommitStart=()=>{throw reason;};await expect(f.archive.commit()).rejects.toBe(reason);expect(f.counts.rename).toBe(0);
    expect((await f.archive.abort()).state).toBe('confirmed');expect((await f.archive.releaseTarget()).state).toBe('confirmed');expect(f.storage.get(f.target)!.toString()).toBe('原目标');
  });
  it('短写完整消费，只有原子替换后发布，完整性检查保留原始dump字节',async()=>{
    const f=await fixture();f.control.shortWrite=7;
    const dump=Buffer.concat([Buffer.from('DELIMITER $$\r\n18446744073709551615\n'),Buffer.from([0,255,1])]);
    await f.archive.open();await f.archive.writeDump(dump);const result=await f.archive.finish(manifest());
    expect(f.storage.get(f.target)!.toString()).toBe('原目标');expect(f.counts.boundary).toBe(0);
    await f.archive.commit();expect(f.archive.snapshot()).toMatchObject({owner:f.owner,fileCommitted:true,closed:true,artifactToken:'ram-artifact',sha256:result.archive.sha256});
    const bytes=f.storage.get(f.target)!,checked=await inspectDatabaseBackupArchive({size:BigInt(bytes.length),read:async(offset,length)=>bytes.subarray(Number(offset),Number(offset)+length)});
    expect(checked.dump).toEqual({entry:'dump.sql',bytes:String(dump.length),sha256:createHash('sha256').update(dump).digest('hex')});
    expect(f.counts.close).toBe(1);expect(f.counts.remove).toBe(0);
    await expect(AtomicFile.create(f.target,'utf8',()=>{},()=>{},f.io)).rejects.toThrow('正在由另一个任务');
    expect(await f.archive.releaseTarget()).toEqual({owner:f.owner,state:'confirmed'});
    const next=await AtomicFile.create(f.target,'utf8',()=>{},()=>{},f.io);await next.dispose();
  });
  it('提交前取消只删除本临时文件，重复清理不重复close/remove',async()=>{
    const f=await fixture();await f.archive.open();await f.archive.writeDump(Buffer.from('SELECT 1;'));await f.archive.finish(manifest());f.control.cancelled=true;
    await expect(f.archive.commit()).rejects.toThrow('RAM取消');expect(await f.archive.abort()).toEqual({owner:f.owner,state:'confirmed'});
    expect(await f.archive.abort()).toEqual({owner:f.owner,state:'confirmed'});expect(f.counts).toMatchObject({close:1,remove:1,rename:0,boundary:0});expect(f.storage.get(f.target)!.toString()).toBe('原目标');
    expect(await f.archive.releaseTarget()).toEqual({owner:f.owner,state:'confirmed'});
  });
  it('背压未离开时不并发关闭，原写入离开后显式清理才确认',async()=>{
    const f=await fixture(),gate=deferred();await f.archive.open();f.control.writeGate=gate.promise;
    const writing=f.archive.writeDump(Buffer.alloc(65536,7));void writing.catch(()=>{});await vi.waitFor(()=>expect(f.counts.write).toBeGreaterThan(0));
    f.control.cancelled=true;expect(await f.archive.abort()).toEqual({owner:f.owner,state:'unknown'});expect(f.counts.close).toBe(0);expect(f.counts.remove).toBe(0);
    gate.resolve();await expect(writing).rejects.toThrow('RAM取消');expect(await f.archive.abort()).toEqual({owner:f.owner,state:'confirmed'});expect(f.archive.snapshot().closed).toBe(true);
  });
  it('close拒绝不因dispose已返回或重试而确认，也不释放给普通导出',async()=>{
    const f=await fixture(),failure=Error('原close未知');await f.archive.open();await f.archive.writeDump(Buffer.from('SELECT 1;'));await f.archive.finish(manifest());f.control.closeError=failure;
    await expect(f.archive.commit()).rejects.toBe(failure);await expect(f.archive.abort()).rejects.toBe(failure);await expect(f.archive.abort()).rejects.toBe(failure);
    expect(f.archive.snapshot()).toMatchObject({closed:false,fileCommitted:false});expect(await f.archive.releaseTarget()).toEqual({owner:f.owner,state:'unknown'});expect(f.counts.close).toBe(1);
    await expect(AtomicFile.create(f.target,'utf8',()=>{},()=>{},f.io)).rejects.toThrow('正在由另一个任务');
  });
  it('rename未终结时取消不删除，晚到成功如实发布且不把成功文件撤销',async()=>{
    const f=await fixture(),gate=deferred();await f.archive.open();await f.archive.writeDump(Buffer.from('SELECT 1;'));await f.archive.finish(manifest());f.control.renameGate=gate.promise;
    const commit=f.archive.commit();void commit.catch(()=>{});await vi.waitFor(()=>expect(f.counts.rename).toBe(1));f.control.cancelled=true;
    expect(await f.archive.abort()).toEqual({owner:f.owner,state:'unknown'});expect(await f.archive.releaseTarget()).toEqual({owner:f.owner,state:'unknown'});expect(f.counts.remove).toBe(0);
    gate.resolve();await commit;expect(f.archive.snapshot()).toMatchObject({fileCommitted:true,closed:true});expect(await f.archive.abort()).toEqual({owner:f.owner,state:'confirmed'});expect(f.counts.remove).toBe(0);
    expect(await f.archive.releaseTarget()).toEqual({owner:f.owner,state:'confirmed'});
  });
  it('rename拒绝仍保留未知临时归档和目标预留，不能回退abort',async()=>{
    const f=await fixture(),failure=Error('原rename结果未知');await f.archive.open();await f.archive.writeDump(Buffer.from('SELECT 1;'));await f.archive.finish(manifest());f.control.renameError=failure;
    await expect(f.archive.commit()).rejects.toBe(failure);expect(await f.archive.abort()).toEqual({owner:f.owner,state:'unknown'});expect(await f.archive.releaseTarget()).toEqual({owner:f.owner,state:'unknown'});
    expect(f.counts.remove).toBe(0);expect(f.storage.size).toBe(2);expect(f.archive.snapshot().closed).toBe(false);
    await expect(AtomicFile.create(f.target,'utf8',()=>{},()=>{},f.io)).rejects.toThrow('正在由另一个任务');
  });
  it('迟到的已登记目标预留只归原owner，显式再次取清理回执不产生新IO',async()=>{
    const f=await fixture(),gate=deferred<AtomicFileTargetReservation>();
    const archive=new DatabaseBackupAtomicArchive(f.owner,f.target,gate.promise,f.hooks,f.io);
    expect(await archive.abort()).toEqual({owner:f.owner,state:'unknown'});gate.resolve(f.reservation);await Promise.resolve();
    expect(await archive.abort()).toEqual({owner:f.owner,state:'confirmed'});expect(await archive.releaseTarget()).toEqual({owner:f.owner,state:'confirmed'});expect(f.counts.open).toBe(0);
  });
  it('owner改变后恢复原值也不复活旧资源能力',async()=>{
    const f=await fixture(),original=f.owner.taskId;f.owner.taskId=randomUUID();expect(()=>f.archive.snapshot()).toThrow('owner已变化');f.owner.taskId=original;
    expect(()=>f.archive.snapshot()).toThrow('owner已变化');expect(()=>f.archive.abort()).toThrow('owner已变化');expect(f.counts.open).toBe(0);
  });
  it('目标预留不能认领另一条路径、重复writer或已归还的锁',async()=>{
    const f=await fixture();await expect(AtomicFile.create(f.target+'.other','utf8',()=>{},()=>{},f.io,1000,f.reservation)).rejects.toThrow('不属于当前路径');expect(f.counts.open).toBe(0);
    const writer=await AtomicFile.create(f.target,'utf8',()=>{},()=>{},f.io,1000,f.reservation);
    await expect(AtomicFile.create(f.target,'utf8',()=>{},()=>{},f.io,1000,f.reservation)).rejects.toThrow('已使用');await writer.dispose();f.reservation.release();
    await expect(AtomicFile.create(f.target,'utf8',()=>{},()=>{},f.io,1000,f.reservation)).rejects.toThrow('已失效');
  });
});
