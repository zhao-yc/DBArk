import{randomUUID}from'node:crypto';
import{beforeAll,afterAll,describe,it,expect,vi}from'vitest';
import mysql from'mysql2';
import{Engine}from'../../src/engine';
import{connect,execute,type ManagedConnection}from'../../src/engine/connection';
import{identifier}from'../../src/engine/sql';
import type{ConnectionProfile,QueryOutcome}from'../../src/shared/contracts';
import type{CompletionDirectoryRequest,CompletionMetadataOutput}from'../../src/shared/sqlCompletion';
import{analyzeCompletion}from'../../src/shared/completionAnalysis';
import{completionCapabilitiesForServer,type CompletionScopeCapabilities}from'../../src/shared/completionCapabilities';
import{completionSuggestions}from'../../src/renderer/completionSuggestions';
import{SessionCompletionDirectory}from'../../src/renderer/sessionCompletionDirectory';

// 只有统筹显式启用才访问已核对200隔离实例；不加载本机凭据文件、不启动GUI或剪贴板。
const enabled=process.env.DBARK_INTEGRATION_ENABLED==='1',database='dbark_lateral_'+randomUUID().replaceAll('-','').slice(0,12);
const profile:ConnectionProfile={id:randomUUID(),name:'LATERAL隔离验收',group:'',color:'#123456',dialect:'mysql',host:process.env.DBARK_TEST_HOST??'',port:Number(process.env.DBARK_TEST_PORT??13384),user:process.env.DBARK_TEST_USER??'',password:process.env.DBARK_TEST_PASSWORD,...(process.env.DBARK_TEST_TLS==='1'?{tls:{enabled:true,rejectUnauthorized:true,caPath:process.env.DBARK_TEST_CA}}:{})};
const engine=new Engine(()=>{}),drivers=new Set<ReturnType<typeof mysql.createConnection>>(),threadIds=new Set<number>();
let bootstrap='',sessionId='',databaseAttempted=false,capabilities:CompletionScopeCapabilities={},observer:ManagedConnection|undefined,restoreConnections:(()=>void)|undefined;
/** 只记录实际握手后的线程，不用本地对象数量替代服务器连接释放证据。 */
function recordThread(driver:ReturnType<typeof mysql.createConnection>){const id=driver.threadId;if(typeof id==='number'&&Number.isSafeInteger(id)&&id>0)threadIds.add(id);}
/** SQL只经真实Engine会话执行，目录请求不携带正文或借用执行接口。 */
async function query(sql:string,session=sessionId):Promise<QueryOutcome>{return engine.handle('query.execute',{sessionId:session,taskId:randomUUID(),sql,maxRows:100});}
/** 未知会话来源显式读回；不通过修改缓存或绕过临时遮蔽保护来准备补全。 */
async function confirmedDirectory(){for(const table of['users','orders'])await engine.handle('query.temporaryRead',{sessionId,database,table,taskId:randomUUID()});const state=await engine.handle('query.completionState',{sessionId}),requests:CompletionDirectoryRequest[]=[];const permanent={load:async(input:CompletionDirectoryRequest):Promise<CompletionMetadataOutput>=>{requests.push(input);return engine.handle('metadata.completion',{...input,connectionId:profile.id,taskId:randomUUID()});}};return{state,requests,directory:new SessionCompletionDirectory(permanent,input=>{if(input.kind==='columns')return engine.handle('query.temporaryCompletion',{sessionId,kind:'columns',database:input.database,table:input.table,prefix:input.prefix});if(input.kind==='objects'&&input.objectKind==='relation')return engine.handle('query.temporaryCompletion',{sessionId,kind:'objects',database:input.database,prefix:input.prefix});throw Error('会话覆盖层目标无效');},state.objectsRevision??0)};}

