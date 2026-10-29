import { sidebarMenuRamPort, navigationMenuRamPort } from '../helpers/sidebarMenuRamPort';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { tableDropZh } from '../../src/renderer/locales/tableDrop.zh-CN';
import { objectUri } from '../../src/shared/workbench';
const source=readFileSync(new URL('../e2e/table-drop-live.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

/** 运行真实正式用例模块；页面、观察连接、注册及清理均为RAM端口，没有导入实库/GUI。 */
function fixture(){
 const info={id:'本例'},application={},nextApplication={};let activeInfo=info,retained=false,closed=false,globalReads=0,run!:()=>Promise<void>;
 const ui:string[]=[],nextUi:string[]=[],sql:string[]=[],confirmations:string[]=[],fills:string[]=[];
 const firstUi=deferred<void>(),releaseUi=deferred<void>();let pauseUi=false;
 function locator(log:string[],label=''){
  const value:any={locator:(name:string)=>locator(log,name),filter:()=>value,getByRole:(_role:string,options:{name?:string}={})=>locator(log,String(options.name??'')),getByText:(name:string)=>locator(log,name),getByLabel:(name:string)=>locator(log,name)};
  for(const action of['focus','click','check','fill'])value[action]=async(text?:string)=>{log.push(action+':'+label);if(action==='fill'){fills.push(text!);if(label===tableDropZh.confirmation)confirmations.push(text!);}if(pauseUi){pauseUi=false;firstUi.resolve();await releaseUi.promise;}};
  return value;
 }
 const oldPage={locator:(name:string)=>locator(ui,name),getByRole:(_role:string,options:{name?:string}={})=>locator(ui,String(options.name??'')),keyboard:{press:async(value:string)=>{ui.push('key:'+value);}},evaluate:async(fn:Function)=>fn.toString().includes('connections.list')?[{id:'connection',host:'192.168.31.200',port:13384}]:[{kind:'schema.tableDrop.apply'}]};
 const nextPage={locator:(name:string)=>locator(nextUi,name),getByRole:(_role:string,options:{name?:string}={})=>locator(nextUi,String(options.name??''))};
 let currentPage:any=oldPage,currentApplication:any=application;
 const lost=Error('本例owner已失效'),retain=vi.fn(()=>{retained=true;}),exit=vi.fn(async()=>{}),end=vi.fn(async()=>{}),cleanup=vi.fn(async()=>{});
 const observer={query:vi.fn(async(statement:string)=>{sql.push(statement);if(statement.startsWith('SELECT @@version'))return[[{version:'8.4.11',os:'Linux',names:0,uuid:'00000000-0000-0000-0000-000000000001'}]];if(statement.startsWith('SELECT id'))return[[{id:1}]];return[[]];}),end};
 const test=Object.assign((title:string,body:(input:{},info:unknown)=>Promise<void>)=>{run=()=>body({},info);},{use:vi.fn()});
 const desktop:any={test,expect:(value:unknown)=>{const assertion:any=expect(value);for(const method of['toHaveCount','toBeEnabled','toBeDisabled','toContainText','toBeVisible'])assertion[method]=async()=>{};return assertion;},ownedDesktopResources:(ownerInfo:unknown)=>{if(ownerInfo!==activeInfo||retained)throw lost;return{page:currentPage,application:currentApplication,closed};},retainOwnedDesktopResources:retain,confirmOwnedDesktopExit:exit,quitDesktop:exit};
 Object.defineProperty(desktop,'page',{get:()=>{globalReads++;return currentPage;}});
 const exports:any={},context=createContext({exports,process:{platform:'win32'},require(name:string){
    // 对象树菜单是显式RAM展示依赖，不加载Playwright或计作原生/认证模块。
    if (name === './sidebar-menu') return sidebarMenuRamPort;
    if (name === './navigation-menu') return navigationMenuRamPort;
  if(name==='./desktop-fixture')return desktop;
  if(name==='./live-helpers')return{environment:{DBARK_TEST_HOST:'192.168.31.200',DBARK_TEST_PORT:13384,DBARK_TEST_EXPECTED_SERVER_UUID:'00000000-0000-0000-0000-000000000001'},isolatedDatabase:async(body:Function)=>{await body({connectionId:'connection',connectionName:'RAM连接',database:'dbark_e2e_ram',observer});}};
  if(name==='../../src/renderer/locales/tableDrop.zh-CN')return{tableDropZh};
  if(name==='../helpers/tableDropTarget')return{assertTableDropLiveTarget:()=>{}};
  if(name==='../../src/shared/workbench')return{objectUri};throw Error('禁止真实导入：'+name);
 }});
 runInContext(compiled,context);exports.registerTableDropUiTests();
 return{run:()=>run(),observer,ui,nextUi,sql,confirmations,fills,retain,exit,end,cleanup,lost,firstUi,releaseUi,
  pause:()=>{pauseUi=true;},lose:()=>{activeInfo={id:'下一例'};currentPage=nextPage;currentApplication=nextApplication;},rebind:()=>{currentPage=nextPage;currentApplication=nextApplication;},close:()=>{closed=true;},globalReads:()=>globalReads};
}
describe('DROP正式用例显式owner与未知观察（仅RAM）',()=>{
 it('正例：稳定owner完成原5条观察SQL、准确确认和手填旧URI，全程不读取全局page',async()=>{
  const f=fixture();await f.run();expect(f.observer.query).toHaveBeenCalledTimes(5);expect(f.sql.filter(value=>value.startsWith('CREATE TABLE'))).toHaveLength(1);expect(f.sql.filter(value=>value.startsWith('INSERT INTO'))).toHaveLength(1);
  expect(f.confirmations).toEqual(['dbark_e2e_ram.subject ','dbark_e2e_ram.subject']);expect(f.fills).toContain(objectUri({connectionId:'connection',database:'dbark_e2e_ram',kind:'table',name:'subject'}));expect(f.globalReads()).toBe(0);expect(f.nextUi).toEqual([]);expect(f.retain).not.toHaveBeenCalled();expect(f.exit).not.toHaveBeenCalled();
 });
 it.each(['lose','rebind']as const)('首个UI等待后%s，不操作下一页面，也不进入后续观察SQL',async mode=>{
  const f=fixture();f.pause();const pending=f.run().catch(error=>error);await f.firstUi.promise;f[mode]();f.releaseUi.resolve();const error=await pending;
  expect(error.name).toBe('Error');expect(error.message).toMatch(/owner已失效|归属已变化/);expect(f.nextUi).toEqual([]);expect(f.confirmations).toEqual([]);expect(f.observer.query).toHaveBeenCalledTimes(3);expect(f.exit).not.toHaveBeenCalled();expect(f.end).not.toHaveBeenCalled();expect(f.globalReads()).toBe(0);
 });
 it('观察SQL未知保留原首因并停链，后续CREATE、INSERT、退出或清库均不执行',async()=>{
  const f=fixture(),unknown=Error('本例观察请求未知');f.observer.query.mockRejectedValueOnce(unknown);const error=await f.run().catch(reason=>reason);
  expect(error).toBe(unknown);expect(f.retain).toHaveBeenCalledTimes(1);expect(f.observer.query).toHaveBeenCalledTimes(1);expect(f.ui).toEqual([]);expect(f.nextUi).toEqual([]);expect(f.exit).not.toHaveBeenCalled();expect(f.end).not.toHaveBeenCalled();
 });
 it('观察请求发出后owner失效，迟到成功不能继续写SQL或UI',async()=>{
  const f=fixture(),pendingResult=deferred<any>(),entered=deferred<void>();f.observer.query.mockImplementationOnce(()=>{entered.resolve();return pendingResult.promise;});const pending=f.run().catch(error=>error);await entered.promise;f.lose();pendingResult.resolve([[{version:'8.4.11'}]]);const error=await pending;
  expect(error).toBe(f.lost);expect(f.retain).toHaveBeenCalledTimes(1);expect(f.observer.query).toHaveBeenCalledTimes(1);expect(f.nextUi).toEqual([]);expect(f.ui).toEqual([]);expect(f.end).not.toHaveBeenCalled();
 });
 it.each([2,3,4,5])('第%d条观察SQL未知时，包含写入及删除后核，后续链路不再继续',async index=>{
  const f=fixture(),unknown=Error('本例观察请求未知'),normal=f.observer.query.getMockImplementation()!;let calls=0;
  f.observer.query.mockImplementation(statement=>++calls===index?Promise.reject(unknown):normal(statement));
  expect(await f.run().catch(error=>error)).toBe(unknown);expect(f.retain).toHaveBeenCalledTimes(1);expect(f.observer.query).toHaveBeenCalledTimes(index);expect(f.fills).not.toContain(objectUri({connectionId:'connection',database:'dbark_e2e_ram',kind:'table',name:'subject'}));expect(f.exit).not.toHaveBeenCalled();expect(f.end).not.toHaveBeenCalled();expect(f.nextUi).toEqual([]);
 });
 it('保留标记再失败也不覆盖观察SQL原异常',async()=>{
  const f=fixture(),unknown=Error('原观察失败');f.observer.query.mockRejectedValueOnce(unknown);f.retain.mockImplementationOnce(()=>{throw Error('标记错误');});expect(await f.run().catch(error=>error)).toBe(unknown);expect(f.observer.query).toHaveBeenCalledTimes(1);expect(f.exit).not.toHaveBeenCalled();
 });
 it('已关闭的同例页面在首个UI/观察请求之前停链',async()=>{
  const f=fixture();f.close();await expect(f.run()).rejects.toThrow('关闭');expect(f.observer.query).not.toHaveBeenCalled();expect(f.ui).toEqual([]);expect(f.retain).toHaveBeenCalledTimes(1);
 });
 it('源码所有关键await后立即重核，SQL只通过observe提交且保留原正式身份',()=>{
  const tree=ts.createSourceFile('table-drop-live.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let awaited=0,queries=0;
  const visit=(node:ts.Node)=>{if(ts.isAwaitExpression(node)&&!(ts.isCallExpression(node.expression)&&node.expression.expression.getText(tree)==='isolatedDatabase')){
   let statement:ts.Node=node;while(statement.parent&&!ts.isStatement(statement))statement=statement.parent;const block=statement.parent;
   if(ts.isBlock(block)){const index=block.statements.indexOf(statement as ts.Statement),next=block.statements[index+1];expect(next?.getText(tree)).toBe('owner.assertCurrent();');awaited++;}
  }if(ts.isCallExpression(node)&&node.expression.getText(tree)==='context.observer.query'){queries++;expect(ts.isArrowFunction(node.parent)).toBe(true);expect(node.parent.parent.getText(tree)).toMatch(/^observe\(owner,/);}ts.forEachChild(node,visit);};visit(tree);
  expect(awaited).toBeGreaterThan(20);expect(queries).toBe(5);expect(source).toContain("test('单表删除真实入口先预览与准确确认，观察目录消失、关闭旧标签且拒绝旧URI导航'");expect(source).not.toMatch(/clipboard\.|quitDesktop\(|confirmOwnedDesktopExit\(/);
 });
});
