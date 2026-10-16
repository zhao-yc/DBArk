import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import ts from 'typescript';
import {expect as playwrightExpect} from '@playwright/test';
import {describe,it,expect} from 'vitest';

/** 只抽取原声明执行；页面、连接和图片均为RAM端口，不加载真实E2E夹具。 */
function declaration(relative:string,name:string){
  const source=readFileSync(new URL(relative,import.meta.url),'utf8'),tree=ts.createSourceFile(relative,source,ts.ScriptTarget.Latest,true);
  const node=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);if(!node)throw Error('缺少被测原声明');
  return ts.transpileModule(node.getText(tree).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
const saved=declaration('../e2e/sql-completion-call-routines.spec.ts','savedSql');
const unchanged=declaration('../e2e/sql-completion-call-routines.spec.ts','assertSnapshotUnchanged');
const isolated=declaration('../e2e/live-helpers.ts','isolatedDatabase');

describe('CALL的窄失败产物边界',()=>{
  it('全文一致仍通过，沿用原补全余量上限',async()=>{
    const limits:number[]=[];const read=runInNewContext(saved+';savedSql',{expect:playwrightExpect,window:{dbark:{invoke:async()=>({activeTabId:'q',tabs:[{id:'q',sql:'CALL p(1, 7)'}]})}}});
    await read({page:{evaluate:(callback:(value:unknown)=>unknown,value:unknown)=>callback(value)}},{remainingCompletionTimeout:(limit:number)=>{limits.push(limit);return 1;}},'CALL p(1, 7)');expect(limits).toEqual([5000]);
  });
  it('真实Playwright全文失败仅输出布尔，不能写出实际或期望参数',async()=>{
    const read=runInNewContext(saved+';savedSql',{expect:playwrightExpect,window:{dbark:{invoke:async()=>({activeTabId:'q',tabs:[{id:'q',sql:'CALL p(91726431)'}]})}}});let failure:Error|undefined;
    try{await read({page:{evaluate:(callback:(value:unknown)=>unknown,value:unknown)=>callback(value)}},{remainingCompletionTimeout:()=>1},'CALL p(1, 7)');}catch(error){failure=error as Error;}
    expect(failure).toBeDefined();expect(failure!.message).not.toContain('91726431');expect(failure!.message).not.toContain('1, 7');expect(failure!.message).toContain('完整正文');
  });
  it.each(['tasks','history','marker']as const)('完整%s快照不同仍失败，但不序列化意外SQL',key=>{
    const compare=runInNewContext(unchanged+';assertSnapshotUnchanged',{expect:playwrightExpect,isDeepStrictEqual});
    const before={tasks:[],history:[],marker:[{id:1,hits:0}]},actual={...before,[key]:[{sql:'CALL p(91726431)',hits:7}]};let failure:Error|undefined;
    try{compare(actual,before);}catch(error){failure=error as Error;}
    expect(failure).toBeDefined();expect(failure!.message).not.toContain('91726431');expect(failure!.message).not.toContain('CALL p');
  });
  it('完整快照的独立深拷贝仍通过',()=>{
    const compare=runInNewContext(unchanged+';assertSnapshotUnchanged',{expect:playwrightExpect,isDeepStrictEqual}),before={tasks:[{sql:'合成SQL',detail:{value:1}}],history:[],marker:[{id:1,hits:0}]};
    expect(()=>compare(structuredClone(before),before)).not.toThrow();
  });
  it.each([undefined,true,false])('公共截图选项=%s只影响本例截图，原异常及精确清理保留',async captureFailureScreenshot=>{
    let screenshots=0,ended=0;const queries:string[]=[],original=new Error('合成原失败');
    const observer={query:async(value:{sql:string})=>{queries.push(value.sql);return[[]];},end:async()=>{ended++;}};
    const ports:any={environment:{DBARK_TEST_HOST:'合成端点',DBARK_TEST_USER:'合成用户'},randomUUID:()=> 'a'.repeat(32),Date:{now:()=>1000},tlsCertificate:()=>undefined,mysql:{createConnection:async()=>observer},connectAndCreate:async(database:string)=>({database,connectionId:'本例'}),expect:playwrightExpect,pageErrors:[],closed:false,page:{screenshot:async()=>{screenshots++;}},answerDialogs:async()=>undefined,quitDesktop:async()=>{ports.closed=true;}};
    const run=runInNewContext(isolated+';isolatedDatabase',ports);let failure:unknown;
    try{await run(async()=>{throw original;},{outputPath:(name:string)=>name},captureFailureScreenshot===undefined?undefined:{captureFailureScreenshot});}catch(error){failure=error;}
    expect(failure).toBe(original);expect(screenshots).toBe(captureFailureScreenshot===false?0:1);expect(ended).toBe(1);
    expect(queries[0]).toBe('DROP DATABASE IF EXISTS `dbark_e2e_rs_aaaaaaaa`');expect(queries).toHaveLength(2);
  });
});