describe.skipIf(!enabled)('200隔离实例：LATERAL语义、真实目录和插入后执行',()=>{
  beforeAll(async()=>{
    if(profile.host!=='192.168.31.200'||![13357,13380,13384,13310,13311,13484].includes(profile.port))throw Error('只允许统筹已核对的200隔离实例');
    // 旁观真实驱动创建与握手，不替换网络返回；独立观察连接不归Engine所有。
    const create=mysql.createConnection,recording=vi.spyOn(mysql,'createConnection').mockImplementation(config=>{const driver=create(config);drivers.add(driver);recordThread(driver);driver.once('connect',()=>recordThread(driver));return driver;});restoreConnections=()=>recording.mockRestore();
    observer=await connect(profile);const control=observer,ownId=Number((await execute<{id:string|number}[]>(control,'SELECT CONNECTION_ID() AS id')).rows[0].id);expect(ownId).toBeGreaterThan(0);expect(ownId).toBe(control.connection.threadId);
    const status=await engine.handle('connections.open',{id:profile.id,profile}),probeId=status.connectionId;if(typeof probeId!=='number'||!Number.isSafeInteger(probeId)||probeId<1)throw Error('未取得真实建连探测线程');threadIds.add(probeId);
    await vi.waitFor(async()=>expect((await execute<Record<string,unknown>[]>(control,'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?',[probeId])).rows).toHaveLength(0),{timeout:5000,interval:50});
    // 六个固定实例的预期独立于被测能力函数，不能把错误的全关闭实现变成全跳过。
    const baseline:Record<number,[string,boolean]>={13357:['5.7.',false],13380:['8.0.',true],13384:['8.4.',true],13310:['10.11.',false],13311:['11.4.',false],13484:['8.4.',true]},expected=baseline[profile.port];
    expect(status.version.replace(/^5\.5\.5-/, '').startsWith(expected[0])).toBe(true);capabilities=completionCapabilitiesForServer(status.dialect,status.version);expect(capabilities.lateralDerivedTables).toBe(expected[1]);if(!capabilities.lateralDerivedTables)return;
    bootstrap=(await engine.handle('sessions.open',{connectionId:profile.id})).sessionId;
    // 创建结果不确定时也精确DROP IF EXISTS本例名称，不能因返回失败遗留随机库。
    databaseAttempted=true;await query(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`,bootstrap);
    sessionId=(await engine.handle('sessions.open',{connectionId:profile.id,database})).sessionId;
    await query('CREATE TABLE users(id INT PRIMARY KEY,user_value INT);CREATE TABLE orders(id INT PRIMARY KEY,user_id INT,order_value INT);INSERT INTO users VALUES(1,10),(2,20);INSERT INTO orders VALUES(1,1,100),(2,2,200)');
  });
  afterAll(async()=>{
    const failures:unknown[]=[];
    /** 每项收尾独立尝试；首个失败保留，后续清理和残留核对不能被提前跳过。 */
    async function attempt(action:()=>Promise<unknown>){try{await action();}catch(error){failures.push(error);}}
    try{
      await attempt(async()=>{if(sessionId)await engine.handle('sessions.close',{sessionId});});
      // 先关闭本例Engine所有剩余连接，避免失败会话仍持锁而阻塞独立观察连接的精确DROP。
      await attempt(()=>engine.closeAll());
      await attempt(async()=>{if(databaseAttempted){if(!/^dbark_lateral_[a-f0-9]{12}$/.test(database))throw Error('拒绝清理非本例库');if(!observer)throw Error('观察连接缺失，无法精确清理本例库');await execute(observer,`DROP DATABASE IF EXISTS ${identifier(database)}`);}});
      const control=observer;
      if(control){
        await attempt(async()=>{if(databaseAttempted){const remaining=await execute<Record<string,unknown>[]>(control,'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[database]);expect(remaining.rows).toHaveLength(0);}});
        await attempt(async()=>{
          for(const driver of drivers)recordThread(driver);const ids=[...threadIds].filter(id=>id!==control.connection.threadId);expect(ids.length).toBeGreaterThan(0);
          // Vitest钩子没有当前测试上下文，使用同5秒/50毫秒预算的vi.waitFor保持真实断言。
          await vi.waitFor(async()=>expect((await execute<Record<string,unknown>[]>(control,'SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN ('+ids.map(()=>'?').join(',')+')',ids)).rows).toHaveLength(0),{timeout:5000,interval:50});
          console.log(JSON.stringify({验收说明:'LATERAL本例Engine与目录线程逐ID释放',实际线程数:ids.length,残留数:0}));
        });
      }
    }finally{await attempt(async()=>{await observer?.close();});await attempt(async()=>{restoreConnections?.();});}
    if(failures.length===1)throw failures[0];if(failures.length>1)throw new AggregateError(failures,'LATERAL夹具收尾存在多项失败，首个错误已保留',{cause:failures[0]});
  });
  it('旧版MySQL、MariaDB或未知版本保持能力关闭且无LATERAL目录读取',context=>{if(capabilities.lateralDerivedTables)context.skip();const marked='SELECT * FROM users u JOIN LATERAL(SELECT u.|) d ON TRUE';expect(analyzeCompletion(marked.replace('|',''),marked.indexOf('|'),{},capabilities)).toMatchObject({status:'blocked',reason:'capability'});});
  for(const[marked,label,column,values]of[
    ['SELECT d.copied FROM users u JOIN LATERAL(SELECT u.use|suffix AS copied) d ON TRUE ORDER BY u.id','user_value','copied',['10','20']],
    ['SELECT d.cop|suffix FROM users u JOIN LATERAL(SELECT u.user_value AS copied) d ON TRUE ORDER BY u.id','copied','copied',['10','20']],
    ['SELECT d.copied FROM users u JOIN LATERAL(SELECT u.ord|suffix AS copied FROM orders u WHERE u.id=1) d ON TRUE ORDER BY u.id','order_value','copied',['100','100']],
    ['SELECT d.use|suffix FROM users u JOIN LATERAL(SELECT u.*) d ON TRUE ORDER BY u.id','user_value','user_value',['10','20']],
  ]as const)it('真实候选插入后的模型SQL直接执行：'+marked,async context=>{
    if(!capabilities.lateralDerivedTables)context.skip();const source=marked.replace('|',''),prepared=await confirmedDirectory(),analysis=analyzeCompletion(source,marked.indexOf('|'),{ansiQuotes:prepared.state.ansiQuotes,noBackslashEscapes:prepared.state.noBackslashEscapes},capabilities);expect(analysis.status).toBe('ready');if(analysis.status!=='ready')throw Error('分析未就绪');const suggestions=await completionSuggestions(analysis,database,prepared.directory,undefined,'mysql'),item=suggestions.items.find(candidate=>candidate.label===label&&candidate.kind==='column');expect(item).toBeDefined();if(!item)throw Error('实际目录未提供目标字段');
    // 直接使用实际候选和实际替换范围，不用预期SQL覆盖补全结果；此处是无GUI层验收。
    const inserted=source.slice(0,analysis.target.start)+item.insertText+source.slice(analysis.target.end),result=await query(inserted),set=result.results[0],output=set.columns.filter(item=>item.name===column);expect(output).toHaveLength(1);
    // Engine查询使用c0/c1位置键；先确认显示名唯一，再按实际key保留原值断言。
    expect(set.rows.map(row=>String(row[output[0].key]))).toEqual(values);expect(prepared.requests.filter(input=>input.kind==='columns').every(input=>input.table==='users'||input.table==='orders')).toBe(true);
  });
  it('后置关系与普通非LATERAL体不请求目录，不执行不支持SQL',async context=>{if(!capabilities.lateralDerivedTables)context.skip();for(const marked of['SELECT * FROM users u JOIN LATERAL(SELECT late.|) d ON TRUE JOIN orders late ON TRUE','SELECT * FROM users u JOIN(SELECT u.| FROM orders o)d ON TRUE']){const prepared=await confirmedDirectory(),analysis=analyzeCompletion(marked.replace('|',''),marked.indexOf('|'),{},capabilities);if(analysis.status==='ready')await completionSuggestions(analysis,database,prepared.directory);expect(analysis.status).toBe('blocked');expect(prepared.requests).toEqual([]);}});
});
