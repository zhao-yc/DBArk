import{beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi}from'vitest';
import{mkdtempSync,rmSync,mkdirSync,rmdirSync,readFileSync}from'node:fs';
import{join,dirname,resolve,basename}from'node:path';
import{tmpdir}from'node:os';
import{createRequire}from'node:module';
import{randomUUID}from'node:crypto';
import{build}from'esbuild';
import type{Database}from'sql.js';
import{LocalStore}from'../../src/main/storage';
import{HistoryPages}from'../../src/main/historyPages';
import{SavedQueryPages}from'../../src/main/savedQueryPages';
import{SavedQueryMatcher}from'../../src/main/savedQueryMatcher';
import{SavedQuerySearchCancelled}from'../../src/main/savedQuerySearch';
import{summarizeHistoryRecord}from'../../src/main/historyPageMatch';
import{validateCommand}from'../../src/shared/validation';
import type{HistoryEntry,ConnectionProfile}from'../../src/shared/contracts';
import type{HistoryPageInput,HistoryPageEntry}from'../../src/shared/historyPages';

const require=createRequire(import.meta.url),protector={available:()=>false,encrypt:(value:string)=>value,decrypt:(value:string)=>value};
const request=(patch:Partial<HistoryPageInput>={}):HistoryPageInput=>({taskId:randomUUID(),search:'',fields:['sql','error'],scope:{kind:'all'},status:'all',onError:'continue',...patch});
const history=(patch:Partial<HistoryEntry>={}):HistoryEntry=>({id:'h',connectionId:'source',sql:'SELECT 9007199254740993',startedAt:'2026-10-15T00:00:00.000Z',elapsedMs:12,success:true,...patch});
const profile=(id='source'):ConnectionProfile=>({id,name:'离线来源',group:'',color:'#123456',dialect:'mysql',host:'127.0.0.1',port:1,user:'offline'});
const position=(entry:HistoryEntry)=>({id:entry.id,connectionId:entry.connectionId,startedAt:entry.startedAt});
let workerDirectory:string,workerPath:string,directory:string,store:LocalStore,service:HistoryPages,restore:()=>void;
const workers=new Set<SavedQueryMatcher>();let onSummary:(worker:SavedQueryMatcher)=>void=()=>{};
/** 清理只允许本例在系统临时父目录创建的精确前缀，不触碰其它目录。 */
function removeDirectory(path:string){if(dirname(resolve(path))!==resolve(tmpdir())||!basename(path).startsWith('dbark-test-historypages-'))throw Error('拒绝清理非本例临时目录');rmSync(path,{recursive:true,force:true});}
/** 直接写入原始夹具仅用于损坏和旧版记录，不作为生产新增历史接口。 */
function insert(entry:HistoryEntry,raw=JSON.stringify(entry)){(store as unknown as{db:Database}).db.run('INSERT INTO history VALUES(?,?,?,?)',[entry.id,entry.connectionId,raw,entry.startedAt]);}
beforeAll(async()=>{workerDirectory=mkdtempSync(join(tmpdir(),'dbark-test-historypages-'));workerPath=join(workerDirectory,'worker.cjs');await build({entryPoints:['src/main/savedQuerySearchWorker.ts'],outfile:workerPath,bundle:true,platform:'node',format:'cjs',target:'node22'});const original=SavedQueryMatcher.prototype.summarizeHistory,spy=vi.spyOn(SavedQueryMatcher.prototype,'summarizeHistory').mockImplementation(function(this:SavedQueryMatcher,...args){workers.add(this);const result=original.apply(this,args);onSummary(this);return result;});restore=()=>spy.mockRestore();});
afterAll(()=>{restore?.();removeDirectory(workerDirectory);});
beforeEach(async()=>{directory=mkdtempSync(join(tmpdir(),'dbark-test-historypages-'));store=await LocalStore.open(join(directory,'test.sqlite'),require.resolve('sql.js/dist/sql-wasm.wasm'),protector);service=new HistoryPages(store,workerPath);workers.clear();onSummary=()=>{};});
afterEach(async()=>{await service?.close();for(const worker of workers)expect(worker.threadId).toBe(-1);store?.close();removeDirectory(directory);});

