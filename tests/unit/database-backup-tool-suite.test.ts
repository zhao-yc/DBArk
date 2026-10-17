import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseBackupSuiteSha256, databaseBackupToolChoices, verifyDatabaseBackupToolSuite, verifyRegisteredDatabaseBackupTool, type DatabaseBackupSuiteIO, type DatabaseBackupToolSuite } from '../../src/engine/databaseBackupToolSuite';

/** 全部文件与句柄都驻留RAM，不加载或运行任何数据库原生程序。 */
function fixture(){
  const root=resolve('ram-backup-suite'),hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
  const contents=new Map([['bin/mysql.exe',Buffer.from('合成恢复工具')],['bin/mysqldump.exe',Buffer.from('合成备份工具')],['bin/libssl.dll',Buffer.from('合成动态库')]]);
  const paths=new Map([...contents].map(([path,bytes])=>[join(root,...path.split('/')),bytes]));
  let closed=0,opened=0,reads=0;
  const state={cancelled:false,shortReads:true,closeError:undefined as Error|undefined,readError:undefined as Error|undefined,changed:false,extra:false,linked:false};
  const metadata=(path:string)=>{const bytes=paths.get(path),directory=path===root||path===join(root,'bin');return{bytes:BigInt(bytes?.length??0),identity:path+':'+(bytes?hash(bytes):'directory')+(state.changed&&bytes?':changed':''),file:!!bytes,directory,link:state.linked&&path===join(root,'bin','libssl.dll')};};
  const io:DatabaseBackupSuiteIO={
    realpath:async path=>path,stat:async path=>metadata(path),names:async path=>path===root?['bin']:['mysql.exe','mysqldump.exe','libssl.dll',...(state.extra?['unapproved.dll']:[])],
    open:async path=>{opened++;const bytes=paths.get(path)!;return{
      stat:async()=>metadata(path),close:async()=>{closed++;if(state.closeError)throw state.closeError;},
      read:async(buffer,length,position)=>{reads++;if(state.readError)throw state.readError;const count=Math.min(length,state.shortReads?2:length,Math.max(0,bytes.length-position));bytes.copy(buffer,0,position,position+count);return count;}
    };}
  };
  const base={id:'mysql-8.4.11-win32-x64',family:'mysql',version:'8.4.11',platform:'win32',arch:'x64',dumpExecutable:'bin/mysqldump.exe',restoreExecutable:'bin/mysql.exe',files:[...contents].map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)}))} as const;
  const manifest:DatabaseBackupToolSuite={...base,suiteSha256:databaseBackupSuiteSha256(base)};
  const options={platform:'win32',arch:'x64',io,checkCancelled:()=>{if(state.cancelled)throw Error('合成取消');}};
  return {root,manifest,options,io,state,paths,counts:()=>({opened,closed,reads})};
}

