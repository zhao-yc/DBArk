import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { keeperLimits, selectModeCandidate, acceptKeeperEvent } from './macos-mode-keeper-policy.mjs';
import { ciContext } from './native-editor-ci.mjs';
import { readApproval } from './native-editor-ci-identity.mjs';
import { assertFileFirstModelResult } from './native-file-first-model-ci.mjs';

/** 参数门先于资源；不提供通用命令、任意可执行路径或本地模式切换入口。 */
export function requireKeeperCI(args, platform, arch, env) {
  assert.deepEqual(args, ['source']); assert.equal(platform, 'darwin'); assert.equal(arch, 'arm64');
  assert.equal(env.GITHUB_ACTIONS, 'true'); assert.equal(env.GITHUB_REF, 'refs/heads/codex/macos-mode-keeper-20261019');
  assert.equal(env.MODE_KEEPER_RUNNER_ENVIRONMENT,'github-hosted');
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  for (const name of ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_JOB']) assert.match(env[name] ?? '', /^[a-zA-Z0-9_-]+$/);
  for (const key of Object.keys(env)) assert.ok(!/^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$|DYLD_|LD_PRELOAD$)/i.test(key), '模式准备前拒绝外部入口/原生门/预加载环境');
}

/** 只消费原native CLI的成功链，不补SDK/PID/SQLite观察，也不把原失败改写成成功。 */
export function requireOriginalCompletion(value) {
  assert.equal(value.phase,'source'); assert.equal(value.cleanupAllowed,true); assert.equal(value.automaticRetry,false);
  assert.equal(value.proofs.length,2);
  for (const proof of value.proofs) {
    assert.equal(proof.accepted,true); assert.equal(proof.directoryRemoved,true);
    assert.equal(proof.sqlExecution,0); assert.equal(proof.systemClipboard,0); assert.equal(proof.normalOwners.length,2);
    for (const owner of proof.normalOwners) { assert.equal(owner.confirmed,true); assert.equal(owner.willQuit,true); assert.equal(owner.closed,true); assert.ok(Number.isSafeInteger(owner.recordedPids) && owner.recordedPids > 0); }
  }
  assert.equal(value.proofs[0].sqliteChecked,true); assert.equal(value.proofs[1].schema,9);
}

/** 仅消费原报告的四次稳定尺寸附件；新增候选不能靠稳定的较小客户区获得通过。 */
export function requireOriginalLayoutGeometry(report, plan) {
  const specs=[]; const visit=s=>{specs.push(...(s.specs??[]));for(const child of s.suites??[])visit(child);};
  for(const suite of report.suites??[])visit(suite);
  assert.deepEqual(report.errors,[]); assert.equal(specs.length,1);
  const result=specs[0].tests[0].results[0]; assert.equal(result.status,'passed'); assert.equal(result.retry,0);
  const stable=result.attachments.filter(a=>a.name==='分栏原生窗口尺寸').map(a=>{
    assert.equal(a.contentType,'application/json'); assert.equal(typeof a.body,'string'); assert.ok(!a.path);
    return JSON.parse(Buffer.from(a.body,'base64').toString('utf8'));
  }).filter(value=>value.stable===true);
  assert.deepEqual(stable.map(value=>[value.requested.width,value.requested.height]),[[1400,1000],[1400,480],[1400,1000],[1400,1000]]);
  for(const value of stable) {
    assert.deepEqual(value.actual,value.requested);
    assert.deepEqual(value.page.viewport,{...value.requested,devicePixelRatio:1});
    assert.deepEqual(value.native.actual,[value.requested.width,value.requested.height]);
    const d=value.native.diagnostics; assert.ok(d); assert.equal(d.zoomFactor,1); assert.equal(d.display.scaleFactor,1);
    assert.equal(d.display.bounds.width,plan.mode.logicalWidth); assert.equal(d.display.bounds.height,plan.mode.logicalHeight);
    const area=d.display.workArea, bounds=d.bounds, content=d.contentBounds;
    for(const rect of [area,bounds,content]) for(const key of ['x','y','width','height']) assert.ok(Number.isFinite(rect[key]));
    assert.ok(area.width>=keeperLimits.minimumVisibleWidth && area.height>=keeperLimits.minimumVisibleHeight);
    assert.equal(content.width,value.requested.width); assert.equal(content.height,value.requested.height);
    assert.ok(bounds.x>=area.x && bounds.y>=area.y && bounds.x+bounds.width<=area.x+area.width && bounds.y+bounds.height<=area.y+area.height);
  }
  return stable.length;
}

