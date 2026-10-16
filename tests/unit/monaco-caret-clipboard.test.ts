import {readFileSync} from 'node:fs';
import {createContext,runInContext,runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,expect,it} from 'vitest';
import {CompletionWorkerClient} from '../../src/renderer/completionWorkerClient';
import {resolveCompletionContext,completionContextCapabilities} from '../../src/renderer/completionContext';
import {completionLimits} from '../../src/shared/sqlCompletion';

type Payload=Blob|{title:string;url:string};
type Entry=Record<string,Payload>;
interface Options{
  platform?:'win32'|'darwin';emptyRead?:'none'|'one';surroundEmpty?:boolean;
  operationFails?:boolean;operationError?:unknown;beforeReadError?:Error;afterReadError?:Error;
  external?:Entry[];externalText?:string;wrongCaret?:boolean;wrongSource?:boolean;noRequest?:boolean;
}
const marked='SELECT a| FROM q',source='SELECT a FROM q';
const helperSource=readFileSync(new URL('../e2e/monaco-caret.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(helperSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const blob=(value:string,type='text/plain')=>new Blob([value],{type});
const editorSource=readFileSync(new URL('../../src/renderer/components/SqlEditor.tsx',import.meta.url),'utf8');
const editorTree=ts.createSourceFile('SqlEditor.tsx',editorSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let providerText='';
/** 提取实际provider原回调；不能另写一份按期望marked产生正确位置的假provider。 */
function visitProvider(node:ts.Node){if(ts.isPropertyAssignment(node)&&node.name.getText(editorTree)==='provideCompletionItems')providerText=node.initializer.getText(editorTree);ts.forEachChild(node,visitProvider);}
visitProvider(editorTree);if(!providerText)throw Error('缺少真实provider');
const providerCode=ts.transpileModule('const extracted='+providerText,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

/** 整个正式helper与provider执行于纯VM；只替换OS、键盘/模型、传输和轮询等待边界。 */
function replay(initial:Entry[],options:Options={}){
  let current=initial.map(entry=>({...entry})),modelSource='',offset=0,selectAll=false,arrows=0,readCount=0;
  const keys:string[]=[],insertions:string[]=[],writes:string[]=[],posted:{source:string;offset:number}[]=[],pollDiagnostics:unknown[]=[];
  const clipboard={
    async read(){
      readCount++;if(readCount===1&&options.beforeReadError)throw options.beforeReadError;
      if(readCount>1&&options.afterReadError)throw options.afterReadError;
      if(readCount>1&&options.external)current=options.external.map(entry=>({...entry}));
      let entries=current.length?current:options.emptyRead==='none'?[]:[{}];if(options.surroundEmpty)entries=[{},...entries,{}];
      return entries.map(entry=>({types:Object.keys(entry),async getType(type:string){return entry[type];}}));
    },
    async readText(){if(readCount>1&&options.externalText!==undefined)return options.externalText;const value=current.find(entry=>Object.hasOwn(entry,'text/plain'))?.['text/plain'];return value instanceof Blob?value.text():'';},
    async write(){writes.push('write');throw Error('禁止系统剪贴板写入');},
    async writeText(){writes.push('writeText');throw Error('禁止系统剪贴板写入');},
    clear(){writes.push('clear');throw Error('禁止系统剪贴板写入');}
  };
  /** 假传输只回blocked以结束真实Client等待；不把它冒充实际解析器、Worker线程或Monaco。 */
  class RendererWorker{
    onmessage:((event:{data:unknown})=>void)|null=null;onerror:unknown=null;onmessageerror:unknown=null;
    constructor(){queueMicrotask(()=>this.onmessage?.({data:{type:'dbark-completion-ready',version:1}}));}
    postMessage(value:{id:number;source:string;offset:number}){posted.push(value);queueMicrotask(()=>this.onmessage?.({data:{id:value.id,result:{status:'blocked',reason:'syntax'}}}));}
    terminate(){}
  }
  const context=createContext({Buffer,Blob,Error,AggregateError,Reflect,Worker:RendererWorker,process:{platform:options.platform??'win32'}});
  context.window=context;context.dbark={invoke:async(command:string)=>{if(command!=='settings.get')throw Error('禁止其它IPC');return{activeTabId:'query',tabs:[{id:'query',sql:modelSource}]};}};
  const client=new CompletionWorkerClient(()=>new (context.Worker as typeof RendererWorker)() as unknown as Worker);
  const model={getValueLength:()=>modelSource.length,getValue:()=>modelSource,getVersionId:()=>1,isDisposed:()=>false,getOffsetAt:(position:{offset:number})=>position.offset,onDidChangeContent:()=>({dispose(){}})};
  const environment={disposed:false,readOnly:false,editorRef:{current:{getModel:()=>model}},active:undefined,statusRef:{current:()=>undefined},completion:{connectionId:'合成连接',connectionVersion:0},completionServerFacts:{get:()=>undefined},completionLimits,AbortController,resolveCompletionContext,completionContextCapabilities,worker:client};
  const provider=runInNewContext('(function(env){with(env){'+providerCode+';return extracted;}})',{})(environment) as (model:unknown,position:{offset:number},context:unknown,token:unknown)=>Promise<unknown>;
  const token={isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})};
  const desktop={evaluate:async(callback:(api:{clipboard:typeof clipboard},argument:unknown)=>unknown,argument?:unknown)=>callback({clipboard},argument)};
  const page={
    locator:()=>({getByRole:()=>({focus:async()=>undefined})}),
    evaluate:async(callback:(argument:unknown)=>unknown,argument?:unknown)=>callback(argument),
    keyboard:{
      insertText:async(text:string)=>{insertions.push(text);modelSource=selectAll?text:modelSource.slice(0,offset)+text+modelSource.slice(offset);offset=selectAll?text.length:offset+text.length;selectAll=false;},
      press:async(key:string)=>{
        keys.push(key);if(key==='Escape'&&options.operationFails)throw options.operationError;
        if(key==='Control+A'||key==='Meta+A')selectAll=true;
        if(key==='Control+Home'||key==='Meta+ArrowUp')offset=0;
        if(key==='ArrowRight'&&offset<modelSource.length){if(!options.wrongCaret||arrows!==0)offset+=(modelSource.codePointAt(offset)??0)>0xffff?2:1;arrows++;}
        if(key==='Control+Space'&&!options.noRequest){if(options.wrongSource)modelSource='X'+modelSource.slice(1);await provider(model,{offset},{},token);}
      }
    }
  };
  // 纯回放不消耗13秒等待；保留正式轮询回调和断言，只执行一次受控观测。
  const boundaryExpect=Object.assign((value:unknown,message?:string)=>expect(value,message),{poll:(read:()=>unknown,config?:{message?:string})=>({toBe:async(expected:unknown)=>expect(await read(),config?.message).toBe(expected),toEqual:async(expected:unknown)=>{const actual=await read();pollDiagnostics.push(actual);expect(actual,config?.message).toEqual(expected);}})});
  const module:{exports:{positionMonacoCaret:(text:string)=>Promise<string>;observeMonacoCaret:()=>Promise<void>;triggerMonacoCompletion:(text:string)=>Promise<void>;remainingCompletionTimeout:(limit?:number)=>number}}={exports:{} as never};
  runInContext('(function(require,module,exports){'+compiled+'\n})',context)((name:string)=>{
    if(name==='./desktop-fixture')return{desktop,page,expect:boundaryExpect};if(name==='./live-helpers')return{modifier:options.platform==='darwin'?'Meta':'Control'};throw Error('纯回放禁止其它依赖');
  },module,module.exports);
  return{run:(value=marked)=>module.exports.positionMonacoCaret(value),observe:()=>module.exports.observeMonacoCaret(),trigger:(value=marked)=>module.exports.triggerMonacoCompletion(value),timeout:(limit?:number)=>module.exports.remainingCompletionTimeout(limit),keys,insertions,writes,posted,pollDiagnostics,context,clipboard,client,get offset(){return offset;},get modelSource(){return modelSource;},get entries(){return current;}};
}

/** 全格式检查使用独立的原始字节观测，不复制正式比较算法。 */
async function bytes(entries:Entry[]){return Promise.all(entries.map(async entry=>Object.fromEntries(await Promise.all(Object.entries(entry).map(async([type,value])=>[type,value instanceof Blob?Buffer.from(await value.arrayBuffer()).toString('hex'):value])))));}

describe('Monaco光标帮助器的只读剪贴板回放',()=>{
  it.each([{label:'空数组',items:[],emptyRead:'none' as const},{label:'单空壳',items:[{}],emptyRead:'one' as const},{label:'多个空壳',items:[{},{},{}],emptyRead:'one' as const}])('$label不需要清空或写回',async({items,emptyRead})=>{
    const h=replay(items,{emptyRead});await expect(h.run()).resolves.toBe(source);expect(h.writes).toEqual([]);expect(h.context.__dbarkMonacoCaretClipboard).toBeUndefined();
  });
  it.each(['win32','darwin'] as const)('%s只用原生输入和文档首移动，保留带类型零字节',async platform=>{
    const h=replay([{'text/plain':blob(''),'text/html':blob('','text/html'),'image/png':new Blob([])}],{platform});await h.run();expect(h.insertions).toEqual([source]);expect(h.writes).toEqual([]);expect(h.keys).toEqual(['Escape',platform==='darwin'?'Meta+A':'Control+A',platform==='darwin'?'Meta+ArrowUp':'Control+Home',...Array(8).fill('ArrowRight')]);
  });
  it('多item、富文本、图片、书签、web与raw全部保持，只忽略无类型空壳',async()=>{
    const entries:Entry[]=[{}, {'text/plain':blob('合成原文🙂\0'),'text/html':blob('<b>合成</b>'),'image/png':new Blob([new Uint8Array([0,1,255])]),'electron application/bookmark':{title:'合成',url:'https://synthetic.invalid/'},'web application/x.synthetic':blob('合成web'),'electron application/osclipboard;format="16"':blob('合成raw')},{'text/rtf':blob('合成rtf')}];
    const h=replay(entries,{surroundEmpty:true});await h.run();expect(h.writes).toEqual([]);expect(await bytes(h.entries)).toEqual(await bytes(entries));
  });
  it.each(['删除类型','新增类型','同类型改字节','改变书签','纯文本另读变化','item数量变化'])('外部变化严格失败且不覆盖新内容：%s',async mode=>{
    const entry:Entry={'text/plain':blob('合成原文'),'image/png':blob('合成图像'),'electron application/bookmark':{title:'合成旧',url:'https://synthetic.invalid/old'}};
    const changed={...entry};if(mode==='删除类型')delete changed['image/png'];if(mode==='新增类型')changed['text/html']=blob('合成新增');if(mode==='同类型改字节')changed['image/png']=blob('合成变化');if(mode==='改变书签')changed['electron application/bookmark']={title:'合成新',url:'https://synthetic.invalid/new'};
    const external=mode==='item数量变化'?[changed,{'text/rtf':blob('合成第二项')}]:[changed],h=replay([entry],{external,externalText:mode==='纯文本另读变化'?'合成外部文本':undefined});
    await expect(h.run()).rejects.toThrow('原剪贴板全部可读格式与纯文本必须恢复');expect(h.writes).toEqual([]);expect(h.context.__dbarkMonacoCaretClipboard).toBeUndefined();expect(await bytes(h.entries)).toEqual(await bytes(external));
  });
  it('操作失败仍只读核对，原异常对象不变',async()=>{const error=Error('合成操作失败'),h=replay([{'text/plain':blob('合成原文')}],{operationFails:true,operationError:error});await expect(h.run()).rejects.toBe(error);expect(h.writes).toEqual([]);});
  it('前置读取失败时尚未输入，原生消息不泄露',async()=>{const error=Error('合成前置读失败'),h=replay([],{beforeReadError:error});await expect(h.run()).rejects.toThrow('光标定位前的剪贴板只读完整采集失败');expect(h.keys).toEqual([]);expect(h.writes).toEqual([]);});
  it('后置读取失败时不尝试恢复或覆盖，原生消息不泄露',async()=>{const error=Error('合成后置读失败'),h=replay([],{afterReadError:error});await expect(h.run()).rejects.toThrow('光标定位后的剪贴板只读完整采集失败');expect(h.writes).toEqual([]);expect(h.context.__dbarkMonacoCaretClipboard).toBeUndefined();});
  it.each([Error('合成操作异常'),null])('操作和只读核对都失败时保留原异常关系：%s',async operation=>{const readError=Error('合成后置读异常'),h=replay([],{operationFails:true,operationError:operation,afterReadError:readError}),error=await h.run().catch(error=>error);expect(error).toBeInstanceOf(AggregateError);expect(error.cause).toBe(operation);expect(error.errors[0]).toBe(operation);expect(error.errors[1].message).toBe('光标定位后的剪贴板只读完整采集失败');expect(error.errors[1].cause).toBeUndefined();expect(h.writes).toEqual([]);});
  it('操作与内容核对都失败时也保留两条原因',async()=>{const operation=Error('合成操作异常'),h=replay([],{operationFails:true,operationError:operation,external:[{'text/plain':blob('合成外部文本')}]}),error=await h.run().catch(error=>error);expect(error).toBeInstanceOf(AggregateError);expect(error.cause).toBe(operation);expect(error.errors[0]).toBe(operation);expect(error.errors[1].message).toContain('原剪贴板全部可读格式与纯文本必须恢复');});
  it('失败诊断不含剪贴板原文、格式原名或内容摘要',async()=>{const secret='SYNTHETIC_PRIVATE_MARKER',type='web application/x.'+secret,h=replay([{[type]:blob(secret)}],{external:[{[type]:blob('合成变化')}]}),error=await h.run().catch(error=>error);expect(error.message).not.toContain(secret);expect(error.message).not.toContain(type);expect(error.message).not.toContain('sha256');expect(h.writes).toEqual([]);});
  it('原生读取异常中的格式、路径和摘要不进入失败诊断',async()=>{const privateError=Error('SYNTHETIC_PRIVATE_MARKER web application/x.synthetic D:/synthetic/private sha256=synthetic'),h=replay([],{afterReadError:privateError}),error=await h.run().catch(error=>error);expect(error.message).toBe('光标定位后的剪贴板只读完整采集失败');expect(error.cause).toBeUndefined();expect(error.stack).not.toContain('SYNTHETIC_PRIVATE_MARKER');});
});

describe('真实provider发送位置与独立marked期望的纯接线',()=>{
  it.each([{platform:'win32' as const,marked:'SELECT a| FROM q',sql:'SELECT a FROM q',offset:8},{platform:'darwin' as const,marked:'SELECT a| FROM q',sql:'SELECT a FROM q',offset:8},{platform:'win32' as const,marked:'-- 🙂\r\nSELECT a|suffix FROM q',sql:'-- 🙂\nSELECT asuffix FROM q',offset:14}])('$platform输入与UTF16/CRLF位置精确匹配',async value=>{
    const h=replay([],{platform:value.platform});await h.observe();await h.run(value.marked);await h.trigger(value.marked);expect(h.modelSource).toBe(value.sql);expect(h.offset).toBe(value.offset);expect(h.posted).toHaveLength(1);expect(h.posted[0]).toMatchObject({source:value.sql,offset:value.offset});expect(h.keys.filter(key=>key==='Control+Space')).toHaveLength(1);expect(h.writes).toEqual([]);expect(h.context.__dbarkMonacoCaretObservation.expected).toBeUndefined();h.client.dispose();
  });
  it.each([{label:'错误光标offset',wrongCaret:true},{label:'同长度错误正文',wrongSource:true},{label:'真实请求缺失',noRequest:true}])('$label不能把空建议或错误位置当通过',async value=>{
    const h=replay([],value);await h.observe();await h.run();await expect(h.trigger()).rejects.toThrow('真实provider必须发送原marked全文与UTF16光标位置');expect(h.writes).toEqual([]);expect(h.context.__dbarkMonacoCaretObservation.expected).toBeUndefined();expect(h.pollDiagnostics.at(-1)).not.toEqual({seen:true,sourceMatches:true,offsetMatches:true});if(value.wrongCaret)expect(h.posted[0].offset).toBe(7);if(value.wrongSource){expect(h.posted[0].source.length).toBe(source.length);expect(h.posted[0].source).not.toBe(source);}h.client.dispose();
  });
  it('位置证明与原产品等待共享13秒，不累加等待窗口',async()=>{let now=1000;const h=replay([]);h.context.Date={now:()=>now};await h.observe();await h.run();await h.trigger();expect(h.timeout()).toBe(13000);now=9000;expect(h.timeout()).toBe(5000);expect(h.timeout(2000)).toBe(2000);now=15000;expect(h.timeout()).toBe(1);h.client.dispose();});
  it('同SQL旧请求曾通过也不能满足本次没有新请求的观察范围',async()=>{
    const options:Options={},h=replay([],options);await h.observe();await h.run();await h.trigger();expect(h.posted).toHaveLength(1);
    options.noRequest=true;await h.run();await expect(h.trigger()).rejects.toThrow('真实provider必须发送原marked全文与UTF16光标位置');
    expect(h.posted).toHaveLength(1);expect(h.context.__dbarkMonacoCaretObservation.after).toBe(1);expect(h.pollDiagnostics.at(-1)).toEqual({seen:false,sourceMatches:true,offsetMatches:true});h.client.dispose();
  });
  it('与原窗口/LATERAL实例包装兼容，原请求和接收者不变',async()=>{
    const h=replay([]);await h.observe();const Native=h.context.Worker;let forwarded=0;h.context.Worker=class extends Native{constructor(){super();const post=this.postMessage.bind(this);this.postMessage=(...args:unknown[])=>{forwarded++;return post(...args);};}};await h.run();await h.trigger();expect(forwarded).toBe(1);expect(h.posted).toHaveLength(1);h.client.dispose();
  });
  it('未安装观察器不能悄悄跳过光标证明',async()=>{const h=replay([]);await h.run();await expect(h.trigger()).rejects.toThrow('未安装真实光标观察器');expect(h.keys).not.toContain('Control+Space');});
  it.each(['sql-completion','sql-completion-window','sql-completion-lateral','session-objects'])('%s全部触发走独立marked观察，不信任定位返回值',async name=>{
    const text=readFileSync(new URL('../e2e/'+name+'.spec.ts',import.meta.url),'utf8'),tree=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true);let atCaret='',trigger='',choose='';
    function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)){if(node.name?.text==='atCaret')atCaret=node.getText(tree);if(node.name?.text==='triggerCompletion')trigger=node.getText(tree);if(node.name?.text==='choose')choose=node.getText(tree);}ts.forEachChild(node,visit);}visit(tree);
    expect(text).toContain('test.beforeEach(observeMonacoCaret)');expect(text).not.toContain("page.keyboard.press('Control+Space')");if(choose)expect(choose).toContain('await triggerCompletion()');
    let received='';const code=ts.transpileModule('let expectedCaret="";'+atCaret+';'+trigger+';({atCaret,triggerCompletion})',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    const wired=runInNewContext(code,{positionMonacoCaret:async()=> '不可信帮助器返回值',triggerMonacoCompletion:async(value:string)=>{received=value;}});await wired.atCaret('-- 🙂\r\nSELECT a|suffix');await wired.triggerCompletion();expect(received).toBe('-- 🙂\r\nSELECT a|suffix');
  });
});
