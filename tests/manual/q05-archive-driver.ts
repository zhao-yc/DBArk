import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {crc32} from 'node:zlib';
import {createQueryStreamFile} from '../../src/engine/queryStreamFile';
import {queryStreamExportLimits,type QueryExportFrame} from '../../src/shared/queryStreamExport';

const rowBytes=256*1024,header='entry,row,payload\r\n',zip32=2**32;
export interface EntryEvidence{name:string;rows:number;bytes:number;sha256:string;crc32:string;resultOrdinal:number;rowResultOrdinal:number;}
export interface ArchiveProgress{rows:number;bytesWritten:number;rss:number;heapUsed:number;}
export interface ScenarioPlan{large:boolean;rowBytes:number;rowCounts:number[];csvBytes:number[];archiveUpperBound:number;fileLimit:number;}

/** 大模式第一条目真实超过4GiB，随后两个条目的本地头偏移也必须跨界；不允许任意规模输入。 */
export function scenarioPlan(large:boolean):ScenarioPlan{
  const rowCounts=[large?Math.floor(zip32/rowBytes)+1:32,8,0];
  const csvBytes=rowCounts.map(rows=>Buffer.byteLength(header)+rows*rowBytes);
  const archiveUpperBound=csvBytes.reduce((sum,size)=>sum+size,0)+queryStreamExportLimits.archiveManifestBytes+64*1024;
  assert(archiveUpperBound<queryStreamExportLimits.fileBytes,'验收预算必须小于产品10GiB总上限');
  return{large,rowBytes,rowCounts,csvBytes,archiveUpperBound,fileLimit:queryStreamExportLimits.fileBytes};
}

/** 固定ASCII样本无需复制产品CSV转义算法；每行带唯一序号，只持有当前行及固定载荷。 */
async function* frames(plan:ScenarioPlan,entries:EntryEvidence[]):AsyncGenerator<QueryExportFrame>{
  for(let index=0;index<plan.rowCounts.length;index++){
    const rowResultOrdinal=index+1,resultOrdinal=index===0?1:index+2;
    const hash=createHash('sha256');let crc=0,bytes=0;
    const consume=(text:string)=>{const chunk=Buffer.from(text);hash.update(chunk);crc=crc32(chunk,crc);bytes+=chunk.length;};
    consume(header);
    const columns=['entry','row','payload'].map((name,column)=>({position:column+1,key:'c'+column,name,exportName:name,type:'VAR_STRING'}));
    yield{kind:'rows-start',resultOrdinal,statementOrdinal:resultOrdinal,rowResultOrdinal,columns};
    const padding='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const payload=padding.repeat(Math.ceil((rowBytes-13)/padding.length)).slice(0,rowBytes-13);
    for(let row=0;row<plan.rowCounts[index];row++){
      const ordinal=String(row).padStart(8,'0'),line=`${rowResultOrdinal},${ordinal},${payload}\r\n`;
      assert.equal(Buffer.byteLength(line),rowBytes);consume(line);
      yield{kind:'row',resultOrdinal,values:[String(rowResultOrdinal),ordinal,payload]};
      if(row%16===15)await setImmediate();
    }
    yield{kind:'rows-end',resultOrdinal,warningCount:0};
    entries.push({name:`results/rows-${String(rowResultOrdinal).padStart(3,'0')}.csv`,rows:plan.rowCounts[index],bytes,sha256:hash.digest('hex'),crc32:crc.toString(16).padStart(8,'0'),resultOrdinal,rowResultOrdinal});
    if(index===0)yield{kind:'status',resultOrdinal:2,statementOrdinal:2,affectedRows:0,insertId:'0',warningCount:1};
  }
}

/** 在自有目录故意取消一次真实写入，核对原有目标逐字节未变且partial释放。 */
async function cancelledTargetProbe(root:string):Promise<{bytes:number;sha256:string;preserved:true;bytesWrittenBeforeAbort:number}>{
  const path=join(root,'protected-old-target.zip'),original=Buffer.from('DBArk Q05 public old target\r\n');
  await writeFile(path,original,{flag:'wx'});let cancelled=false;
  const writer=await createQueryStreamFile({filePath:path,format:'csv-zip',encoding:'utf8',resultSelection:{kind:'all'},checkCancelled(){if(cancelled)throw Error('验收主动取消');},onCommitStart(){throw Error('取消样本不允许进入替换');}});
  try{
    await writer.write({kind:'rows-start',resultOrdinal:1,statementOrdinal:1,rowResultOrdinal:1,columns:[{position:1,key:'v',name:'v',exportName:'v',type:'VAR_STRING'}]});
    await writer.write({kind:'row',resultOrdinal:1,values:['取消前真实落盘'.repeat(10000)]});
    await writer.write({kind:'rows-end',resultOrdinal:1});
    assert(writer.bytesWritten>64*1024,'取消样本必须先完成真实磁盘写入');
    cancelled=true;await assert.rejects(writer.complete(),/验收主动取消/);
  }finally{await writer.abort();}
  assert.deepEqual(await readFile(path),original,'失败取消必须保留原目标');
  assert(!(await readdir(root)).some(name=>name.startsWith('protected-old-target.zip.dbark-')),'取消后不能遗留该目标partial');
  return{bytes:original.length,sha256:createHash('sha256').update(original).digest('hex'),preserved:true,bytesWrittenBeforeAbort:writer.bytesWritten};
}

/** 直接调用产品写入器，不注入AtomicFileIO/CRC；消费者逐帧等待，让真实磁盘背压限制数据持有量。 */
export async function writeScenario(root:string,large:boolean,onProgress:(value:ArchiveProgress)=>Promise<void>,checkCancelled:()=>void){
  const plan=scenarioPlan(large),protection=await cancelledTargetProbe(root),entries:EntryEvidence[]=[];
  const target=join(root,'archive.zip');let committing=0,rows=0,peakRss=0,peakHeap=0,nextReport=0;
  const writer=await createQueryStreamFile({filePath:target,format:'csv-zip',encoding:'utf8',resultSelection:{kind:'all'},checkCancelled,onCommitStart(){committing++;}});
  try{
    for await(const frame of frames(plan,entries)){
      await writer.write(frame);if(frame.kind==='row')rows++;
      const memory=process.memoryUsage();peakRss=Math.max(peakRss,memory.rss);peakHeap=Math.max(peakHeap,memory.heapUsed);
      if(writer.bytesWritten>=nextReport){nextReport=writer.bytesWritten+256*1024**2;await onProgress({rows,bytesWritten:writer.bytesWritten,rss:memory.rss,heapUsed:memory.heapUsed});}
    }
    await writer.complete();assert(writer.fileCommitted);assert.equal(committing,1);assert.equal(writer.rowsWritten,rows);
    const status=await lstat(target);assert(status.isFile()&&!status.isSymbolicLink());assert.equal(status.size,writer.bytesWritten);assert(status.size<=plan.fileLimit);
    return{plan,target,entries,protection,rows,archiveBytes:status.size,peakRss,peakHeap,commits:committing};
  }catch(error){
    // 先记录失败时已完成的真实字节；abort按产品语义删除partial，不能让诊断写入覆盖原异常。
    try{await writeFile(join(root,'writer-failure.json'),JSON.stringify({bytesWritten:writer.bytesWritten,rowsWritten:writer.rowsWritten,fileCommitted:writer.fileCommitted,files:await readdir(root)},null,2));}catch{/* 诊断失败不能改变本次写入失败的原因。 */}
    throw error;
  }finally{await writer.abort();}
}
