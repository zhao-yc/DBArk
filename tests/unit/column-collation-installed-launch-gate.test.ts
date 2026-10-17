import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { bindColumnCollationInstalledTarget as bind } from '../helpers/columnCollationInstalledUi';

const desktop = readFileSync(new URL('../e2e/desktop-fixture.ts',import.meta.url),'utf8');
const ui = readFileSync(new URL('../e2e/column-collation-installed-ui.ts',import.meta.url),'utf8');
const flags = ['tests/e2e/column-collation-installed.spec.ts','--workers=1','--retries=0','--repeat-each=1','--max-failures=1','--trace=off'];
const compile = (source:string) => ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;

/** 仅合成Windows配置，不读取真实环境或认证，不加载Electron与数据库驱动。 */
function environment():Record<string,string|undefined> {
  const marker='b'.repeat(32);
  return {DBARK_INTEGRATION_ENABLED:'1',DBARK_COLUMN_COLLATION_UI:'1',DBARK_COLUMN_COLLATION_KIND:'char',DBARK_COLUMN_COLLATION_MARKER:marker,DBARK_TEST_HOST:'192.168.31.200',DBARK_TEST_PORT:'13384',DBARK_TEST_TLS:'0',DBARK_TEST_USER:'RAM',DBARK_TEST_PASSWORD:'RAM未使用认证',DBARK_TEST_DATABASE:'dbark_column_collation_char_'+marker,DBARK_TEST_EXPECTED_SERVER_UUID:'11111111-1111-1111-1111-111111111111',DBARK_EXECUTABLE_PATH:'C:\\RAM\\DBArk.exe'};
}

/** 执行真实注册函数，捕获Playwright本应交给自动夹具的选项；不复制注册逻辑。 */
function registration(raw=environment()) {
  const binding=bind(()=>raw,flags,'win32'),test:any=vi.fn();test.use=vi.fn();test.describe={configure:vi.fn()};test.afterAll=vi.fn();
  const context=createContext({exports:{},require(name:string){
    if(name==='@playwright/test')return {expect};
    if(name==='node:fs/promises')return {stat:vi.fn()};
    if(name==='./desktop-fixture')return {test};
    if(name.endsWith('/zh-CN')||name.endsWith('/columnPatches.zh-CN'))return {};
    throw Error('RAM禁止加载其它模块');
  }});
  runInContext(compile(ui),context);context.exports.registerColumnCollationInstalledUi(binding);
  return {raw,binding,options:test.use.mock.calls[0][0]};
}

/** 提取原自动夹具和原launch函数；原生、目录与诊断端口均使用RAM替身。 */
function fixture(mkdir?:()=>Promise<string>) {
  const tree=ts.createSourceFile('desktop.ts',desktop,ts.ScriptTarget.Latest,true),functions:string[]=[];let auto='';
  function visit(node:ts.Node) {
    if(ts.isFunctionDeclaration(node)&&['ownedDesktopState','recordOwnedDesktopProcesses','bindOwnedDesktopExit','launchDesktop'].includes(node.name?.text??''))functions.push(node.getText(tree));
    if(ts.isPropertyAssignment(node)&&node.name.getText(tree)==='desktopLifetime'&&ts.isArrayLiteralExpression(node.initializer))auto=node.initializer.elements[0].getText(tree);
    ts.forEachChild(node,visit);
  }
  visit(tree);expect(functions).toHaveLength(4);expect(auto).not.toBe('');
  const launch=vi.fn(async()=>{throw Error('RAM原生边界拒绝，不启动应用');}),remove=vi.fn(),mkdtemp=vi.fn(mkdir??(async()=> 'C:\\RAM\\profile-new')),diagnostics=vi.fn(()=>undefined),states=new WeakMap();
  const context=createContext({exports:{},Error,AggregateError,preservedDesktopExits:states,process:{env:environment()},electron:{launch},createSnippetsNativeDiagnostics:diagnostics,snippetsDiagnosticsArmed:false,snippetsDiagnostics:undefined,pageErrors:[],dataDir:undefined,desktop:undefined,page:undefined,closed:true,mkdtemp,tmpdir:()=> 'C:\\RAM',join:(...parts:string[])=>parts.join('\\'),rm:remove});
  runInContext(compile(functions.join('\n')+'\nglobalThis.fixture='+auto+';'),context);
  const info={},body=vi.fn();
  return {launch,remove,mkdtemp,diagnostics,states,info,body,run:(options:unknown)=>context.fixture(options,body,info) as Promise<void>};
}

