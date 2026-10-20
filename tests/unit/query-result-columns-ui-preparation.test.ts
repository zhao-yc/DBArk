import { readFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { describe,expect,it,vi } from 'vitest';
import { bindQueryResultColumnsUiTarget,queryResultColumnsUiKeys,QueryResultColumnsUiLifetime,queryResultColumnsUiTasks,assertQueryResultColumnsUiIdentity,closeQueryResultColumnsObserver,queryResultColumnsSql,installQueryResultColumnsAudit,answerQueryResultColumnsSave,verifyQueryResultColumnsFile,verifyQueryResultColumnsCopy } from '../helpers/queryResultColumnsUi';
import { closeMysqlConnection } from '../../src/engine/connection';
/** 凭据与输出路径全为合成值；不读取真实process.env、旧文件或原生应用。 */
function config():Record<string,string|undefined>{const output=resolve('/ram/dbark-query-columns-'+'a'.repeat(32));return {DBARK_INTEGRATION_ENABLED:'1',DBARK_QUERY_RESULT_COLUMNS_UI:'1',DBARK_TEST_HOST:'192.168.31.200',DBARK_TEST_PORT:'13384',DBARK_TEST_TLS:'0',DBARK_TEST_USER:'RAM用户',DBARK_TEST_PASSWORD:'',DBARK_TEST_EXPECTED_SERVER_UUID:'00000000-0000-0000-0000-000000000001',DBARK_QUERY_COLUMNS_OUT_DIR:output,DBARK_QUERY_COLUMNS_CSV_PATH:join(output,'visible-selected.csv'),DBARK_QUERY_COLUMNS_JSON_PATH:join(output,'visible-selected.json')};}
function binding(){const raw=config(),helper={...raw};return {raw,helper,target:bindQueryResultColumnsUiTarget(()=>raw,helper)};}
const tasks=()=>[{id:'q',kind:'query.execute',status:'completed'},{id:'csv',kind:'files.exportResult',status:'completed'},{id:'json',kind:'files.exportResult',status:'completed'}];
/** 只接纳此前原期限中的成功事实；端口不实现进程、网络或文件动作。 */
function lifetime(mode:'normal'|'noop'|'throw'='normal'){
 let now=0,closed=false,current=true;const retain=vi.fn(()=>{if(mode==='throw')throw Error('通知失败');}),exit=vi.fn(async()=>{closed=true;});const info={_startWallTime:0,timeout:120000,status:'passed'};
 const owner={check(){if(!current)throw Error('原owner变化');},closed:()=>closed,retain,exit},life=new QueryResultColumnsUiLifetime(owner,info,()=>now);
 return {life,owner,info,retain,exit,time:(value:number)=>{now=value;},change:()=>{current=false;},close:()=>{closed=true;}};
}
describe('结果列正式入口列表及双门',()=>{
 const compiled=ts.transpileModule(readFileSync(new URL('../e2e/query-result-columns.spec.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 it.each(['--list','--list=json'])('%s在两门都开时也不读认证或导入helper/live',flag=>{const skip=vi.fn(),loaded:string[]=[],env=new Proxy({}, {get(){throw Error('列表不得读环境');},ownKeys(){throw Error('列表不得枚举环境');}});runInNewContext(compiled,{exports:{},process:{argv:['node','test',flag],env},require(name:string){if(name==='@playwright/test')return {test:{skip}};loaded.push(name);throw Error('禁止加载真实模块');}});expect(skip).toHaveBeenCalledOnce();expect(loaded).toEqual([]);});
 it.each([['0','0'],['0','1'],['1','0']])('未同时开启%s/%s不读认证、不导入实际模块',(integration,purpose)=>{const skip=vi.fn();runInNewContext(compiled,{exports:{},process:{argv:[],env:new Proxy({DBARK_INTEGRATION_ENABLED:integration,DBARK_QUERY_RESULT_COLUMNS_UI:purpose},{get(value,key:string){if(!Object.hasOwn(value,key))throw Error('默认关闭不读其它配置');return value[key as keyof typeof value];}})},require(name:string){if(name==='@playwright/test')return {test:{skip}};throw Error('禁止实际模块');}});expect(skip).toHaveBeenCalledOnce();});
});
describe('Root显式RAM目标与保存答案永久绑定',()=>{
 it('准确空密码也须显式提供，输出目录与两个文件答案不可猜补',()=>{const f=binding();f.target.assertCurrent();expect(f.target.target.port).toBe(13384);delete f.raw.DBARK_TEST_PASSWORD;expect(()=>bindQueryResultColumnsUiTarget(()=>f.raw,{...f.raw})).toThrow();const raw=config();delete raw.DBARK_QUERY_COLUMNS_JSON_PATH;expect(()=>bindQueryResultColumnsUiTarget(()=>raw,{...raw})).toThrow();});
 it.each([{DBARK_TEST_HOST:'deve-server.yinzon.com'},{DBARK_TEST_PORT:'13484'},{DBARK_TEST_TLS:'1'},{DBARK_TEST_DATABASE:'任意库'},{DBARK_TEST_SSH:'1'},{DBARK_QUERY_COLUMNS_CSV_PATH:'/other.csv'},{DBARK_QUERY_COLUMNS_OUT_DIR:resolve('/ram/shared')}])('未知或扩大目标%j在动作前拒绝',patch=>{const raw={...config(),...patch};expect(()=>bindQueryResultColumnsUiTarget(()=>raw,{...raw})).toThrow();});
 it.each(['raw','helper'] as const)('%s变化被观测后恢复也不复活，包括可选字段存在性',side=>{const f=binding(),source=side==='raw'?f.raw:f.helper;source.DBARK_TEST_PORT='13357';expect(()=>f.target.assertCurrent()).toThrow('永久');source.DBARK_TEST_PORT='13384';expect(()=>f.target.assertCurrent()).toThrow('永久');const next=binding();next.raw.DBARK_TEST_CA='';expect(()=>next.target.assertCurrent()).toThrow('永久');delete next.raw.DBARK_TEST_CA;expect(()=>next.target.assertCurrent()).toThrow('永久');});
 it('身份门仅接受准确MySQL8.4.11及同UUID，不按大版本外推',()=>{const uuid=config().DBARK_TEST_EXPECTED_SERVER_UUID!;assertQueryResultColumnsUiIdentity([[{version:'8.4.11',os:'Linux',names:'0',uuid}]],uuid);for(const version of ['8.4.1','8.4.11 x','8.4.11-MariaDB','8.4.12'])expect(()=>assertQueryResultColumnsUiIdentity([[{version,os:'Linux',names:0,uuid}]],uuid)).toThrow();});
});
describe('原TestInfo期限／owner和同流收尾',()=>{
 it('仅一查询两文件的准确终态后，正常同owner退出、原观察流close和afterEach全部确认',async()=>{const f=lifetime(),close=vi.fn(async()=>{});queryResultColumnsUiTasks(tasks());await f.life.finish(async()=>tasks(),close);f.life.endBody();f.life.afterEach();expect(f.exit).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(f.retain).not.toHaveBeenCalled();});
 it.each(['noop','throw'] as const)('保留通知%s也先锁本地；迟到动作不得退出或关闭观察流',async mode=>{const f=lifetime(mode),original=Error('原始错误');await expect(f.life.observe(async()=>{throw original;})).rejects.toBe(original);const action=vi.fn(async()=>1);await expect(f.life.observe(action)).rejects.toThrow('停链');expect(action).not.toHaveBeenCalled();expect(f.exit).not.toHaveBeenCalled();});
 it('afterEach发现未settle先保留，迟到返回及owner恢复都不能发起收尾',async()=>{const f=lifetime();let resolve!:()=>void;const pending=f.life.observe(()=>new Promise<void>(yes=>{resolve=yes;}));const rejected=expect(pending).rejects.toThrow();expect(()=>f.life.afterEach()).toThrow();resolve();await rejected;f.life.endBody();expect(()=>f.life.afterEach()).toThrow();expect(f.exit).not.toHaveBeenCalled();});
 it.each(['deadline','status','timeout','clock','owner'] as const)('%s失效即永久停链，不从helper或afterEach重计预算',async mode=>{const f=lifetime();await f.life.observe(async()=>1);if(mode==='deadline')f.time(120000);else if(mode==='status')f.info.status='failed';else if(mode==='timeout')f.info.timeout=240000;else if(mode==='clock')f.time(-1);else f.change();await expect(f.life.observe(async()=>1)).rejects.toThrow();f.time(1);f.info.status='passed';f.info.timeout=120000;await expect(f.life.finish(async()=>tasks(),async()=>{})).rejects.toThrow();expect(f.exit).not.toHaveBeenCalled();});
 it('缺原起点和未知任务列表都不得以空列表或closed标志放行',async()=>{const f=lifetime(),missing=new QueryResultColumnsUiLifetime(f.owner,{timeout:120000,status:'passed'},()=>1);await expect(missing.observe(async()=>1)).rejects.toThrow();for(const value of [[],tasks().slice(0,2),[...tasks(),{id:'x',kind:'query.execute',status:'completed'}],tasks().map(t=>({...t,status:'running'}))])expect(()=>queryResultColumnsUiTasks(value)).toThrow();});
 it('真实严格函数等待捕获原stream的close，Promise end或换流不能伪造成功',async()=>{const events=new EventEmitter(),stream={closed:false,once:events.once.bind(events),removeListener:events.removeListener.bind(events),end(callback:()=>void){callback();queueMicrotask(()=>{stream.closed=true;events.emit('close');});},destroy(){}};const native={stream,end(callback:()=>void){queueMicrotask(callback);},destroy(){}},raw={connection:native};await closeQueryResultColumnsObserver(raw,native,stream,()=>{},value=>closeMysqlConnection(value,true,false,100));expect(stream.closed).toBe(true);stream.closed=false;await expect(closeQueryResultColumnsObserver(raw,native,stream,()=>{},async()=>{})).rejects.toThrow('同流');const close=vi.fn(async()=>{});await expect(closeQueryResultColumnsObserver({connection:{}},native,stream,()=>{},close)).rejects.toThrow('归属');expect(close).not.toHaveBeenCalled();});
});
/** 在隔离VM中运行将序列化到Electron的真实函数；原handler只返回RAM对象。 */
function audit(){let now=0;const original=vi.fn(async(_event:any,payload:any)=>({ok:true,result:payload.command==='sessions.open'?{sessionId:'s'}:payload.command==='connections.open'?{version:'8.4.11',dialect:'mysql'}:payload.command==='files.choose'?{token:payload.input.format,name:'visible-selected.'+payload.input.format}:{rows:2}})),handlers=new Map([['dbark:request',original]]);const context:any={Date:{now:()=>now},ipcMain:{_invokeHandlers:handlers},target:{senderId:1,profileId:'c',tabId:'q',sql:queryResultColumnsSql,deadline:120000}};runInNewContext(`(${installQueryResultColumnsAudit.toString()})({ipcMain},target)`,context);const invoke=(command:string,input:any={})=>handlers.get('dbark:request')!({sender:{id:1}},{command,input});return {context,original,handlers,invoke,state:context.__dbarkQueryResultColumnsAudit,time:(value:number)=>{now=value;}};}
describe('本例IPC观察器只委托准确原请求',()=>{
 it('首次目标拒绝分类保留，后续时钟变化和检查不能抹去原失败或委托请求',async()=>{
  const f=audit();await expect(f.invoke('settings.save',{activeTabId:'q',tabs:[{id:'q',kind:'query',connectionId:'c',sql:'RAM私有正文'}]})).rejects.toThrow('永久停链：工作区目标');
  f.time(120001);expect(()=>f.state.check()).toThrow('永久停链：工作区目标');await expect(f.invoke('tasks.list')).rejects.toThrow('工作区目标');
  expect(f.state.failure).toBe('工作区目标');expect(f.state.revision).toBe(1);expect(f.original).not.toHaveBeenCalled();
 });
 it('连接版本回包拒绝只保留分类，不将原始回包写入诊断',async()=>{
  const f=audit();f.original.mockResolvedValueOnce({ok:true,result:{version:'8.4.12',dialect:'mysql'}});
  await expect(f.invoke('connections.open',{id:'c'})).rejects.toThrow('连接方言或版本回包');expect(()=>f.state.check()).toThrow('连接方言或版本回包');
  expect(f.state.failure).toBe('连接方言或版本回包');expect(f.state.pending).toBe(0);expect(f.state.session).toBe('');expect(f.original).toHaveBeenCalledOnce();
 });
 it('失败回包记录已许可命令，后续请求仍永久拒绝且不委托',async()=>{
  const f=audit();f.original.mockResolvedValueOnce({ok:false,result:{rows:0}});
  await expect(f.invoke('connections.open',{id:'c'})).rejects.toThrow('原处理器失败回包：connections.open');await expect(f.invoke('tasks.list')).rejects.toThrow('原处理器失败回包：connections.open');
  expect(f.state.failure).toBe('原处理器失败回包：connections.open');expect(f.state.pending).toBe(0);expect(f.original).toHaveBeenCalledOnce();
 });
 it('原处理器异常保持同一个错误，后续检查只给固定分类且不保存异常正文',async()=>{
  const f=audit(),reason=Error('RAM原错误正文');f.original.mockRejectedValueOnce(reason);
  await expect(f.invoke('tasks.list')).rejects.toBe(reason);expect(()=>f.state.check()).toThrow('原处理器抛出：tasks.list');
  expect(f.state.failure).toBe('原处理器抛出：tasks.list');expect(f.state.pending).toBe(0);expect(f.original).toHaveBeenCalledOnce();
 });
 it.each([['query.sessionState','未许可命令：query.sessionState'],['RAM私有命令内容','未许可命令']])('拒绝%s时仅固定协议名称可见，既不回显任意字符串也不扩大允许名单',async(command,expected)=>{
  const f=audit();await expect(f.invoke(command,{private:'RAM私有输入'})).rejects.toThrow(expected);expect(f.state.failure).toBe(expected);
  await expect(f.invoke('tasks.list')).rejects.toThrow(expected);expect(f.original).not.toHaveBeenCalled();
 });
 it('一条原SQL和两次格式请求原样委托，不伪造结果，重复SQL立刻永久拒绝',async()=>{const f=audit();await f.invoke('sessions.open',{connectionId:'c'});await f.invoke('query.execute',{sessionId:'s',sql:queryResultColumnsSql});for(const format of ['csv','json']){await f.invoke('files.choose',{purpose:'export',format});const response=await f.invoke('files.exportResult',{format,encoding:'utf8',fileToken:format});expect(response).toEqual({ok:true,result:{rows:2}});}expect(f.state.queries).toBe(1);expect(f.state.exports).toEqual(['csv','json']);await expect(f.invoke('query.execute',{sessionId:'s',sql:queryResultColumnsSql})).rejects.toThrow('永久');expect(f.original.mock.calls.filter(([,p])=>p.command==='query.execute')).toHaveLength(1);});
 it.each(['connections.save','connections.delete','query.executeParameterized','schema.apply'])('修订或扩大路径%s不委托，改回也永久停链',async command=>{const f=audit();await expect(f.invoke(command,{})).rejects.toThrow();await expect(f.invoke('tasks.list')).rejects.toThrow('永久');expect(f.original).not.toHaveBeenCalled();});
 it('标签/SQL上下文ABA或handler替换均不能恢复；另sender原样委托不接管其它owner',async()=>{const f=audit();const wrapped=f.handlers.get('dbark:request')!;await wrapped({sender:{id:99}},{command:'foreign',input:{}});expect(f.original).toHaveBeenCalledOnce();await expect(f.invoke('settings.save',{activeTabId:'q',tabs:[{id:'q',kind:'query',connectionId:'c',sql:'改变'}]})).rejects.toThrow();await expect(f.invoke('settings.save',{activeTabId:'q',tabs:[{id:'q',kind:'query',connectionId:'c',sql:queryResultColumnsSql}]})).rejects.toThrow();const next=audit();next.handlers.set('dbark:request',next.original);expect(()=>next.state.check()).toThrow();next.handlers.set('dbark:request',wrapped);expect(()=>next.state.check()).toThrow();});
});
describe('人工独立文件与RAMcopy期待',()=>{
 const header='bytes,id,repeated,repeated [4],null_value,empty_value\r\n',first='base64:AP8=,1,18446744073709551615,0.12345678901234567890,\\N,""\r\n',last='base64:,3,9007199254740993,1.00000000000000000001,\\N,""\r\n';
 it('CSV原始字节独立拆列，拒绝隐藏列、行序、精度、NULL及空串混淆',()=>{const csv=header+first+last;verifyQueryResultColumnsFile('csv',Buffer.from(csv));for(const value of [header+last+first,csv.replace('18446744073709551615','18446744073709552000'),csv.replace('\\N',''),csv.replace('empty_value','hidden_value'),csv+'HIDDEN_SENTINEL'])expect(()=>verifyQueryResultColumnsFile('csv',Buffer.from(value))).toThrow();});
 it('JSON及合成copy逐项保留包装与精度，键顺序、隐藏字段或原型污染均不能蒙混',()=>{const rows=[{bytes:{type:'binary',base64:'AP8='},id:'1',repeated:'18446744073709551615',['repeated [4]']:'0.12345678901234567890',null_value:null,empty_value:''},{bytes:{type:'binary',base64:''},id:'3',repeated:'9007199254740993',['repeated [4]']:'1.00000000000000000001',null_value:null,empty_value:''}];verifyQueryResultColumnsFile('json',Buffer.from(JSON.stringify(rows)));const copy={prevented:true,typed:JSON.stringify({version:1,rows:[[{type:'binary',base64:'AP8='},'1','18446744073709551615','0.12345678901234567890',null,''],[{type:'binary',base64:''},'3','9007199254740993','1.00000000000000000001',null,'']]}),text:'0x00ff\t1\t18446744073709551615\t0.12345678901234567890\tNULL\t\n0x\t3\t9007199254740993\t1.00000000000000000001\tNULL\t'};verifyQueryResultColumnsCopy(copy);expect(()=>verifyQueryResultColumnsCopy({...copy,prevented:false})).toThrow();(rows[0] as Record<string,unknown>).hidden='多余';expect(()=>verifyQueryResultColumnsFile('json',Buffer.from(JSON.stringify(rows)))).toThrow();});
});

it('Root保存答案仅给原sender一次，使用后恢复原函数；其它窗口不获文件授权',async()=>{
 const f=audit(),original=vi.fn(async()=>({canceled:true}));f.context.dialog={showSaveDialog:original};f.context.answer={senderId:1,path:'/ram/visible-selected.csv'};runInNewContext(`(${answerQueryResultColumnsSave.toString()})({dialog},answer)`,f.context);expect(await f.context.dialog.showSaveDialog({webContents:{id:1}},{})).toEqual({canceled:false,filePath:'/ram/visible-selected.csv'});expect(f.context.dialog.showSaveDialog).toBe(original);
 runInNewContext(`(${answerQueryResultColumnsSave.toString()})({dialog},answer)`,f.context);await expect(f.context.dialog.showSaveDialog({webContents:{id:2}},{})).rejects.toThrow('其它窗口');expect(f.context.dialog.showSaveDialog).toBe(original);expect(f.state.invalid).toBe(true);
});

it('IPC审计必须先有准确sender且受原期限约束，时间恢复也不复活',()=>{const f=audit();f.time(120000);expect(()=>f.state.check()).toThrow();f.time(1);expect(()=>f.state.check()).toThrow();const context:any={Date:{now:()=>0},ipcMain:{_invokeHandlers:new Map([['dbark:request',vi.fn()]])},target:{senderId:0,profileId:'c',tabId:'q',sql:queryResultColumnsSql,deadline:120000}};expect(()=>runInNewContext(`(${installQueryResultColumnsAudit.toString()})({ipcMain},target)`,context)).toThrow('归属');expect(context.__dbarkQueryResultColumnsAudit).toBeUndefined();});
