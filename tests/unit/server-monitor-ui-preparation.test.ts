import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { assertServerMonitorUiIdentity, bindServerMonitorUiTarget, closeServerMonitorObserver, guardServerMonitorExitAnswers, ServerMonitorUiLifetime, serverMonitorUiKeys, serverMonitorUiTaskIds } from '../helpers/serverMonitorUi';
import { closeMysqlConnection } from '../../src/engine/connection';

/** 所有配置为显式RAM合成值，空密码也有自有属性；不读取认证文件。 */
function config() { return { DBARK_INTEGRATION_ENABLED:'1', DBARK_S02_SERVER_MONITOR_UI_TEST:'1', DBARK_TEST_HOST:'192.168.31.200', DBARK_TEST_PORT:'13384', DBARK_TEST_TLS:'0', DBARK_TEST_USER:'RAM用户', DBARK_TEST_PASSWORD:'', DBARK_TEST_EXPECTED_SERVER_UUID:'00000000-0000-0000-0000-000000000001' } as Record<string,string|undefined>; }
const tasks = () => [{id:'monitor-one',kind:'serverMonitor.read',status:'completed'},{id:'monitor-two',kind:'serverMonitor.read',status:'completed'}];
/** 模拟同一框架开始时间与共享owner；本地时钟/通知可独立对抗，不等待真实期限。 */
function lifetime(notification = 'normal',start:number|null=0) {
  let now=0,closed=false; const info:{_startWallTime?:number;timeout:number;status:string}={_startWallTime:start??undefined,timeout:120000,status:'passed'},retain=vi.fn(()=>{if(notification==='throw')throw Error('RAM通知失败');}),exit=vi.fn(async()=>{closed=true;}),close=vi.fn(async()=>{});
  const life=new ServerMonitorUiLifetime({check(){},closed:()=>closed,retain,exit},info,()=>now);return {life,info,retain,exit,close,setNow:(value:number)=>{now=value;}};
}
describe('S02首个正式UI的纯准备门',()=>{
  it('准确明文目标接受显式空密码，继承/缺失认证与其它端口/TLS/默认库/SSH均拒绝',()=>{
    const raw=config();expect(bindServerMonitorUiTarget(()=>raw,{...raw}).target.port).toBe(13384);
    for(const patch of [{DBARK_TEST_PORT:'13380'},{DBARK_TEST_TLS:'1'},{DBARK_TEST_DATABASE:'业务库'},{DBARK_TEST_SSH:'1'},{DBARK_TEST_CA:'RAM-only.pem'},{DBARK_TEST_EXPECTED_SERVER_UUID:'未知'}]){const bad={...raw,...patch};expect(()=>bindServerMonitorUiTarget(()=>bad,{...bad})).toThrow();}
    const missing={...raw};delete missing.DBARK_TEST_PASSWORD;expect(()=>bindServerMonitorUiTarget(()=>missing,{...missing})).toThrow('显式');expect(()=>bindServerMonitorUiTarget(()=>Object.create(raw),Object.create(raw))).toThrow('显式');
  });
  it('raw/helper或属性存在性变化后恢复也永久停链',()=>{
    const raw=config(),helper={...raw},binding=bindServerMonitorUiTarget(()=>raw,helper);helper.DBARK_TEST_SSH='0';expect(()=>binding.assertCurrent()).toThrow();delete helper.DBARK_TEST_SSH;expect(()=>binding.assertCurrent()).toThrow('停链');
  });
  it('准确只读身份检查不接受错误版本、UUID或大小写目录规则，不读取额外状态',()=>{
    const row={version:'8.4.11',os:'Linux',names:0,uuid:config().DBARK_TEST_EXPECTED_SERVER_UUID};expect(()=>assertServerMonitorUiIdentity([[row]],row.uuid!)).not.toThrow();for(const patch of [{version:'8.4.12'},{names:1},{uuid:'其它'},{os:'Windows'}])expect(()=>assertServerMonitorUiIdentity([[{...row,...patch}]],row.uuid!)).toThrow('身份');
  });
  it('准确两个监控完成且任务号不同，空列表/重复/查询任务/未完成不能冒充终态',()=>{
    expect(serverMonitorUiTaskIds(tasks(),2)).toEqual(['monitor-one','monitor-two']);for(const value of [[],[tasks()[0],tasks()[0]],[tasks()[0],{...tasks()[1],kind:'query.execute'}],[tasks()[0],{...tasks()[1],status:'running'}]])expect(()=>serverMonitorUiTaskIds(value,2)).toThrow('未确认');
  });
});