describe('备份原生工具完整套件核验',()=>{
  it('原始根入口是链接时在解析前拒绝，核验期间入口换绑也不能沿用原套件',async()=>{
    const linked=fixture(),stat=linked.io.stat;
    linked.io.stat=async path=>({...await stat(path),link:path===linked.root});
    linked.io.realpath=async()=>{throw Error('原始入口链接不应进入解析');};
    await expect(verifyDatabaseBackupToolSuite(linked.root,linked.manifest,linked.options)).rejects.toThrow('原始根入口不允许链接');expect(linked.counts().opened).toBe(0);
    const rebound=fixture(),original=rebound.io.realpath;let resolutions=0;
    rebound.io.realpath=async path=>{if(path===rebound.root&&++resolutions===2)return path+'-rebound';return original(path);};
    await expect(verifyDatabaseBackupToolSuite(rebound.root,rebound.manifest,rebound.options)).rejects.toThrow('根入口已换绑');expect(rebound.counts().closed).toBe(rebound.counts().opened);
  });
  it('注册目录只列已核平台，未知ID不读IO，不能以自造同名工具清单替换官方摘要',async()=>{
    const f=fixture();expect(databaseBackupToolChoices('darwin','arm64')).toEqual([]);
    expect(databaseBackupToolChoices('win32','x64')).toEqual([{id:'mysql-8.4.11-win32-x64',family:'mysql',version:'8.4.11',label:'MySQL 8.4.11（x64）'}]);
    expect(await verifyRegisteredDatabaseBackupTool(f.root,'unregistered',f.options)).toBeNull();expect(f.counts().opened).toBe(0);
    await expect(verifyRegisteredDatabaseBackupTool(f.root,f.manifest.id,f.options)).rejects.toThrow('长度变化');expect(f.counts().opened).toBe(0);
  });
  it('清单顺序无关，准确家族和平台参与摘要，短读完整消费并逐句柄关闭',async()=>{
    const f=fixture(),before=structuredClone(f.manifest);
    expect(databaseBackupSuiteSha256({...f.manifest,files:[...f.manifest.files].reverse()})).toBe(f.manifest.suiteSha256);
    const result=await verifyDatabaseBackupToolSuite(f.root,f.manifest,f.options);
    expect(result).toMatchObject({id:f.manifest.id,suiteSha256:f.manifest.suiteSha256,verifiedFiles:3,dumpPath:join(f.root,'bin','mysqldump.exe')});
    expect(f.counts().opened).toBe(3);expect(f.counts().closed).toBe(3);expect(f.counts().reads).toBeGreaterThan(6);expect(f.manifest).toEqual(before);
    expect(databaseBackupSuiteSha256({...f.manifest,version:'8.4.12'})).not.toBe(f.manifest.suiteSha256);
  });
  it('清单摘要、平台或架构不符时，在任何IO之前拒绝',async()=>{
    for(const change of [{suiteSha256:'0'.repeat(64)},{}]){
      const f=fixture();f.io.realpath=async()=>{throw Error('不应读取路径');};
      await expect(verifyDatabaseBackupToolSuite(f.root,{...f.manifest,...change},{...f.options,arch:'arm64'})).rejects.toThrow('不匹配');expect(f.counts().opened).toBe(0);
    }
  });
  it.each(['../escape.dll','bin/../escape.dll','bin\\escape.dll','bin/CON:stream','bin/.'])('越界或特殊路径%s在IO前拒绝',path=>{
    const f=fixture();expect(()=>databaseBackupSuiteSha256({...f.manifest,files:[...f.manifest.files,{path,bytes:1,sha256:'1'.repeat(64)}]})).toThrow('清单无效');
  });
  it('清单外动态库、目录链接、遗漏文件和同长内容变化均不能通过',async()=>{
    const extra=fixture();extra.state.extra=true;await expect(verifyDatabaseBackupToolSuite(extra.root,extra.manifest,extra.options)).rejects.toThrow('文件缺失');
    const linked=fixture();linked.state.linked=true;await expect(verifyDatabaseBackupToolSuite(linked.root,linked.manifest,linked.options)).rejects.toThrow('不允许链接');
    const missing=fixture();missing.io.names=async path=>path===missing.root?['bin']:['mysql.exe','mysqldump.exe'];await expect(verifyDatabaseBackupToolSuite(missing.root,missing.manifest,missing.options)).rejects.toThrow('不完整');
    const corrupt=fixture();corrupt.paths.get(join(corrupt.root,'bin','mysql.exe'))![0]^=1;await expect(verifyDatabaseBackupToolSuite(corrupt.root,corrupt.manifest,corrupt.options)).rejects.toThrow('摘要');
    for(const f of [extra,linked,missing,corrupt])expect(f.counts().closed).toBe(f.counts().opened);
  });
  it('读取期间取消仍关闭已捕获句柄，取消原错不能被关闭失败覆盖',async()=>{
    const f=fixture(),original=f.io.open;f.io.open=async path=>{const reader=await original(path),read=reader.read;reader.read=async(...args)=>{const result=await read(...args);f.state.cancelled=true;return result;};return reader;};
    await expect(verifyDatabaseBackupToolSuite(f.root,f.manifest,f.options)).rejects.toThrow('合成取消');expect(f.counts().closed).toBe(1);
    const bad=fixture(),first=Error('原读取失败'),second=Error('关闭未知');bad.state.readError=first;bad.state.closeError=second;
    const error=await verifyDatabaseBackupToolSuite(bad.root,bad.manifest,bad.options).catch(error=>error);
    expect(error).toBeInstanceOf(AggregateError);expect(error.errors).toEqual([first,second]);expect(bad.counts().closed).toBe(1);
  });
  it('打开后身份漂移与清单输入在await后的修改不能改绑原核验',async()=>{
    const drift=fixture(),open=drift.io.open;drift.io.open=async path=>{const reader=await open(path);drift.state.changed=true;return reader;};
    await expect(verifyDatabaseBackupToolSuite(drift.root,drift.manifest,drift.options)).rejects.toThrow('打开期间');expect(drift.counts().closed).toBe(1);
    const f=fixture(),realpath=f.io.realpath;f.io.realpath=async path=>{f.manifest.files[0].sha256='0'.repeat(64);return realpath(path);};
    expect((await verifyDatabaseBackupToolSuite(f.root,f.manifest,f.options)).suiteSha256).not.toBe(databaseBackupSuiteSha256(f.manifest));
  });
  it('大小写重名、错误家族工具和超预算不能通过固定清单',()=>{
    const f=fixture();
    expect(()=>databaseBackupSuiteSha256({...f.manifest,files:[...f.manifest.files,{...f.manifest.files[0],path:'BIN/MySQL.exe'}]})).toThrow('清单无效');
    expect(()=>databaseBackupSuiteSha256({...f.manifest,family:'mariadb'})).toThrow('准确家族');
    expect(()=>databaseBackupSuiteSha256({...f.manifest,files:f.manifest.files.map(file=>({...file,bytes:64*1024**2+1}))})).toThrow('清单无效');
  });
});