describe('时间范围沿真实SQLite概要分页和worker处理',()=>{
 it('60条真实记录有界分批，实际开始时刻[开始,结束)匹配20条，数据库文件零变化',async()=>{
  for(let i=0;i<60;i++)store.addHistory(history({id:'h'+String(i).padStart(2,'0'),startedAt:new Date(Date.parse('2026-10-17T10:00:00Z')+i*60000).toISOString(),sql:'合成长SQL_'+'x'.repeat(2000)}));
  const before=readFileSync(join(directory,'test.sqlite')),range={from:'2026-10-17T10:20:00.000Z',until:'2026-10-17T10:40:00.000Z'};
  let page=await service.start(request({timeRange:range})),ids:string[]=[];
  while(true){expect(page.items.length).toBeLessThanOrEqual(25);expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(128*1024);ids.push(...page.items.map(value=>value.entry.id));if(!page.cursor)break;page=await service.next({taskId:randomUUID(),cursor:page.cursor});}
  expect(ids).toEqual(Array.from({length:20},(_,i)=>'h'+String(39-i)));expect(page).toMatchObject({scanned:60,matched:20,failed:0});
  expect(readFileSync(join(directory,'test.sqlite'))).toEqual(before);expect(store.tasks()).toEqual([]);
 });
 it('坏和无时区遗留时间按onError计数或停止，未启用范围仍保持旧行为',async()=>{
  store.addHistory(history({id:'valid',startedAt:'2026-10-17T12:00:00Z'}));store.addHistory(history({id:'legacy',startedAt:'2026-10-19',sql:'不得回显的合成正文'}));
  const range={from:'2026-10-17T00:00:00.000Z',until:'2026-10-18T00:00:00.000Z'};
  const continued=await service.start(request({timeRange:range}));expect(continued.items.map(value=>value.entry.id)).toEqual(['valid']);expect(continued).toMatchObject({scanned:2,matched:1,failed:1});expect(JSON.stringify(continued.failures)).not.toContain('不得回显');
  const stopped=await service.start(request({timeRange:range,onError:'stop'}));expect(stopped).toMatchObject({scanned:1,matched:0,failed:1,stoppedOnError:true});expect(stopped.cursor).toBeUndefined();
  expect((await service.start(request())).items.map(value=>value.entry.id)).toEqual(['legacy','valid']);
 });
 it('游标绑定起始时复制的不可变范围，篡改原对象或续页参数不能改筛选',async()=>{
  for(let i=0;i<30;i++)store.addHistory(history({id:'h'+String(i).padStart(2,'0'),startedAt:'2026-10-17T12:00:00.000Z'}));
  const input=request({timeRange:{from:'2026-10-17T00:00:00.000Z',until:'2026-10-18T00:00:00.000Z'}}),pending=service.start(input);
  input.timeRange!.from='2027-01-01T00:00:00.000Z';input.timeRange!.until='2027-01-02T00:00:00.000Z';const first=await pending;expect(first.items).toHaveLength(25);
  expect(()=>service.next({taskId:randomUUID(),cursor:first.cursor,timeRange:input.timeRange})).toThrow();
  const last=await service.next({taskId:randomUUID(),cursor:first.cursor});expect(last.items).toHaveLength(5);expect(last.matched).toBe(30);
  expect(()=>service.next({taskId:randomUUID(),cursor:first.cursor})).toThrow('已翻页');
 });
 it('偏移格式的真实startedAt先解析时刻，不能按索引字面量判断范围',async()=>{
  store.addHistory(history({id:'offset',startedAt:'2026-10-17T08:00:00+08:00'}));store.addHistory(history({id:'before',startedAt:'2026-10-17T07:59:59.999+08:00'}));
  const page=await service.start(request({timeRange:{from:'2026-10-17T00:00:00.000Z',until:'2026-10-17T00:00:00.001Z'}}));expect(page.items.map(value=>value.entry.id)).toEqual(['offset']);
 });
 it('范围读取取消等待worker真实终止，释放或关闭后不遗留可续读游标',async()=>{
  for(let i=0;i<30;i++)store.addHistory(history({id:'h'+i}));const input=request({timeRange:{from:'2026-10-01T00:00:00.000Z'}});
  onSummary=()=>{void service.cancel(input.taskId);};await expect(service.start(input)).rejects.toBeInstanceOf(SavedQuerySearchCancelled);onSummary=()=>{};
  const first=await service.start(request({timeRange:input.timeRange}));service.release({cursor:first.cursor});expect(()=>service.next({taskId:randomUUID(),cursor:first.cursor})).toThrow('已过期');
  const second=await service.start(request({timeRange:input.timeRange}));await service.close();expect(()=>service.next({taskId:randomUUID(),cursor:second.cursor})).toThrow('已过期');
 });
});

