import{readFileSync}from'node:fs';import vm from'node:vm';import ts from'typescript';import{describe,expect,it,vi}from'vitest';
import{compactSqlKeywordCaseNative,sqlKeywordCaseNativeSource}from'../helpers/sqlKeywordCaseNativeFixture';
import{planSqlFormatting,prepareSqlFormattingRoles}from'../../src/renderer/sqlFormatting';
const source=readFileSync(new URL('../e2e/sql-keyword-case-native.spec.ts',import.meta.url),'utf8');
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
  it('基线Main没有其它onBeforeRequest拦截器，规格不会覆盖既有产品处理器',()=>{expect(readFileSync(new URL('../../src/main/index.ts',import.meta.url),'utf8')).not.toMatch(/webRequest\.onBeforeRequest/);});
});
