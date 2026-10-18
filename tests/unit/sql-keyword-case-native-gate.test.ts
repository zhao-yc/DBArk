import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import ts from'typescript';import{describe,expect,it,vi}from'vitest';
import * as gate from'../e2e/sql-keyword-case-native-gate';
import{bindEditorIndentNativeCase}from'../e2e/editor-indentation-native-gate';
import * as fixture from'../helpers/sqlKeywordCaseNativeFixture';
const source=readFileSync(new URL('../e2e/sql-keyword-case-native.spec.ts',import.meta.url),'utf8');
const allowed=()=>({DBARK_SQL_KEYWORD_CASE_NATIVE_TEST:'1',DBARK_INTEGRATION_ENABLED:'0',DBARK_SQL_KEYWORD_CASE_MANIFEST:'C:/RAM-keyword-approved.json',DBARK_SQL_KEYWORD_CASE_MANIFEST_SHA256:'a'.repeat(64)});
/** 仅转译正式spec并登记回调；运行时、随机数及原生入口都是拒绝执行的RAM哨兵。 */
function declaration(env:NodeJS.ProcessEnv,args:string[]=[],info:any={_startWallTime:0,timeout:120000,status:'passed'}){
  const callbacks:Function[]=[],hooks:Function[]=[],modules:string[]=[],skip=vi.fn(),use=vi.fn(),configure=vi.fn(),create=vi.fn(()=>{throw Error('禁止原生运行');}),random=vi.fn(()=>{throw Error('声明阶段禁止随机操作');});
  const test=Object.assign((_title:string,body:Function)=>callbacks.push(body),{skip,use,afterEach:(body:Function)=>hooks.push(body),info:()=>info,describe:{configure}});
  const require=(name:string)=>{modules.push(name);if(name==='@playwright/test')return{test,expect};if(name==='node:crypto')return{randomUUID:random};if(name==='./sql-keyword-case-native-gate')return gate;if(name==='../helpers/sqlKeywordCaseNativeFixture')return fixture;if(name==='./editor-indentation-native-gate')return{bindEditorIndentNativeCase:(value:any,environment:any,current:any)=>bindEditorIndentNativeCase(value,environment,current,()=>0)};if(name==='./editor-indentation-native-runtime')return{createEditorIndentNativeRun:create};if(name.includes('/locales/'))return{};throw Error('不允许加载模块：'+name);};
  runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:{},require,process:{env,argv:args,platform:'win32'},WeakMap,Buffer,Error,AggregateError});return{callbacks,hooks,modules,skip,use,configure,create,random,info};
}
describe('关键字原生准备的声明及权限护栏（非Playwright运行）',()=>{
  it('默认关闭及RAM模拟list均登记两例，凭据getter不读、native运行时不加载',()=>{
    for(const args of[[],['--list'],['--list=true']]){const env:NodeJS.ProcessEnv=args.length?allowed():{};Object.defineProperty(env,'DBARK_TEST_PASSWORD',{enumerable:true,get(){throw Error('禁止读取凭据');}});const d=declaration(env,args);expect(d.callbacks).toHaveLength(2);expect(d.skip.mock.calls[0][0]).toBe(true);expect(d.modules.some(name=>/runtime|owner|node:fs|node:net/.test(name))).toBe(false);expect(d.create).not.toHaveBeenCalled();expect(d.random).not.toHaveBeenCalled();expect(d.use).toHaveBeenCalledWith({trace:'off',screenshot:'off',video:'off'});expect(d.configure).toHaveBeenCalledWith({mode:'serial',retries:0,timeout:120000});}
  });
  it('list优先于所有环境getter，不因显式原生门或脏环境加载live模块',()=>{
    const env=new Proxy({}as NodeJS.ProcessEnv,{get(){throw Error('list不应读任何环境值');}});const d=declaration(env,['--list']);expect(d.callbacks).toHaveLength(2);expect(d.modules.some(name=>/runtime|owner/.test(name))).toBe(false);
  });
  it('分栏门空值和CLI交互参数等号形式也须在live加载前拒绝',()=>{
    expect(()=>declaration({...allowed(),DBARK_QUERY_LAYOUT_NATIVE_TEST:''})).toThrow();
    for(const args of [['--ui=true'],['--debug=true']])expect(()=>declaration(allowed(),args)).toThrow();
  });
  it.each([{DBARK_INTEGRATION_ENABLED:'1'},{DBARK_EDITOR_INDENT_NATIVE_TEST:'1'},{DBARK_EDITOR_INDENT_MANIFEST:'C:/other.json'},{DBARK_QUERY_LAYOUT_NATIVE_TEST:'1'},{DBARK_QUERY_LAYOUT_MANIFEST:'C:/other.json'},{DBARK_TEST_PASSWORD:''},{DBARK_USER_DATA:'C:/user'},{DBARK_DEV_URL:'http://invalid'},{dbark_sql_keyword_case_native_test:'1'},{NODE_OPTIONS:''}])('显式激活拒绝危险环境%j且在runtime加载前停链',patch=>{
    expect(()=>declaration({...allowed(),...patch})).toThrow();
  });
  it.each([['--config','other.ts'],['-cother.ts'],['--ui'],['--debug'],['--trace=on'],['--trace','retain-on-failure']].map(args=>({args})))('拒绝替换配置或录制参数%j',({args})=>{expect(()=>gate.assertSqlKeywordCaseNativeEnvironment(allowed(),args,'win32')).toThrow();});
  it('清单漂移后恢复原值也不复活，原120秒和TestInfo墓碑保持',()=>{
    const env=allowed(),environment=gate.bindSqlKeywordCaseNativeEnvironment(()=>({env,args:[],platform:'win32'}));env.DBARK_SQL_KEYWORD_CASE_MANIFEST_SHA256='b'.repeat(64);expect(()=>environment.assertCurrent()).toThrow();env.DBARK_SQL_KEYWORD_CASE_MANIFEST_SHA256='a'.repeat(64);expect(()=>environment.assertCurrent()).toThrow();
    let now=1;const info={_startWallTime:0,timeout:120000,status:'passed'},scope=bindEditorIndentNativeCase(info,{assertCurrent(){}},()=>info,()=>now);scope.assertCurrent();now=120000;expect(()=>scope.assertCurrent()).toThrow();now=2;expect(()=>scope.assertCurrent()).toThrow();
  });
  it('实际回调先拒绝录制与错误原预算，不调用任何运行时或端口',async()=>{
    const first=declaration(allowed());await expect(first.callbacks[0]({trace:'on',screenshot:'off',video:'off'},first.info)).rejects.toThrow();expect(first.create).not.toHaveBeenCalled();
    const second=declaration(allowed(),[],{_startWallTime:0,timeout:119999,status:'passed'});await expect(second.callbacks[0]({trace:'off',screenshot:'off',video:'off'},second.info)).rejects.toThrow();expect(second.create).not.toHaveBeenCalled();
  });
  it('原afterEach墓碑拒绝同TestInfo迟到操作，下一TestInfo不能借旧授权',()=>{
    const original={_startWallTime:0,timeout:120000,status:'passed'};let current=original;
    const scope=bindEditorIndentNativeCase(original,{assertCurrent(){}},()=>current,()=>1);scope.assertCurrent();scope.retain();expect(()=>scope.assertCurrent()).toThrow();
    const next=bindEditorIndentNativeCase(original,{assertCurrent(){}},()=>current,()=>1);current={...original};expect(()=>next.assertCurrent()).toThrow();current=original;expect(()=>next.assertCurrent()).toThrow();
  });
  it('正式spec只以键盘输入与真实面板操作，不写store/模型/执行入口或新增强制清理',()=>{
    // 对正式可执行代码检查，保留说明禁止动作的中文注释不会触发假阳性。
    const executable=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,removeComments:true}}).outputText;
    expect(executable).not.toMatch(/useWorkspace|Zustand|\.setValue\(|\.setPosition\(|executeEdits\(|runAction\(|dispatchEvent\(|query\.execute|query\.exportStream|process\.kill|taskkill|\.rm\(/);
    expect(source).toContain("keyboard.press('Alt+Shift+F')");expect(source).toContain('runtime!.createEditorIndentNativeRun(scope, approval!)');expect(source).toContain('await run.close(first)');expect(source).toContain('await run.close(second); await run.finish()');expect(source).toContain('expect(disk.schema).toBe(9)');expect(source).toContain('cases.get(info)?.retain()');
  });
});
