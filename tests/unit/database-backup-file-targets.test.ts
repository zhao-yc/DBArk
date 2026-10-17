import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AtomicFile, AtomicFileTargetReservation, type AtomicFileIO } from '../../src/engine/atomicFile';
import { DatabaseBackupFileTargets, type AuthorizedBackupFile } from '../../src/engine/databaseBackupFileTargets';
import { DatabaseBackupExecutor, type DatabaseBackupExecutionOwner, type DatabaseBackupExecutionPorts, type DatabaseBackupExecutionScope } from '../../src/engine/databaseBackupExecution';
import { inspectDatabaseBackupArchive } from '../../src/engine/databaseBackupArchive';
import { databaseBackupFixture } from './databaseBackupFixtures';

/** 真实计划器、执行器、目标协调器、ZIP与AtomicFile组合；仅数据库/进程及数据IO为RAM。 */
async function fixture(stageMs=1000){
  const f=databaseBackupFixture(),inspection=await f.planner.inspect(f.input),plan=await f.planner.prepare({inspectionToken:inspection.inspectionToken,fileToken:'output',acknowledgeGlobalWriteBlock:true,taskId:'prepare'}),binding=f.planner.bindings(plan.planToken);
  const path=join(process.cwd(),'ram-backup-flow-'+randomUUID()+'.zip'),storage=new Map([[path,Buffer.from('原目标')]]);
  const authority:AuthorizedBackupFile={purpose:'database-backup',fileToken:'output',outputLease:binding.output.outputLease,revision:binding.output.revision,filePath:path,artifactToken:'published-ram-artifact'};
  const counts={open:0};
  const io:AtomicFileIO={open:async file=>{counts.open++;storage.set(file,Buffer.alloc(0));return{write:async(bytes,offset,length)=>{storage.set(file,Buffer.concat([storage.get(file)!,Buffer.from(bytes.subarray(offset,offset+length))]));return{bytesWritten:length};},sync:async()=>{},close:async()=>{}};},rename:async(from,to)=>{storage.set(to,storage.get(from)!);storage.delete(from);},remove:async file=>{storage.delete(file);}};
  const targets=new DatabaseBackupFileTargets(()=>({...authority}),io),state={unknownTools:false};
  let owner!:DatabaseBackupExecutionOwner,dumpClosed=false,lockReleased=false,toolsClosed=false;
  const scope=():DatabaseBackupExecutionScope=>({
    owner,
    confirmLeases:async()=>({owner,sourceLease:binding.source.sourceLease,connectionRevision:binding.source.connectionRevision,toolLease:binding.tool.toolLease,registryRevision:binding.tool.registryRevision,suiteSha256:binding.tool.observedSuiteSha256,outputLease:binding.output.outputLease,outputRevision:binding.output.revision}),
    acquireLock:async()=>({owner,lockId:'ram-lock',profileId:binding.plan.lock.profileId,sourceLease:binding.source.sourceLease,acquiredAt:new Date(f.ports.now()).toISOString(),actualHeld:true,allObjectsFrozen:true}),
    inspectLocked:async()=>({owner,source:structuredClone(binding.source),tool:structuredClone(binding.tool)}),
    startDump:async()=>({owner,stdout:(async function*(){yield Buffer.from('仅RAM原始SQL\0\n');})(),exit:Promise.resolve({owner,code:0,signal:null})}),
    confirmContinuity:async lock=>({owner,lockId:lock.lockId,uninterrupted:true}),requestCancel:async()=>{},
    closeDump:async()=>{dumpClosed=true;return{owner,state:'confirmed'};},unlock:async()=>{lockReleased=true;return{owner,state:'confirmed'};},closeTools:async()=>{toolsClosed=true;return{owner,state:state.unknownTools?'unknown':'confirmed'};},
    snapshot:()=>({owner,dumpClosed,lockReleased,toolsClosed})
  });
  const ports:DatabaseBackupExecutionPorts={now:f.ports.now,bindings:async()=>binding,reserve:(who,context)=>targets.reserve(who,context),createScope:who=>{owner=who;return scope();},allocateArchive:(who,context,target,hooks)=>targets.allocateArchive(who,context,target,hooks)};
  const executor=new DatabaseBackupExecutor(ports,{stageMs,cleanupMs:500});
  return{...f,plan,binding,path,storage,authority,io,targets,state,ports,executor,counts};
}

