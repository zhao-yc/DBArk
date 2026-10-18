import{afterEach,describe,expect,it}from'vitest';
import{mkdtemp,readFile,readdir,rm,writeFile}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import iconv from'iconv-lite';
import{createQueryStreamFile,type QueryStreamFileOptions}from'../../src/engine/queryStreamFile';
import{nativeAtomicFileIO,type AtomicFileIO}from'../../src/engine/atomicFile';
import type{QueryInsertSample}from'../../src/shared/queryInsertExport';
const folders:string[]=[];
afterEach(async()=>{await Promise.all(folders.splice(0).map(folder=>rm(folder,{recursive:true,force:true})));});
/** 所有IO只使用测试自身目录；真实写入/同步/关闭/替换，不连接数据库。 */
async function options(extra:Partial<QueryStreamFileOptions>={}){const folder=await mkdtemp(join(tmpdir(),'dbark-insert-atomic-'));folders.push(folder);const filePath=join(folder,'结果.sql');await writeFile(filePath,'原文件');return{filePath,format:'sql' as const,encoding:'utf8' as const,resultSelection:{kind:'all' as const},insertTarget:{database:'库',table:'表',columns:['值']},checkCancelled(){},onCommitStart(){},beforeInsertCommit:async()=>{},...extra};}
/** 使用正式元数据与位置值，空字符串和NULL不借测试转换器改写。 */
async function data(writer:Awaited<ReturnType<typeof createQueryStreamFile>>){await writer.write({kind:'rows-start',resultOrdinal:1,statementOrdinal:1,rowResultOrdinal:1,columns:[{position:1,key:'c0',name:'别名',exportName:'别名',type:'VAR_STRING'}]});for(const value of['',null,'中文😊\0\\'])await writer.write({kind:'row',resultOrdinal:1,values:[value]});await writer.write({kind:'rows-end',resultOrdinal:1});}
describe('完整INSERT原子暂存与编码边界',()=>{
  it.each(['utf8','utf16le','gb18030'] as const)('%s样例与同一实际暂存内容一致，字节来自已同步文件',async encoding=>{
    let sample!:QueryInsertSample,bytes=0;const input=await options({encoding,beforeInsertCommit:async(value,size)=>{sample=value;bytes=size;expect(await readFile(input.filePath,'utf8')).toBe('原文件');const partial=(await readdir(folders.at(-1)!)).find(name=>name.endsWith('.partial'))!;const buffer=await readFile(join(folders.at(-1)!,partial));expect(buffer.length).toBe(size);expect(iconv.decode(buffer,encoding)).toBe(value.sql);}}),writer=await createQueryStreamFile(input);
    try{await data(writer);await writer.complete();expect(writer.fileCommitted).toBe(true);expect(writer.rowsWritten).toBe(3);expect(sample.shownRows).toBe(3);expect((await readFile(input.filePath)).length).toBe(bytes);expect(iconv.decode(await readFile(input.filePath),encoding)).toBe(sample.sql);}finally{await writer.abort();}expect(await readdir(folders.at(-1)!)).toEqual(['结果.sql']);
  });
  it('暂存支持短写，确认后原子替换失败不改变旧目标；不丢弃临时文件清理',async()=>{
    const input=await options();let calls=0;
    const io:AtomicFileIO={...nativeAtomicFileIO,open:async path=>{const file=await nativeAtomicFileIO.open(path);return{...file,write:(buffer,offset,length)=>{calls++;return file.write(buffer,offset,Math.min(3,length));}};},rename:async()=>{throw Error('发布替换失败');}};
    const writer=await createQueryStreamFile(input,io);try{await data(writer);await expect(writer.complete()).rejects.toThrow('发布替换失败');expect(calls).toBeGreaterThan(10);expect(writer.fileCommitted).toBe(false);}finally{await writer.abort();}expect(await readFile(input.filePath,'utf8')).toBe('原文件');expect(await readdir(folders.at(-1)!)).toEqual(['结果.sql']);
  });
  it('暂存同步磁盘失败不能发布预览；确认回调失败同样保留旧目标',async()=>{
    let previews=0;const input=await options({beforeInsertCommit:async()=>{previews++;}}),writer=await createQueryStreamFile(input,{...nativeAtomicFileIO,open:async path=>{const file=await nativeAtomicFileIO.open(path);return{...file,sync:async()=>{throw Error('暂存同步失败');}};}});
    try{await data(writer);await expect(writer.complete()).rejects.toThrow('暂存同步失败');expect(previews).toBe(0);}finally{await writer.abort();}expect(await readFile(input.filePath,'utf8')).toBe('原文件');
    const second=await options({beforeInsertCommit:async()=>{throw Error('确认已过期');}}),rejected=await createQueryStreamFile(second);try{await data(rejected);await expect(rejected.complete()).rejects.toThrow('确认已过期');}finally{await rejected.abort();}expect(await readFile(second.filePath,'utf8')).toBe('原文件');expect(await readdir(folders.at(-1)!)).toEqual(['结果.sql']);
  });
  it('确认回包后的取消仍在替换前生效，进入替换后晚取消报告真实发布',async()=>{
    let cancelled=false,committing=false;const input=await options({checkCancelled(){if(cancelled&&!committing)throw Error('已取消');},beforeInsertCommit:async()=>{cancelled=true;},onCommitStart(){committing=true;}}),writer=await createQueryStreamFile(input);
    try{await data(writer);await expect(writer.complete()).rejects.toThrow('已取消');}finally{await writer.abort();}expect(await readFile(input.filePath,'utf8')).toBe('原文件');
    cancelled=false;let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>release=resolve);const second=await options({checkCancelled(){if(cancelled&&!committing)throw Error('已取消');},onCommitStart(){committing=true;}}),late=await createQueryStreamFile(second,{...nativeAtomicFileIO,rename:async(from,to)=>{enter();await gate;await nativeAtomicFileIO.rename(from,to);}});
    try{await data(late);const completing=late.complete();await entered;cancelled=true;release();await completing;expect(late.fileCommitted).toBe(true);}finally{await late.abort();}
  });
});
