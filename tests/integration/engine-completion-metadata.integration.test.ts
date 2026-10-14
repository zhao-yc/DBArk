import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import mysql from 'mysql2';
import {Engine} from '../../src/engine';
import {connect,execute,type ManagedConnection} from '../../src/engine/connection';
import {identifier,qualified} from '../../src/engine/sql';
import type {ConnectionProfile,QueryOutcome,TaskEvent} from '../../src/shared/contracts';
import type {CompletionMetadataInput,CompletionMetadataOutput} from '../../src/shared/sqlCompletion';
const enabled=process.env.DBARK_INTEGRATION_ENABLED==='1';
const suffix=randomUUID().replaceAll('-','').slice(0,12),database='dbark_colperm_'+suffix,user='cp_'+suffix,password=randomUUID()+randomUUID();
const profile:ConnectionProfile={id:randomUUID(),name:'补全目录隔离验收',group:'',color:'#123456',dialect:'mysql',host:process.env.DBARK_TEST_HOST??'',port:Number(process.env.DBARK_TEST_PORT??13384),user:process.env.DBARK_TEST_USER??'',password:process.env.DBARK_TEST_PASSWORD,...(process.env.DBARK_TEST_TLS==='1'?{tls:{enabled:true,rejectUnauthorized:true,caPath:process.env.DBARK_TEST_CA}}:{})};
const events:TaskEvent[]=[],engine=new Engine(event=>events.push(event));let observer:ManagedConnection|undefined,restrictedProfile:ConnectionProfile|undefined;
const drivers=new Set<ReturnType<typeof mysql.createConnection>>();let restoreConnections:(()=>void)|undefined;
/** 只有随机隔离库内DDL和已有授权subject表SELECT；密码不会写入SQL错误或报告。 */
async function sql(text:string,values:(string|number)[]=[]){return(await execute<Record<string,unknown>[]>(observer!,text,values)).rows;}
/** 生产Engine命令使用唯一任务号，目录和会话均不伪造返回。 */
async function directory(input:Omit<CompletionMetadataInput,'connectionId'|'taskId'>,connectionId=profile.id):Promise<CompletionMetadataOutput>{return engine.handle('metadata.completion',{...input,connectionId,taskId:randomUUID()});}
/** 联合类型的请求字段保持明确，测试不把SQL或会话传入目录接口。 */
const objects=(prefix='',objectKind:'relation'|'function'|'procedure'='relation')=>directory({kind:'objects',database,prefix,objectKind} as CompletionMetadataInput);
const columns=(table='subject',prefix='')=>directory({kind:'columns',database,table,prefix} as CompletionMetadataInput);
describe.skipIf(!enabled)('200隔离实例：补全目录与查询会话',()=>{
  beforeAll(async()=>{
    if(profile.host!=='192.168.31.200'||![13357,13380,13384,13310,13311,13484].includes(profile.port))throw Error('只允许已核对200隔离实例');
    // 旁观式记录真实驱动对象，不替换网络响应，连建连中取消也在清理后逐ID核对。
    const create=mysql.createConnection;const recording=vi.spyOn(mysql,'createConnection').mockImplementation(config=>{const driver=create(config);drivers.add(driver);return driver;});restoreConnections=()=>recording.mockRestore();
    await engine.handle('connections.open',{id:profile.id,profile});observer=await connect(profile);
    await sql(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`);
    const extra=Array.from({length:260},(_,i)=>identifier('c'+String(i).padStart(3,'0'))+' INT').join(',');
    await sql(`CREATE TABLE ${qualified(database,'subject')}(id INT PRIMARY KEY,note TEXT,${identifier('__proto__')} TEXT,${identifier('x%_!')} INT,${identifier('中文')} INT,${extra}) ENGINE=InnoDB`);
    await sql(`INSERT INTO ${qualified(database,'subject')}(id,note) VALUES(1,'隔离原值')`);
    for(let i=0;i<270;i++)await sql(`CREATE TABLE ${qualified(database,'lookup_'+String(i).padStart(3,'0'))}(id INT) ENGINE=InnoDB`);
    await sql(`CREATE TABLE ${qualified(database,'a!%_文字')}(id INT) ENGINE=InnoDB`);
    await sql(`CREATE TABLE ${qualified(database,'aOther')}(id INT) ENGINE=InnoDB`);
    await sql(`CREATE VIEW ${qualified(database,'visible_view')} AS SELECT id,note FROM ${qualified(database,'subject')}`);
    await sql(`CREATE FUNCTION ${qualified(database,'f_completion')}() RETURNS INT DETERMINISTIC RETURN 1`);
    await sql(`CREATE PROCEDURE ${qualified(database,'p_completion')}() SELECT 1`);
    // 授权只覆盖本例subject的SELECT，不授库级或全局权限，口令仅保留内存。
    try{await sql(`CREATE USER '${user}'@'%' IDENTIFIED BY '${password}'`);await sql(`GRANT SELECT ON ${qualified(database,'subject')} TO '${user}'@'%'`);}catch{throw Error('隔离SELECT账号准备失败，原认证内容已隐藏');}
    restrictedProfile={...profile,id:randomUUID(),name:'仅subject可见',user,password};await engine.handle('connections.open',{id:restrictedProfile.id,profile:restrictedProfile});
  },120000);
  afterAll(async()=>{
    try{await engine.closeAll();if(observer){if(!/^cp_[a-f0-9]{12}$/.test(user)||!/^dbark_colperm_[a-f0-9]{12}$/.test(database))throw Error('拒绝清理非本例资源');await sql(`DROP USER IF EXISTS '${user}'@'%'`);await sql(`DROP DATABASE IF EXISTS ${identifier(database)}`);expect(await sql('SELECT User FROM mysql.user WHERE User=?',[user])).toHaveLength(0);expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[database])).toHaveLength(0);
      const ids=[...drivers].filter(driver=>driver!==observer!.connection).map(driver=>driver.threadId).filter((id):id is number=>typeof id==='number'&&Number.isSafeInteger(id)&&id>0);expect(ids.length).toBeGreaterThan(0);
      const remaining=await sql('SELECT ID,USER,DB FROM information_schema.PROCESSLIST WHERE ID IN ('+ids.map(()=>'?').join(',')+')',ids);expect(remaining).toHaveLength(0);console.log(JSON.stringify({验收说明:'本套件实际驱动连接逐ID释放核对',连接数量:ids.length,残留数量:remaining.length}));
    }}finally{try{await observer?.close({strict:true});}finally{restoreConnections?.();}}
  },60000);
  it('数据库和表前缀精确匹配特殊符号，目录不是前20表启发式',async()=>{const db=await directory({kind:'databases',prefix:database});expect(db.entries).toEqual([{name:database,kind:'database'}]);expect((await objects('a!%_')).entries).toEqual([{name:'a!%_文字',kind:'table'}]);expect((await objects('lookup_269')).entries).toEqual([{name:'lookup_269',kind:'table'}]);});
  it('大量表和列明确返回256与更多标记，前缀可继续取得后续结果',async()=>{const relations=await objects();expect(relations.entries).toHaveLength(256);expect(relations.incomplete).toBe(true);const fields=await columns();expect(fields.entries).toHaveLength(256);expect(fields.incomplete).toBe(true);expect((await columns('subject','c25')).entries.map(v=>v.name)).toEqual(Array.from({length:10},(_,i)=>'c25'+i));});
  it('视图、函数和过程按语法类别分开读取，列名和类型原文保留',async()=>{expect((await objects('visible')).entries).toEqual([{name:'visible_view',kind:'view'}]);expect((await objects('f_completion','function')).entries).toEqual([{name:'f_completion',kind:'function'}]);expect((await objects('p_completion','procedure')).entries).toEqual([{name:'p_completion',kind:'procedure'}]);expect((await columns('subject','__proto__')).entries).toEqual([{name:'__proto__',kind:'column',dataType:'text'}]);expect((await columns('subject','x%_!')).entries[0].name).toBe('x%_!');expect((await columns('subject','中文')).entries[0].name).toBe('中文');});
  it('SELECT权限仅看到subject，不向受限用户泄露其它对象或函数',async()=>{const id=restrictedProfile!.id;expect((await directory({kind:'objects',database,prefix:'',objectKind:'relation'} as CompletionMetadataInput,id)).entries).toEqual([{name:'subject',kind:'table'}]);expect((await directory({kind:'columns',database,table:'lookup_269',prefix:''} as CompletionMetadataInput,id)).entries).toEqual([]);expect((await directory({kind:'objects',database,prefix:'f_',objectKind:'function'} as CompletionMetadataInput,id)).entries).toEqual([]);});
  it('读取独立于原事务和临时表，不改变CONNECTION_ID或提交用户写入',async()=>{
    const {sessionId}=await engine.handle('sessions.open',{connectionId:profile.id,database});
    /** 查询仍使用原固定会话，元数据不能拿它执行或准备语句。 */
    const run=(text:string):Promise<QueryOutcome>=>engine.handle('query.execute',{sessionId,sql:text,taskId:randomUUID(),maxRows:10});
    await run('CREATE TEMPORARY TABLE marker (v BIGINT); INSERT INTO marker VALUES(9007199254740993)');await engine.handle('query.transaction',{sessionId,action:'begin'});await run('INSERT INTO subject(id,note) VALUES(2,\'未提交\')');const before=(await run('SELECT CONNECTION_ID() AS id,v FROM marker')).results[0].rows[0];
    await columns('subject','note');await objects('lookup_269');
    expect((await run('SELECT CONNECTION_ID() AS id,v FROM marker')).results[0].rows[0]).toEqual(before);expect((await sql(`SELECT COUNT(*) AS n FROM ${qualified(database,'subject')}`))[0].n).toBe('1');expect((await engine.handle('query.sessionState',{sessionId})).transactionOpen).toBe(true);
    await engine.handle('query.transaction',{sessionId,action:'rollback'});expect((await sql(`SELECT COUNT(*) AS n FROM ${qualified(database,'subject')}`))[0].n).toBe('1');await engine.handle('sessions.close',{sessionId});
  });
  it('建连阶段取消等待真实资源终态，旧任务不能返回目录或占用配置',async()=>{const taskId=randomUUID(),task=engine.handle('metadata.completion',{connectionId:profile.id,taskId,kind:'columns',database,table:'subject',prefix:''});const rejected=expect(task).rejects.toThrow(/取消|中止/);await engine.handle('query.cancel',{taskId});await rejected;expect(events.filter(v=>v.taskId===taskId).at(-1)?.status).toBe('cancelled');expect((await columns('subject','note')).entries[0].name).toBe('note');});
  it('主进程可信配置直接启动可取消短读，不要求额外测试连接或查询会话',async()=>{const isolated=new Engine(()=>{}),id=randomUUID();try{const result=await isolated.handle('metadata.completion',{connectionId:id,profile:{...profile,id},taskId:randomUUID(),kind:'columns',database,table:'subject',prefix:'note'});expect(result.entries).toEqual([{name:'note',kind:'column',dataType:'text'}]);}finally{await isolated.closeAll();}});
});
