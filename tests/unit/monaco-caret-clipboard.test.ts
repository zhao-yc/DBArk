import {readFileSync} from 'node:fs';
import {createContext,runInContext,runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,expect,it} from 'vitest';
import {CompletionWorkerClient} from '../../src/renderer/completionWorkerClient';
import {resolveCompletionContext,completionContextCapabilities,sameCompletionScope} from '../../src/renderer/completionContext';
import {completionLimits} from '../../src/shared/sqlCompletion';

type Payload=Blob|{title:string;url:string};
type Entry=Record<string,Payload>;
interface Options{
  platform?:'win32'|'darwin';emptyRead?:'none'|'one';surroundEmpty?:boolean;
  operationFails?:boolean;operationError?:unknown;beforeReadError?:Error;afterReadError?:Error;
  external?:Entry[];externalText?:string;wrongCaret?:boolean;wrongSource?:boolean;noRequest?:boolean;
  modelEol?:'\n'|'\r\n';untrustedEvent?:boolean;noKeyEvent?:boolean;focusCount?:number;hidden?:boolean;
  selected?:boolean;versionChanges?:boolean;startupDirty?:boolean;delayWorkerReady?:boolean;beforeKeydown?:()=>void;
  initialSql?:string;guardSelectedSurround?:boolean;
  preparedSqlOverride?:string;
}
const marked='SELECT a| FROM q',source='SELECT a FROM q';
const helperSource=readFileSync(new URL('../e2e/monaco-caret.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(helperSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const blob=(value:string,type='text/plain')=>new Blob([value],{type});
const editorSource=readFileSync(new URL('../../src/renderer/components/SqlEditor.tsx',import.meta.url),'utf8');
const editorTree=ts.createSourceFile('SqlEditor.tsx',editorSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let providerText='',scopeCurrentText='';
/** 真实provider只作辅助传输回放；位置证明必须读取按键事件当时的当前模型。 */
function visitProvider(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(editorTree)==='scopeCurrent'&&node.initializer)scopeCurrentText=node.initializer.getText(editorTree);if(ts.isPropertyAssignment(node)&&node.name.getText(editorTree)==='provideCompletionItems')providerText=node.initializer.getText(editorTree);ts.forEachChild(node,visitProvider);}
visitProvider(editorTree);if(!providerText||!scopeCurrentText)throw Error('缺少真实provider或作用域门');
const providerCode=ts.transpileModule('const scopeCurrent='+scopeCurrentText+';const extracted='+providerText,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

/** 执行锁定Monaco官方包围选区判定，不另写首括号与非空选区的理想分支。 */
function officialSurroundSelection(){
  const declarations=(relative:string,names:string[])=>{
    const text=readFileSync(new URL('../../node_modules/monaco-editor/esm/vs/'+relative,import.meta.url),'utf8'),tree=ts.createSourceFile(relative,text,ts.ScriptTarget.Latest,true),found:string[]=[];
    function visit(node:ts.Node){if((ts.isClassDeclaration(node)||ts.isFunctionDeclaration(node))&&node.name&&names.includes(node.name.text))found.push(node.getText(tree));if(ts.isVariableDeclaration(node)&&names.includes(node.name.getText(tree)))found.push('const '+node.getText(tree)+';');ts.forEachChild(node,visit);}visit(tree);if(found.length!==names.length)throw Error('官方输入规则提取不完整');return found.join('\n');
  };
  return runInNewContext(declarations('editor/common/cursor/cursorTypeEditOperations.js',['SurroundSelectionOperation','shouldSurroundChar'])+'\n'+declarations('editor/common/cursorCommon.js',['isQuote'])+'\n'+declarations('basic-languages/sql/sql.js',['conf'])+'\n({operation:SurroundSelectionOperation,pairs:conf.surroundingPairs})');
}
const surround=officialSurroundSelection();
/** 模型与选区是合成边界，是否包围选区的规则仍执行官方原方法。 */
function wouldSurroundSelectedSql(text:string,selected:boolean,character:string):boolean{
  const lines=text.split(/\r\n|\n/),selection={isEmpty:()=>!selected||!text.length,startLineNumber:1,startColumn:1,endLineNumber:lines.length,endColumn:lines.at(-1)!.length+1};
  return surround.operation._isSurroundSelectionType({autoSurround:'languageDefined',surroundingPairs:Object.fromEntries(surround.pairs.map((pair:{open:string;close:string})=>[pair.open,pair.close]))},{getLineContent:(line:number)=>lines[line-1],getValueInRange:()=>text},[selection],character);
}

/** 正式helper原样执行；模型、DOM、原生键盘与OS API均为合成边界，不冒充原生验收。 */
function replay(initial:Entry[],options:Options={}){
  let current=initial.map(entry=>({...entry})),modelSource=options.initialSql??'',offset=0,selectAll=false,arrows=0,readCount=0,hasQuery=false,reloads=0,versionReads=0;
  const keys:string[]=[],insertions:string[]=[],writes:string[]=[],posted:{source:string;offset:number}[]=[],proofDiagnostics:Record<string,unknown>[]=[],initializers:(()=>void)[]=[],listeners:((event:unknown)=>void)[]=[];
  const clipboard={
    async read(){readCount++;if(readCount===1&&options.beforeReadError)throw options.beforeReadError;if(readCount>1&&options.afterReadError)throw options.afterReadError;if(readCount>1&&options.external)current=options.external.map(entry=>({...entry}));let entries=current.length?current:options.emptyRead==='none'?[]:[{}];if(options.surroundEmpty)entries=[{},...entries,{}];return entries.map(entry=>({types:Object.keys(entry),async getType(type:string){return entry[type];}}));},
    async readText(){if(readCount>1&&options.externalText!==undefined)return options.externalText;const value=current.find(entry=>Object.hasOwn(entry,'text/plain'))?.['text/plain'];return value instanceof Blob?value.text():'';},
    async write(){writes.push('write');throw Error('禁止系统剪贴板写入');},async writeText(){writes.push('writeText');throw Error('禁止系统剪贴板写入');},clear(){writes.push('clear');throw Error('禁止系统剪贴板写入');}
  };
  const workers:RendererWorker[]=[];
  /** ready与send可以延迟，专门保留analyze早于布防的旧请求反例。 */
  class RendererWorker{
    onmessage:((event:{data:unknown})=>void)|null=null;onerror:unknown=null;onmessageerror:unknown=null;
    constructor(){workers.push(this);if(!options.delayWorkerReady)queueMicrotask(()=>this.onmessage?.({data:{type:'dbark-completion-ready',version:1}}));}
    postMessage(value:{id:number;source:string;offset:number}){posted.push(value);queueMicrotask(()=>this.onmessage?.({data:{id:value.id,result:{status:'blocked',reason:'syntax'}}}));}terminate(){}
  }
  const eol=()=>options.modelEol??'\n';
  /** 从实际合成正文及键盘offset推导行列，不读取marked或定位帮助器的返回值。 */
  const currentPosition=()=>{const lines=modelSource.slice(0,offset).split(/\r\n|\n/);return{lineNumber:lines.length,column:lines.at(-1)!.length+1};};
  const model={getValueLength:()=>modelSource.length,getValue:()=>modelSource,getEOL:eol,getVersionId:()=>options.versionChanges?++versionReads:1,isDisposed:()=>false,getOffsetAt:(position:{offset?:number;lineNumber?:number;column?:number})=>position.offset??modelSource.split(eol()).slice(0,position.lineNumber!-1).reduce((sum,line)=>sum+line.length+eol().length,0)+position.column!-1,onDidChangeContent:()=>({dispose(){}})};
  const target={},node={isConnected:true,closest:()=>query,contains:(item:unknown)=>item===target,getClientRects:()=>options.hidden?[]:[{}]},query={querySelector:()=>({contains:(item:unknown)=>item===node}),getClientRects:()=>[{}]};
  const editor={getContainerDomNode:()=>node,hasTextFocus:()=>true,getModel:()=>model,getPosition:currentPosition,getSelections:()=>{const p=currentPosition();return[{isEmpty:()=>!options.selected,positionLineNumber:p.lineNumber,positionColumn:p.column}];}};
  const api={editor:{getEditors:()=>hasQuery?Array(options.focusCount??1).fill(editor):[]}};
  const context=createContext({Buffer,Blob,Error,AggregateError,Reflect,Worker:RendererWorker,process:{platform:options.platform??'win32'},getComputedStyle:()=>({visibility:options.hidden?'hidden':'visible'})});context.window=context;context.self=context;
  context.document={addEventListener:(name:string,callback:(event:unknown)=>void,capture:boolean)=>{expect(name).toBe('keydown');expect(capture).toBe(true);listeners.push(callback);}};
  context.dbark={invoke:async(command:string)=>{if(command==='settings.get')return{activeTabId:'query',tabs:hasQuery?[{id:'query',sql:options.preparedSqlOverride??modelSource}]:[]};if(command==='connections.list')return options.startupDirty?[{id:'合成既有连接'}]:[];if(command==='tasks.list'||command==='history.list')return[];throw Error('禁止其它IPC');}};
  const client=new CompletionWorkerClient(()=>new (context.Worker as typeof RendererWorker)() as unknown as Worker);
  const completion={connectionId:'合成连接',connectionVersion:0};
  const environment={aliveRef:{current:true},propsRef:{current:{readOnly:false}},completionRef:{current:completion},sameCompletionScope,hover:undefined,disposed:false,readOnly:false,editorRef:{current:{getModel:()=>model}},active:undefined,statusRef:{current:()=>undefined},completion,completionServerFacts:{get:()=>undefined},completionLimits,AbortController,resolveCompletionContext,completionContextCapabilities,worker:client};
  const provider=runInNewContext('(function(env){with(env){'+providerCode+';return extracted;}})',{})(environment) as (model:unknown,position:{offset:number},context:unknown,token:unknown)=>Promise<unknown>;
  const token={isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})};
  const desktop={evaluate:async(callback:(api:{clipboard:typeof clipboard},argument:unknown)=>unknown,argument?:unknown)=>callback({clipboard},argument)};
  const page={
    locator:()=>({getByRole:()=>({focus:async()=>undefined}),isVisible:async()=>true}),evaluate:async(callback:(argument:unknown)=>unknown,argument?:unknown)=>callback(argument),
    addInitScript:async(callback:()=>void)=>{initializers.push(callback);},reload:async()=>{reloads++;delete context.__dbarkMonacoCaretObservation;listeners.length=0;for(const initialize of initializers)initialize();expect(context.MonacoEnvironment.globalAPI).toBe(true);context.monaco=api;context.MonacoEnvironment={getWorker(){}};},
    keyboard:{insertText:async(text:string)=>{if(options.guardSelectedSurround&&wouldSurroundSelectedSql(modelSource,selectAll,text[0]??''))throw Error('原生输入仍带可包围的非空旧选区');hasQuery=true;const value=text.replaceAll('\n',eol());insertions.push(text);modelSource=selectAll?value:modelSource.slice(0,offset)+value+modelSource.slice(offset);offset=selectAll?value.length:offset+value.length;selectAll=false;},press:async(key:string)=>{
      keys.push(key);if(key==='Escape'&&options.operationFails)throw options.operationError;
      if(key==='Control+A'||key==='Meta+A')selectAll=true;
      if(key==='Backspace'&&selectAll){modelSource='';offset=0;selectAll=false;}
      if(key==='Control+Home'||key==='Meta+ArrowUp'){offset=0;arrows=0;}
      if(key==='ArrowRight'&&offset<modelSource.length){if(!options.wrongCaret||arrows!==0)offset+=modelSource.startsWith('\r\n',offset)||(modelSource.codePointAt(offset)??0)>0xffff?2:1;arrows++;}
      if(key==='Control+Space'){
        options.beforeKeydown?.();if(options.wrongSource)modelSource='X'+modelSource.slice(1);
        if(!options.noKeyEvent)for(const listener of listeners)listener({isTrusted:!options.untrustedEvent,code:'Space',ctrlKey:true,metaKey:false,altKey:false,shiftKey:false,repeat:false,target});
        if(!options.noRequest)await provider(model,{offset},{},token);
      }
    }}
  };
  // 只替换轮询等待，不替换正式回调或断言；按键位置断言本身没有轮询等待。
  const boundaryExpect=Object.assign((value:unknown,message?:string)=>{if(value&&typeof value==='object'&&'captured'in value)proofDiagnostics.push(value as Record<string,unknown>);return Object.assign(expect(value,message),{toBeVisible:async()=>expect(await(value as{isVisible:()=>Promise<boolean>}).isVisible()).toBe(true)});},{poll:(read:()=>unknown,config?:{message?:string})=>({toBe:async(expected:unknown)=>expect(await read(),config?.message).toBe(expected),toEqual:async(expected:unknown)=>expect(await read(),config?.message).toEqual(expected)})});
  const module:{exports:{positionMonacoCaret:(text:string,options?:{redactSqlAssertion?:boolean})=>Promise<string>;observeMonacoCaret:()=>Promise<void>;triggerMonacoCompletion:(text:string)=>Promise<void>;remainingCompletionTimeout:(limit?:number)=>number}}={exports:{} as never};
  runInContext('(function(require,module,exports){'+compiled+'\n})',context)((name:string)=>{if(name==='./desktop-fixture')return{desktop,page,expect:boundaryExpect};if(name==='./live-helpers')return{modifier:options.platform==='darwin'?'Meta':'Control'};throw Error('纯回放禁止其它依赖');},module,module.exports);
  return{run:(value=marked,inputOptions?:{redactSqlAssertion?:boolean})=>module.exports.positionMonacoCaret(value,inputOptions),observe:()=>module.exports.observeMonacoCaret(),trigger:(value=marked)=>module.exports.triggerMonacoCompletion(value),timeout:(limit?:number)=>module.exports.remainingCompletionTimeout(limit),ready:()=>workers.at(-1)?.onmessage?.({data:{type:'dbark-completion-ready',version:1}}),keys,insertions,writes,posted,proofDiagnostics,context,clipboard,client,get offset(){return offset;},get modelSource(){return modelSource;},get entries(){return current;},get reloads(){return reloads;}};
}

/** 全格式检查使用独立的原始字节观测，不复制正式比较算法。 */
async function bytes(entries:Entry[]){return Promise.all(entries.map(async entry=>Object.fromEntries(await Promise.all(Object.entries(entry).map(async([type,value])=>[type,value instanceof Blob?Buffer.from(await value.arrayBuffer()).toString('hex'):value])))));}

describe('Monaco光标帮助器的只读剪贴板回放',()=>{
  it('CALL显式脱敏选项仍完整原生输入、精确准备且零剪贴板写入',async()=>{
    const call='CALL p(1, 7)|',h=replay([{'text/plain':blob('合成剪贴板哨兵')}]);
    await expect(h.run(call,{redactSqlAssertion:true})).resolves.toBe(call.replace('|',''));
    expect(h.insertions).toEqual([call.replace('|','')]);expect(h.writes).toEqual([]);expect(h.context.__dbarkMonacoCaretClipboard).toBeUndefined();
  });
  it.each([{label:'同长度参数改变',value:'CALL p(8, 9)'},{label:'长度变化',value:'CALL p(91726431)'}])('CALL准备$label仍失败，匹配器不回显参数',async({value:preparedSqlOverride})=>{
    const h=replay([],{preparedSqlOverride});let failure:Error|undefined;
    try{await h.run('CALL p(1, 7)|',{redactSqlAssertion:true});}catch(error){failure=error as Error;}
    expect(failure).toBeDefined();expect(failure!.message).toContain('完整正文');expect(failure!.message).not.toContain(preparedSqlOverride);
    expect(h.writes).toEqual([]);expect(h.context.__dbarkMonacoCaretClipboard).toBeUndefined();
  });
  it.each([{label:'空数组',items:[],emptyRead:'none' as const},{label:'单空壳',items:[{}],emptyRead:'one' as const},{label:'多个空壳',items:[{},{},{}],emptyRead:'one' as const}])('$label不需要清空或写回',async({items,emptyRead})=>{
    const h=replay(items,{emptyRead});await expect(h.run()).resolves.toBe(source);expect(h.writes).toEqual([]);expect(h.context.__dbarkMonacoCaretClipboard).toBeUndefined();
  });
  it.each(['win32','darwin'] as const)('%s只用原生输入和文档首移动，保留带类型零字节',async platform=>{
    const h=replay([{'text/plain':blob(''),'text/html':blob('','text/html'),'image/png':new Blob([])}],{platform});await h.run();expect(h.insertions).toEqual([source]);expect(h.writes).toEqual([]);expect(h.keys).toEqual(['Escape',platform==='darwin'?'Meta+A':'Control+A','Backspace',platform==='darwin'?'Meta+ArrowUp':'Control+Home',...Array(8).fill('ArrowRight')]);
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

describe('真实按键捕获阶段的公开当前模型位置证明',()=>{
  it('官方规则证实首括号会包围非空旧选区，删除为空后不再包围',()=>{expect(wouldSurroundSelectedSql('SELECT old_value',true,'(')).toBe(true);expect(wouldSurroundSelectedSql('',false,'(')).toBe(false);expect(wouldSurroundSelectedSql('SELECT old_value',true,' ')).toBe(false);});
  it('已有旧正文时先原生清空，再一次输入括号起始SQL并证明真实位置',async()=>{
    const sample='(SELECT 2 AS first_output) UNION ALL (SELECT 1 AS other_output) ORDER BY fir|suffix',expected='(SELECT 2 AS first_output) UNION ALL (SELECT 1 AS other_output) ORDER BY firsuffix',h=replay([],{initialSql:'SELECT SUM(1) AS aggregated_total HAVING aggsuffix>0',guardSelectedSurround:true});
    await h.observe();await expect(h.run(sample)).resolves.toBe(expected);await h.trigger(sample);expect(h.modelSource).toBe(expected);expect(h.insertions).toEqual([expected]);expect(h.keys.filter(key=>key==='Backspace')).toHaveLength(1);expect(h.writes).toEqual([]);h.client.dispose();
  });
  it.each([{platform:'win32' as const,marked:'SELECT a| FROM q',sql:'SELECT a FROM q',offset:8},{platform:'darwin' as const,marked:'SELECT a| FROM q',sql:'SELECT a FROM q',offset:8},{platform:'win32' as const,marked:'-- 🙂\r\nSELECT a|suffix FROM q',sql:'-- 🙂\nSELECT asuffix FROM q',offset:14},{platform:'win32' as const,modelEol:'\r\n' as const,marked:'-- 🙂\r\nSELECT a|suffix FROM q',sql:'-- 🙂\r\nSELECT asuffix FROM q',offset:15}])('$platform输入与UTF16/模型EOL位置匹配',async value=>{
    const h=replay([],value);await h.observe();await h.run(value.marked);await h.trigger(value.marked);expect(h.modelSource).toBe(value.sql);expect(h.offset).toBe(value.offset);expect(h.posted[0]).toMatchObject({source:value.sql,offset:value.offset});expect(h.keys.filter(key=>key==='Control+Space')).toHaveLength(1);expect(h.writes).toEqual([]);expect(h.context.__dbarkMonacoCaretObservation.armed).toBeUndefined();expect(h.reloads).toBe(1);h.client.dispose();
  });
  it.each([{label:'错误光标offset',wrongCaret:true},{label:'同长度错误正文',wrongSource:true},{label:'非可信按键',untrustedEvent:true},{label:'缺少本次按键事件',noKeyEvent:true},{label:'多个聚焦编辑器',focusCount:2},{label:'隐藏编辑器',hidden:true},{label:'非折叠选区',selected:true},{label:'读取时版本变化',versionChanges:true}])('$label不能通过当前状态证明',async value=>{
    const h=replay([],value);await h.observe();await h.run();await expect(h.trigger()).rejects.toThrow('真实Control+Space时唯一可见编辑器');expect(h.writes).toEqual([]);expect(h.context.__dbarkMonacoCaretObservation.armed).toBeUndefined();if(value.wrongCaret)expect(h.offset).toBe(7);if(value.wrongSource){expect(h.modelSource.length).toBe(source.length);expect(h.modelSource).not.toBe(source);}h.client.dispose();
  });
  it('没有新Worker请求时仍以真正按键的当前模型证明位置，原产品断言另行保留',async()=>{const h=replay([],{noRequest:true});await h.observe();await h.run();await h.trigger();expect(h.posted).toEqual([]);expect(h.proofDiagnostics.at(-1)).toMatchObject({captured:true,sourceMatches:true,offsetMatches:true});});
  it('旧analyze等待ready、布防后按键前send，不能让当前错误光标通过',async()=>{
    const options:Options={wrongCaret:true,noRequest:true,delayWorkerReady:true},h=replay([],options);await h.observe();await h.run();const pending=h.client.analyze(source,8);expect(h.posted).toEqual([]);
    options.beforeKeydown=()=>h.ready();await expect(h.trigger()).rejects.toThrow('真实Control+Space时唯一可见编辑器');
    expect(h.posted).toHaveLength(1);expect(h.posted[0]).toMatchObject({source,offset:8});expect(h.offset).toBe(7);expect(h.proofDiagnostics.at(-1)).toMatchObject({captured:true,sourceMatches:true,positionMatches:false,offsetMatches:false});await pending;h.client.dispose();
  });
  it('同SQL旧请求曾通过，下一次错误光标且没有新请求仍失败',async()=>{const options:Options={},h=replay([],options);await h.observe();await h.run();await h.trigger();expect(h.posted).toHaveLength(1);options.noRequest=true;options.wrongCaret=true;await h.run();await expect(h.trigger()).rejects.toThrow('真实Control+Space时唯一可见编辑器');expect(h.posted).toHaveLength(1);expect(h.proofDiagnostics.at(-1)).toMatchObject({sourceMatches:true,positionMatches:false,offsetMatches:false});h.client.dispose();});
  it('当前证明不增加13秒预算',async()=>{let now=1000;const h=replay([]);h.context.Date={now:()=>now};await h.observe();await h.run();await h.trigger();expect(h.timeout()).toBe(13000);now=9000;expect(h.timeout()).toBe(5000);expect(h.timeout(2000)).toBe(2000);now=15000;expect(h.timeout()).toBe(1);h.client.dispose();});
  it('已有连接时拒绝reload，不清理或覆盖既有工作台',async()=>{const h=replay([],{startupDirty:true});await expect(h.observe()).rejects.toThrow('公开API初始化只能在无连接、标签、任务和历史的空工作台进行');expect(h.reloads).toBe(0);expect(h.keys).toEqual([]);expect(h.writes).toEqual([]);});
  it('不再包装Worker.prototype，已有终态观察保持原样',async()=>{const h=replay([]),post=h.context.Worker.prototype.postMessage;await h.observe();expect(h.context.Worker.prototype.postMessage).toBe(post);});
  it('未初始化公开API与捕获器不能悄悄跳过证明',async()=>{const h=replay([]);await h.run();await expect(h.trigger()).rejects.toThrow('未安装真实光标观察器');expect(h.keys).not.toContain('Control+Space');});
  it.each(['sql-completion','sql-completion-window','sql-completion-lateral','session-objects'])('%s继续提交原marked，不信任定位返回值',async name=>{
    const text=readFileSync(new URL('../e2e/'+name+'.spec.ts',import.meta.url),'utf8'),tree=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true);let atCaret='',trigger='',choose='';
    function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)){if(node.name?.text==='atCaret')atCaret=node.getText(tree);if(node.name?.text==='triggerCompletion')trigger=node.getText(tree);if(node.name?.text==='choose')choose=node.getText(tree);}ts.forEachChild(node,visit);}visit(tree);
    expect(text).toContain('test.beforeEach(observeMonacoCaret)');expect(text).not.toContain("page.keyboard.press('Control+Space')");if(choose)expect(choose).toContain('await triggerCompletion()');
    let received='';const code=ts.transpileModule('let expectedCaret="";'+atCaret+';'+trigger+';({atCaret,triggerCompletion})',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    const wired=runInNewContext(code,{positionMonacoCaret:async()=> '不可信帮助器返回值',triggerMonacoCompletion:async(value:string)=>{received=value;}});await wired.atCaret('-- 🙂\r\nSELECT a|suffix');await wired.triggerCompletion();expect(received).toBe('-- 🙂\r\nSELECT a|suffix');
  });
});
