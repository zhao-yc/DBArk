import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import * as path from 'node:path';
import ts from 'typescript';
import {describe,expect,it} from 'vitest';
import {navigationMenuRamPort} from '../helpers/sidebarMenuRamPort';

type Kind='query-binary-types-offline'|'record-input-guards-offline';
type Payload=Blob|{title:string;url:string};
type Entry=Record<string,Payload>;
interface Options{
  emptyRead?:'none'|'one'|'many';shells?:boolean;transform?:(entries:Entry[])=>Entry[];textMismatch?:boolean;
  writeError?:Error;clearError?:Error;closeError?:Error;removeError?:Error;captureError?:Error;operationError?:Error;outsideDirectory?:boolean;
}
const kinds:Kind[]=['query-binary-types-offline','record-input-guards-offline'];
const sources=Object.fromEntries(kinds.map(kind=>[kind,readFileSync(new URL('../e2e/'+kind+'.spec.ts',import.meta.url),'utf8')])) as Record<Kind,string>;
const blob=(text:string)=>new Blob([text]);

/** 整份正式fixture转译执行，捕获原before/after回调；仅替换UI/OS边界，不复制比较算法。 */
function replay(kind:Kind,initial:Entry[],options:Options={},fixtureSource=sources[kind]){
  const hooks:{beforeAll:(()=>Promise<void>)[];beforeEach:(()=>Promise<void>)[];afterEach:((input:unknown,info:unknown)=>Promise<void>)[];afterAll:(()=>Promise<void>)[];tests:{title:string;body:(input:unknown,info:unknown)=>Promise<void>}[]}={beforeAll:[],beforeEach:[],afterEach:[],afterAll:[],tests:[]};
  const calls={write:0,clear:0,close:0,remove:0,read:0,launch:0},attachments:{name:string;body:string}[]=[];let current=initial.map(entry=>({...entry})),restoring=false,inBody=false;
  class ClipboardItem{readonly types:string[];constructor(readonly values:Entry){this.types=Object.keys(values);}async getType(type:string){return this.values[type];}}
  const clipboard={
    async read(){calls.read++;if(calls.read===1&&options.captureError)throw options.captureError;let entries=current.length?current:options.emptyRead==='none'?[]:options.emptyRead==='many'?[{},{},{}]:[{}];if(options.shells)entries=[{},...entries,{}];return entries.map(entry=>({types:Object.keys(entry),async getType(type:string){return entry[type];}}));},
    async readText(){if(restoring&&options.textMismatch)return '合成变化纯文本';const value=current.find(entry=>Object.hasOwn(entry,'text/plain'))?.['text/plain'];return value instanceof Blob?value.text():'';},
    async write(items:ClipboardItem[]){calls.write++;restoring=true;if(options.writeError)throw options.writeError;const entries=await Promise.all(items.map(async item=>Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)])))));current=options.transform?options.transform(entries):entries;},
    clear(){calls.clear++;restoring=true;if(options.clearError)throw options.clearError;current=[];}
  };
  const target={};const locator={nth:()=>locator,getAttribute:async()=> '1',getByRole:()=>locator,locator:()=>locator};
  const page={locator:()=>locator,getByRole:()=>{if(inBody&&options.operationError)throw options.operationError;return locator;},on:()=>undefined,evaluate:async(callback:()=>unknown)=>callback()};
  const app={firstWindow:async()=>page,async evaluate(callback:(api:unknown)=>unknown){return callback({clipboard,ClipboardItem,app:{getAppMetrics:()=>[{pid:9876501}]}});},async close(){calls.close++;if(options.closeError)throw options.closeError;}};
  const test=Object.assign((title:string,body:(input:unknown,info:unknown)=>Promise<void>)=>hooks.tests.push({title,body}),{skip:()=>undefined,use:()=>undefined,beforeAll:(callback:()=>Promise<void>)=>hooks.beforeAll.push(callback),beforeEach:(callback:()=>Promise<void>)=>hooks.beforeEach.push(callback),afterEach:(callback:(input:unknown,info:unknown)=>Promise<void>)=>hooks.afterEach.push(callback),afterAll:(callback:()=>Promise<void>)=>hooks.afterAll.push(callback)});
  // UI就绪由假端口负责；所有布尔/字节/集合断言及poll回调仍执行正式代码。
  const boundaryExpect=Object.assign((value:unknown,message?:string)=>Object.assign(expect(value,message),{toBeVisible:async()=>undefined}),{poll:(read:()=>unknown)=>({toEqual:async(expected:unknown)=>expect(await read()).toEqual(expected)})});
  const temporary='/controlled-tmp',context=createContext({Buffer,Blob,Error,AggregateError,process:{env:{DBARK_INTEGRATION_ENABLED:'0',DBARK_QUERY_BINARY_NATIVE_ENABLED:'1',DBARK_RECORD_INPUT_NATIVE_ENABLED:'1'},platform:'darwin',cwd:()=>'/controlled-project',kill:()=>{throw Error('合成进程已退出');}}});
  context.window={__recordInputGuardAudit:{events:[]}};
  const requireBoundary=(name:string)=>{
    if(name==='./navigation-menu')return navigationMenuRamPort;
    if(name==='@playwright/test')return{test,expect:boundaryExpect,_electron:{launch:async()=>{calls.launch++;return app;}}};
    if(name==='vite')return{createServer:async()=>({listen:async()=>undefined,close:async()=>undefined,httpServer:{address:()=>({port:32100})}})};
    if(name==='@vitejs/plugin-react')return{default:()=>[],__esModule:true};
    if(name==='node:fs/promises')return{mkdtemp:async(prefix:string)=>(options.outsideDirectory?'/outside/':temporary+'/')+path.posix.basename(prefix)+'case',rm:async()=>{calls.remove++;if(options.removeError)throw options.removeError;}};
    if(name==='node:os')return{tmpdir:()=>temporary};if(name==='node:path')return path.posix;
    throw Error('正式fixture纯回放禁止其它依赖');
  };
  const compiled=ts.transpileModule(fixtureSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,module={exports:{}};
  runInContext('(function(require,module,exports){'+compiled+'\n})',context)(requireBoundary,module,module.exports);
  const info={attach:async(name:string,input:{body:string})=>{attachments.push({name,body:input.body});}};
  return{calls,attachments,context,async before(){for(const hook of hooks.beforeAll)await hook();for(const hook of hooks.beforeEach)await hook();},async after(){for(const hook of hooks.afterEach)await hook({},info);},async body(){inBody=true;try{await hooks.tests[0].body({},info);}finally{inBody=false;}},changeClipboard(entries:Entry[]){current=entries.map(entry=>({...entry}));},get entries(){return current;},get diagnostic(){const value=attachments.find(item=>item.name==='原剪贴板恢复结果');return value?JSON.parse(value.body):undefined;}};
}

