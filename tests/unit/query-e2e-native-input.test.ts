import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {expect as playwrightExpect} from '@playwright/test';
import {describe,expect,it,vi} from 'vitest';

const files=['query-parameters.spec.ts','query-stream-export.spec.ts'];
const sourceOf=(file:string)=>readFileSync(new URL('../e2e/'+file,import.meta.url),'utf8');
const parameterTree=ts.createSourceFile(files[0],sourceOf(files[0]),ts.ScriptTarget.Latest,true);
let dynamicSql='';
/** 使用正式动态模式用例的原SQL，不删引号或改写反斜杠以迎合准备机制。 */
function findDynamic(node:ts.Node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(parameterTree)==='dynamic'&&node.initializer&&ts.isStringLiteral(node.initializer))dynamicSql=node.initializer.text;
  ts.forEachChild(node,findDynamic);
}
findDynamic(parameterTree);if(!dynamicSql)throw Error('缺少原动态模式SQL');

/** 执行正式私有声明；DOM事件、输入及持久化是RAM端口，不能冒充真实Monaco或原生剪贴板验收。 */
function fixture(file:string,{modifier='Control',legacyInput=false,persisted,ignoredPaste=false,failure}:{modifier?:string;legacyInput?:boolean;persisted?:string;ignoredPaste?:boolean;failure?:Error}={}){
  const source=sourceOf(file),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='writeSql') as ts.FunctionDeclaration|undefined;
  if(!declaration?.body)throw Error('缺少SQL准备原声明');
  let helper=declaration.getText(ast);
  if(legacyInput){
    // 仅把输入一步还原成586的insertText；原全文matcher及SQL保持，重放已证多引号端口失败。
    const paste=declaration.body.statements.find(node=>node.getText(ast).includes('new ClipboardEvent'));
    if(!paste)throw Error('缺少合成paste入口');
    helper=helper.replace(paste.getText(ast),'await page.keyboard.insertText(source);');
  }
  const code=ts.transpileModule(helper,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const calls:unknown[][]=[];let model='必须删除的旧SQL',selected=false;
  const forbidden=vi.fn(()=>{throw Error('禁止系统剪贴板、Electron端口或直接设置模型');});
  class Transfer{
    values=new Map<string,string>();
    setData(type:string,value:string){calls.push(['setData',type,value]);this.values.set(type,value);}
    getData(type:string){return this.values.get(type)??'';}
  }
  class PasteEvent{
    constructor(public type:string,public options:{clipboardData:Transfer;bubbles:boolean;cancelable:boolean}){}
  }
  const element={dispatchEvent:(event:PasteEvent)=>{
    calls.push(['paste',event.type,event.options.bubbles,event.options.cancelable]);
    if(failure)throw failure;
    expect(event.options.clipboardData.values.size).toBe(1);
    if(!ignoredPaste)model+=event.options.clipboardData.getData('text/plain');
    return false; // 既有handler可preventDefault；不能靠dispatchEvent返回值冒充全文已正确。
  }};
  const page={keyboard:{press:async(key:string)=>{calls.push(['press',key]);if(key===modifier+'+A')selected=true;if(key==='Backspace'){expect(selected).toBe(true);model='';selected=false;}},insertText:async(text:string)=>{calls.push(['insertText',text]);model+=text+"'";}},evaluate:async(callback:()=>Promise<unknown>)=>{calls.push(['read-persisted']);return callback();}};
  const textbox={focus:async()=>{calls.push(['focus']);},evaluate:async(callback:(target:typeof element,sql:string)=>unknown,sql:string)=>{calls.push(['evaluate-paste']);expect(selected).toBe(false);return callback(element,sql);}};
  const query=()=>({locator:(selector:string)=>{expect(selector).toBe('.monaco-editor');return{getByRole:(role:string)=>{expect(role).toBe('textbox');return textbox;}};}});
  // 只取消轮询等待；正式读取回调、完整期望值和真实Playwright逐字matcher保持原样，未覆写5秒默认期限。
  const boundaryExpect={poll:(read:()=>Promise<unknown>,options?:unknown)=>{expect(options).toBeUndefined();return{toBe:async(expected:unknown)=>{calls.push(['expected',expected]);playwrightExpect(await read()).toBe(expected);}};}};
  const write=runInNewContext(code+';writeSql',{
    page,query,modifier,expect:boundaryExpect,DataTransfer:Transfer,ClipboardEvent:PasteEvent,
    desktop:{evaluate:forbidden},navigator:{clipboard:new Proxy({},{get:()=>forbidden()})},
    monaco:{editor:{setValue:forbidden,executeEdits:forbidden}},
    window:{dbark:{invoke:async(command:string)=>{expect(command).toBe('settings.get');return{activeTabId:'q',tabs:[{id:'q',sql:persisted??model}]};}}}
  }) as(source:string)=>Promise<void>;
  return{write,calls,forbidden,model:()=>model};
}

describe.each(files)('%s合成paste准备SQL',file=>{
  it.each(['Control','Meta'])('%s清选区后通过事件传输完整正文，零系统剪贴板端口',async modifier=>{
    const h=fixture(file,{modifier}),source=dynamicSql+"\r\nSELECT '(中文🚢)'";
    await h.write(source);
    expect(h.calls).toEqual([['focus'],['press',modifier+'+A'],['press','Backspace'],['evaluate-paste'],['setData','text/plain',source],['paste','paste',true,true],['expected',source.replaceAll('\r\n','\n')],['read-persisted']]);
    expect(h.model()).toBe(source);expect(h.forbidden).not.toHaveBeenCalled();
  });
  it('旧insertText在多余引号端口仍被原全文断言拒绝，保留旧失败',async()=>{
    const h=fixture(file,{legacyInput:true});await expect(h.write(dynamicSql)).rejects.toThrow();
    expect(h.model()).toBe(dynamicSql+"'");expect(h.calls).toContainEqual(['expected',dynamicSql]);expect(h.calls).toContainEqual(['insertText',dynamicSql]);expect(h.forbidden).not.toHaveBeenCalled();
  });
  it('paste后持久化正文仍多一个引号时，原全文断言继续拒绝',async()=>{
    const h=fixture(file,{persisted:dynamicSql+"'"});await expect(h.write(dynamicSql)).rejects.toThrow();
    expect(h.model()).toBe(dynamicSql);expect(h.calls).toContainEqual(['expected',dynamicSql]);expect(h.forbidden).not.toHaveBeenCalled();
  });
  it('事件未被消费时失败，不把投递成功当成SQL准备成功或回退键盘',async()=>{
    const h=fixture(file,{ignoredPaste:true});await expect(h.write(dynamicSql)).rejects.toThrow();
    expect(h.model()).toBe('');expect(h.calls.some(call=>call[0]==='insertText')).toBe(false);expect(h.forbidden).not.toHaveBeenCalled();
  });
  it('paste处理异常原样传播，不重投或切换输入方式',async()=>{
    const original=new Error('合成paste处理失败'),h=fixture(file,{failure:original});await expect(h.write(dynamicSql)).rejects.toBe(original);
    expect(h.calls.filter(call=>call[0]==='paste')).toHaveLength(1);expect(h.calls.some(call=>call[0]==='insertText'||call[0]==='read-persisted')).toBe(false);expect(h.forbidden).not.toHaveBeenCalled();
  });
});
