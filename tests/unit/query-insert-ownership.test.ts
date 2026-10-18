import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AtomicFile,nativeAtomicFileIO,type AtomicFileIO} from '../../src/engine/atomicFile';
import {createQueryStreamFile,type QueryStreamFileOptions} from '../../src/engine/queryStreamFile';

const folders:string[]=[];
afterEach(async()=>{for(const folder of folders.splice(0))await rm(folder,{recursive:true,force:true});});
/** 每例仅使用本任务创建的目录；原目标、原句柄改名文件和外来目录项分别核对。 */
async function fixture(){
  const folder=await mkdtemp(join(tmpdir(),'dbark-insert-ownership-'));folders.push(folder);
  const filePath=join(folder,'目标.sql');await writeFile(filePath,'原目标');
  let partial='',moved='',cancelled=false,closes=0,previews=0;
  const input:QueryStreamFileOptions={filePath,format:'sql',encoding:'utf8',resultSelection:{kind:'all'},insertTarget:{database:'明确库',table:'明确表',columns:['值']},checkCancelled(){if(cancelled)throw Error('本例取消');},onCommitStart(){},beforeInsertCommit:async()=>{previews++;}};
  const io:AtomicFileIO={...nativeAtomicFileIO,open:async path=>{partial=path;const file=await nativeAtomicFileIO.open(path);return{...file,close:async()=>{closes++;await file.close();}};}};
  return{folder,filePath,input,io,get partial(){return partial;},get closes(){return closes;},get previews(){return previews;},get moved(){return moved;},cancel(){cancelled=true;},
    async swap(){moved=partial+'.原句柄文件';await rename(partial,moved);await writeFile(partial,'外来文件不得删除');},
    async assertRetained(){expect(await readFile(filePath,'utf8')).toBe('原目标');expect(await readFile(partial,'utf8')).toBe('外来文件不得删除');expect(await readFile(moved,'utf8')).toBeDefined();expect(closes).toBeGreaterThan(0);},
  };
}
/** 完整帧仍走正式SQL序列化；不以产品清理函数生成文件归属预期。 */
async function fill(writer:Awaited<ReturnType<typeof createQueryStreamFile>>,value='真实值'){
  await writer.write({kind:'rows-start',resultOrdinal:1,statementOrdinal:1,rowResultOrdinal:1,columns:[{position:1,key:'c0',name:'来源别名',exportName:'来源别名',type:'VAR_STRING'}]});
  await writer.write({kind:'row',resultOrdinal:1,values:[value]});await writer.write({kind:'rows-end',resultOrdinal:1});
}

