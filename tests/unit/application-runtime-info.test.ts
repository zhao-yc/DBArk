import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { publicCommands, isUiCommandInvocation } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';
import baseline from '../fixtures/application-info-v028-baseline.json';

const source=readFileSync(new URL('../../src/main/index.ts',import.meta.url),'utf8').replaceAll('\r\n','\n');
const tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true),hash=(value:string)=>createHash('sha256').update(value).digest('hex');
/** 只运行实际Main分支；所有系统API均为RAM端口，不导入Electron或Main模块。 */
function clause(command:string){let found:ts.CaseClause|undefined;function visit(node:ts.Node){if(ts.isCaseClause(node)&&node.expression.getText(tree)==="'"+command+"'")found=node;ts.forEachChild(node,visit);}visit(tree);if(!found)throw Error('实际Main分支缺失');return found;}
function main(command:string,scope:object){const exports:any={};runInNewContext(ts.transpileModule('exports.run=function(){'+clause(command).statements.map(node=>node.getText(tree)).join('\n')+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,...scope});return exports.run as()=>any;}

it('新旧命令保持白名单及严格空输入，元信息不能夹带探测、路径或秘密参数',()=>{
  expect(publicCommands['app.runtimeInfo']).toBe(true);expect(publicCommands['app.info']).toBe(true);expect(validateCommand('app.runtimeInfo',{})).toEqual({});
  for(const value of [undefined,null,[],0,true,'',{probe:true},{encryptionAvailable:false},{filePath:'外部路径'},{sql:'SELECT 1'},{extra:undefined}])expect(()=>validateCommand('app.runtimeInfo',value)).toThrow();
});
it('Root28 App使用已审hook，启动不调用加密检测，原SQL格式偏好仍在',()=>{
  const app=readFileSync(new URL('../../src/renderer/App.tsx',import.meta.url),'utf8');expect(app).toContain('useApplicationInfo(bundledVersion)');expect(app).toContain('onCheck={checkEncryption}');expect(app).not.toContain("invoke('app.info'");expect(app).toContain('<SqlKeywordCasePreferences/>');
  const hook=readFileSync(new URL('../../src/renderer/useApplicationInfo.ts',import.meta.url),'utf8'),parsed=ts.createSourceFile('hook.ts',hook,ts.ScriptTarget.Latest,true),effects:string[]=[];let checks=0;
  function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(parsed)==='useEffect')effects.push(node.arguments[0].getText(parsed));if(ts.isCallExpression(node)&&node.expression.getText(parsed)==='checkEncryption')checks++;ts.forEachChild(node,visit);}visit(parsed);expect(effects).toHaveLength(1);expect(effects[0]).toContain("invoke('app.runtimeInfo'");expect(effects[0]).not.toContain("invoke('app.info'");expect(checks).toBe(0);
});
it.each(['darwin','win32','linux'])('%s重复元信息只读三个Main属性，safeStorage零读取',platform=>{
  const order:string[]=[],crypto=vi.fn(()=>{throw Error('禁止系统保护器访问');});
  const run=main('app.runtimeInfo',{app:{getVersion(){order.push('version');return baseline.version;},getPath(name:string){order.push(name);return'RAM/本例';}},process:{get platform(){order.push('platform');return platform;}},safeStorage:new Proxy({},{get:crypto})});
  for(let count=0;count<20;count++)expect(run()).toEqual({version:baseline.version,platform,dataPath:'RAM/本例'});expect(order).toEqual(Array.from({length:20},()=>['version','platform','userData']).flat());expect(crypto).not.toHaveBeenCalled();
});
it.each(['version','platform','path'])('元信息%s错误保持原对象，不回退加密检测',stage=>{
  const failure=Error('原元信息错误'),crypto=vi.fn(),run=main('app.runtimeInfo',{app:{getVersion(){if(stage==='version')throw failure;return baseline.version;},getPath(){if(stage==='path')throw failure;return'RAM';}},process:{get platform(){if(stage==='platform')throw failure;return'darwin';}},safeStorage:new Proxy({},{get:crypto})});
  let caught:unknown;try{run();}catch(reason){caught=reason;}expect(caught).toBe(failure);expect(crypto).not.toHaveBeenCalled();
});
it('452850a原单行app.info及真实凭据尾部保持，不移植R23标记或版本证据',()=>{
  expect(baseline.revision).toBe('452850ab472c028377339c53331e451b949be180');expect(baseline.version).toBe('0.28.0');expect(hash(clause('app.info').getText(tree))).toBe(baseline.appInfoCaseSha256);
  expect(source).not.toContain('nativeStartupInfoMarker');const desktop=readFileSync(new URL('../e2e/desktop.spec.ts',import.meta.url),'utf8').replaceAll('\r\n','\n');
  // 连接现在是严格判别联合；仅剥离两处已审网络收窄，原凭据流程仍逐字核对旧基线。
  const tail = desktop.slice(desktop.indexOf("test('系统加密可用时"));
  const profileGuard = ".then(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; })";
  const profilesGuard = ".then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }))";
  for (const guard of [profileGuard, profilesGuard]) expect(tail.split(guard)).toHaveLength(2);
  expect(hash(tail.replace(profileGuard, '').replace(profilesGuard, ''))).toBe(baseline.desktopCredentialTailSha256);
});
it.each([true,false])('Root28原app.info保持boolean=%s、原同步顺序及一次真实能力调用',available=>{
  const order:string[]=[],native=vi.fn(()=>{order.push('crypto');return available;});const run=main('app.info',{app:{getVersion(){order.push('version');return baseline.version;},getPath(name:string){expect(name).toBe('userData');order.push('path');return'RAM';}},process:{get platform(){order.push('platform');return'darwin';}},safeStorage:{isEncryptionAvailable:native}});
  expect(run()).toEqual({version:baseline.version,platform:'darwin',encryptionAvailable:available,dataPath:'RAM'});expect(order).toEqual(['version','platform','crypto','path']);expect(native).toHaveBeenCalledOnce();
});
it.each(['version','platform','crypto','path'])('Root28原app.info在%s保留原错误及前缀调用，不伪造false',stage=>{
  const order:string[]=[],failure=Error('原保护路径错误'),step=(key:string,value:unknown)=>{order.push(key);if(key===stage)throw failure;return value;};
  const run=main('app.info',{app:{getVersion:()=>step('version',baseline.version),getPath:()=>step('path','RAM')},process:{get platform(){return step('platform','darwin');}},safeStorage:{isEncryptionAvailable:()=>step('crypto',true)}});let caught:unknown;try{run();}catch(reason){caught=reason;}expect(caught).toBe(failure);expect(order).toEqual(['version','platform','crypto','path'].slice(0,['version','platform','crypto','path'].indexOf(stage)+1));
});
it('实际preload只透传新白名单，原app.info错误消息保持',async()=>{
  let api:any;const request=vi.fn(async()=>({ok:true,result:{version:baseline.version,platform:'darwin',dataPath:'RAM'}} as any));const preload=readFileSync(new URL('../../src/main/preload.ts',import.meta.url),'utf8');
  runInNewContext(ts.transpileModule(preload,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:{},require(name:string){if(name==='electron')return{contextBridge:{exposeInMainWorld(_name:string,value:unknown){api=value;}},ipcRenderer:{invoke:request}};if(name==='../shared/commands')return{publicCommands,isUiCommandInvocation};throw Error('禁止其它preload依赖');}});
  expect(await api.invoke('app.runtimeInfo',{})).toEqual({version:baseline.version,platform:'darwin',dataPath:'RAM'});expect(request.mock.calls[0]).toEqual(['dbark:request',{command:'app.runtimeInfo',input:{}}]);request.mockResolvedValueOnce({ok:false,error:'原保护器错误'});await expect(api.invoke('app.info',{})).rejects.toThrow('原保护器错误');
});
