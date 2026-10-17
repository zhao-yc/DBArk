import { createHash } from 'node:crypto';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import toolCatalog from './databaseBackupToolCatalog.json';

export interface DatabaseBackupSuiteFile { path: string; bytes: number; sha256: string; }
export interface DatabaseBackupToolSuite {
  id: string; family: 'mysql' | 'mariadb'; version: string; platform: 'win32' | 'darwin'; arch: 'x64' | 'arm64';
  dumpExecutable: string; restoreExecutable: string; files: readonly DatabaseBackupSuiteFile[]; suiteSha256: string;
}
interface FileStamp { bytes: bigint; identity: string; file: boolean; directory: boolean; link: boolean; }
interface SuiteReader { stat(): Promise<FileStamp>; read(buffer: Buffer, length: number, position: number): Promise<number>; close(): Promise<void>; }
export interface DatabaseBackupSuiteIO {
  realpath(path: string): Promise<string>; stat(path: string): Promise<FileStamp>; names(path: string): Promise<string[]>;
  open(path: string): Promise<SuiteReader>;
}
export const databaseBackupSuiteLimits = { files: 512, entries: 1024, depth: 8, fileBytes: 64 * 1024 ** 2, bytes: 256 * 1024 ** 2, chunkBytes: 64 * 1024 } as const;
/** 目录只描述已核官方分发的准确组合；存在目录项不表示工具已安装或备份能力已验。 */
export function databaseBackupToolChoices(platform: string, arch: string) {
  return toolCatalog.suites.filter(suite=>suite.platform===platform&&suite.arch===arch).map(suite=>({id:suite.id,family:suite.family as 'mysql'|'mariadb',version:suite.version,label:`MySQL ${suite.version}（${suite.arch}）`}));
}
/** 运行端只能按编译期目录ID解析；不接收用户提供的摘要、工具路径或自签清单。 */
export async function verifyRegisteredDatabaseBackupTool(root: string, id: string, options: Parameters<typeof verifyDatabaseBackupToolSuite>[2]) {
  const approved=(toolCatalog.suites as DatabaseBackupToolSuite[]).find(suite=>suite.id===id);
  if(!approved)return null;
  const verified=await verifyDatabaseBackupToolSuite(root,approved,options);
  return {...verified,catalogRevision:sha(JSON.stringify(toolCatalog))};
}
/** 文件身份使用BigInt，避免Windows文件ID及纳秒时间经Number丢失精度。 */
function stamp(info: Awaited<ReturnType<typeof nativeStat>>): FileStamp {
  return { bytes: info.size, identity: [info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':'), file: info.isFile(), directory: info.isDirectory(), link: info.isSymbolicLink() };
}
const nativeStat = (path: string) => lstat(path,{bigint:true});
const nativeIO: DatabaseBackupSuiteIO = {
  realpath, names: path=>readdir(path), stat: async path=>stamp(await nativeStat(path)),
  open: async path=>{
    const handle=await open(path,'r');
    return { stat:async()=>stamp(await handle.stat({bigint:true})), read:async(buffer,length,position)=>(await handle.read(buffer,0,length,position)).bytesRead, close:()=>handle.close() };
  }
};
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const safePath = (path: string) => /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) && !path.split('/').some(part=>part==='.'||part==='..') && path.split('/').length<=databaseBackupSuiteLimits.depth;