/** 独立读取实际假端口最终内容，不复用正式restore比较逻辑。 */
async function bytes(entries:Entry[]){return Promise.all(entries.map(async entry=>Object.fromEntries(await Promise.all(Object.entries(entry).map(async([type,value])=>[type,value instanceof Blob?Buffer.from(await value.arrayBuffer()).toString('hex'):value])))));}

for(const kind of kinds)describe(kind+'正式回调的全格式恢复纯回归',()=>{
  it.each(['none','one','many'] as const)('空剪贴板形状%s仅规范化无类型壳',async emptyRead=>{const h=replay(kind,[],{emptyRead});await h.before();h.changeClipboard([{'text/plain':blob('合成临时')}]);await h.after();expect(h.calls.clear).toBe(1);expect(h.calls.write).toBe(0);expect(h.diagnostic).toMatchObject({restored:true,capturedReadableItems:0,restoredReadableItems:0});expect(h.calls.close).toBe(1);expect(h.calls.remove).toBe(1);});
  it('多item空壳、有类型零字节、所有字节及书签/web/raw均不丢失',async()=>{
    const initial:Entry[]=[{'text/plain':blob(''),'text/html':blob(''),'image/png':new Blob([]),'electron application/bookmark':{title:'合成书签',url:'https://synthetic.invalid/'}},{'text/rtf':blob('合成富文本'),'web application/x.synthetic':blob('合成web'),'electron application/osclipboard;format="Synthetic"':blob('合成原生')}],h=replay(kind,initial,{shells:true});await h.before();h.changeClipboard([{'text/plain':blob('合成临时')}]);await h.after();expect(await bytes(h.entries)).toEqual(await bytes(initial));expect(h.calls.write).toBe(1);expect(h.calls.clear).toBe(0);expect(h.diagnostic).toMatchObject({restored:true,capturedReadableItems:2,restoredReadableItems:2,capturedEmptyTypeItems:2,restoredEmptyTypeItems:2,savedTypeCount:7,actualTypeCount:7});
  });
  it.each(['missing','additional','bytes','bookmark','text','items'])('完整类型或内容变化%s仍触发原严格断言',async mode=>{
    const initial:Entry[]=[{'text/plain':blob('合成原文'),'image/png':blob('合成图像'),'electron application/bookmark':{title:'合成旧',url:'https://synthetic.invalid/old'}}],h=replay(kind,initial,{textMismatch:mode==='text',transform:entries=>{const values={...entries[0]};if(mode==='missing')delete values['image/png'];if(mode==='additional')values['text/html']=blob('合成新增');if(mode==='bytes')values['image/png']=blob('合成变化');if(mode==='bookmark')values['electron application/bookmark']={title:'合成新',url:'https://synthetic.invalid/new'};return mode==='items'?[values,{'text/rtf':blob('合成额外条目')}]:[values];}});
    await h.before();await expect(h.after()).rejects.toThrow();expect(h.diagnostic.restored).toBe(false);expect(h.calls.close).toBe(1);expect(h.calls.remove).toBe(1);if(mode==='additional')expect(h.diagnostic.additionalTypes).toBe(1);if(mode==='bytes'||mode==='bookmark')expect(h.diagnostic.payloadMismatches).toBe(1);
  });
  it('操作失败原对象不变，afterEach仍完整恢复并清理',async()=>{const operation=Error('合成操作失败'),h=replay(kind,[{'text/plain':blob('合成原文')}],{operationError:operation});await h.before();h.changeClipboard([{'text/plain':blob('合成临时')}]);await expect(h.body()).rejects.toBe(operation);await h.after();expect(h.diagnostic.restored).toBe(true);expect(h.calls.close).toBe(1);expect(h.calls.remove).toBe(1);});
  it('恢复write API失败仍抛原对象并执行finally清理',async()=>{const error=Error('合成写入失败'),h=replay(kind,[{'text/plain':blob('合成原文')}],{writeError:error});await h.before();await expect(h.after()).rejects.toBe(error);expect(h.calls.close).toBe(1);expect(h.calls.remove).toBe(1);});
  it('原空状态clear API失败不能转成功，finally仍执行',async()=>{const error=Error('合成空状态恢复失败'),h=replay(kind,[],{clearError:error});await h.before();await expect(h.after()).rejects.toBe(error);expect(h.calls.close).toBe(1);expect(h.calls.remove).toBe(1);});
  it('关闭失败不能继续删除仍可能占用的目录',async()=>{const error=Error('合成关闭失败'),h=replay(kind,[],{closeError:error});await h.before();await expect(h.after()).rejects.toBe(error);expect(h.calls.close).toBe(1);expect(h.calls.remove).toBe(0);expect(h.diagnostic.restored).toBe(true);});
  it('目录清理失败保持失败',async()=>{const error=Error('合成目录清理失败'),h=replay(kind,[],{removeError:error});await h.before();await expect(h.after()).rejects.toBe(error);expect(h.calls.close).toBe(1);expect(h.calls.remove).toBe(1);});
  it.each(['restore','cleanup'])('操作及%s分别失败时两个原回调都保留各自原因',async stage=>{const operation=Error('合成操作失败'),teardown=Error('合成收尾失败'),h=replay(kind,[{'text/plain':blob('合成原文')}],{operationError:operation,...(stage==='restore'?{writeError:teardown}:{closeError:teardown})});await h.before();await expect(h.body()).rejects.toBe(operation);await expect(h.after()).rejects.toBe(teardown);expect(h.calls.close).toBe(1);expect(h.calls.remove).toBe(stage==='restore'?1:0);});
  it('捕获读取失败时尚未改剪贴板，仍关闭并清理自有目录',async()=>{const error=Error('合成捕获失败'),h=replay(kind,[],{captureError:error});await expect(h.before()).rejects.toBe(error);await h.after();expect(h.calls.write+h.calls.clear).toBe(0);expect(h.calls.close).toBe(1);expect(h.calls.remove).toBe(1);});
  it('原目录范围守卫继续拒绝越界删除',async()=>{const h=replay(kind,[],{outsideDirectory:true});await h.before();await expect(h.after()).rejects.toThrow('拒绝清理');expect(h.calls.close).toBe(1);expect(h.calls.remove).toBe(0);});
  it('新增恢复诊断只有布尔和数量，不含MIME、正文、路径或摘要',async()=>{const marker='SYNTHETIC_PRIVATE_MARKER',type='web application/x.'+marker,h=replay(kind,[{[type]:blob(marker)}],{transform:entries=>entries.map(entry=>({...entry,[type]:blob('合成变化')}))});await h.before();await expect(h.after()).rejects.toThrow();const text=JSON.stringify(h.diagnostic);expect(text).not.toContain(marker);expect(text).not.toContain(type);expect(text).not.toContain('sha256');expect(Object.values(h.diagnostic).every(value=>typeof value==='boolean'||typeof value==='number')).toBe(true);});
});