it('拒绝长短配置覆盖及其它未知CLI选项，固定五项支持拆分值',()=>{
  for(const extra of [['--config','alternate.ts'],['--config=alternate.ts'],['-c','alternate.ts'],['-calternate.ts'],['--project=other'],['--ui'],['--reporter=line']])expect(()=>bind(environment,[...flags,...extra],'win32')).toThrow('CLI');
  const split=flags.flatMap(value=>value.startsWith('--')?value.split('='):[value]);
  expect(()=>bind(environment,split,'win32').assertCurrent()).not.toThrow();
});

it('初始及当前快照均拒Windows大小写别名，恢复后仍永久停链',()=>{
  for(const key of ['dbark_dev_url','dBaRk_TeSt_UsEr','dbark_executable_path','ssh_auth_sock','node_extra_ca_certs']) {
    const raw=environment();raw[key]='RAM';expect(()=>bind(()=>raw,flags,'win32')).toThrow();
    delete raw[key];const binding=bind(()=>raw,flags,'win32');raw[key]='RAM';expect(()=>binding.assertCurrent()).toThrow();
    delete raw[key];expect(()=>binding.assertCurrent()).toThrow();
  }
});

it('同值C02规范别名可绑定，替换环境对象后检查当前值',()=>{
  let raw=environment();raw.DBARK_C02_EXECUTABLE_PATH=raw.DBARK_EXECUTABLE_PATH;
  const binding=bind(()=>raw,flags,'win32');binding.assertCurrent();
  raw={...raw,DBARK_C02_EXECUTABLE_PATH:'C:\\Other\\DBArk.exe'};
  expect(()=>binding.assertCurrent()).toThrow();
});

it('真实注册只给夹具检查端口，不暴露目标或认证字段',()=>{
  const registered=registration();expect(Object.keys(registered.options.ownedDesktopLaunchGuard)).toEqual(['assertCurrent']);
  expect(registered.options.ownedDesktopLaunchGuard.assertCurrent).toEqual(expect.any(Function));
  expect(registered.options).toMatchObject({preserveOnUnconfirmedExit:true,trace:'off',screenshot:'off',video:'off'});
});

it('注册后启动前漂移在分配资源之前拒绝',async()=>{
  const registered=registration(),f=fixture();registered.raw.DBARK_EXECUTABLE_PATH='C:\\Other\\DBArk.exe';
  await expect(f.run(registered.options)).rejects.toThrow('资源身份');
  expect(f.mkdtemp).not.toHaveBeenCalled();expect(f.diagnostics).not.toHaveBeenCalled();expect(f.launch).not.toHaveBeenCalled();expect(f.remove).not.toHaveBeenCalled();expect(f.body).not.toHaveBeenCalled();
});

it('目录await期间新增环境污染仍在原生launch前拒绝并保留现场',async()=>{
  let finish!:(directory:string)=>void;const pending=new Promise<string>(resolve=>{finish=resolve;}),registered=registration(),f=fixture(()=>pending);
  const running=f.run(registered.options).catch(reason=>reason);expect(f.mkdtemp).toHaveBeenCalledTimes(1);
  registered.raw.dbark_dev_url='http://RAM.invalid';finish('C:\\RAM\\profile-new');await running;
  expect(f.launch).not.toHaveBeenCalled();expect(f.remove).not.toHaveBeenCalled();expect(f.body).not.toHaveBeenCalled();
  expect(f.states.get(f.info)).toMatchObject({retained:true,active:false});
  delete registered.raw.dbark_dev_url;expect(()=>registered.binding.assertCurrent()).toThrow();
});

it('绑定不漂移的显式用例可到RAM原生边界，证明没有无条件阻断',async()=>{
  const registered=registration(),f=fixture();await f.run(registered.options).catch(()=>{});
  expect(f.launch).toHaveBeenCalledTimes(1);expect(f.launch.mock.calls[0]).toMatchObject([{executablePath:'C:\\RAM\\DBArk.exe'}]);
  expect(f.remove).not.toHaveBeenCalled();expect(f.body).not.toHaveBeenCalled();
});

it('原strict用例未设置检查端口时保持原启动行为',async()=>{
  const f=fixture();await f.run({trace:'off',preserveOnUnconfirmedExit:true}).catch(()=>{});
  expect(f.mkdtemp).toHaveBeenCalledTimes(1);expect(f.launch).toHaveBeenCalledTimes(1);expect(f.remove).not.toHaveBeenCalled();
});
