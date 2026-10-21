import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {describe,expect,it} from 'vitest';
import {analyzeCompletion} from '../../src/shared/completionAnalysis';
import {completionCapabilitiesForServer} from '../../src/shared/completionCapabilities';
import {completionSuggestions} from '../../src/renderer/completionSuggestions';
import type {CompletionDirectoryRequest} from '../../src/shared/sqlCompletion';

const enabled={insertRowAliases:true};
const statement='INSERT INTO users SET id=1 AS incoming ON DUPLICATE KEY UPDATE id=incoming.§';

/** 真实分析器与建议器共用显式能力；只把有权限的字段目录替换为RAM，不连接数据库。 */
async function complete(marked:string,capabilities:Parameters<typeof analyzeCompletion>[3]=enabled,database:string|null='active'){
  const analysis=analyzeCompletion(marked.replace('§',''),marked.indexOf('§'),{noBackslashEscapes:true},capabilities),requests:CompletionDirectoryRequest[]=[];
  const result=analysis.status==='ready'?await completionSuggestions(analysis,database??undefined,{async load(query){requests.push(query);return{entries:[{name:'amount',kind:'column' as const}],incomplete:false};}}):{items:[]};
  return{analysis,requests,items:result.items};
}

describe('INSERT SET新行别名的目标、作用域及真实Worker',()=>{
  it.each([
    'INSERT INTO app.sales SET id=1,amount=DEFAULT AS incoming ON DUPLICATE KEY UPDATE amount=incoming.am§',
    "INSERT IGNORE app.sales SET id=1,amount=COALESCE(CAST('1.25' AS DECIMAL(10,2)),0) AS incoming ON DUPLICATE KEY UPDATE id=2,amount=COALESCE(incoming.am§,amount)",
    "/* 😀 */ INSERT HIGH_PRIORITY INTO app.sales SET `amount`=1 /* AS fake */,id=JSON_EXTRACT('{\"a\":1}','$.a') AS incoming ON DUPLICATE KEY UPDATE amount=(incoming.am§)",
    'INSERT INTO `app.db`.`sales.table` SET amount=CAST(1 AS DECIMAL) AS `new.row` ON DUPLICATE KEY UPDATE amount=`new.row`.`am§tail`',
  ])('只读取真实插入目标字段并保留精确替换：%s',async marked=>{
    const r=await complete(marked);expect(r.analysis.status).toBe('ready');expect(r.requests).toEqual([{kind:'columns',database:marked.includes('`app.db`')?'app.db':'app',table:marked.includes('`sales.table`')?'sales.table':'sales',prefix:'am'}]);expect(r.items).toEqual([expect.objectContaining({label:'amount',insertText:'`amount`',kind:'column'})]);
    if(r.analysis.status==='ready'){const{start,end}=r.analysis.target,source=marked.replace('§','');expect(source.slice(0,start)+'`amount`'+source.slice(end)).toContain(marked.includes('`new.row`')?'`new.row`.`amount`':'incoming.`amount`');}
  });
  it('原被拒绝的简单SET现在只读当前库目标，未知默认库仍不读取任何目录',async()=>{
    const r=await complete(statement);expect(r.analysis.status).toBe('ready');expect(r.requests).toEqual([{kind:'columns',database:'active',table:'users',prefix:''}]);
    const unknown=await complete(statement,enabled,null);expect(unknown.requests).toEqual([]);expect(unknown.items).toEqual([]);
  });
  it.each([
    'INSERT INTO users SET id=incoming.§ AS incoming ON DUPLICATE KEY UPDATE id=1',
    'INSERT INTO users SET id=1 AS incoming ON DUPLICATE KEY UPDATE incoming.§=1',
    'INSERT INTO users SET id=1 AS incoming(x) ON DUPLICATE KEY UPDATE id=incoming.§',
    'INSERT INTO users SET id=1 AS users ON DUPLICATE KEY UPDATE id=users.§',
    'INSERT INTO users(id) SET id=1 AS incoming ON DUPLICATE KEY UPDATE id=incoming.§',
    'INSERT INTO users SET id=1, AS incoming ON DUPLICATE KEY UPDATE id=incoming.§',
    'INSERT INTO users SET id= AS incoming ON DUPLICATE KEY UPDATE id=incoming.§',
    'INSERT INTO users SET id:=1 AS incoming ON DUPLICATE KEY UPDATE id=incoming.§',
    'INSERT INTO users SET users.id=1 AS incoming ON DUPLICATE KEY UPDATE id=incoming.§',
    'INSERT INTO users SET id=(SELECT 1) AS incoming ON DUPLICATE KEY UPDATE id=incoming.§',
    'INSERT INTO users SET id=1 AS incoming ON DUPLICATE KEY UPDATE id=(SELECT incoming.§)',
    'INSERT INTO users SET id=CAST(1 AS SIGNED AS incoming ON DUPLICATE KEY UPDATE id=incoming.§',
    'INSERT INTO users SET id=1 AS incoming ON DUPLICATE KEY UPDATE id=Incoming.§',
    'INSERT INTO users SET id=1 AS incoming ON DUPLICATE KEY UPDATE id=incoming.x.§',
    'INSERT INTO users SET id=1 AS incoming ON DUPLICATE KEY UPDATE id=incoming.§+',
    'INSERT INTO users SET id=1+ AS incoming ON DUPLICATE KEY UPDATE id=incoming.§',
    'INSERT INTO users SET id=COALESCE(1,) AS incoming ON DUPLICATE KEY UPDATE id=incoming.§',
  ])('不支持或非法局部名称不能回退同名schema目录：%s',async marked=>{const r=await complete(marked);expect(r.analysis.status).toBe('blocked');expect(r.requests).toEqual([]);});
  it.each([['mysql','8.0.18',false],['mysql','8.0.19',true],['mysql','8.4.11',true],['mariadb','11.4.13-MariaDB',false],['mysql','8.0.36-TiDB',false]] as const)('SET复用原服务器能力门：%s/%s',async(dialect,version,allowed)=>{
    const r=await complete(statement,completionCapabilitiesForServer(dialect,version));expect(r.analysis.status).toBe(allowed?'ready':'blocked');expect(r.requests.length).toBe(allowed?1:0);
  });
  it('SET没有行声明时，嵌套CAST的AS不抢占真实schema函数',async()=>{
    const r=await complete('INSERT INTO users SET id=CAST(1 AS SIGNED) ON DUPLICATE KEY UPDATE id=reporting.am§()');expect(r.analysis.status).toBe('ready');expect(r.requests).toEqual([{kind:'objects',database:'reporting',objectKind:'function',prefix:'am'}]);
  });
  it('实际浏览器Worker保持缺省关闭，显式能力才返回SET目标；不输出SQL',()=>{
    const bundle=buildSync({entryPoints:['src/renderer/completion.worker.ts'],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',logLevel:'silent'}).outputFiles[0].text,messages:any[]=[],self:{postMessage(value:unknown):void;onmessage?:(event:{data:unknown})=>void}={postMessage:value=>messages.push(structuredClone(value))};
    runInNewContext(bundle,{self,console:{error:()=>{throw Error('不能输出SQL');},warn:()=>{},log:()=>{}},setTimeout,clearTimeout},{timeout:8000});expect(messages).toEqual([{type:'dbark-completion-ready',version:1}]);
    for(const[id,capabilities]of[[1,undefined],[2,enabled],[3,{insertRowAliases:false}]] as const){self.onmessage!({data:{id,source:statement.replace('§',''),offset:statement.indexOf('§'),mode:{},capabilities}});expect(messages.at(-1).result.status).toBe(id===2?'ready':'blocked');if(id===2)expect(messages.at(-1).result.relations).toMatchObject([{name:'incoming',table:'users',source:'table'}]);}
  });
});