describe('S02原期限、活动和同owner正常/失败边界',()=>{
  it('正常任务→原窗口退出→原观察流关闭，afterEach只核原成功事实',async()=>{
    const f=lifetime();f.setNow(119999);await f.life.finish(async()=>tasks(),f.close);f.life.endBody();f.setNow(120001);expect(()=>f.life.afterEach()).not.toThrow();expect(f.exit).toHaveBeenCalledOnce();expect(f.close).toHaveBeenCalledOnce();expect(f.retain).not.toHaveBeenCalled();await expect(f.life.observe(async()=>{})).rejects.toThrow('停链');
  });
  it('原起点120秒已到而共享owner仍有效，禁止退出/关闭，不从helper续期',async()=>{
    const f=lifetime();f.setNow(120000);await expect(f.life.finish(async()=>tasks(),f.close)).rejects.toThrow('期限');expect(f.exit).not.toHaveBeenCalled();expect(f.close).not.toHaveBeenCalled();f.setNow(1);expect(()=>f.life.check()).toThrow('停链');
  });
  it.each(['throw','noop'])('afterEach活动未结束先sticky，通知%s也阻断迟到收尾',async notification=>{
    const f=lifetime(notification);let release!:()=>void;const pending=f.life.observe(()=>new Promise<void>(yes=>{release=yes;})).catch(reason=>reason);expect(()=>f.life.afterEach()).toThrow('收尾');release();expect(await pending).toBeInstanceOf(Error);await expect(f.life.finish(async()=>tasks(),f.close)).rejects.toThrow('停链');expect(f.exit).not.toHaveBeenCalled();expect(f.close).not.toHaveBeenCalled();expect(f.retain).toHaveBeenCalledOnce();
  });
  it('缺开始时间/改预算/框架超时/时钟倒退均拒绝，原失败不被finally覆盖',async()=>{
    for(const change of ['start','budget','timeout','clock']){const f=lifetime('normal',change==='start'?null:0);if(change==='budget')f.info.timeout=130000;if(change==='timeout')f.info.status='timedOut';if(change==='clock'){f.setNow(1);f.life.check();f.setNow(0);}expect(()=>f.life.check()).toThrow('期限');}
    const f=lifetime(),original=Error('独立原失败');await expect(f.life.observe(async()=>{throw original;})).rejects.toBe(original);expect(()=>f.life.endBody()).not.toThrow();expect(f.exit).not.toHaveBeenCalled();expect(f.close).not.toHaveBeenCalled();
  });
  it('原生关闭失败保留首因和现场，原窗口退出也不构成所有资源已释放',async()=>{
    const f=lifetime(),failure=Error('RAM观察流关闭未知');f.close.mockRejectedValueOnce(failure);await expect(f.life.finish(async()=>tasks(),f.close)).rejects.toBe(failure);f.life.endBody();expect(()=>f.life.afterEach()).toThrow('保留');expect(f.life.state.observerClosed).toBe(false);expect(f.life.state.retained).toBe(true);
  });
  it('正常观察流调用真实严格关闭函数等待同一stream close，Promise返回/换流不足',async()=>{
    const events=new EventEmitter(),stream={closed:false,once:events.once.bind(events),removeListener:events.removeListener.bind(events),destroy(){},end(callback:()=>void){callback();queueMicrotask(()=>{stream.closed=true;events.emit('close');});}},native={stream,end(callback:()=>void){queueMicrotask(callback);},destroy(){}},raw={connection:native};
    await closeServerMonitorObserver(raw,native,stream,()=>{},value=>closeMysqlConnection(value,true));expect(stream.closed).toBe(true);
    stream.closed=false;await expect(closeServerMonitorObserver(raw,native,stream,()=>{},async()=>{})).rejects.toThrow('未确认');const replacement={...stream};native.stream=replacement;await expect(closeServerMonitorObserver(raw,native,stream,()=>{},async()=>{})).rejects.toThrow('归属');
  });
  it('本例私有退出保护把共享自动答案1改为0，保留异常对话框记录而不自动强制退出',()=>{
    const sandbox:any={__dbarkE2EDialogs:{answers:[],calls:[]}};runInNewContext('('+guardServerMonitorExitAnswers.toString()+')()',sandbox);const calls=[{message:'RAM收尾未知'}];sandbox.__dbarkE2EDialogs={answers:[1,1],calls};expect(sandbox.__dbarkE2EDialogs.answers).toEqual([0,0]);expect(sandbox.__dbarkE2EDialogs.calls).toBe(calls);expect(()=>{sandbox.__dbarkE2EDialogs={};}).toThrow('形状');
  });
});