/** keeper与native分别持有原进程句柄；永不kill应用、runner或未知PID。 */
async function run() {
  requireKeeperCI(process.argv.slice(2),process.platform,process.arch,process.env);
  const project = fileURLToPath(new URL('../',import.meta.url)), output = join(project,'.cache/macos-mode-keeper');
  // 在任何显示资源之前绑定本job的原checkout；只读Git检查，不替代后续原CI批准。
  const head=spawnSync('git',['rev-parse','HEAD'],{cwd:project,encoding:'utf8'});
  const dirty=spawnSync('git',['status','--porcelain','--untracked-files=no'],{cwd:project,encoding:'utf8'});
  assert.equal(head.status,0);assert.equal(head.stdout.trim(),process.env.GITHUB_SHA);
  assert.equal(dirty.status,0);assert.equal(dirty.stdout.trim(),'');
  mkdirSync(output,{recursive:true});
  const nonce = randomBytes(32).toString('hex'), start = performance.now();
  let state = {nonce,seq:0,last:start,deadline:start+keeperLimits.leaseSeconds*1000,phase:'starting',failed:false};
  let fault, bytes = 0, buffer = Buffer.alloc(0), readyResolve, readyReject, nativeRunning = false, keeperEnded = false, nativeResult, originalProofsConsumed=false, fileResult, fileProofsConsumed=false;
  const journal = join(output,'keeper.jsonl'); writeFileSync(journal,'',{flag:'wx'});
  const ready = new Promise((done,reject)=>{readyResolve=done;readyReject=reject;}); void ready.catch(()=>{});
  const keeper = spawn(join(output,'keeper'),['--hold','600',nonce],{cwd:project,stdio:['pipe','pipe','inherit']});
  /** 任意故障单向停链；只给已捕获的keeper写retain，不向原native发退出或清理命令。 */
  function retain(reason) {
    if (fault) return; fault = String(reason); state = {...state,failed:true}; readyReject(Error(fault));
    if (!keeperEnded && !keeper.stdin.destroyed) keeper.stdin.write(JSON.stringify({action:'retain',nonce})+'\n');
  }
  keeper.stdin.on('error',()=>retain('keeper原输入通道失败'));
  keeper.on('error',()=>retain('keeper启动失败'));
  const exited = new Promise(done=>keeper.on('close',(code,signal)=>{
    keeperEnded=true;
    if (nativeRunning || state.phase !== 'restored' || code !== 0 || signal !== null) retain('keeper在原native链或恢复证明完成前退出');
    done({code,signal});
  }));
  keeper.stdout.on('data',chunk=>{
    try {
    bytes+=chunk.length;
    if (bytes>8*1024*1024) { retain('keeper总输出超过8MiB'); return; }
    appendFileSync(journal,chunk); buffer=Buffer.concat([buffer,chunk]);
    if (buffer.length>2*1024*1024) { buffer=Buffer.alloc(0); retain('keeper帧超过2MiB'); return; }
    for (let end;(end=buffer.indexOf(10))>=0;) {
      const line=buffer.subarray(0,end); buffer=buffer.subarray(end+1);
      if (fault) continue;
      try {
        const event=JSON.parse(line.toString('utf8'));
        state=acceptKeeperEvent(state,event,performance.now());
        if (event.type==='inventory') {
          assert.equal(event.snapshot.displays[0].mirrored,false);
          const plan=selectModeCandidate(event.snapshot); state={...state,phase:'selected',plan,original:event.snapshot.displays[0]};
          writeFileSync(join(output,'plan.json'),JSON.stringify({inventory:event.snapshot,plan},null,2)+'\n',{flag:'wx'});
          keeper.stdin.write(JSON.stringify({action:'apply',nonce,modeID:plan.mode.modeID})+'\n');
        } else if (event.type==='ready') readyResolve();
      } catch { retain('keeper帧、顺序或真实空间证明失败'); }
    }
    } catch { retain('keeper原日志保存失败'); }
  });
  let timer;
  try {
    await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('keeper准备未在15秒完成')),15000);})]);
    clearTimeout(timer);
    assert.ok(!fault && !keeperEnded && performance.now()<state.deadline);
    nativeRunning=true;
    // 原脚本完整保留：同次构建/批准、缩进后分栏、原TestInfo期限、断言及退出证明均不改。
    const native=spawn(process.execPath,['scripts/native-editor-ci.mjs','source'],{cwd:project,env:process.env,stdio:'inherit'});
    const result=await new Promise(done=>{native.once('error',()=>done({code:null,signal:'启动失败'}));native.once('close',(code,signal)=>done({code,signal}));});
    nativeRunning=false; nativeResult=result;
    assert.equal(result.code,0); assert.equal(result.signal,null); assert.ok(!fault && !keeperEnded && performance.now()<state.deadline);
    requireOriginalCompletion(JSON.parse(readFileSync(join(project,'test-results/native-editor-ci/source-completed.json'),'utf8')));
    const layoutDirectory=join(project,'test-results/native-editor-ci/source-layout');
    const reportBytes=readFileSync(join(layoutDirectory,'report.json'));
    const accepted=JSON.parse(readFileSync(join(layoutDirectory,'accepted.json'),'utf8'));
    assert.equal(accepted.reportSha256,createHash('sha256').update(reportBytes).digest('hex'));
    requireOriginalLayoutGeometry(JSON.parse(reportBytes.toString('utf8')),state.plan);
    originalProofsConsumed=true;
    assert.ok(!fault && !keeperEnded && performance.now()<state.deadline);
    // 同一源码批准交给现有四例CLI；不重build、不重签清单、不继承其它原生门。
    const sourcePath=join(project,'test-results/native-editor-ci/source-approval.json');
    const sourceHash=createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
    const sourceApproval=readApproval(sourcePath,sourceHash,ciContext(project));
    assert.equal(sourceApproval.value.phase,'source');
    assert.ok(!fault && !keeperEnded && performance.now()<state.deadline);
    nativeRunning=true;
    const files=spawn(process.execPath,['scripts/native-file-first-model-ci.mjs','source'],{cwd:project,env:{...process.env,DBARK_NATIVE_EDITOR_SOURCE_APPROVAL:sourcePath,DBARK_NATIVE_EDITOR_SOURCE_APPROVAL_SHA256:sourceHash},stdio:'inherit'});
    fileResult=await new Promise(done=>{files.once('error',()=>done({code:null,signal:'启动失败'}));files.once('close',(code,signal)=>done({code,signal}));});
    nativeRunning=false;
    assert.equal(fileResult.code,0); assert.equal(fileResult.signal,null);
    assert.ok(!fault && !keeperEnded && performance.now()<state.deadline);
    const fileDirectory=join(project,'test-results/native-file-first-model-ci/source');
    const fileReportBytes=readFileSync(join(fileDirectory,'report.json'));
    const fileAccepted=JSON.parse(readFileSync(join(fileDirectory,'accepted.json'),'utf8'));
    assert.equal(fileAccepted.phase,'source'); assert.equal(fileAccepted.approvalSha256,sourceHash);
    assert.deepEqual(fileAccepted.context,sourceApproval.value.context);
    assert.equal(fileAccepted.reportSha256,createHash('sha256').update(fileReportBytes).digest('hex'));
    assert.equal(fileAccepted.cleanupAllowed,true); assert.equal(fileAccepted.automaticRetry,false);
    assert.deepEqual(fileAccepted.proofs,assertFileFirstModelResult(JSON.parse(fileReportBytes.toString('utf8'))));
    readApproval(sourcePath,sourceHash,ciContext(project)); fileProofsConsumed=true;
    assert.ok(!fault && !keeperEnded && performance.now()<state.deadline);
    state={...state,phase:'releasing'}; keeper.stdin.write(JSON.stringify({action:'release',nonce})+'\n');
  } catch (error) { retain(error instanceof Error ? error.message : '父控制器失败'); }
  finally { clearTimeout(timer); }
  // 先等待原native CLI自然返回，再等待keeper。失败不恢复显示、不强停应用；session模式供原证据上传期间继续保留。
  const result=await exited;
  const accepted=!fault && originalProofsConsumed && fileProofsConsumed && state.phase==='restored' && result.code===0 && result.signal===null;
  writeFileSync(join(output,'receipt.json'),JSON.stringify({accepted,fault:fault??null,keeper:result,modeScope:'forSession',originalNativeCLIResult:nativeResult??null,originalProofsConsumed,originalFileCLIResult:fileResult??null,fileProofsConsumed,allFailureEvidenceCompleteConfirmed:false,artifactUploadConfirmed:false,keeperExitRestorationRequested:false,normalRestoreObservedBeforeKeeperExit:state.phase==='restored',postKeeperExitRestoreObserved:false,applicationForceStop:false,nativeOriginalAssertionsUnchanged:true,evidenceBoundary:'仅原CLI返回后已写出的文件可供下一步upload-artifact读取；中断可能没有完整report，未知应用/profile未补读。上传成功须以后续step的artifact-id/digest另证，不由本receipt冒充。'},null,2)+'\n',{flag:'wx'});
  if (!accepted) throw Error('模式保有/原native/恢复证明未完整闭合；原失败保留');
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) run().catch(error=>{console.error(error);process.exitCode=1;});
