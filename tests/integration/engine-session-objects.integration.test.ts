import {randomUUID} from 'node:crypto';
import mysql from 'mysql2';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {Engine} from '../../src/engine';
import {connect,execute,type ManagedConnection} from '../../src/engine/connection';
import {identifier,qualified} from '../../src/engine/sql';
import type {ConnectionProfile,QueryOutcome,TaskEvent} from '../../src/shared/contracts';
const enabled=process.env.DBARK_INTEGRATION_ENABLED==='1',suffix=randomUUID().replaceAll('-','').slice(0,12),database='dbark_colperm_'+suffix,other='dbark_colperm_'+randomUUID().replaceAll('-','').slice(0,12),user='cp_'+suffix,password=randomUUID()+randomUUID();
const profile:ConnectionProfile={id:randomUUID(),name:'会话临时对象隔离验收',group:'',color:'#123456',dialect:'mysql',host:process.env.DBARK_TEST_HOST??'',port:Number(process.env.DBARK_TEST_PORT??13384),user:process.env.DBARK_TEST_USER??'',password:process.env.DBARK_TEST_PASSWORD,...(process.env.DBARK_TEST_TLS==='1'?{tls:{enabled:true,rejectUnauthorized:true,caPath:process.env.DBARK_TEST_CA}}:{})};
const events:TaskEvent[]=[],engine=new Engine(event=>events.push(event)),drivers=new Set<ReturnType<typeof mysql.createConnection>>();let observer:ManagedConnection|undefined,restore:(()=>void)|undefined,restricted:ConnectionProfile;
/** 生产命令负责执行、会话互斥和任务，旁观连接仅准备隔离资源及断言。 */
const run=(sessionId:string,sql:string):Promise<QueryOutcome>=>engine.handle('query.execute',{sessionId,sql,taskId:randomUUID(),maxRows:20});
const fields=(sessionId:string,table='subject',schema=database)=>engine.handle('query.temporaryCompletion',{sessionId,kind:'columns',database:schema,table,prefix:''});
const read=(sessionId:string,table='subject',schema=database,taskId=randomUUID())=>engine.handle('query.temporaryRead',{sessionId,database:schema,table,taskId});
const names=async(sessionId:string,table='subject',schema=database)=>(await fields(sessionId,table,schema)).entries.map((value:{name:string})=>value.name);
/** 结果按稳定列键读取，避免把显示别名直接当结果键。 */
function cell(result:QueryOutcome,name:string){const set=result.results[0];return set.rows[0][set.columns.find(column=>column.name===name)!.key];}
async function session<T>(body:(id:string)=>Promise<T>,connectionId=profile.id):Promise<T>{const{sessionId}=await engine.handle('sessions.open',{connectionId,database});try{return await body(sessionId);}finally{await engine.handle('sessions.close',{sessionId});}}
describe.skipIf(!enabled)('200隔离实例：真实会话临时对象',()=>{
  beforeAll(async()=>{
    if(profile.host!=='192.168.31.200'||![13357,13380,13384,13310,13311,13484].includes(profile.port))throw Error('只允许已核对200隔离实例');
    const create=mysql.createConnection,recording=vi.spyOn(mysql,'createConnection').mockImplementation(config=>{const driver=create(config);drivers.add(driver);return driver;});restore=()=>recording.mockRestore();
    observer=await connect(profile);await engine.handle('connections.open',{id:profile.id,profile});
    for(const name of[database,other])await execute(observer,`CREATE DATABASE ${identifier(name)} CHARACTER SET utf8mb4`);
    await execute(observer,`CREATE TABLE ${qualified(database,'subject')}(id INT PRIMARY KEY,permanent_column TEXT) ENGINE=InnoDB`);await execute(observer,`CREATE TABLE ${qualified(other,'subject')}(other_permanent INT) ENGINE=InnoDB`);
    await execute(observer,`CREATE PROCEDURE ${qualified(database,'make_subject')}() BEGIN DROP TEMPORARY TABLE IF EXISTS subject;CREATE TEMPORARY TABLE subject(routine_column INT);END`);
    await execute(observer,`CREATE FUNCTION ${qualified(database,'temp_function')}() RETURNS INT MODIFIES SQL DATA BEGIN DROP TEMPORARY TABLE IF EXISTS subject;CREATE TEMPORARY TABLE subject(function_column INT);RETURN 1;END`);
    await execute(observer,`CREATE VIEW ${qualified(database,'calling_view')} AS SELECT ${qualified(database,'temp_function')}() AS result_value`);
    try{await execute(observer,`CREATE USER '${user}'@'%' IDENTIFIED BY '${password}'`);await execute(observer,`GRANT SELECT ON ${qualified(database,'subject')} TO '${user}'@'%'`);}catch{throw Error('隔离表级SELECT账号准备失败，原认证内容已隐藏');}
    restricted={...profile,id:randomUUID(),name:'表级只读临时对象负例',user,password};await engine.handle('connections.open',{id:restricted.id,profile:restricted});
  },60000);
  afterAll(async()=>{
    try{await engine.closeAll();if(observer){if(!/^cp_[a-f0-9]{12}$/.test(user)||![database,other].every(value=>/^dbark_colperm_[a-f0-9]{12}$/.test(value)))throw Error('清理目标无效');await execute(observer,`DROP USER IF EXISTS '${user}'@'%'`);for(const name of[database,other])await execute(observer,`DROP DATABASE IF EXISTS ${identifier(name)}`);expect((await execute<Record<string,unknown>[]>(observer,'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?,?)',[database,other])).rows).toHaveLength(0);expect((await execute<Record<string,unknown>[]>(observer,'SELECT User FROM mysql.user WHERE User=?',[user])).rows).toHaveLength(0);const ids=[...drivers].filter(driver=>driver!==observer!.connection).map(driver=>driver.threadId).filter((id):id is number=>typeof id==='number'&&id>0);expect(ids.length).toBeGreaterThan(0);expect((await execute<Record<string,unknown>[]>(observer,'SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN ('+ids.map(()=>'?').join(',')+')',ids)).rows).toHaveLength(0);console.log(JSON.stringify({验收说明:'临时对象测试库用户与实际连接清零',连接数量:ids.length,残留数量:0}));}}
    finally{try{await observer?.close({strict:true});}finally{restore?.();}}
  },60000);
  it('两个标签同名临时表各自遮蔽永久字段，显式库名也保持来源',async()=>session(async a=>session(async b=>{
    await run(a,'CREATE TEMPORARY TABLE subject(first_session BIGINT,note TEXT)');await run(b,'CREATE TEMPORARY TABLE subject(second_session DECIMAL(40,8))');expect(await names(a)).toEqual(['first_session','note']);expect(await names(b)).toEqual(['second_session']);const permanent=await engine.handle('metadata.completion',{connectionId:profile.id,taskId:randomUUID(),kind:'columns',database,table:'subject',prefix:''});expect(permanent.entries.map((value:{name:string})=>value.name)).toEqual(['id','permanent_column']);expect(await read(a)).toMatchObject({temporary:true,columns:2});expect(await names(a)).toEqual(['first_session','note']);
  })));
  it('IF NOT EXISTS保持原定义，LIKE与CTAS显式读取真实列且不发送SQL结果批次',async()=>session(async id=>{
    await run(id,'CREATE TEMPORARY TABLE subject(original_column INT);CREATE TEMPORARY TABLE IF NOT EXISTS subject(wrong_column INT)');expect(await names(id)).toEqual(['original_column']);await run(id,'DROP TEMPORARY TABLE subject;CREATE TEMPORARY TABLE subject LIKE '+qualified(other,'subject'));expect((await fields(id)).incomplete).toBe(true);expect(await read(id)).toMatchObject({temporary:true,columns:1});expect(await names(id)).toEqual(['other_permanent']);await run(id,'DROP TEMPORARY TABLE subject;CREATE TEMPORARY TABLE subject(added_column INT) SELECT 7 AS selected_column');expect((await fields(id)).incomplete).toBe(true);const taskId=randomUUID();await read(id,'subject',database,taskId);expect(await names(id)).toEqual(['added_column','selected_column']);expect(events.filter(event=>event.taskId===taskId).at(-1)?.status).toBe('completed');expect(events.filter(event=>event.taskId===taskId).some(event=>event.batch)).toBe(false);
  }));
  it('ALTER增删改序和跨库改名只更新成功对象，回滚不复活临时DDL',async()=>session(async id=>{
    await run(id,'CREATE TEMPORARY TABLE subject(id INT,note TEXT);ALTER TABLE subject ADD first_column INT FIRST,CHANGE COLUMN note renamed VARCHAR(20) AFTER first_column,DROP COLUMN id');expect(await names(id)).toEqual(['first_column','renamed']);await run(id,'ALTER TABLE subject RENAME TO '+qualified(other,'moved'));expect((await fields(id)).handled).toBe(false);expect(await names(id,'moved',other)).toEqual(['first_column','renamed']);await run(id,'ROLLBACK');expect(await names(id,'moved',other)).toEqual(['first_column','renamed']);await run(id,'DROP TEMPORARY TABLE '+qualified(other,'moved'));expect((await fields(id,'moved',other)).handled).toBe(false);
  }));
  it('切库、引号和名称内点号按实际会话与完整标识符记录',async()=>session(async id=>{
    await run(id,"SET SESSION sql_mode='ANSI_QUOTES,NO_BACKSLASH_ESCAPES'");await run(id,'CREATE TEMPORARY TABLE "table.name"("field.name" INT,"中文" TEXT)');expect(await names(id,'table.name')).toEqual(['field.name','中文']);await run(id,'USE '+identifier(other)+';CREATE TEMPORARY TABLE subject(other_temp INT)');expect(await names(id,'subject',other)).toEqual(['other_temp']);expect(await names(id,'table.name')).toEqual(['field.name','中文']);
  }));
  it('纯缓存反复读取不改变行数、警告、连接、事务、临时表和外部未提交可见性',async()=>session(async id=>{
    await run(id,'CREATE TEMPORARY TABLE subject(v BIGINT);INSERT INTO subject VALUES(9007199254740993);BEGIN;UPDATE subject SET v=v+1');const before=(await run(id,'SELECT CONNECTION_ID() AS id,v FROM subject')).results[0].rows[0];await run(id,'UPDATE subject SET v=v-1');for(let n=0;n<4;n++){await fields(id);await engine.handle('query.temporaryState',{sessionId:id});}expect(cell(await run(id,'SELECT ROW_COUNT() AS n'),'n')).toBe('1');await run(id,"SELECT CAST('bad_value' AS UNSIGNED)");await fields(id);expect((await run(id,'SHOW WARNINGS')).results[0].rows.length).toBeGreaterThan(0);expect((await engine.handle('query.sessionState',{sessionId:id})).transactionOpen).toBe(true);await run(id,'UPDATE subject SET v=v+1');expect((await run(id,'SELECT CONNECTION_ID() AS id,v FROM subject')).results[0].rows[0]).toEqual(before);expect((await execute<Record<string,unknown>[]>(observer!,`SELECT COUNT(*) AS n FROM ${qualified(database,'subject')}`)).rows[0].n).toBe('0');await engine.handle('query.transaction',{sessionId:id,action:'rollback'});
  }));
  it('CALL和存储函数使旧字段待核对，按名称读取能恢复真实来源',async()=>session(async id=>{
    await run(id,'CREATE TEMPORARY TABLE subject(old_column INT);CALL make_subject()');expect(await names(id)).toEqual([]);expect((await fields(id)).handled).toBe(true);expect(await read(id)).toMatchObject({temporary:true});expect(await names(id)).toEqual(['routine_column']);await run(id,'SELECT '+qualified(database,'temp_function')+'()');expect(await names(id)).toEqual([]);await read(id);expect(await names(id)).toEqual(['function_column']);
  }));
  it('动态执行、可执行注释和明确读取的诊断变化符合入口说明',async()=>session(async id=>{
    await run(id,"SET @dbark_temp_ddl='CREATE TEMPORARY TABLE subject(dynamic_column INT)';PREPARE dbark_stmt FROM @dbark_temp_ddl;EXECUTE dbark_stmt;DEALLOCATE PREPARE dbark_stmt");expect((await fields(id)).incomplete).toBe(true);await read(id);expect(await names(id)).toEqual(['dynamic_column']);await run(id,'/*! ALTER TABLE subject ADD executable_column INT */');expect(await names(id)).toEqual([]);await read(id);expect(await names(id)).toEqual(['dynamic_column','executable_column']);await run(id,'INSERT INTO subject VALUES(1,2)');await read(id);expect(cell(await run(id,'SELECT ROW_COUNT() AS n'),'n')).toBe('-1');
  }));
  it('普通表达式错误保留临时结构，失败ALTER只将目标转为待核对',async()=>session(async id=>{
    await run(id,'CREATE TEMPORARY TABLE subject(actual_column INT)');await expect(run(id,'SELECT missing_column')).rejects.toThrow();expect(await names(id)).toEqual(['actual_column']);await run(id,'USE '+identifier(database));await expect(run(id,'ALTER TABLE subject ADD broken UNKNOWN_TYPE')).rejects.toThrow();expect(await names(id)).toEqual([]);expect((await fields(id)).incomplete).toBe(true);await read(id);expect(await names(id)).toEqual(['actual_column']);
  }));
  it('无CREATE TEMPORARY权限创建失败，不虚构遮蔽或扩大表级授权',async()=>session(async id=>{
    await expect(run(id,'CREATE TEMPORARY TABLE subject(fake_column INT)')).rejects.toThrow();expect((await fields(id)).handled).toBe(false);expect((await engine.handle('query.temporaryState',{sessionId:id})).objects).toEqual([]);expect(await read(id)).toMatchObject({temporary:false});const grants=(await execute<Record<string,unknown>[]>(observer!,`SHOW GRANTS FOR '${user}'@'%'`)).rows;expect(JSON.stringify(grants)).not.toContain('CREATE TEMPORARY TABLES');
  },restricted.id));
  it('繁忙时不读中间目录，取消真实长查询后显式读回并保持同一会话',async()=>session(async id=>{
    await run(id,'CREATE TEMPORARY TABLE subject(actual_column INT)');const before=cell(await run(id,'SELECT CONNECTION_ID() AS id'),'id'),taskId=randomUUID(),pending=run(id,'SELECT 1');await pending;const long=engine.handle('query.execute',{sessionId:id,sql:'SELECT SLEEP(10)',taskId,maxRows:1}),rejection=expect(long).rejects.toThrow();await expect.poll(async()=>(await engine.handle('query.temporaryState',{sessionId:id})).busy).toBe(true);await expect(fields(id)).rejects.toThrow('暂不可用');await engine.handle('query.cancel',{taskId});await rejection;await read(id);expect(await names(id)).toEqual(['actual_column']);expect(cell(await run(id,'SELECT CONNECTION_ID() AS id'),'id')).toBe(before);
  }));
  it('关闭后目录不可访问，新会话从空目录开始',async()=>{let closed='';await session(async id=>{closed=id;await run(id,'CREATE TEMPORARY TABLE subject(old_column INT)');});await expect(fields(closed)).rejects.toThrow('不存在');await session(async id=>{expect((await fields(id)).handled).toBe(false);expect((await engine.handle('query.temporaryState',{sessionId:id})).objects).toEqual([]);});});
  it('真实响应尚未消费时取消结构读取，排空后不发布迟到缓存并可继续原会话',async()=>session(async id=>{
    await run(id,'CREATE TEMPORARY TABLE subject(actual_column INT)');const thread=Number(cell(await run(id,'SELECT CONNECTION_ID() AS id'),'id')),driver=[...drivers].find(value=>value.threadId===thread);if(!driver)throw Error('未观察到实际会话驱动');
    // 只暂停真实socket消费，不替换查询、网络响应或目录内容；取消仍使用生产KILL控制连接。
    const stream=(driver as unknown as{stream:{pause():void;resume():void}}).stream,before=await engine.handle('query.temporaryState',{sessionId:id}),taskId=randomUUID();stream.pause();const pending=read(id,'subject',database,taskId),rejection=expect(pending).rejects.toThrow('取消');
    try{await expect.poll(async()=>(await engine.handle('query.temporaryState',{sessionId:id})).busy).toBe(true);await engine.handle('query.cancel',{taskId});expect((await engine.handle('query.temporaryState',{sessionId:id})).busy).toBe(true);}finally{stream.resume();}
    await rejection;expect(events.filter(value=>value.taskId===taskId).at(-1)?.status).toBe('cancelled');expect((await engine.handle('query.temporaryState',{sessionId:id})).revision).toBe(before.revision);await read(id);expect(await names(id)).toEqual(['actual_column']);expect(Number(cell(await run(id,'SELECT CONNECTION_ID() AS id'),'id'))).toBe(thread);
  }));
  it('视图中的存储函数与CTAS表达式改变其它临时表时旧字段均失效',async()=>session(async id=>{
    await run(id,'CREATE TEMPORARY TABLE subject(old_column INT);SELECT result_value FROM calling_view');expect(await names(id)).toEqual([]);await read(id);expect(await names(id)).toEqual(['function_column']);await run(id,'CREATE TEMPORARY TABLE from_expression AS SELECT '+qualified(database,'temp_function')+'() AS value_column');expect(await names(id)).toEqual([]);await read(id);expect(await names(id)).toEqual(['function_column']);await read(id,'from_expression');expect(await names(id,'from_expression')).toEqual(['value_column']);
  }));
  it('条件ALTER或多动作ALTER不能把未实现语法虚构成字段',async()=>session(async id=>{
    await run(id,'CREATE TEMPORARY TABLE subject(actual_column INT)');const maria=observer!.status.dialect==='mariadb';await run(id,maria?'ALTER TABLE subject ADD COLUMN IF NOT EXISTS added_column INT':'ALTER TABLE subject ADD COLUMN added_column INT');if(maria){expect(await names(id)).toEqual([]);expect((await fields(id)).incomplete).toBe(true);}await read(id);expect(await names(id)).toEqual(['actual_column','added_column']);
  }));
  it.skipIf(profile.port===13357)('支持不可见列的实例显式读回与直接补全保持可见性',async()=>session(async id=>{
    await run(id,'CREATE TEMPORARY TABLE subject(visible_column INT,hidden_column INT INVISIBLE)');expect((await fields(id)).entries.find((value:{name:string})=>value.name==='hidden_column')?.visible).toBe(false);await read(id);expect((await fields(id)).entries.find((value:{name:string})=>value.name==='hidden_column')?.visible).toBe(false);await run(id,observer!.status.dialect==='mariadb'?'ALTER TABLE subject MODIFY COLUMN hidden_column INT':'ALTER TABLE subject ALTER COLUMN hidden_column SET VISIBLE');expect((await fields(id)).entries.find((value:{name:string})=>value.name==='hidden_column')?.visible).toBe(true);
  }));
  it.skipIf(![13380,13384,13484].includes(profile.port))('会话级自动隐形主键使普通临时声明不完整，显式读取取得实际隐藏字段',async()=>session(async id=>{
    await run(id,'SET SESSION sql_generate_invisible_primary_key=ON;SET SESSION show_gipk_in_create_table_and_information_schema=ON;CREATE TEMPORARY TABLE subject(real_column INT) ENGINE=InnoDB');expect(await names(id)).toEqual(['real_column']);expect((await fields(id)).incomplete).toBe(true);await read(id);expect(await names(id)).toEqual(['my_row_id','real_column']);expect((await fields(id)).entries[0].visible).toBe(false);expect((await fields(id)).incomplete).toBe(false);
  }));
});