describe('完整INSERT从open到abort的原目录项归属',()=>{
  it.each(['before-prepare-cancel','prepare-sync-failure'] as const)('原真实文件红例转绿：%s保留外来文件，不追查改名原件',async mode=>{
    const f=await fixture(),io:AtomicFileIO={...f.io,open:async path=>{const file=await f.io.open(path);return mode==='prepare-sync-failure'?{...file,sync:async()=>{await file.sync();await f.swap();throw Error('注入同步失败');}}:file;}};
    const writer=await createQueryStreamFile(f.input,io);await fill(writer);
    if(mode==='before-prepare-cancel'){await f.swap();f.cancel();}
    await expect(writer.complete()).rejects.toThrow(mode==='before-prepare-cancel'?'本例取消':'注入同步失败');
    await expect(writer.abort()).rejects.toThrow('身份');await expect(writer.abort()).rejects.toThrow('身份');await f.assertRetained();expect(f.previews).toBe(0);expect(writer.fileCommitted).toBe(false);
  });
  it('open回包后取消仍关闭原句柄，已确认的本例空partial可清理',async()=>{
    const f=await fixture();await expect(createQueryStreamFile(f.input,{...f.io,open:async path=>{const file=await f.io.open(path);f.cancel();return file;}})).rejects.toThrow('本例取消');
    expect(f.closes).toBe(1);expect(await readdir(f.folder)).toEqual(['目标.sql']);expect(await readFile(f.filePath,'utf8')).toBe('原目标');
  });
  it('open回包前替换目录项不得认领新文件，创建失败仍关闭原句柄',async()=>{
    const f=await fixture();await expect(createQueryStreamFile(f.input,{...f.io,open:async path=>{const file=await f.io.open(path);await f.swap();f.cancel();return file;}})).rejects.toThrow('身份');await f.assertRetained();
  });
  it('旧IO无归属能力时拒绝INSERT并保留未知目录项，关闭句柄但不调用盲删',async()=>{
    const f=await fixture();let removals=0;
    const io:AtomicFileIO={...f.io,remove:async()=>{removals++;},open:async path=>{const file=await f.io.open(path);return{write:file.write,sync:file.sync,close:file.close};}};
    await expect(createQueryStreamFile(f.input,io)).rejects.toThrow('身份校验');expect(f.closes).toBe(1);expect(removals).toBe(0);expect(await readFile(f.partial,'utf8')).toBe('');
  });
  it.each(['before-prepare','write-return'] as const)('%s原inode被外部改写时不能把新修改代次当成本任务写入',async mode=>{
    const f=await fixture(),writer=await createQueryStreamFile(f.input,{...f.io,open:async path=>{const file=await f.io.open(path);return{...file,write:async(buffer,offset,length)=>{const result=await file.write(buffer,offset,length);if(mode==='write-return'){await writeFile(f.partial,'外部改写原inode');throw Error('写回包前失败');}return result;}};}});
    await fill(writer);if(mode==='before-prepare'){await writeFile(f.partial,'外部改写原inode');f.cancel();}
    await expect(writer.complete()).rejects.toThrow();await expect(writer.abort()).rejects.toThrow('身份');
    expect(await readFile(f.partial,'utf8')).toBe('外部改写原inode');expect(await readFile(f.filePath,'utf8')).toBe('原目标');expect(f.previews).toBe(0);expect(f.closes).toBeGreaterThan(0);
  });
  it.each(['cancel','sync','write','close'] as const)('归属明确的%s失败可在原句柄重核后清理本例partial',async mode=>{
    const f=await fixture();let first=true;
    const io:AtomicFileIO={...f.io,open:async path=>{const file=await f.io.open(path);return{...file,
      write:async(buffer,offset,length)=>{if(mode==='write')throw Error('注入写失败');return file.write(buffer,offset,Math.min(length,17));},
      sync:async()=>{if(mode==='sync')throw Error('注入同步失败');await file.sync();},
      close:async()=>{await file.close();if(mode==='close'&&first){first=false;throw Error('注入关闭未知');}},
    };}};
    const writer=await createQueryStreamFile(f.input,io);await fill(writer);if(mode==='cancel')f.cancel();
    await expect(writer.complete()).rejects.toThrow();await writer.abort();
    expect(await readFile(f.filePath,'utf8')).toBe('原目标');expect(await readdir(f.folder)).toEqual(['目标.sql']);
  });
  it('关闭持续失败时保留未确认资源，不能继续remove或宣称清零',async()=>{
    const f=await fixture(),writer=await createQueryStreamFile(f.input,{...f.io,open:async path=>{const file=await f.io.open(path);return{...file,close:async()=>{await file.close();throw Error('关闭回包持续未知');}};}});
    await fill(writer);await expect(writer.complete()).rejects.toThrow('关闭回包持续未知');await expect(writer.abort()).rejects.toThrow('关闭回包持续未知');
    expect(await readFile(f.filePath,'utf8')).toBe('原目标');expect(await readFile(f.partial,'utf8')).toContain('INSERT INTO');expect(writer.fileCommitted).toBe(false);
  });
  it('真实短写更新自有修改代次，正常prepare和发布不被初始时间戳误拒绝',async()=>{
    const f=await fixture();let writes=0;
    const writer=await createQueryStreamFile({...f.input,beforeInsertCommit:async(sample,bytes)=>{expect(await readFile(f.filePath,'utf8')).toBe('原目标');expect((await readFile(f.partial)).length).toBe(bytes);expect(sample.sql).toContain("_utf8mb4 X'e79c9fe5ae9ee580bc'");}},{...f.io,open:async path=>{const file=await f.io.open(path);return{...file,write:async(buffer,offset,length)=>{writes++;return file.write(buffer,offset,Math.min(length,3));}};}});
    await fill(writer);await writer.complete();await writer.abort();expect(writes).toBeGreaterThan(20);expect(writer.fileCommitted).toBe(true);expect(await readdir(f.folder)).toEqual(['目标.sql']);
  });
  it.each(['cancel','replace','rewrite'] as const)('prepare后%s保持发布与清理事实',async mode=>{
    const f=await fixture(),writer=await createQueryStreamFile({...f.input,beforeInsertCommit:async()=>{if(mode==='cancel')f.cancel();else if(mode==='replace')await f.swap();else await writeFile(f.partial,'外来改写');}},f.io);await fill(writer);
    await expect(writer.complete()).rejects.toThrow();
    if(mode==='cancel'){await writer.abort();expect(await readdir(f.folder)).toEqual(['目标.sql']);}
    else{await expect(writer.abort()).rejects.toThrow('身份');expect(await readFile(f.partial,'utf8')).toBe(mode==='replace'?'外来文件不得删除':'外来改写');}
    expect(await readFile(f.filePath,'utf8')).toBe('原目标');expect(writer.fileCommitted).toBe(false);
  });
  it('普通CSV等旧调用不要求新增归属能力，不放宽原输出或提交协议',async()=>{
    const f=await fixture(),file=await AtomicFile.create(f.filePath,'utf8',()=>{},()=>{});await file.write('旧调用正文');await file.commit();await file.dispose();expect(await readFile(f.filePath,'utf8')).toBe('旧调用正文');
  });
});
