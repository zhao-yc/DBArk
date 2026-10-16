// 默认仅查看状态；全部产物进入忽略缓存。分析只能选择本脚本生成的无入口/无导入样例DLL。
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),args=process.argv.slice(2);
const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const cache=path.resolve(option('--cache')??path.join(repo,'.cache/rea-ghidra-portable-20261016')),relative=path.relative(path.join(repo,'.cache'),cache);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'缓存必须位于本克隆.cache下');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
/** 二进制摘要流式计算，避免校验Node/JDK时一次保留整个文件。 */
async function shaFile(file){const digest=createHash('sha256');for await(const bytes of createReadStream(file))digest.update(bytes);return digest.digest('hex');}
/** 确定性的PE32+ DLL：一个导出sample_value，机器码仅mov eax,42;ret；不执行此文件。 */
export function fixtureBytes(){
 const b=Buffer.alloc(1024),pe=0x80,opt=pe+24,section=opt+240;b.write('MZ');b.writeUInt32LE(pe,0x3c);b.write('PE\0\0',pe,'binary');b.writeUInt16LE(0x8664,pe+4);b.writeUInt16LE(1,pe+6);b.writeUInt16LE(240,pe+20);b.writeUInt16LE(0x2022,pe+22);b.writeUInt16LE(0x20b,opt);b.writeUInt32LE(512,opt+4);b.writeUInt32LE(0x1000,opt+20);b.writeBigUInt64LE(0x180000000n,opt+24);b.writeUInt32LE(0x1000,opt+32);b.writeUInt32LE(0x200,opt+36);b.writeUInt16LE(6,opt+40);b.writeUInt16LE(6,opt+48);b.writeUInt32LE(0x2000,opt+56);b.writeUInt32LE(0x200,opt+60);b.writeUInt16LE(3,opt+68);b.writeUInt16LE(0x160,opt+70);for(const offset of [72,88])b.writeBigUInt64LE(0x100000n,opt+offset);for(const offset of [80,96])b.writeBigUInt64LE(0x1000n,opt+offset);b.writeUInt32LE(16,opt+108);b.writeUInt32LE(0x1100,opt+112);b.writeUInt32LE(0x90,opt+116);b.write('.text',section);for(const[offset,value]of [[8,512],[12,0x1000],[16,512],[20,512],[36,0x60000020]])b.writeUInt32LE(value,section+offset);b.set([0xb8,42,0,0,0,0xc3],0x200);for(const[offset,value]of [[12,0x1140],[16,1],[20,1],[24,1],[28,0x1160],[32,0x1164],[36,0x1168]])b.writeUInt32LE(value,0x300+offset);b.write('dbark_rea_sample.dll\0',0x340);b.writeUInt32LE(0x1000,0x360);b.writeUInt32LE(0x1170,0x364);b.writeUInt16LE(0,0x368);b.write('sample_value\0',0x370);return b;
}
if(args.includes('--configure')){
 const reaRoot=path.resolve(option('--rea-root')??path.join(cache,'rea-portable/node_modules/rea-agents')),ghidraHome=path.resolve(option('--ghidra-root')??path.join(cache,'ghidra/ghidra_12.1.4_PUBLIC')),javaHome=path.resolve(option('--java-home')??'');assert.ok(option('--java-home'),'须显式提供已核JDK目录');
 const pkg=await json(path.join(reaRoot,'package.json')),native=await json(path.join(reaRoot,'native/windows/build/manifest.json'));assert.equal(pkg.version,'6.5.0');assert.equal(native.packageVersion,pkg.version);assert.equal(native.artifactSha256,'665c57ab90aef0712a6aafc423c7992a88bf608bea63b370cb30c695900f9aed');
 const nativePath=await fs.realpath(path.join(reaRoot,'native/windows/build',native.artifact));assert.equal(sha(await fs.readFile(nativePath)),native.artifactSha256);const properties=await fs.readFile(path.join(ghidraHome,'Ghidra/application.properties'),'utf8');assert.match(properties,/application.version=12\.1\.4/);assert.match(properties,/application.java.min=21/);await fs.access(path.join(javaHome,'bin/java.exe'));await fs.access(path.join(javaHome,'bin/javac.exe'));
 await fs.mkdir(cache,{recursive:true});const fixture=path.join(cache,'dbark-rea-sample.dll'),bytes=fixtureBytes();try{assert.equal(sha(await fs.readFile(fixture)),sha(bytes));}catch(error){if(error.code!=='ENOENT')throw error;await fs.writeFile(fixture,bytes,{flag:'wx'});}
 const entry=path.join(reaRoot,'scripts/rea.mjs'),manifest={reaVersion:pkg.version,reaEntry:entry,reaEntrySha256:await shaFile(entry),sourceReviewCommit:'9e7e13fb7155a2fe6f672ddb4a17e40d1a9c4173',ghidraVersion:'12.1.4',ghidraHome,javaHome,javaSha256:await shaFile(path.join(javaHome,'bin/java.exe')),node:process.execPath,nodeSha256:await shaFile(process.execPath),native:{path:nativePath,sha256:native.artifactSha256},sample:{path:fixture,sha256:sha(bytes),bytes:bytes.length,address:'0x180001000',expectedReturn:42},analysisHeapMiB:256,nodeHeapMiB:256,logicalCpus:1};await fs.writeFile(path.join(cache,'toolchain.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({便携配置:true,REA:pkg.version,Ghidra:'12.1.4',样例字节:bytes.length,analysis:0}));
}else{
 const mode=args.includes('--help-cli')?'help':args.includes('--doctor')?'doctor':args.includes('--sample')?'sample':'status',record=option('--record')??mode;assert.match(record,/^[a-z0-9-]+$/u);const manifest=await json(path.join(cache,'toolchain.json'));
 for(const[file,expected]of [[manifest.reaEntry,manifest.reaEntrySha256],[manifest.native.path,manifest.native.sha256],[manifest.node,manifest.nodeSha256],[path.join(manifest.javaHome,'bin/java.exe'),manifest.javaSha256],[manifest.sample.path,manifest.sample.sha256]])assert.equal(await shaFile(file),expected,'绑定输入已变化');
 if(mode==='status')console.log(JSON.stringify({REA:manifest.reaVersion,Ghidra:manifest.ghidraVersion,样例SHA256:manifest.sample.sha256,默认关闭:true,analysis:0}));
 else{
  // 先拒绝旧记录名，再启动任何子进程，避免覆盖失败原件或在落盘时才发现冲突。
  for(const suffix of ['.exit.json','.stdout.json','.stderr.txt','-guard-audit.json']){try{await fs.lstat(path.join(cache,record+suffix));throw Error('运行记录已存在，请使用新的--record名称');}catch(error){if(error.code!=='ENOENT')throw error;}}
  if(mode!=='help')assert.ok(args.includes('--allow-scheduled-analysis'),'doctor/分析须等待ROOT排程后显式启用');
  // 已验证REA会把含点目录的会话根退到外层。缓存约束下必须提前拒绝，不能借此写ROOT目录。
  if(mode==='sample')assert.ok(!cache.split(path.sep).some(part=>part.startsWith('.')),'Ghidra项目路径含点前缀组件；REA会退到缓存外，当前约束下拒绝分析，须由ROOT另行安排不含点的专用目录');
  const home=path.join(cache,'runtime-profile'),temporary=path.join(cache,'runtime-temp');await fs.mkdir(home,{recursive:true});await fs.mkdir(temporary,{recursive:true});
  const env={};for(const name of ['SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT'])if(process.env[name])env[name]=process.env[name];Object.assign(env,{PATH:path.dirname(manifest.node)+';'+path.join(process.env.SystemRoot,'System32'),USERPROFILE:home,HOME:home,APPDATA:path.join(home,'roaming'),LOCALAPPDATA:path.join(home,'local'),TEMP:temporary,TMP:temporary,JAVA_HOME:manifest.javaHome,GHIDRA_INSTALL_DIR:manifest.ghidraHome,REA_ANALYSIS_PROVIDER:'ghidra',GHIDRA_HEADLESS_MAXMEM:'256M',GHIDRA_MAXMEM:'256M',GHIDRA_HEADLESS_JAVA_OPTIONS:'-XX:ActiveProcessorCount=1',REA_GHIDRA_STARTUP_TIMEOUT_MS:'120000',REA_LOG_LEVEL:'silent',DBARK_REA_CACHE:cache,DBARK_REA_MODE:mode});
  const command=mode==='help'?['--help']:mode==='doctor'?['doctor','--provider','ghidra','--json']:['decompile',manifest.sample.path,'sample_value','--provider','ghidra','--json'];
  env.DBARK_REA_RECORD=record;const invocation=['--max-old-space-size='+manifest.nodeHeapMiB,'--require',path.join(repo,'scripts/research/rea-portable-guard.cjs'),manifest.reaEntry,...command],startedAt=new Date().toISOString();const stdout=[],stderr=[];let errorCode=null;
  const result=await new Promise(done=>{const child=spawn(manifest.node,invocation,{cwd:cache,env,windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:mode==='help'?30000:180000});child.stdout.on('data',chunk=>stdout.push(chunk));child.stderr.on('data',chunk=>stderr.push(chunk));child.on('error',error=>{errorCode=error.code??'UNKNOWN';});child.on('close',(status,signal)=>done({status,signal,errorCode}));});
  await fs.writeFile(path.join(cache,record+'.exit.json'),JSON.stringify({startedAt,finishedAt:new Date().toISOString(),...result,command:invocation},null,2)+'\n',{flag:'wx'});await fs.writeFile(path.join(cache,record+'.stdout.json'),Buffer.concat(stdout),{flag:'wx'});await fs.writeFile(path.join(cache,record+'.stderr.txt'),Buffer.concat(stderr),{flag:'wx'});assert.equal(sha(await fs.readFile(manifest.sample.path)),manifest.sample.sha256);console.log(JSON.stringify({模式:mode,退出:result.status,信号:result.signal,原件已保存:true}));process.exitCode=result.status??1;
 }
}
