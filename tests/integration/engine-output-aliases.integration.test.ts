import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import mysql from 'mysql2';
import {Engine} from '../../src/engine';
import {connect,execute,type ManagedConnection} from '../../src/engine/connection';
import {analyzeCompletion} from '../../src/shared/completionAnalysis';
import {completionSuggestions} from '../../src/renderer/completionSuggestions';
import type {ConnectionProfile,QueryOutcome,TaskEvent} from '../../src/shared/contracts';

const enabled=process.env.DBARK_INTEGRATION_ENABLED==='1';
const profile:ConnectionProfile={id:randomUUID(),name:'输出别名隔离验收',group:'',color:'#123456',dialect:'mysql',host:process.env.DBARK_TEST_HOST??'',port:Number(process.env.DBARK_TEST_PORT??13384),user:process.env.DBARK_TEST_USER??'',password:process.env.DBARK_TEST_PASSWORD,...(process.env.DBARK_TEST_TLS==='1'?{tls:{enabled:true,rejectUnauthorized:true,caPath:process.env.DBARK_TEST_CA}}:{})};
const events:TaskEvent[]=[],engine=new Engine(event=>events.push(event)),drivers=new Set<ReturnType<typeof mysql.createConnection>>();
let observer:ManagedConnection|undefined,restore:(()=>void)|undefined,sessionId='';
/** 所有语句仅使用常量或派生表，不创建用户、库表、授权或全局设置。 */
const run=(sql:string)=>engine.handle('query.execute',{sessionId,taskId:randomUUID(),sql,maxRows:20});
/** 以实际结果列键读取值，兼容结果网格对重名和内部字段键的处理。 */
function values(result:QueryOutcome){const set=result.results[0];return set.rows.map(row=>set.columns.map(column=>String(row[column.key])));}
/** 使用实际会话模式分析，唯一允许的目录替身是拒绝任何不必要的目录读取。 */
async function suggestions(marked:string){
  const state=await engine.handle('query.completionState',{sessionId}),source=marked.replace('|',''),analysis=analyzeCompletion(source,marked.indexOf('|'),state);
  expect(analysis.status).toBe('ready');if(analysis.status!=='ready')throw Error('真实别名分析未就绪');const before=events.length;
  const result=await completionSuggestions(analysis,undefined,{load:async()=>{throw Error('纯本地投影不得读取物理目录');}},undefined,state.dialect);
  expect(events).toHaveLength(before);return{analysis,result,source};
}
/** 接受实际候选后执行同一份SQL；不是仅检查解析器返回了一个名称。 */
async function complete(marked:string,label:string){const{analysis,result,source}=await suggestions(marked),item=result.items.find(item=>item.label===label&&['SELECT 输出别名','集合查询输出列'].includes(item.detail));expect(item).toBeDefined();if(!item)throw Error('缺少可执行输出别名');return run(source.slice(0,analysis.target.start)+item.insertText+source.slice(analysis.target.end));}

