import{readFileSync,readdirSync}from'node:fs';import{resolve,relative}from'node:path';import{fileURLToPath}from'node:url';import vm from'node:vm';import ts from'typescript';import{describe,expect,it,vi}from'vitest';
import{compactSqlKeywordCaseNative,sqlKeywordCaseNativeSource}from'../helpers/sqlKeywordCaseNativeFixture';
import{planSqlFormatting,prepareSqlFormattingRoles}from'../../src/renderer/sqlFormatting';
const source=readFileSync(new URL('../e2e/sql-keyword-case-native.spec.ts',import.meta.url),'utf8');
/** 只检查受控源码文本的命名引用；不冒充Electron session或第三方依赖的listener枚举。 */
function listenerReferences(files:{path:string;text:string}[]){return files.filter(file=>/\bonBeforeRequest\b/.test(file.text)).map(file=>file.path);}
/** 遍历全部src及scripts相关源码；链接或未知读取失败必须显式失败，不能静默跳过。 */
function sourceInventory(){
  const root=fileURLToPath(new URL('../../',import.meta.url)),files:{path:string;text:string}[]=[];
  const visit=(directory:string)=>{for(const item of readdirSync(directory,{withFileTypes:true})){const path=resolve(directory,item.name);if(item.isSymbolicLink())throw Error('listener前提检查不接受源码链接');if(item.isDirectory())visit(path);else if(item.isFile()&&/\.(?:[cm]?[jt]sx?|ps1|sh)$/i.test(item.name))files.push({path:relative(root,path).replaceAll('\\','/'),text:readFileSync(path,'utf8')});}};
  visit(resolve(root,'src'));visit(resolve(root,'scripts'));return files;
}
/** 提取正式恢复断言函数，RAM只提供只读settings/Monaco端口，不另写一套预期逻辑。 */
function restorationHarness(){
  const tree=ts.createSourceFile('native.ts',source,ts.ScriptTarget.Latest,true),node=tree.statements.find(value=>ts.isFunctionDeclaration(value)&&value.name?.text==='assertRestoredWorkspace');
  if(!node)throw Error('缺少正式重启身份断言');
  const saved={sqlKeywordCase:'upper',activeTabId:'first',tabs:[{id:'first',sql:'同样正文'},{id:'second',sql:'同样正文'}]},models=[{pane:0,editor:1,model:2,value:'同样正文'},{pane:1,editor:3,model:4,value:'同样正文'}];
  const actual=structuredClone(saved);let visible={...models[0]};
  const context=vm.createContext({exports:{},expect,settings:async()=>actual,snapshots:async()=>models,current:async()=>visible});
  vm.runInContext(ts.transpileModule('exports.check='+node.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return{saved,actual,models,setVisible(value:typeof visible){visible=value;},check:()=>context.exports.check({}, {}, saved, models, 'upper')};
}
/** 提取正式app.evaluate回调，仅由RAM窗口/session端口接收，不导入Electron或Playwright。 */
function gateHarness(){
  const tree=ts.createSourceFile('native.ts',source,ts.ScriptTarget.Latest,true),callbacks=new Map<string,string>();
  for(const node of tree.statements)if(ts.isFunctionDeclaration(node)&&['installKeywordCaseModuleGate','keywordCaseModuleGate'].includes(node.name?.text??'')){const visit=(value:ts.Node)=>{if(ts.isCallExpression(value)&&value.expression.getText(tree)==='owner.application.evaluate')callbacks.set(node.name!.text,value.arguments[0].getText(tree));ts.forEachChild(value,visit);};visit(node);}
  let listener:((details:any,next:(response:any)=>void)=>void)|null=null;const registrations:any[]=[],contents:any={id:7,isDestroyed:()=>false},window:any={isDestroyed:()=>false,webContents:contents};contents.session={webRequest:{onBeforeRequest(filter:any,next?:any){registrations.push([filter,next]);listener=next??null;}}};
  const context=vm.createContext({exports:{},URL,Error});vm.runInContext(ts.transpileModule(`exports.install=${callbacks.get('installKeywordCaseModuleGate')};exports.act=${callbacks.get('keywordCaseModuleGate')};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);const functions=context.exports as any;
  return{registrations,install:(nonce='RAM-owner')=>functions.install({BrowserWindow:{getAllWindows:()=>[window]}},nonce),act:(action:string,nonce='RAM-owner')=>functions.act({}, {action,nonce}),request:(url:string,id=7)=>{const reply=vi.fn();if(!listener)throw Error('没有RAM listener');listener({url,webContentsId:id},reply);return reply;},changeContents(){window.webContents={...contents};}};
}
describe('关键字原生固定预期和实际模块门（纯RAM端口）',()=>{
  it.each(['preserve','upper','lower']as const)('%s固定样例可由原planner接受，原生预期仍来自独立固定角色',async mode=>{
    await prepareSqlFormattingRoles();const input=sqlKeywordCaseNativeSource(),plan=planSqlFormatting(input,0,input.length,'\n',{keywordCase:mode});expect(plan).not.toBeNull();expect(compactSqlKeywordCaseNative(plan!.text)).toBe(compactSqlKeywordCaseNative(sqlKeywordCaseNativeSource(mode)));
  });
  it.each(["'SeLeCt🚢'","'WhErE'",'`SeLeCt`','/* FrOm stays */','-- SeLeCt remains'])('保护片段%s变化明确拒绝，不把字面量里的关键字当转换结果',fragment=>{expect(()=>compactSqlKeywordCaseNative(sqlKeywordCaseNativeSource().replace(fragment,fragment.toUpperCase()))).toThrow();});
  it('标识符大小写漂移会与独立固定预期不一致',()=>{expect(compactSqlKeywordCaseNative(sqlKeywordCaseNativeSource('upper').replace('MiXeDName','MIXEDNAME'))).not.toBe(compactSqlKeywordCaseNative(sqlKeywordCaseNativeSource('upper')));});
  it('名称内部被拆入空白不作为合法排版差异放行',()=>{expect(compactSqlKeywordCaseNative(sqlKeywordCaseNativeSource('upper').replace('MiXeDName','MiXeD Name'))).not.toBe(compactSqlKeywordCaseNative(sqlKeywordCaseNativeSource('upper')));});
  it('正式门只扣原窗口唯一file角色模块回包，释放不改载荷，完成后真实移除listener',()=>{
    const h=gateHarness();expect(h.install()).toMatchObject({held:0,delivered:0,detached:false,failed:false});expect(h.request('file:///RAM/assets/other.js')).toHaveBeenCalledWith({});expect(h.request('https://RAM/sqlFormattingRoles-a.js')).toHaveBeenCalledWith({});expect(h.request('file:///RAM/assets/sqlFormattingRoles-a.js',8)).toHaveBeenCalledWith({});
    const response=h.request('file:///RAM/assets/sqlFormattingRoles-a.js');expect(response).not.toHaveBeenCalled();expect(h.act('summary')).toMatchObject({held:1,delivered:0});expect(()=>h.act('release','other')).toThrow();h.act('release');expect(response).toHaveBeenCalledExactlyOnceWith({cancel:false});expect(h.act('detach')).toMatchObject({held:1,delivered:1,detached:true,failed:false});expect(h.registrations.at(-1)).toEqual([null,undefined]);expect(()=>h.act('summary')).toThrow();
  });
  it('没观察到、重复请求或原窗口变化都不能制造迟到成功或借新owner释放',()=>{
    const empty=gateHarness();empty.install();expect(()=>empty.act('release')).toThrow();expect(()=>empty.act('detach')).toThrow();
    const duplicate=gateHarness();duplicate.install();duplicate.request('file:///RAM/assets/sqlFormattingRoles-a.js');expect(duplicate.request('file:///RAM/assets/sqlFormattingRoles-a.js')).toHaveBeenCalledWith({cancel:true});expect(duplicate.act('summary').failed).toBe(true);expect(()=>duplicate.act('release')).toThrow();
    const changed=gateHarness();changed.install();changed.request('file:///RAM/assets/sqlFormattingRoles-a.js');changed.changeContents();expect(()=>changed.act('release')).toThrow();
    const changedBeforeRequest=gateHarness();changedBeforeRequest.install();changedBeforeRequest.changeContents();expect(changedBeforeRequest.request('file:///RAM/assets/sqlFormattingRoles-a.js')).toHaveBeenCalledWith({cancel:true});expect(()=>changedBeforeRequest.act('release')).toThrow();
  });
  it('释放后重复请求也永久失败，detach必须保留原listener和私有门线索',()=>{
    const h=gateHarness();h.install();const original=h.request('file:///RAM/assets/sqlFormattingRoles-a.js');h.act('release');
    expect(original).toHaveBeenCalledExactlyOnceWith({cancel:false});expect(h.request('file:///RAM/assets/sqlFormattingRoles-a.js')).toHaveBeenCalledWith({cancel:true});
    expect(()=>h.act('detach')).toThrow();expect(h.act('summary')).toMatchObject({held:1,delivered:1,detached:false,failed:true});
    expect(h.registrations).toHaveLength(1);expect(()=>h.install('新nonce不能覆盖旧失败门')).toThrow('原模块门仍存在');expect(original).toHaveBeenCalledOnce();
  });
  it('重启正式断言核对活动ID和唯一可见pane对应的真实模型，即使两标签正文相同',async()=>{const h=restorationHarness();expect(await h.check()).toEqual({activeTabId:'first',paneIndex:0,editor:1,model:2});});
  it.each(['错误持久化活动ID','错误可见pane','错误可见模型','错误可见正文'])('重启%s必须被正式断言拒绝',async reason=>{
    const h=restorationHarness();if(reason==='错误持久化活动ID')h.actual.activeTabId='second';if(reason==='错误可见pane')h.setVisible({...h.models[1]});if(reason==='错误可见模型')h.setVisible({...h.models[0],model:99});if(reason==='错误可见正文')h.setVisible({...h.models[0],value:'别的正文'});
    await expect(h.check()).rejects.toThrow();
  });
  it('固定src/scripts没有onBeforeRequest命名引用，仅证明已扫描源码的静态前提',()=>{const files=sourceInventory();expect(files.some(file=>file.path==='src/main/index.ts')).toBe(true);expect(files.some(file=>file.path.startsWith('src/engine/'))).toBe(true);expect(files.some(file=>file.path.startsWith('scripts/'))).toBe(true);expect(listenerReferences(files)).toEqual([]);});
  it('Main之外模块的括号访问或解构别名也不能逃过静态前提检查',()=>{
    expect(listenerReferences([{path:'src/main/index.ts',text:'import "./feature";'},{path:'src/main/feature.ts',text:'const request=originalSession.webRequest;request["onBeforeRequest"]({},listener);'},{path:'scripts/launch.cjs',text:'const {onBeforeRequest:register}=request;register({},listener);'}])).toEqual(['src/main/feature.ts','scripts/launch.cjs']);
  });
});
