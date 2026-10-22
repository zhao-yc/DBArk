import {randomUUID} from 'node:crypto';
import mysql from 'mysql2';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {Engine} from '../../src/engine';
import {connect,execute,type ManagedConnection} from '../../src/engine/connection';
import {identifier,qualified} from '../../src/engine/sql';
import type {ConnectionProfile,QueryOutcome,TaskEvent} from '../../src/shared/contracts';
import type {CompletionSessionState} from '../../src/shared/sqlCompletion';
const enabled=process.env.DBARK_INTEGRATION_ENABLED==='1',database=()=> 'dbark_colperm_'+randomUUID().replaceAll('-','').slice(0,12),a=database(),b=database(),c=database();
const profile:ConnectionProfile={id:randomUUID(),name:'补全会话协议验收',group:'',color:'#123456',dialect:'mysql',host:process.env.DBARK_TEST_HOST??'',port:Number(process.env.DBARK_TEST_PORT??13384),user:process.env.DBARK_TEST_USER??'',password:process.env.DBARK_TEST_PASSWORD,...(process.env.DBARK_TEST_TLS==='1'?{tls:{enabled:true,rejectUnauthorized:true,caPath:process.env.DBARK_TEST_CA}}:{})};
const events:TaskEvent[]=[],engine=new Engine(event=>events.push(event)),drivers=new Set<ReturnType<typeof mysql.createConnection>>();let observer:ManagedConnection|undefined,restore:(()=>void)|undefined;
/** 使用生产会话命令，缓存读取不借用观察连接或人为填充默认库。 */
const state=(sessionId:string):Promise<CompletionSessionState>=>engine.handle('query.completionState',{sessionId});
const run=(sessionId:string,sql:string):Promise<QueryOutcome>=>engine.handle('query.execute',{sessionId,sql,taskId:randomUUID(),maxRows:20});
/** 结果行按稳定列键保存，显示别名不能当作对象属性；精确值保持原类型。 */
function cell(outcome:QueryOutcome,name:string){const result=outcome.results[0],columns=result.columns.filter(column=>column.name===name);expect(columns).toHaveLength(1);return result.rows[0][columns[0].key];}
/** 每例用独立会话，异常时也释放临时表和事务；库清理由套件按精确名称执行。 */
async function session<T>(body:(id:string)=>Promise<T>,schema:string|undefined=a):Promise<T>{const{sessionId}=await engine.handle('sessions.open',{connectionId:profile.id,database:schema});try{return await body(sessionId);}finally{await engine.handle('sessions.close',{sessionId});}}
describe.skipIf(!enabled)('200隔离实例：补全读取真实会话缓存',()=>{
  beforeAll(async()=>{
    if(profile.host!=='192.168.31.200'||![13357,13380,13384,13310,13311,13484].includes(profile.port))throw Error('只允许已核对200隔离实例');
    const create=mysql.createConnection,recording=vi.spyOn(mysql,'createConnection').mockImplementation(config=>{const driver=create(config);drivers.add(driver);return driver;});restore=()=>recording.mockRestore();
    await engine.handle('connections.open',{id:profile.id,profile});observer=await connect(profile);
    for(const name of[a,b])await execute(observer,`CREATE DATABASE ${identifier(name)} CHARACTER SET utf8mb4`);
    await execute(observer,`CREATE TABLE ${qualified(a,'subject')}(id INT PRIMARY KEY,a_column TEXT) ENGINE=InnoDB`);await execute(observer,`CREATE TABLE ${qualified(b,'subject')}(id INT PRIMARY KEY,b_column TEXT) ENGINE=InnoDB`);await execute(observer,`CREATE PROCEDURE ${qualified(a,'p_schema')}() SELECT DATABASE() AS actual_database`);
  },60000);
  afterAll(async()=>{
    try{await engine.closeAll();if(observer){for(const name of[a,b,c]){if(!/^dbark_colperm_[a-f0-9]{12}$/.test(name))throw Error('清理目标不符');await execute(observer,`DROP DATABASE IF EXISTS ${identifier(name)}`);}expect((await execute<Record<string,unknown>[]>(observer,'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?,?,?)',[a,b,c])).rows).toHaveLength(0);const ids=[...drivers].filter(driver=>driver!==observer!.connection).map(driver=>driver.threadId).filter((id):id is number=>typeof id==='number'&&id>0);expect(ids.length).toBeGreaterThan(0);expect((await execute<Record<string,unknown>[]>(observer,'SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN ('+ids.map(()=>'?').join(',')+')',ids)).rows).toHaveLength(0);console.log(JSON.stringify({验收说明:'会话补全缓存实际连接逐ID释放',连接数量:ids.length,残留数量:0}));}}
    finally{try{await observer?.close({strict:true});}finally{restore?.();}}
  },60000);
  it('新会话初始化确认默认库与模式，无默认库和未知状态分开表示',async()=>{
    await session(async id=>{const cached=await state(id);expect(cached).toMatchObject({database:a,databaseKnown:true,broken:false,busy:false});expect(typeof cached.ansiQuotes).toBe('boolean');expect(typeof cached.noBackslashEscapes).toBe('boolean');});
    const{sessionId}=await engine.handle('sessions.open',{connectionId:profile.id});try{expect(await state(sessionId)).toMatchObject({database:null,databaseKnown:true,broken:false,busy:false});}finally{await engine.handle('sessions.close',{sessionId});}
  });
  it('历史事件在会话互斥内固定执行前默认库，脚本切库、参数和失败不挪用完成后的库',async()=>session(async id=>{
    await run(id,`USE ${identifier(b)}`);
    const taskId=randomUUID();await engine.handle('query.execute',{sessionId:id,taskId,sql:`USE ${identifier(a)};SELECT DATABASE()`,maxRows:20});
    expect(events.filter(event=>event.taskId===taskId&&event.executionDatabase).map(event=>event.executionDatabase)).toEqual([{state:'known',database:b}]);expect((await state(id)).database).toBe(a);
    const parameterId=randomUUID();await engine.handle('query.executeParameterized',{sessionId:id,taskId:parameterId,sql:'SELECT :v',parameters:[{name:'v',type:'text',value:'参数'}],maxRows:20});expect(events.find(event=>event.taskId===parameterId&&event.executionDatabase)?.executionDatabase).toEqual({state:'known',database:a});
    const failed=randomUUID();await expect(engine.handle('query.execute',{sessionId:id,taskId:failed,sql:'SELECT * FROM dbark_missing_context_subject',maxRows:20})).resolves.toMatchObject({results:[],failure:{statementOrdinal:1,statementsCompleted:0,message:expect.any(String)}});expect(events.find(event=>event.taskId===failed&&event.executionDatabase)?.executionDatabase).toEqual({state:'known',database:a});
    const unknown=randomUUID();await engine.handle('query.execute',{sessionId:id,taskId:unknown,sql:'SELECT 1',maxRows:20});expect(events.find(event=>event.taskId===unknown&&event.executionDatabase)?.executionDatabase).toEqual({state:'unknown'});
  }));
  it('显式空库建连覆盖连接配置默认库，历史事件不会把无库误记为配置库',async()=>{
    const configured={...profile,id:randomUUID(),database:a};await engine.handle('connections.open',{id:configured.id,profile:configured});const{sessionId}=await engine.handle('sessions.open',{connectionId:configured.id,database:null});
    try{expect(await state(sessionId)).toMatchObject({databaseKnown:true,database:null});const taskId=randomUUID();expect(cell(await engine.handle('query.execute',{sessionId,taskId,sql:'SELECT DATABASE() AS db',maxRows:20}),'db')).toBeNull();expect(events.find(event=>event.taskId===taskId&&event.executionDatabase)?.executionDatabase).toEqual({state:'known',database:null});}
    finally{await engine.handle('sessions.close',{sessionId});await engine.handle('connections.close',{id:configured.id});}
  });
  it('USE后的目录来源为B，原连接、事务和A库临时表保持独立',async()=>session(async id=>{
    await run(id,'CREATE TEMPORARY TABLE marker(v BIGINT);INSERT INTO marker VALUES(9007199254740993);BEGIN;INSERT INTO subject(id,a_column) VALUES(19,\'未提交\')');const before=(await run(id,'SELECT CONNECTION_ID() AS id,v FROM marker')).results[0].rows[0];await run(id,`USE ${identifier(b)}`);const cached=await state(id);expect(cached.database).toBe(b);const directory=await engine.handle('metadata.completion',{connectionId:profile.id,taskId:randomUUID(),kind:'columns',database:cached.database,table:'subject',prefix:''});expect(directory.entries.map((value:{name:string})=>value.name)).toContain('b_column');expect(directory.entries.map((value:{name:string})=>value.name)).not.toContain('a_column');expect((await run(id,`SELECT CONNECTION_ID() AS id,v FROM ${qualified(a,'marker')}`)).results[0].rows[0]).toEqual(before);expect((await engine.handle('query.sessionState',{sessionId:id})).transactionOpen).toBe(true);expect((await execute<Record<string,unknown>[]>(observer!,`SELECT COUNT(*) AS n FROM ${qualified(a,'subject')} WHERE id=19`)).rows[0].n).toBe('0');await engine.handle('query.transaction',{sessionId:id,action:'rollback'});
  }));
  it('反复读取缓存不覆盖ROW_COUNT或SHOW WARNINGS',async()=>session(async id=>{
    await run(id,"INSERT INTO subject(id,a_column) VALUES(21,'诊断保留')");await state(id);await state(id);expect(cell(await run(id,'SELECT ROW_COUNT() AS n'),'n')).toBe('1');await run(id,"SELECT CAST('not_a_number' AS UNSIGNED) AS v");await state(id);await state(id);expect((await run(id,'SHOW WARNINGS')).results[0].rows.length).toBeGreaterThan(0);
  }));
  it('模式变更从协议缓存传给补全，不读取额外SQL模式',async()=>session(async id=>{
    await run(id,"SET SESSION sql_mode='ANSI_QUOTES,NO_BACKSLASH_ESCAPES'");expect(await state(id)).toMatchObject({database:a,databaseKnown:true,ansiQuotes:true,noBackslashEscapes:true});const result=await run(id,'SELECT "a_column" FROM subject');expect(result.results[0].columns.map(value=>value.name)).toEqual(['a_column']);
  }));
  it('双跟踪关闭后的USE标记未知，恢复配置仍等待真实库名通知',async()=>session(async id=>{
    await run(id,"SET SESSION session_track_system_variables='';SET SESSION session_track_schema=OFF");await run(id,`USE ${identifier(b)}`);expect(await state(id)).toMatchObject({databaseKnown:false,broken:false});expect(await state(id)).not.toHaveProperty('database');await run(id,"SET SESSION session_track_schema=ON;SET SESSION session_track_system_variables='sql_mode,session_track_schema,session_track_system_variables'");expect((await state(id)).databaseKnown).toBe(false);await run(id,`USE ${identifier(b)}`);expect(await state(id)).toMatchObject({database:b,databaseKnown:true});
  }));
  it('跨库CALL以最后实际恢复的默认库为准，不采用过程内部库',async()=>session(async id=>{
    await run(id,`CALL ${qualified(a,'p_schema')}()`);expect(await state(id)).toMatchObject({database:b,databaseKnown:true,busy:false});expect(cell(await run(id,'SELECT DATABASE() AS db'),'db')).toBe(b);
  },b));
  it('ERR后不以普通EOF恢复旧库，后续USE真报告才确认',async()=>session(async id=>{
    await expect(run(id,'SELECT missing_column FROM missing_table')).resolves.toMatchObject({results:[],failure:{statementOrdinal:1,statementsCompleted:0,message:expect.any(String)}});expect(await state(id)).toMatchObject({databaseKnown:false,broken:false});await run(id,'SELECT 1');expect((await state(id)).databaseKnown).toBe(false);await run(id,`USE ${identifier(b)}`);expect(await state(id)).toMatchObject({database:b,databaseKnown:true});
  }));
  it('繁忙会话只返回忙碌快照，读取缓存不取消原长查询',async()=>session(async id=>{
    const taskId=randomUUID(),query=engine.handle('query.execute',{sessionId:id,sql:'SELECT SLEEP(10)',taskId,maxRows:1}),failure=expect(query).rejects.toThrow();await expect.poll(async()=>(await state(id)).busy).toBe(true);expect(await state(id)).toEqual({databaseKnown:false,broken:false,busy:true});expect(events.filter(event=>event.taskId===taskId).at(-1)?.status).toBe('running');await engine.handle('query.cancel',{taskId});await failure;expect(events.filter(event=>event.taskId===taskId).at(-1)?.status).toBe('cancelled');
  }));
  it('预处理删除当前隔离库的空名称报告表示确认无默认库',async()=>{
    await execute(observer!,`CREATE DATABASE ${identifier(c)} CHARACTER SET utf8mb4`);await session(async id=>{await run(id,`PREPARE cleanup_stmt FROM 'DROP DATABASE ${identifier(c)}';EXECUTE cleanup_stmt;DEALLOCATE PREPARE cleanup_stmt`);expect(await state(id)).toMatchObject({database:null,databaseKnown:true,broken:false,busy:false});},c);
  });
});