const entryCode=ts.transpileModule(readFileSync(new URL('../e2e/server-monitor.spec.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
/** 执行真正wrapper文本；只替换模块加载与环境，拒绝桌面、驱动和私料读取。 */
function entry(flags:string[],values:Record<string,string|undefined>,denyAll=false){const loads:string[]=[],skip=vi.fn(),register=vi.fn(),reads:string[]=[];const environment=new Proxy(values,{get(object,key:string){reads.push(key);if(denyAll||key.startsWith('DBARK_TEST_')&&!Object.hasOwn(object,'DBARK_TEST_HOST'))throw Error('禁止认证读取');return object[key];}});runInNewContext(entryCode,{exports:{},process:{argv:flags,env:environment},require(name:string){loads.push(name);if(name==='@playwright/test')return{test:{skip}};if(name==='../helpers/serverMonitorUi')return{bindServerMonitorUiTarget,serverMonitorUiKeys};if(name==='./server-monitor-live')return{registerServerMonitorUi:register};throw Error('禁止实际模块：'+name);}});return{loads,skip,register,reads};}
describe('S02默认关闭及真正列表的wrapper隔离',()=>{
  it.each(['--list','--list=true'])('列表%s先短路，连双门都不读取',flag=>{const f=entry([flag],{},true);expect(f.reads).toEqual([]);expect(f.loads).toEqual(['@playwright/test']);expect(f.skip).toHaveBeenCalledOnce();});
  it.each([['0','0'],['0','1'],['1','0']])('默认双门%s/%s不读取认证或加载live', (integration,specific)=>{const f=entry([],{DBARK_INTEGRATION_ENABLED:integration,DBARK_S02_SERVER_MONITOR_UI_TEST:specific});expect(f.loads).toEqual(['@playwright/test']);expect(f.register).not.toHaveBeenCalled();});
  it('双门全开也先验证显式RAM目标，正确目标才注册唯一live',()=>{expect(()=>entry([],{DBARK_INTEGRATION_ENABLED:'1',DBARK_S02_SERVER_MONITOR_UI_TEST:'1'})).toThrow();const f=entry([],config());expect(f.register).toHaveBeenCalledOnce();expect(f.loads).toEqual(['@playwright/test','../helpers/serverMonitorUi','./server-monitor-live']);});
  it('真实live只注册一个保留式120秒场景，媒体CLI覆盖在认证/网络前拒绝',async()=>{
    const options:unknown[]=[],budgets:number[]=[],hooks:Function[]=[],bodies:Function[]=[],retained=vi.fn(),network=vi.fn(),exit=vi.fn(),page={},application={};
    const test=Object.assign((_title:string,body:Function)=>bodies.push(body),{use:(value:unknown)=>options.push(value),setTimeout:(value:number)=>budgets.push(value),afterEach:(hook:Function)=>hooks.push(hook),describe:{configure:(value:unknown)=>options.push(value)}});
    const code=ts.transpileModule(readFileSync(new URL('../e2e/server-monitor-live.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,output:any={};
    runInNewContext(code,{exports:output,require(name:string){if(name==='mysql2/promise')return{createConnection:network};if(name==='./desktop-fixture')return{test,retainOwnedDesktopResources:retained,confirmOwnedDesktopExit:exit,ownedDesktopResources:()=>({page,application,closed:false})};if(name.endsWith('/serverMonitorUi'))return{ServerMonitorUiLifetime,assertServerMonitorUiIdentity,closeServerMonitorObserver,serverMonitorUiTaskIds};if(name.endsWith('/connection')||name.endsWith('/serverMonitorZh')||name.endsWith('/zh-CN'))return{};throw Error('注册禁止模块：'+name);}});
    const raw=config();output.registerServerMonitorUi(bindServerMonitorUiTarget(()=>raw,{...raw}));expect(budgets).toEqual([120000]);expect(options).toEqual([{trace:'off',screenshot:'off',video:'off',preserveOnUnconfirmedExit:true},{retries:0}]);expect(bodies).toHaveLength(1);expect(hooks).toHaveLength(1);
    await expect(bodies[0]({trace:'on',screenshot:'off',video:'off'},{_startWallTime:Date.now(),timeout:120000,status:'passed'})).rejects.toThrow('禁止');expect(network).not.toHaveBeenCalled();expect(exit).not.toHaveBeenCalled();expect(retained).toHaveBeenCalledOnce();
  });
});
