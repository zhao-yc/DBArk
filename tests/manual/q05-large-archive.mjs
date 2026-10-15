import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {appendFile,lstat,mkdir,mkdtemp,readFile,readdir,realpath,rm,statfs,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const help=`Q05真实ZIP64文件边界验收（默认关闭）
  node tests/manual/q05-large-archive.mjs --smoke --python <Python绝对路径>
  $env:DBARK_Q05_LARGE_ARCHIVE='1'
  node tests/manual/q05-large-archive.mjs --large --python <Python绝对路径>
可追加 --cleanup-success，仅在全部校验成功后删除本次大ZIP，证据JSON保留。
不带参数仅显示帮助；普通单元/CI不会收集本入口。
大模式实际写入超过4GiB，须由统筹明确启动；不涉及数据库、GUI或Docker。`;
const args=process.argv.slice(2);
if(!args.length||args.includes('--help')){console.log(help);process.exit(0);}
let mode,python,cleanup=false;
for(let index=0;index<args.length;index++){
  const arg=args[index];
  if(arg==='--smoke'||arg==='--large'){if(mode)throw Error('只能选择一个验收模式');mode=arg.slice(2);}
  else if(arg==='--python'){if(python||!args[index+1]||args[index+1].startsWith('--'))throw Error('必须提供唯一Python绝对路径');python=args[++index];}
  else if(arg==='--cleanup-success'){cleanup=true;}
  else throw Error('不支持的验收参数：'+arg);
}
if(!mode||!python||!isAbsolute(python))throw Error('需要显式模式与Python绝对路径；未创建临时文件');
if(mode==='large'&&process.env.DBARK_Q05_LARGE_ARCHIVE!=='1')throw Error('大归档默认关闭：还须显式设置DBARK_Q05_LARGE_ARCHIVE=1；未写入任何文件');

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),owner=randomUUID();
const reserve=1024n**3n;
let root,cacheReal,child,cancelled=false;
// 停止信号先变为产品取消检查；子进程阶段则终止验证器，仍由主流程保存失败证据。
const stop=()=>{cancelled=true;child?.kill();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
const checkCancelled=()=>{if(cancelled)throw Error('验收收到停止信号，已停止当前写入');};

/** 子进程不经shell，输出有界并留在自有目录；验证进程逐块读取，不在stdout输出CSV。 */
async function command(executable,parameters,label){
  checkCancelled();
  return new Promise((accept,reject)=>{
    const processChild=spawn(executable,parameters,{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'}});
    child=processChild;let stdout='',stderr='',overflow=false;
    const collect=(channel,chunk)=>{
      if(channel==='stdout')stdout+=chunk;else stderr+=chunk;
      if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>256*1024){overflow=true;processChild.kill();}
    };
    processChild.stdout.setEncoding('utf8');processChild.stderr.setEncoding('utf8');
    processChild.stdout.on('data',chunk=>collect('stdout',chunk));processChild.stderr.on('data',chunk=>collect('stderr',chunk));
    processChild.once('error',reject);
    processChild.once('close',async(code,signal)=>{
      child=undefined;
      try{
        if(root){await writeFile(join(root,label+'-stdout.log'),stdout);await writeFile(join(root,label+'-stderr.log'),stderr);}
        if(overflow)throw Error('独立验证输出超过256KiB上限');
        checkCancelled();accept({code,signal,stdout,stderr});
      }catch(error){reject(error);}
    });
  });
}

/** 清理前重验真实绝对路径、所有者标记及普通文件类型，拒绝链接和任何外部路径。 */
async function validateOwnedFile(name){
  assert(root&&isAbsolute(root)&&dirname(root)===cacheReal&&/^q05-large-archive-[A-Za-z0-9]+$/.test(basename(root)),'临时目录越界');
  const folder=await lstat(root);assert(folder.isDirectory()&&!folder.isSymbolicLink());assert.equal(await realpath(root),root);
  assert.equal(await realpath(dirname(root)),cacheReal);
  const marker=JSON.parse(await readFile(join(root,'owner.json'),'utf8'));assert.equal(marker.owner,owner);assert.equal(marker.root,root);
  const path=resolve(root,name);assert.equal(dirname(path),root,'只能清理自有目录的指定直接子文件');
  const status=await lstat(path);assert(status.isFile()&&!status.isSymbolicLink());assert.equal(await realpath(path),path);return path;
}

/** 空间检查使用目标卷真实可用字节；没有磁盘展开副本，但仍保留1GiB余量。 */
async function diskBudget(remaining){
  const volume=await statfs(root,{bigint:true}),available=volume.bavail*volume.bsize,required=BigInt(remaining)+reserve;
  assert(available>=required,`目标卷空间不足：需要${required}字节，可用${available}字节`);
  return{availableBytes:available.toString(),requiredBytes:required.toString(),reserveBytes:reserve.toString()};
}

const evidence={version:1,mode,owner,started:new Date().toISOString(),state:'准备',scope:'文件写入器＋真实I/O＋独立标准库解包；不代表实库或GUI'};
try{
  const pythonPath=await realpath(python);assert((await lstat(pythonPath)).isFile(),'Python路径必须是实际文件');
  const preflight=await command(pythonPath,['-I','-B','-X','utf8','--version'],'python-version');assert.equal(preflight.code,0,'Python版本预检失败');
  const canonicalRepo=await realpath(repo),cache=join(canonicalRepo,'.cache');await mkdir(cache,{recursive:true});cacheReal=await realpath(cache);
  assert.equal(dirname(cacheReal),canonicalRepo,'不允许通过.cache链接把临时文件写到项目之外');
  root=await realpath(await mkdtemp(join(cacheReal,'q05-large-archive-')));evidence.root=root;evidence.python=preflight.stdout.trim()||preflight.stderr.trim();
  await writeFile(join(root,'owner.json'),JSON.stringify({owner,root},null,2),{flag:'wx'});
  const persist=()=>writeFile(join(root,'run.json'),JSON.stringify(evidence,null,2));await persist();
  console.log('本次独占临时目录：'+root);
  const sourceNames=['src/engine/queryCsvZip.ts','src/engine/queryStreamFile.ts','src/engine/atomicFile.ts','src/shared/queryStreamExport.ts','tests/manual/q05-archive-driver.ts','tests/manual/q05-verify-archive.py','tests/manual/q05-large-archive.mjs'];
  evidence.sources=Object.fromEntries(await Promise.all(sourceNames.map(async name=>[name,createHash('sha256').update(await readFile(join(repo,name))).digest('hex')])));
  const git=await command('git',['rev-parse','HEAD'],'git-head');evidence.head=git.code===0?git.stdout.trim():'未取得Git提交';
  const {build}=await import('esbuild');
  const bundle=join(root,'driver.cjs');await build({entryPoints:[join(repo,'tests/manual/q05-archive-driver.ts')],outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external',target:'node22',logLevel:'silent'});
  const {scenarioPlan,writeScenario}=createRequire(import.meta.url)(bundle),plan=scenarioPlan(mode==='large');evidence.plan=plan;
  evidence.diskBefore=await diskBudget(plan.archiveUpperBound+1024*1024);evidence.state='写入';await persist();
  const written=await writeScenario(root,mode==='large',async progress=>{
    checkCancelled();const space=await diskBudget(Math.max(0,plan.archiveUpperBound-progress.bytesWritten));
    await appendFile(join(root,'progress.jsonl'),JSON.stringify({...progress,availableBytes:space.availableBytes,time:new Date().toISOString()})+'\n');
    console.log(`真实已写入：${progress.bytesWritten}字节，${progress.rows}行`);
  },checkCancelled);
  evidence.written=written;evidence.state='独立解包';await persist();
  const expected=join(root,'expected.json');await writeFile(expected,JSON.stringify(written,null,2),{flag:'wx'});
  const verifier=join(repo,'tests/manual/q05-verify-archive.py');
  const verified=await command(pythonPath,['-I','-B','-X','utf8',verifier,written.target,expected],'verify');
  assert.equal(verified.code,0,'独立标准库校验失败，查看本次verify-stderr.log');
  evidence.verified=JSON.parse(verified.stdout);assert.equal(evidence.verified.verified,true);
  // 小模式另用错误SHA预期作负对照；大模式不为该对照额外重读4GiB。
  if(mode==='smoke'){
    const invalid=structuredClone(written);invalid.entries[0].sha256='0'.repeat(64);
    const invalidPath=join(root,'expected-invalid.json');await writeFile(invalidPath,JSON.stringify(invalid,null,2),{flag:'wx'});
    const negative=await command(pythonPath,['-I','-B','-X','utf8',verifier,written.target,invalidPath],'negative-sha');
    assert(negative.code!==0&&negative.stderr.includes('CSV内容不等于生成期独立证据'),'错误摘要必须被独立校验拒绝');evidence.negativeShaRejected=true;
  }
  assert(!(await readdir(root)).some(name=>name.endsWith('.partial')),'成功后不能留下partial');
  evidence.diskAfter=await diskBudget(0);evidence.state='通过';evidence.finished=new Date().toISOString();await persist();
  if(cleanup){const owned=await validateOwnedFile('archive.zip');await rm(owned);evidence.archiveRemovedAfterSuccess=true;await persist();}
  console.log(`验收通过：${written.archiveBytes}字节；大文件边界实际通过：${mode==='large'?'是':'否（仅小样本）'}；证据：${join(root,'run.json')}`);
}catch(error){
  evidence.state='失败';evidence.finished=new Date().toISOString();evidence.error={message:String(error?.message??error),stack:error?.stack};
  // 失败不清理目录、ZIP或旧目标；产品abort可能已按自身语义移除未提交partial，错误和进度仍保留。
  if(root){evidence.remainingFiles=await readdir(root).catch(()=>[]);await writeFile(join(root,'run.json'),JSON.stringify(evidence,null,2));}
  console.error('验收失败，保留本次证据：'+(root??'尚未创建临时目录')+'；'+evidence.error.message);process.exitCode=1;
}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
