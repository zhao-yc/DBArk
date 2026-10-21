import {describe,it,expect,vi} from 'vitest';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {analyzeCompletion,type CompletionAnalysisReady} from '../../src/shared/completionAnalysis';
import {completionCapabilitiesForServer} from '../../src/shared/completionCapabilities';
import {completionSuggestions} from '../../src/renderer/completionSuggestions';
import {CompletionWorkerClient} from '../../src/renderer/completionWorkerClient';
import {CompletionDirectory} from '../../src/renderer/completionDirectory';
import type {CompletionDirectoryRequest,CompletionMetadataOutput} from '../../src/shared/sqlCompletion';

const enabled={insertRowAliases:true};
const sql='INSERT INTO app.users(id,name) VALUES (1,\'张三\') AS incoming ON DUPLICATE KEY UPDATE name=incoming.|';
function analyze(marked=sql,capabilities:Parameters<typeof analyzeCompletion>[3]=enabled,mode={}){return analyzeCompletion(marked.replace('|',''),marked.indexOf('|'),mode,capabilities);}
function ready(marked=sql):CompletionAnalysisReady{const result=analyze(marked);expect(result.status).toBe('ready');if(result.status!=='ready')throw Error('预期可分析');return result;}
/** 只模拟有权限的字段目录；解析、建议、真实 Worker 入口均使用产品代码。 */
function directory(){return{load:vi.fn(async(query:CompletionDirectoryRequest,_signal?:AbortSignal)=>({entries:query.kind==='columns'?[{name:'name',kind:'column' as const},{name:'created_at',kind:'column' as const}]:[{name:'routine',kind:'function' as const}],incomplete:false}))};}
async function stopped(marked:string,capabilities:Parameters<typeof analyzeCompletion>[3]=enabled){const result=analyze(marked,capabilities),d=directory();if(result.status==='ready')expect((await completionSuggestions(result,'wrong',d)).items).toEqual([]);expect(result.status).toBe('blocked');expect(d.load).not.toHaveBeenCalled();}
/** 实际浏览器 Worker 包装在 RAM 端口中，保持握手、请求校验和 WorkerClient 的消息链。 */
function workerBundle(){return buildSync({entryPoints:['src/renderer/completion.worker.ts'],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',logLevel:'silent'}).outputFiles[0].text;}
function workerPort(bundle:string){const messages:any[]=[],self:{postMessage:(data:unknown)=>void;onmessage?:(event:{data:unknown})=>void}={postMessage:data=>messages.push(structuredClone(data))};runInNewContext(bundle,{self,console:{error:()=>{throw Error('不能输出 SQL');},warn:()=>{},log:()=>{}},setTimeout,clearTimeout},{timeout:8000});return{messages,self};}

describe('INSERT VALUES／SET 新行别名补全',()=>{
  it.each([
    sql,
    'INSERT INTO app.users(id,name) VALUES (1,\'甲\'),(2,\'乙\') AS incoming ON DUPLICATE KEY UPDATE id=1,name=COALESCE(incoming.|,name)',
    'INSERT IGNORE app.users VALUE (1,\'甲\') AS incoming ON DUPLICATE KEY UPDATE name=(incoming.|)',
    'INSERT INTO app.users SET id=1,name=\'甲\' AS incoming ON DUPLICATE KEY UPDATE name=incoming.|',
    'INSERT INTO app.users SET id=1 AS incoming ON DUPLICATE KEY UPDATE id=incoming.|',
  ])('单行、多行及普通表达式只读真实目标表：%s',async marked=>{const a=ready(marked),d=directory(),result=await completionSuggestions(a,'wrong',d);expect(a.syntax).toEqual(['column']);expect(a.relations).toMatchObject([{name:'incoming',source:'table',database:'app',table:'users',aliased:true,columns:[]}]);expect(d.load).toHaveBeenCalledExactlyOnceWith({kind:'columns',database:'app',table:'users',prefix:''},undefined);expect(result.items.map(item=>item.label)).toEqual(['name','created_at']);expect(result.items.map(item=>item.insertText)).toEqual(['`name`','`created_at`']);});
  it('UTF16 范围保留原文与后缀，引用库表和带点别名保持单段名称',async()=>{const marked='/* 😀 */ INSERT INTO `app.db`.`user.table`(id) VALUES (1) AS `new.row` ON DUPLICATE KEY UPDATE name=`new.row`.`na|suffix`',a=ready(marked),d=directory(),result=await completionSuggestions(a,'wrong',d);expect(a.target).toMatchObject({start:marked.indexOf('`na'),end:marked.replace('|','').length,prefix:'na',qualifiers:['new.row'],quoted:true});expect(d.load).toHaveBeenCalledExactlyOnceWith({kind:'columns',database:'app.db',table:'user.table',prefix:'na'},undefined);expect(result.items.map(item=>item.insertText)).toEqual(['`name`']);});
  it('默认库只用于未限定目标表，未知默认库不猜测字段',async()=>{const a=ready(sql.replace('app.users','users')),d=directory();expect((await completionSuggestions(a,undefined,d)).items).toEqual([]);expect(d.load).not.toHaveBeenCalled();await completionSuggestions(a,'current',d);expect(d.load).toHaveBeenCalledExactlyOnceWith({kind:'columns',database:'current',table:'users',prefix:''},undefined);});
  it.each([
    'INSERT INTO users(id) VALUES (incoming.|) AS incoming ON DUPLICATE KEY UPDATE id=1',
    'INSERT INTO users(id) VALUES (1) AS incoming ON DUPLICATE KEY UPDATE incoming.|=1',
    'INSERT INTO users(id) VALUES (1) AS incoming(x) ON DUPLICATE KEY UPDATE id=incoming.|',
    'INSERT INTO users SET id=1 AS incoming(x) ON DUPLICATE KEY UPDATE id=incoming.|',
    'INSERT INTO users(id) VALUES (1) AS incoming ON DUPLICATE KEY UPDATE id=(SELECT incoming.|)',
    'INSERT INTO users(id) VALUES ((SELECT 1)) AS incoming ON DUPLICATE KEY UPDATE id=incoming.|',
    'INSERT INTO users(id) VALUES (1) AS users ON DUPLICATE KEY UPDATE id=users.|',
    'INSERT INTO users(id) VALUES (1) AS incoming ON DUPLICATE KEY UPDATE id=incoming.| +',
    'INSERT INTO users(id) VALUES (1) AS incoming ON DUPLICATE KEY UPDATE id=incoming.x.|',
    'INSERT INTO users(id) VALUES (1) AS incoming ON DUPLICATE KEY UPDATE id=Incoming.|',
    'INSERT INTO users(id) VALUES (1) AS incoming(x ON DUPLICATE KEY UPDATE id=incoming.|',
    'INSERT INTO users(id VALUES (1) AS incoming ON DUPLICATE KEY UPDATE id=incoming.|',
  ])('不支持、越界或恢复语法不能读取同名数据库例程：%s',async marked=>stopped(marked));
  it.each([{}, {insertRowAliases:false}, {windowFunctions:true,lateralDerivedTables:true}])('旧消息缺项及关闭能力不能开启新语法：%j',async cap=>stopped(sql,cap));
  it('预算与取消先于目录读取生效，未知元数据不从 INSERT 列清单造列',async()=>{expect(analyze('x'.repeat(262145)+'|')).toMatchObject({status:'blocked',reason:'budget'});const a=ready(),d=directory(),cancel=new AbortController();cancel.abort();expect((await completionSuggestions(a,'app',d,cancel.signal)).items).toEqual([]);expect(d.load).not.toHaveBeenCalled();const unavailable={load:vi.fn(async()=>{throw Error('目录不可用');})};expect(await completionSuggestions(a,'app',unavailable)).toMatchObject({items:[],incomplete:true,unavailable:true});});
  it.each([
    ['mysql','5.7.44',false],['mysql','8.0.18',false],['mysql','8.0.19',true],['mysql','8.0.19-log',true],['mysql','8.4.11',true],['mysql','8.0.36-TiDB',false],['mysql','9.0.1',false],['mysql',undefined,false],['mariadb','10.11.13-MariaDB',false],['mariadb','11.4.13-MariaDB',false],[undefined,'8.0.36',false],
  ]as const)('服务器门 %s / %s = %s',async(dialect,version,expected)=>{const cap=completionCapabilitiesForServer(dialect,version);expect(cap.insertRowAliases).toBe(expected);if(expected)expect(analyze(sql,cap).status).toBe('ready');else await stopped(sql,cap);});
  it('注释、字符串和后续语句不声明局部别名，合法 schema 例程仍可读取',async()=>{for(const marked of[
    'SELECT /* INSERT INTO users VALUES(1) AS incoming */ incoming.|',
    "SELECT 'INSERT INTO users VALUES(1) AS incoming',incoming.|",
    sql.replace('incoming.|','incoming.name')+'; SELECT incoming.|',
  ]){const a=ready(marked),d=directory();expect(a.relations.some(value=>value.name==='incoming')).toBe(false);await completionSuggestions(a,'app',d);expect(d.load.mock.calls.every(([query])=>query.kind==='objects'&&query.database==='incoming')).toBe(true);expect(d.load).toHaveBeenCalled();}for(const marked of['UPDATE app.users u SET name=u.|','DELETE FROM app.users WHERE |','INSERT INTO app.users (|) VALUES (1)'])expect(ready(marked).relations.some(value=>value.table==='users')).toBe(true);});
  it.each(["INSERT INTO users(id) VALUES (1) AS incoming ON DUPLICATE KEY UPDATE id='incoming.|'",'INSERT INTO users(id) VALUES (1) AS incoming ON DUPLICATE KEY UPDATE id=1 /* incoming.| */'])('串注释内不进入语义分析：%s',async marked=>stopped(marked));
  it('真实 Worker 的缺省能力和非法消息保持关闭，客户端只传独立能力快照',async()=>{
    const bundle=workerBundle(),f=workerPort(bundle);expect(f.messages).toEqual([{type:'dbark-completion-ready',version:1}]);
    for(const[id,capabilities]of[[1,undefined],[2,{windowFunctions:true}],[3,enabled],[4,{insertRowAliases:'true'}],[5,{insertRowAliases:true,extra:true}],[6,{windowFunctions:'true',insertRowAliases:true}],[7,null],[8,[]]]as const){f.self.onmessage!({data:{id,source:sql.replace('|',''),offset:sql.indexOf('|'),mode:{},capabilities}});expect(f.messages.at(-1).result.status).toBe(id===3?'ready':'blocked');}
    let bridge:ReturnType<typeof workerPort>;
    const client=new CompletionWorkerClient(()=>{bridge=workerPort(bundle);const port={onmessage:null as ((event:any)=>void)|null,onerror:null,onmessageerror:null,postMessage:(data:unknown)=>{bridge.self.onmessage!({data});port.onmessage?.({data:bridge.messages.at(-1)});},terminate:vi.fn()};queueMicrotask(()=>port.onmessage?.({data:bridge.messages[0]}));return port;});
    const cap={insertRowAliases:true},pending=client.analyze(sql.replace('|',''),sql.indexOf('|'),{},undefined,cap);cap.insertRowAliases=false;const a=await pending;expect(a.status).toBe('ready');if(a.status==='ready'){const d=directory();await completionSuggestions(a,'wrong',d);expect(d.load).toHaveBeenCalledExactlyOnceWith({kind:'columns',database:'app',table:'users',prefix:''},undefined);}client.dispose();
  },20000);
  it('模型取消和连接撤销后，真实目录的迟到字段不会交付或污染新连接',async()=>{
    const a=ready(),replies:((value:CompletionMetadataOutput)=>void)[]=[],request=vi.fn(()=>new Promise<CompletionMetadataOutput>(resolve=>replies.push(resolve))),cancel=vi.fn(async()=>{});let serial=0;
    const old=new CompletionDirectory('old',1,{request,cancel,id:()=>String(++serial)}),model=new AbortController(),first=completionSuggestions(a,'app',old,model.signal);model.abort();replies[0]({entries:[{name:'late_model',kind:'column'}],incomplete:false});expect((await first).items).toEqual([]);
    const second=completionSuggestions(a,'app',old);old.dispose();replies[1]({entries:[{name:'late_connection',kind:'column'}],incomplete:false});expect((await second).items).toEqual([]);
    const fresh=new CompletionDirectory('new',2,{request,cancel,id:()=>String(++serial)}),third=completionSuggestions(a,'app',fresh);replies[2]({entries:[{name:'fresh',kind:'column'}],incomplete:false});expect((await third).items.map(item=>item.label)).toEqual(['fresh']);expect(request.mock.calls).toHaveLength(3);expect(cancel).toHaveBeenCalledTimes(2);fresh.dispose();
  });
});