describe.skipIf(!enabled)('200隔离实例：输出别名补全与真实SQL语义',()=>{
  beforeAll(async()=>{
    if(profile.host!=='192.168.31.200'||![13357,13380,13384,13310,13311,13484].includes(profile.port))throw Error('仅允许已核对200隔离实例');
    const original=mysql.createConnection,recording=vi.spyOn(mysql,'createConnection').mockImplementation(options=>{const driver=original(options);drivers.add(driver);return driver;});restore=()=>recording.mockRestore();
    observer=await connect(profile);await engine.handle('connections.open',{id:profile.id,profile});sessionId=(await engine.handle('sessions.open',{connectionId:profile.id})).sessionId;
  },30000);
  afterAll(async()=>{try{await engine.closeAll();if(observer){const ids=[...drivers].filter(driver=>driver!==observer!.connection).map(driver=>driver.threadId).filter((id):id is number=>typeof id==='number'&&id>0);expect(ids.length).toBeGreaterThan(0);expect((await execute<Record<string,unknown>[]>(observer,'SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN ('+ids.map(()=>'?').join(',')+')',ids)).rows).toHaveLength(0);console.log(JSON.stringify({验收说明:'输出别名实际驱动连接逐ID释放',连接数量:ids.length,残留数量:0}));}}finally{try{await observer?.close({strict:true});}finally{restore?.();}}},30000);
  it('真实服务器方言覆盖配置，并采用原会话缓存',async()=>{const state=await engine.handle('query.completionState',{sessionId}),version=(await run('SELECT VERSION() AS version')).results[0];expect(state.dialect).toBe(/mariadb/i.test(String(version.rows[0][version.columns[0].key]))?'mariadb':'mysql');});
  it('ORDER使用输出别名排序而非同名原字段',async()=>{expect(values(await complete('SELECT a AS b FROM (SELECT 1 AS a,2 AS b UNION ALL SELECT 2 AS a,1 AS b)t ORDER BY b|','b'))).toEqual([['1'],['2']]);});
  it('GROUP标量别名可分组，HAVING聚合别名可筛选',async()=>{expect(values(await complete('SELECT a+1 AS bucket_name,COUNT(*) AS n FROM (SELECT 1 AS a UNION ALL SELECT 1 UNION ALL SELECT 2)t GROUP BY buck| ORDER BY bucket_name','bucket_name'))).toEqual([['2','2'],['3','1']]);expect(values(await complete('SELECT SUM(a) AS combined_total FROM (SELECT 1 AS a UNION ALL SELECT 2)t HAVING comb|>2','combined_total'))).toEqual([['3']]);});
  it('字符串别名用标识符引用，点号、反引号及中文不分拆',async()=>{for(const name of ['显示.名称','含`反引号']){const literal=name.replaceAll("'","''"),result=await complete("SELECT a AS '"+literal+"' FROM (SELECT 2 AS a UNION ALL SELECT 1)t ORDER BY |",name);expect(result.results[0].columns[0].name).toBe(name);expect(values(result)).toEqual([['1'],['2']]);}});
  it('UNION全局排序采用首分支输出，分支内部采用自己的输出',async()=>{expect(values(await complete('(SELECT 2 AS first_alias) UNION ALL (SELECT 1 AS later_alias) ORDER BY fir|','first_alias'))).toEqual([['1'],['2']]);expect(values(await complete('SELECT 2 AS first_alias UNION ALL (SELECT a AS later_alias FROM (SELECT 3 AS a UNION ALL SELECT 1)t ORDER BY lat| LIMIT 1)','later_alias'))).toEqual([['2'],['1']]);});
  it('同SELECT和WHERE不提供输出别名，GROUP不推荐聚合别名',async()=>{for(const marked of ['SELECT 1 AS displayed_name,disp|','SELECT a AS displayed_name FROM (SELECT 1 AS a)t WHERE disp|=1','SELECT SUM(a) AS displayed_name FROM (SELECT 1 AS a)t GROUP BY disp|']){const{result}=await suggestions(marked);expect(result.items.filter(item=>item.detail==='SELECT 输出别名')).toEqual([]);}});
  it('GROUP/HAVING保留同名原字段优先，输出别名不误导用户',async()=>{for(const clause of ['GROUP BY','HAVING']){const{result}=await suggestions('SELECT a AS b FROM (SELECT 1 AS a,2 AS b)t '+clause+' b|');expect(result.items.some(item=>item.detail==='SELECT 输出别名')).toBe(false);expect(result.items.some(item=>item.insertText==='`t`.`b`')).toBe(true);}});
  it('不同查询块与多个脚本语句的投影不串用',async()=>{const{analysis}=await suggestions('SELECT 9 AS previous_alias;SELECT a AS outer_alias FROM (SELECT 1 AS a)t WHERE EXISTS(SELECT 1 AS inner_alias ORDER BY inn|)');expect(analysis.outputAliases?.aliases).toEqual(['inner_alias']);expect(values(await complete('SELECT a AS outer_alias FROM (SELECT 1 AS a)t WHERE EXISTS(SELECT 1 AS inner_alias ORDER BY inn|)','inner_alias'))).toEqual([['1']]);});
  it('长别名引用按实际方言字节边界，超出时不猜截断后的名称',async()=>{
    const state=await engine.handle('query.completionState',{sessionId});
    for(const name of ['a'.repeat(255),'字'.repeat(85),'a'.repeat(256),'字'.repeat(85)+'a','字'.repeat(86)]){const marked='SELECT a AS `'+name+'` FROM (SELECT 1 AS a)t ORDER BY |',valid=Buffer.byteLength(name,'utf8')<=(state.dialect==='mysql'?256:255),{result}=await suggestions(marked);expect(result.items.some(item=>item.label===name)).toBe(valid);if(valid){expect(values(await complete(marked,name))).toEqual([['1']]);}else{expect(result.incomplete).toBe(true);await expect(run(marked.replace('|','`'+name+'`'))).rejects.toThrow(/Unknown column/);}}
    // 错误会使模式未知；明确的用户SQL恢复本测试所需状态，不隐式重放失败语句。
    await run("SET SESSION sql_mode='ONLY_FULL_GROUP_BY'");
  });
});