/** 可信目录来自发布构建中的固定清单，不能接受renderer传入的清单或路径作为信任根。 */
export function databaseBackupSuiteSha256(input: Omit<DatabaseBackupToolSuite,'suiteSha256'>): string {
  if(!/^[a-z0-9.-]{1,100}$/.test(input.id)||!['mysql','mariadb'].includes(input.family)||!/^\d+\.\d+\.\d+$/.test(input.version)||!['win32','darwin'].includes(input.platform)||!['x64','arm64'].includes(input.arch))throw Error('备份工具套件身份无效');
  if(!Array.isArray(input.files)||!input.files.length||input.files.length>databaseBackupSuiteLimits.files)throw Error('备份工具套件文件数量超限');
  const names=new Set<string>();let total=0;
  for(const file of input.files){
    if(typeof file.path!=='string'||!safePath(file.path)||names.has(file.path.toLowerCase())||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>databaseBackupSuiteLimits.fileBytes||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('备份工具套件文件清单无效');
    names.add(file.path.toLowerCase());total+=file.bytes;if(total>databaseBackupSuiteLimits.bytes)throw Error('备份工具套件超过总字节预算');
  }
  const expectedDump=input.platform==='win32'?(input.family==='mysql'?'bin/mysqldump.exe':'bin/mariadb-dump.exe'):(input.family==='mysql'?'bin/mysqldump':'bin/mariadb-dump');
  const expectedRestore=input.platform==='win32'?(input.family==='mysql'?'bin/mysql.exe':'bin/mariadb.exe'):(input.family==='mysql'?'bin/mysql':'bin/mariadb');
  if(input.dumpExecutable!==expectedDump||input.restoreExecutable!==expectedRestore||!input.files.some(file=>file.path===expectedDump)||!input.files.some(file=>file.path===expectedRestore))throw Error('备份工具可执行文件不属于准确家族');
  return sha(JSON.stringify({schema:1,family:input.family,version:input.version,platform:input.platform,arch:input.arch,dumpExecutable:input.dumpExecutable,restoreExecutable:input.restoreExecutable,files:input.files.map(({path,bytes,sha256})=>({path,bytes,sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)}));
}

/** 只做有界完整文件核验；不搜索PATH、不探测版本、不启动工具、不读取数据库凭据。 */
export async function verifyDatabaseBackupToolSuite(root: string, approved: DatabaseBackupToolSuite, options: { platform: string; arch: string; checkCancelled(): void; io?: DatabaseBackupSuiteIO }) {
  const manifest=structuredClone(approved),io=options.io??nativeIO,check=options.checkCancelled;
  const digest=databaseBackupSuiteSha256(manifest);
  if(digest!==manifest.suiteSha256||manifest.platform!==options.platform||manifest.arch!==options.arch)throw Error('备份工具固定清单或当前平台不匹配');
  const entryPath=resolve(root);
  check();const entryStamp=await io.stat(entryPath);check();
  if(entryStamp.link||!entryStamp.directory)throw Error('备份工具原始根入口不允许链接或非目录');
  const directory=await io.realpath(entryPath);check();
  const initialRoot=await io.stat(directory);check();if(initialRoot.link||!initialRoot.directory)throw Error('备份工具根目录无效');
  if(initialRoot.identity!==entryStamp.identity)throw Error('备份工具根入口解析期间发生变化');
  const expected=new Map(manifest.files.map(file=>[file.path,file])),observed=new Set<string>();let entries=0;
  /** 禁止清单外文件、链接和目录逃逸；动态库与插件也必须逐字节属于相同固定套件。 */
  async function walk(path: string, depth: number): Promise<void> {
    if(depth>databaseBackupSuiteLimits.depth)throw Error('备份工具目录深度超限');
    check();const names=await io.names(path);check();
    if(entries+names.length>databaseBackupSuiteLimits.entries)throw Error('备份工具目录条目超限');entries+=names.length;
    for(const name of names){
      if(!/^[A-Za-z0-9_.-]+$/.test(name)||name==='.'||name==='..')throw Error('备份工具目录名称无效');
      const full=join(path,name),rel=relative(directory,full).replaceAll('\\','/');
      if(isAbsolute(rel)||!safePath(rel))throw Error('备份工具路径越界');
      check();const before=await io.stat(full);check();const actual=await io.realpath(full);check();
      const comparable=(value:string)=>manifest.platform==='win32'?value.toLowerCase():value;
      if(before.link||comparable(actual)!==comparable(full))throw Error('备份工具不允许链接或重定向目录');
      if(before.directory){if(!manifest.files.some(file=>file.path.startsWith(rel+'/')))throw Error('备份工具存在清单外目录');await walk(full,depth+1);continue;}
      const file=expected.get(rel);
      if(!before.file||!file||observed.has(rel)||before.bytes!==BigInt(file.bytes))throw Error('备份工具文件缺失、重复或长度变化');
      check();const reader=await io.open(full);let original:unknown,failed=false;
      try{
        check();if((await reader.stat()).identity!==before.identity)throw Error('备份工具打开期间发生变化');check();
        const hash=createHash('sha256'),buffer=Buffer.alloc(databaseBackupSuiteLimits.chunkBytes);let offset=0;
        while(offset<file.bytes){
          check();const length=Math.min(buffer.length,file.bytes-offset),count=await reader.read(buffer,length,offset);check();
          if(!Number.isInteger(count)||count<1||count>length)throw Error('备份工具文件读取不完整');hash.update(buffer.subarray(0,count));offset+=count;
        }
        check();const extra=await reader.read(buffer,1,offset);check();
        if(extra!==0||hash.digest('hex')!==file.sha256||(await reader.stat()).identity!==before.identity)throw Error('备份工具完整文件摘要或身份不符');check();
      }catch(error){failed=true;original=error;}
      try{await reader.close();}catch(error){throw failed?new AggregateError([original,error],'备份工具读取失败且文件关闭未确认'):error;}
      if(failed)throw original;
      check();if((await io.stat(full)).identity!==before.identity)throw Error('备份工具核验后发生变化');check();observed.add(rel);
    }
  }
  await walk(directory,0);
  check();if(observed.size!==expected.size||(await io.stat(directory)).identity!==initialRoot.identity)throw Error('备份工具套件不完整或根目录已变化');check();
  const finalEntry=await io.stat(entryPath);check();const finalDirectory=await io.realpath(entryPath);check();
  if(finalEntry.link||!finalEntry.directory||finalEntry.identity!==entryStamp.identity||finalDirectory!==directory)throw Error('备份工具原始根入口已换绑');
  return Object.freeze({id:manifest.id,family:manifest.family,version:manifest.version,suiteSha256:digest,dumpPath:join(directory,...manifest.dumpExecutable.split('/')),restorePath:join(directory,...manifest.restoreExecutable.split('/')),verifiedFiles:observed.size});
}
