import{randomUUID}from'node:crypto';
import{beforeAll,afterAll,describe,it,expect}from'vitest';
import{Engine}from'../../src/engine';
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
const engine=new Engine(()=>{});let bootstrap='',sessionId='',created=false,capabilities:CompletionScopeCapabilities={};
/** SQL只经真实Engine会话执行，目录请求不携带正文或借用执行接口。 */
async function query(sql:string,session=sessionId):Promise<QueryOutcome>{return engine.handle('query.execute',{sessionId:session,taskId:randomUUID(),sql,maxRows:100});}
/** 未知会话来源显式读回；不通过修改缓存或绕过临时遮蔽保护来准备补全。 */
async function confirmedDirectory(){for(const table of['users','orders'])await engine.handle('query.temporaryRead',{sessionId,database,table,taskId:randomUUID()});const state=await engine.handle('query.completionState',{sessionId}),requests:CompletionDirectoryRequest[]=[];const permanent={load:async(input:CompletionDirectoryRequest):Promise<CompletionMetadataOutput>=>{requests.push(input);return engine.handle('metadata.completion',{...input,connectionId:profile.id,taskId:randomUUID()});}};return{state,requests,directory:new SessionCompletionDirectory(permanent,input=>{if(input.kind==='columns')return engine.handle('query.temporaryCompletion',{sessionId,kind:'columns',database:input.database,table:input.table,prefix:input.prefix});if(input.kind==='objects'&&input.objectKind==='relation')return engine.handle('query.temporaryCompletion',{sessionId,kind:'objects',database:input.database,prefix:input.prefix});throw Error('会话覆盖层目标无效');},state.objectsRevision??0)};}

describe.skipIf(!enabled)('200隔离实例：LATERAL语义、真实目录和插入后执行',()=>{
  beforeAll(async()=>{
    if(profile.host!=='192.168.31.200'||![13357,13380,13384,13310,13311,13484].includes(profile.port))throw Error('只允许统筹已核对的200隔离实例');
    const status=await engine.handle('connections.open',{id:profile.id,profile});capabilities=completionCapabilitiesForServer(status.dialect,status.version);if(!capabilities.lateralDerivedTables)return;
    bootstrap=(await engine.handle('sessions.open',{connectionId:profile.id})).sessionId;await query(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`,bootstrap);created=true;
    sessionId=(await engine.handle('sessions.open',{connectionId:profile.id,database})).sessionId;
    await query('CREATE TABLE users(id INT PRIMARY KEY,user_value INT);CREATE TABLE orders(id INT PRIMARY KEY,user_id INT,order_value INT);INSERT INTO users VALUES(1,10),(2,20);INSERT INTO orders VALUES(1,1,100),(2,2,200)');
  });
  afterAll(async()=>{try{if(sessionId)await engine.handle('sessions.close',{sessionId});if(created){if(!/^dbark_lateral_[a-f0-9]{12}$/.test(database))throw Error('拒绝清理非本例库');await query(`DROP DATABASE IF EXISTS ${identifier(database)}`,bootstrap);const checked=await query(`SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${database}'`,bootstrap);expect(checked.results[0].rows).toEqual([]);}}finally{await engine.closeAll();}});
  it('旧版MySQL、MariaDB或未知版本保持能力关闭且无LATERAL目录读取',context=>{if(capabilities.lateralDerivedTables)context.skip();const marked='SELECT * FROM users u JOIN LATERAL(SELECT u.|) d ON TRUE';expect(analyzeCompletion(marked.replace('|',''),marked.indexOf('|'),{},capabilities)).toMatchObject({status:'blocked',reason:'capability'});});
  for(const[marked,label,column,values]of[
    ['SELECT d.copied FROM users u JOIN LATERAL(SELECT u.use|suffix AS copied) d ON TRUE ORDER BY u.id','user_value','copied',['10','20']],
    ['SELECT d.cop|suffix FROM users u JOIN LATERAL(SELECT u.user_value AS copied) d ON TRUE ORDER BY u.id','copied','copied',['10','20']],
    ['SELECT d.copied FROM users u JOIN LATERAL(SELECT u.ord|suffix AS copied FROM orders u WHERE u.id=1) d ON TRUE ORDER BY u.id','order_value','copied',['100','100']],
    ['SELECT d.use|suffix FROM users u JOIN LATERAL(SELECT u.*) d ON TRUE ORDER BY u.id','user_value','user_value',['10','20']],
  ]as const)it('真实候选插入后的模型SQL直接执行：'+marked,async context=>{
    if(!capabilities.lateralDerivedTables)context.skip();const source=marked.replace('|',''),prepared=await confirmedDirectory(),analysis=analyzeCompletion(source,marked.indexOf('|'),{ansiQuotes:prepared.state.ansiQuotes,noBackslashEscapes:prepared.state.noBackslashEscapes},capabilities);expect(analysis.status).toBe('ready');if(analysis.status!=='ready')throw Error('分析未就绪');const suggestions=await completionSuggestions(analysis,database,prepared.directory,undefined,'mysql'),item=suggestions.items.find(candidate=>candidate.label===label&&candidate.kind==='column');expect(item).toBeDefined();if(!item)throw Error('实际目录未提供目标字段');
    // 直接使用实际候选和实际替换范围，不用预期SQL覆盖补全结果；此处是无GUI层验收。
    const inserted=source.slice(0,analysis.target.start)+item.insertText+source.slice(analysis.target.end),result=await query(inserted);expect(result.results[0].rows.map(row=>String(row[column]))).toEqual(values);expect(prepared.requests.filter(input=>input.kind==='columns').every(input=>input.table==='users'||input.table==='orders')).toBe(true);
  });
  it('后置关系与普通非LATERAL体不请求目录，不执行不支持SQL',async context=>{if(!capabilities.lateralDerivedTables)context.skip();for(const marked of['SELECT * FROM users u JOIN LATERAL(SELECT late.|) d ON TRUE JOIN orders late ON TRUE','SELECT * FROM users u JOIN(SELECT u.| FROM orders o)d ON TRUE']){const prepared=await confirmedDirectory(),analysis=analyzeCompletion(marked.replace('|',''),marked.indexOf('|'),{},capabilities);if(analysis.status==='ready')await completionSuggestions(analysis,database,prepared.directory);expect(analysis.status).toBe('blocked');expect(prepared.requests).toEqual([]);}});
});
