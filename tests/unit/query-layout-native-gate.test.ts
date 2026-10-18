import { attachNativeStartupDiagnostics } from '../e2e/editor-native-startup-diagnostics';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';
import * as gate from '../e2e/query-layout-native-gate';
import {bindEditorIndentNativeCase} from '../e2e/editor-indentation-native-gate';
import {EditorIndentNativeRun,type IndentNativePort} from '../e2e/editor-indentation-native-owner';
import * as viewport from '../e2e/query-layout-native-viewport';
const source=readFileSync(new URL('../e2e/query-layout-native.spec.ts',import.meta.url),'utf8');
const viewportSource=readFileSync(new URL('../e2e/query-layout-native-viewport.ts',import.meta.url),'utf8');
const allowed=()=>({DBARK_QUERY_LAYOUT_NATIVE_TEST:'1',DBARK_INTEGRATION_ENABLED:'0',DBARK_QUERY_LAYOUT_MANIFEST:'C:/RAM-layout-approved.json',DBARK_QUERY_LAYOUT_MANIFEST_SHA256:'a'.repeat(64)});
/** 真spec声明仅登记回调，runtime哨兵不会创建原生模块；所有环境是显式RAM对象。 */
function declaration(env:NodeJS.ProcessEnv,args:string[]=[],create=vi.fn(()=>{throw Error('未提供RAM runtime');}),info:any={_startWallTime:0,timeout:120000,status:'passed',attach:vi.fn(async()=>{})},clock={now:0}){
 const callbacks:Function[]=[],hooks:Function[]=[],modules:string[]=[],skip=vi.fn(),use=vi.fn(),configure=vi.fn();const test=Object.assign((_title:string,body:Function)=>callbacks.push(body),{skip,use,afterEach:(fn:Function)=>hooks.push(fn),info:()=>info,describe:{configure}});
 // 场景helper是无顶层资源操作的真实纯模块；窗口/文件/网络仍不能在声明阶段取得。
 const require=(name:string)=>{modules.push(name);if(name==='@playwright/test')return {test,expect};if(name==='./query-layout-native-gate')return gate;if(name==='./query-layout-native-viewport')return viewport;if(name==='./editor-indentation-native-gate')return {bindEditorIndentNativeCase:(original:any,environment:any,current:any)=>bindEditorIndentNativeCase(original,environment,current,()=>clock.now)};if(name==='./editor-indentation-native-runtime')return {attachNativeStartupDiagnostics,createEditorIndentNativeRun:create};if(name.includes('/locales/'))return {};throw Error('不允许加载模块:'+name);};
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:{},require,process:{env,argv:args,platform:'win32'},WeakMap,Buffer,Error,AggregateError});return {callbacks,hooks,modules,skip,use,configure,create,info,clock};
}
it('默认关闭和RAM模拟list均只登记一例，脏环境不加载runtime/owner/native模块',()=>{
 for(const [env,args]of [[{DBARK_TEST_PASSWORD:'RAM禁止'},[]],[{...allowed(),DBARK_DEV_URL:'RAM禁止'},['--list']],[{...allowed(),DBARK_INTEGRATION_ENABLED:'1'},['--list=true']]]as[NodeJS.ProcessEnv,string[]][]){const d=declaration(env,args);expect(d.callbacks).toHaveLength(1);expect(d.skip.mock.calls[0][0]).toBe(true);expect(d.modules.some(name=>/runtime|owner|node:fs|node:net/.test(name))).toBe(false);expect(d.create).not.toHaveBeenCalled();expect(d.use).toHaveBeenCalledWith({trace:'off',screenshot:'off',video:'off'});expect(d.configure).toHaveBeenCalledWith({mode:'serial',retries:0,timeout:120000});}
});
it('新门独立manifest，旧门必须关且不接受旧清单或危险环境别名',()=>{
 expect(()=>gate.assertQueryLayoutNativeEnvironment(allowed(),[],'win32')).not.toThrow();expect(()=>gate.assertQueryLayoutNativeEnvironment({...allowed(),DBARK_EDITOR_INDENT_NATIVE_TEST:'0'},[],'win32')).not.toThrow();
 for(const value of [undefined,'','1','false'])expect(()=>gate.assertQueryLayoutNativeEnvironment({...allowed(),DBARK_INTEGRATION_ENABLED:value},[],'win32')).toThrow('integration');
 for(const field of ['DBARK_DEV_URL','DBARK_USER_DATA','NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE','DBARK_TEST_HOST','DBARK_AUTH_TOKEN','DBARK_SSH_KEY','DBARK_MTLS_KEY','DBARK_C02_HOST','dbark_query_layout_native_test','DBARK_EDITOR_INDENT_MANIFEST','DBARK_EDITOR_INDENT_MANIFEST_SHA256'])expect(()=>gate.assertQueryLayoutNativeEnvironment({...allowed(),[field]:''},[],'win32')).toThrow();
 expect(()=>gate.assertQueryLayoutNativeEnvironment({...allowed(),DBARK_EDITOR_INDENT_NATIVE_TEST:'1'},[],'win32')).toThrow('旧缩进');
 expect(()=>gate.assertQueryLayoutNativeEnvironment({...allowed(),DBARK_QUERY_LAYOUT_MANIFEST:'relative.json'},[],'win32')).toThrow('清单');expect(()=>gate.assertQueryLayoutNativeEnvironment({...allowed(),DBARK_QUERY_LAYOUT_MANIFEST_SHA256:'bad'},[],'win32')).toThrow('清单');
 const mac={...allowed(),DBARK_QUERY_LAYOUT_MANIFEST:'/RAM/approved.json'};expect(()=>gate.assertQueryLayoutNativeEnvironment(mac,[],'darwin')).not.toThrow();expect(()=>gate.assertQueryLayoutNativeEnvironment(mac,[],'linux')).toThrow('Windows/macOS');
});
it('安装别名及CLI规则沿原门保持，实际录制选项先于runtime资源创建拒绝',async()=>{
 const env={...allowed(),DBARK_EXECUTABLE_PATH:'C:/RAM/App.exe',DBARK_C02_EXECUTABLE_PATH:'C:/RAM/App.exe'};expect(()=>gate.assertQueryLayoutNativeEnvironment(env,['--trace=off'],'win32')).not.toThrow();expect(()=>gate.assertQueryLayoutNativeEnvironment({...env,DBARK_C02_EXECUTABLE_PATH:'C:/other.exe'},[],'win32')).toThrow();
 for(const args of [['--trace','on'],['--trace'],['--trace=retain-on-failure'],['--config=other.ts'],['-cother.ts'],['--ui'],['--debug']])expect(()=>gate.assertQueryLayoutNativeEnvironment(allowed(),args,'win32')).toThrow();
 const d=declaration(allowed());for(const options of [{trace:'on',screenshot:'off',video:'off'},{trace:'off',screenshot:'on',video:'off'},{trace:'off',screenshot:'off',video:'on'}])await expect(d.callbacks[0](options,d.info)).rejects.toThrow();expect(d.create).not.toHaveBeenCalled();
});
it('独立manifest配置观察到漂移后恢复也不能复活',()=>{const env:NodeJS.ProcessEnv=allowed(),binding=gate.bindQueryLayoutNativeEnvironment(()=>({env,args:[],platform:'win32'}));binding.assertCurrent();env.DBARK_QUERY_LAYOUT_MANIFEST_SHA256='b'.repeat(64);expect(()=>binding.assertCurrent()).toThrow('漂移');env.DBARK_QUERY_LAYOUT_MANIFEST_SHA256='a'.repeat(64);expect(()=>binding.assertCurrent()).toThrow('已失效');});
it.each(['deadline','afterEach','normal']as const)('新case复用原TestInfo期限和%s收尾，不换owner控制器',async mode=>{
 let entered!:()=>void,release!:()=>void;const start=new Promise<void>(yes=>{entered=yes;}),waiting=new Promise<void>(yes=>{release=yes;}),stop=Error('RAM准备停止');
 const port:IndentNativePort={assertCurrent(){},preflight:async()=>{entered();await waiting;},directory:vi.fn(async()=>'/RAM/dbark-indent-owned'),assertDirectory:async()=>{},launch:vi.fn(async()=>({application:{},page:{},ids:new Set(),closed:false,confirmed:false,ready:false,errors:[],quitReady:Promise.resolve()})as any),prepare:async()=>{throw stop;},record:async()=>[101],quit:async()=>{},absent:async()=>{},remove:async()=>{}};
 const run=new EditorIndentNativeRun(port),create=vi.fn((binding:any,approval:any)=>{expect(approval).toEqual({manifestPath:allowed().DBARK_QUERY_LAYOUT_MANIFEST,approvedHash:allowed().DBARK_QUERY_LAYOUT_MANIFEST_SHA256});port.assertCurrent=()=>binding.assertCurrent();return run;})as any,d=declaration(allowed(),[],create),pending=d.callbacks[0]({trace:'off',screenshot:'off',video:'off'},d.info).catch((error:any)=>error);await start;
 if(mode==='deadline')d.clock.now=120000;if(mode==='afterEach')d.hooks[0]({},d.info);release();const result=await pending;if(mode==='normal'){expect(result).toBe(stop);expect(port.launch).toHaveBeenCalledOnce();}else{expect(result).toBeInstanceOf(Error);expect(result).not.toBe(stop);expect(port.directory).not.toHaveBeenCalled();expect(port.launch).not.toHaveBeenCalled();}expect(d.info._startWallTime).toBe(0);expect(d.info.timeout).toBe(120000);
});
it('真实case只有只读IPC及正式键鼠/窗口API，种子为无前导缩进的真实多行',()=>{
 const tree=ts.createSourceFile('spec.ts',source,ts.ScriptTarget.Latest,true),commands:string[]=[];let seed='';function visit(n:ts.Node){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='invoke'){expect(ts.isStringLiteral(n.arguments[0])).toBe(true);commands.push((n.arguments[0]as ts.StringLiteral).text);}if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='value'&&n.initializer?.getText(tree).startsWith('[`SELECT'))seed=n.initializer.getText(tree);ts.forEachChild(n,visit);}visit(tree);expect(commands.sort()).toEqual(['history.list','queries.list','settings.get','tasks.list']);
 const value=runInNewContext(seed,{label:'RAM'});expect(value.split('\n')).toHaveLength(46);expect(value.split('\n').every((line:string)=>line.length>0&&!/^\s/.test(line))).toBe(true);
 expect(source).not.toMatch(/desktop-fixture|\.setValue\(|\.setModel\(|\.updateOptions\(|\.executeEdits\(|\.setSelections?\(|setState\(|clipboard\.|\.screenshot\(|settings\.save|query\.execute/);
 // 原窗口尺寸接线移入官方API helper；同时核实际调用和helper，不能仅出现未调用的同名文本。
 expect(source).toContain('handle.evaluate(resizeQueryLayoutNativeViewport,');expect(viewportSource).toContain('window.setContentSize(Math.ceil(input.width * scale), Math.ceil(input.height * scale))');expect(source).toContain('expect(disk.schema).toBe(8)');expect(source).toContain('await run.close(first)');expect(source).toContain('await run.close(second); await run.finish()');
});