describe('备份私有文件授权与执行器组合',()=>{
  it('原子归档等待超时后迟到目标不再分配文件，仍能显式释放原预留',async()=>{
    const f=await fixture(100),reserve=AtomicFileTargetReservation.reserve;let release!:()=>void;
    const delivery=new Promise<void>(resolve=>{release=resolve;});
    const spy=vi.spyOn(AtomicFileTargetReservation,'reserve').mockImplementation(async target=>{const owned=await reserve(target);await delivery;return owned;});
    try{
      const result=await f.executor.run({planToken:f.plan.planToken,taskId:'late-target'});expect(result.state).toBe('retained-unknown');
      expect(f.executor.retained('late-target')?.failures[0].phase).toContain('归档');release();
      await vi.waitFor(()=>expect(f.executor.retained('late-target')?.pending).toBe(0));
      const allocatedAfterEnd=f.counts.open;expect((await f.executor.recover('late-target')).resources).toBe('confirmed');
      expect(allocatedAfterEnd).toBe(0);expect(f.storage.get(f.path)!.toString()).toBe('原目标');
    }finally{release();spy.mockRestore();}
  });
  it('未授予备份写入目的、产物令牌或可写权限时不占用目标',async()=>{
    for(const kind of ['purpose','artifact','writable']as const){
      const f=await fixture(),owner=Object.freeze({taskId:kind,planToken:f.plan.planToken});
      if(kind==='purpose')Object.assign(f.authority,{purpose:'other'});else if(kind==='artifact')f.authority.artifactToken='';else f.binding.output.writable=false;
      expect(()=>f.targets.reserve(owner,f.binding)).toThrow('授权或修订');Object.assign(f.authority,{purpose:'database-backup',artifactToken:'published-ram-artifact'});f.binding.output.writable=true;
      const target=f.targets.reserve(owner,f.binding),archive=f.targets.allocateArchive(owner,f.binding,target,{checkCancelled:()=>{},onCommitStart:()=>{}});
      await archive.open();expect((await archive.abort()).state).toBe('confirmed');expect((await target.release()).state).toBe('confirmed');
    }
  });
  it('真实执行状态机接纳完整ZIP后发布，释放与普通导出共享的同一目标',async()=>{
    const f=await fixture(),result=await f.executor.run({planToken:f.plan.planToken,taskId:'run'});
    expect(result).toMatchObject({state:'completed',fileCommitted:true,resources:'confirmed',artifactToken:f.authority.artifactToken,restoreVerified:false});
    const bytes=f.storage.get(f.path)!,checked=await inspectDatabaseBackupArchive({size:BigInt(bytes.length),read:async(offset,length)=>bytes.subarray(Number(offset),Number(offset)+length)});
    expect(checked.dump.bytes).toBe(String(Buffer.byteLength('仅RAM原始SQL\0\n')));expect(f.storage.size).toBe(1);
    const next=await AtomicFile.create(f.path,'utf8',()=>{},()=>{},f.io);await next.dispose();
  });
  it('显式工具关闭未知即使快照全真，也保持目标占用直到明确恢复',async()=>{
    const f=await fixture();f.state.unknownTools=true;
    const result=await f.executor.run({planToken:f.plan.planToken,taskId:'unknown'});expect(result).toMatchObject({state:'retained-unknown',resources:'unknown',fileCommitted:false});expect(f.storage.get(f.path)!.toString()).toBe('原目标');
    await expect(AtomicFile.create(f.path,'utf8',()=>{},()=>{},f.io)).rejects.toThrow('正在由另一个任务');
    f.state.unknownTools=false;const recovered=await f.executor.recover('unknown');expect(recovered.resources).toBe('confirmed');expect(recovered.fileCommitted).toBe(false);
    const next=await AtomicFile.create(f.path,'utf8',()=>{},()=>{},f.io);await next.dispose();
  });
  it('授权撤销后恢复原修订也不重开写入，清理仍可结束原资源',async()=>{
    const f=await fixture(),owner=Object.freeze({taskId:'stale',planToken:f.plan.planToken}),target=f.targets.reserve(owner,f.binding),archive=f.targets.allocateArchive(owner,f.binding,target,{checkCancelled:()=>{},onCommitStart:()=>{}});
    await archive.open();const original=f.authority.revision;f.authority.revision='changed';await expect(archive.writeDump(Buffer.from('a'))).rejects.toThrow('授权或修订');f.authority.revision=original;
    await expect(archive.writeDump(Buffer.from('a'))).rejects.toThrow();expect(await archive.abort()).toEqual({owner,state:'confirmed'});expect(await target.release()).toEqual({owner,state:'confirmed'});expect(f.storage.get(f.path)!.toString()).toBe('原目标');
  });
  it('预算包含ZIP头和清单，未提交前失败保留原文件并释放已确认资源',async()=>{
    const f=await fixture();f.binding.plan.maxBytes=160;
    const result=await f.executor.run({planToken:f.plan.planToken,taskId:'budget'});expect(result).toMatchObject({state:'failed',fileCommitted:false,resources:'confirmed'});expect(f.storage.get(f.path)!.toString()).toBe('原目标');expect(f.storage.size).toBe(1);
  });
  it('旧目标回执幂等归还不解除后来同任务号的新预留，也拒绝替换handle',async()=>{
    const f=await fixture(),owner=Object.freeze({taskId:'reused',planToken:f.plan.planToken}),first=f.targets.reserve(owner,f.binding),a=f.targets.allocateArchive(owner,f.binding,first,{checkCancelled:()=>{},onCommitStart:()=>{}});
    await a.open();await a.abort();expect((await first.release()).state).toBe('confirmed');
    const nextOwner=Object.freeze({...owner}),next=f.targets.reserve(nextOwner,f.binding),b=f.targets.allocateArchive(nextOwner,f.binding,next,{checkCancelled:()=>{},onCommitStart:()=>{}});
    await b.open();expect((await first.release()).state).toBe('confirmed');await expect(AtomicFile.create(f.path,'utf8',()=>{},()=>{},f.io)).rejects.toThrow('正在由另一个任务');
    expect(()=>f.targets.allocateArchive(nextOwner,f.binding,{owner:nextOwner,release:vi.fn()}, {checkCancelled:()=>{},onCommitStart:()=>{}})).toThrow('换绑');
    expect((await b.abort()).state).toBe('confirmed');expect((await next.release()).state).toBe('confirmed');
  });
});
