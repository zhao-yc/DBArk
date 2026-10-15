import{describe,it,expect}from'vitest';
import{warmupCompletionAnalysis}from'../../src/shared/completionWarmup';
import{analyzeCompletion}from'../../src/shared/completionAnalysis';
import{buildSync}from'esbuild';
import{runInNewContext}from'node:vm';
describe('解析器启动必须包含真实语法预测及投影收集',()=>{
  it('初始化后不同CTE的实际投影独立，不能把固定样本名称带给用户',()=>{
    expect(()=>warmupCompletionAnalysis()).not.toThrow();const source='WITH actual AS (SELECT 7 AS different_column) SELECT actual.d FROM actual',result=analyzeCompletion(source,source.indexOf('.d')+2);
    expect(result.status).toBe('ready');if(result.status!=='ready')throw Error('真实解析没有就绪');expect(result.relations.find(relation=>relation.name==='actual')?.columns).toEqual(['different_column']);expect(JSON.stringify(result)).not.toContain('records');expect(JSON.stringify(result)).not.toContain('entry');
  });
  it('真实Worker入口先完成本地初始化，再独立处理用户投影，错误输入不能暴露固定结果',()=>{
    const bundle=buildSync({entryPoints:['src/renderer/completion.worker.ts'],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',logLevel:'silent'}).outputFiles[0].text,messages:any[]=[],port:{postMessage:(value:unknown)=>void;onmessage?:(event:{data:unknown})=>void}={postMessage:value=>messages.push(structuredClone(value))};
    runInNewContext(bundle,{self:port,console:{error:()=>{throw Error('语法入口不应输出正文');},warn:()=>undefined,log:()=>undefined},setTimeout,clearTimeout},{timeout:8000});expect(messages).toEqual([{type:'dbark-completion-ready',version:1}]);
    const source='WITH actual AS (SELECT 1 AS user_field) SELECT actual.u FROM actual';port.onmessage!({data:{id:17,source,offset:source.indexOf('.u')+2,mode:{ansiQuotes:false,noBackslashEscapes:true}}});expect(messages.at(-1)).toMatchObject({id:17,result:{status:'ready',relations:[{name:'actual',columns:['user_field']}]}});port.onmessage!({data:{id:18,source,offset:-1,mode:{}}});expect(messages.at(-1)).toEqual({id:18,result:{status:'blocked',reason:'budget'}});
  });
});
