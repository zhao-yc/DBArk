import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {expect as playwrightExpect} from '@playwright/test';
import {describe,expect,it,vi} from 'vitest';

/** 抽取两个私有原声明执行，只提供RAM输入/持久化端口，不加载实库或桌面夹具。 */
function fixture(file:string,modifier='Control',persisted?:string,failure?:Error){
  const source=readFileSync(new URL('../e2e/'+file,import.meta.url),'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='writeSql');if(!declaration)throw Error('缺少SQL准备原声明');
  const code=ts.transpileModule(declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const calls:unknown[][]=[];let model='必须删除的旧SQL',selected=false;
  const forbidden=vi.fn(()=>{throw Error('禁止访问系统剪贴板或Electron端口');});
  const page={keyboard:{press:async(key:string)=>{calls.push(['press',key]);if(key===modifier+'+A')selected=true;if(key==='Backspace'){if(failure)throw failure;model='';selected=false;}},insertText:async(text:string)=>{calls.push(['insertText',text]);model=selected?'('+model+')'+text:model+text;}},evaluate:async(callback:()=>Promise<unknown>)=>{calls.push(['read-persisted']);return callback();}};
  const textbox={focus:async()=>{calls.push(['focus']);}},query=()=>({locator:(selector:string)=>{expect(selector).toBe('.monaco-editor');return{getByRole:(role:string)=>{expect(role).toBe('textbox');return textbox;}};}});
  // 只取消轮询等待；生产读取回调与真实Playwright逐字matcher保持原样。
  const boundaryExpect={poll:(read:()=>Promise<unknown>,options?:unknown)=>{expect(options).toBeUndefined();return{toBe:async(expected:unknown)=>{calls.push(['expected',expected]);playwrightExpect(await read()).toBe(expected);}};}};
  const write=runInNewContext(code+';writeSql',{
    page,query,modifier,expect:boundaryExpect,
    desktop:{evaluate:forbidden},navigator:{clipboard:new Proxy({},{get:()=>forbidden()})},
    window:{dbark:{invoke:async(command:string)=>{
      expect(command).toBe('settings.get');
      return{activeTabId:'q',tabs:[{id:'q',sql:persisted??model}]};
    }}}
  }) as(source:string)=>Promise<void>;
  return{write,calls,forbidden,model:()=>model};
}

describe.each(['query-parameters.spec.ts','query-stream-export.spec.ts'])('%s原生SQL准备',file=>{
  it.each(['Control','Meta'])('%s原生清选区后插入完整正文，零剪贴板端口',async modifier=>{
    const h=fixture(file,modifier),source="(SELECT '引号、括号与🚢' AS value);\r\nSELECT 2";
    await h.write(source);expect(h.calls).toEqual([['focus'],['press',modifier+'+A'],['press','Backspace'],['insertText',source],['expected',source.replaceAll('\r\n','\n')],['read-persisted']]);expect(h.model()).toBe(source);expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each(['SELECT 8','SELECT 700'])('持久化整文不符仍拒绝：%s',async persisted=>{
    const h=fixture(file,'Control',persisted);await expect(h.write('SELECT 7')).rejects.toThrow();expect(h.forbidden).not.toHaveBeenCalled();expect(h.calls.filter(call=>call[0]==='insertText')).toHaveLength(1);
  });
  it('原生输入失败原样传播，不回退剪贴板、模型赋值或重复输入',async()=>{
    const original=new Error('合成原生删除失败'),h=fixture(file,'Control',undefined,original);await expect(h.write('SELECT 7')).rejects.toBe(original);expect(h.calls).toEqual([['focus'],['press','Control+A'],['press','Backspace']]);expect(h.forbidden).not.toHaveBeenCalled();
  });
});
