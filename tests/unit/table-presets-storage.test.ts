import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import initSqlJs from 'sql.js';
import {LocalStore} from '../../src/main/storage';
import {exportConnectionProfile,copyConnectionProfile} from '../../src/shared/connectionTransfer';
import {tablePresetDocumentSchema,tablePresetSaveSchema,validateTablePresetBudget,validateTablePresetColumns,type TablePresetConfiguration,type TablePresetStoredSnapshot} from '../../src/shared/tablePresets';
const require=createRequire(import.meta.url),wasm=require.resolve('sql.js/dist/sql-wasm.wasm'),dirs:string[]=[];
const protector={available:()=>true,encrypt:(value:string)=>'RAM密文:'+value,decrypt:(value:string)=>value.slice(6)};
const target={connectionId:'ram-a',database:'库.__proto__',table:'表/constructor'};
const profile={id:'ram-a',name:'离线连接',host:'offline.invalid',port:3306,user:'RAM',dialect:'mysql' as const,color:'#ffffff',group:'RAM',rememberPassword:true,password:'合成秘密'};
const config:TablePresetConfiguration={filters:[{column:'payload',operator:'IN',values:['','  ','9007199254740993','NULL']},{column:'nullable',operator:'IS NULL'}],filterMode:'any',sort:[{column:'payload',direction:'DESC'}]};
const packet=(snapshot:TablePresetStoredSnapshot)=>({...target,source:snapshot.source,expectedRevision:snapshot.revision,bindingToken:randomUUID()});
async function fixture(){const dir=mkdtempSync(join(tmpdir(),'dbark-preset-'));dirs.push(dir);const file=join(dir,'local.sqlite'),store=await LocalStore.open(file,wasm,protector);store.saveConnection(profile);return {file,store};}
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
describe('命名方案真实SQLite、CAS与原子持久化',()=>{
 it('显式保存精确值/NULL和排序，重启读回；连接/库/表严格隔离',async()=>{
  const {file,store}=await fixture(),empty=store.tablePresets(target);expect(empty.entries).toEqual([]);
  const saved=store.saveTablePreset({...packet(empty),name:'精确方案',configuration:config});expect(saved.entries[0].configuration).toEqual(config);
  store.saveConnection({...profile,id:'ram-b'});expect(store.tablePresets({...target,connectionId:'ram-b'}).entries).toEqual([]);expect(store.tablePresets({...target,database:'另库'}).entries).toEqual([]);expect(store.tablePresets({...target,table:'另表'}).entries).toEqual([]);
  store.close();const reopened=await LocalStore.open(file,wasm,protector);expect(reopened.tablePresets(target).entries).toEqual(saved.entries);reopened.close();
 });
 it('同名必须明确覆盖，过期覆盖/删除和目标替换均拒绝，最后一项删除保留CAS墓碑',async()=>{
  const {store}=await fixture();let saved=store.saveTablePreset({...packet(store.tablePresets(target)),name:'方案',configuration:config}),old=packet(saved),id=saved.entries[0].id;
  expect(()=>store.saveTablePreset({...old,name:'方案',configuration:config})).toThrow('同名');
  saved=store.saveTablePreset({...old,name:'方案',replaceId:id,configuration:{...config,filterMode:'all'}});
  expect(()=>store.deleteTablePreset({...old,id})).toThrow('变化');expect(()=>store.saveTablePreset({...old,name:'方案',replaceId:id,configuration:config})).toThrow('变化');
  const removed=store.deleteTablePreset({...packet(saved),id});expect(removed.entries).toEqual([]);expect(removed.revision).toBe(3);expect(()=>store.deleteTablePreset({...packet(saved),id})).toThrow('变化');
  const created=store.saveTablePreset({...packet(removed),name:'方案',configuration:config});store.saveConnection({...profile,host:'different.invalid'});expect(()=>store.selectedTablePreset({...packet(created),id:created.entries[0].id})).toThrow('变化');const current=store.tablePresets(target);expect(()=>store.selectedTablePreset({...packet(current),id:created.entries[0].id})).toThrow('来源');store.close();
 });
 it('写盘真实失败同时恢复内存和原文件，不把失败保存夹带到后来操作',async()=>{
  const {store,file}=await fixture(),empty=store.tablePresets(target),before=readFileSync(file);mkdirSync(file+'.tmp');
  expect(()=>store.saveTablePreset({...packet(empty),name:'失败项',configuration:config})).toThrow('未保存');expect(store.tablePresets(target)).toEqual(empty);expect(readFileSync(file)).toEqual(before);
  rmSync(file+'.tmp',{recursive:true});const result=store.saveTablePreset({...packet(empty),name:'成功项',configuration:config});expect(result.entries.map(entry=>entry.name)).toEqual(['成功项']);store.close();
 });
 it('连接复制与导出继续白名单，不携带方案；删除其它连接不误清当前值',async()=>{
  const {store}=await fixture();const saved=store.saveTablePreset({...packet(store.tablePresets(target)),name:'方案',configuration:config});store.saveConnection({...profile,id:'ram-b'});store.deleteConnection('ram-b');
  expect(store.tablePresets(target).entries).toEqual(saved.entries);for(const exported of [exportConnectionProfile(store.connections()[0]),copyConnectionProfile(store.connections()[0])]){expect(JSON.stringify(exported)).not.toContain('configuration');expect(JSON.stringify(exported)).not.toContain('9007199254740993');}store.close();
 });
 it('名称/条数/64KiB及全库500/4MiB边界，拒SQL、路径、页码及错误操作符',async()=>{
  const {store}=await fixture();let current=store.tablePresets(target);
  for(let i=0;i<20;i++)current=store.saveTablePreset({...packet(current),name:'方案'+i,configuration:config});
  expect(()=>store.saveTablePreset({...packet(current),name:'第21项',configuration:config})).toThrow();expect(store.tablePresets(target).entries).toHaveLength(20);
  for(const extra of [{sql:'SELECT 1'},{caPath:'never-read.pem'},{page:1}])expect(()=>tablePresetSaveSchema.parse({...packet(current),name:'新项',configuration:config,...extra})).toThrow();
  expect(()=>tablePresetSaveSchema.parse({...packet(current),name:'字'.repeat(81),configuration:config})).toThrow();
  expect(()=>validateTablePresetColumns({...config,filters:[{column:'payload',operator:'未知' as '='}]},['payload'])).toThrow();
  const entry={id:randomUUID(),name:'边界',connectionDigest:'a'.repeat(64),configuration:{filters:[{column:'payload',operator:'IN' as const,values:[...Array(15).fill('x'.repeat(4096)),'']}],filterMode:'all' as const,sort:[]}};
  entry.configuration.filters[0].values[15]='x'.repeat(65536-Buffer.byteLength(JSON.stringify(entry)));
  expect(Buffer.byteLength(JSON.stringify(entry))).toBe(65536);expect(()=>tablePresetDocumentSchema.parse({version:1,revision:0,entries:[entry]})).not.toThrow();entry.configuration.filters[0].values[15]+='x';expect(()=>tablePresetDocumentSchema.parse({version:1,revision:0,entries:[entry]})).toThrow('64 KiB');
  expect(()=>validateTablePresetBudget(500,500,4*1024*1024)).not.toThrow();for(const args of [[501,500,1],[500,501,1],[500,500,4*1024*1024+1]])expect(()=>validateTablePresetBudget(...args as [number,number,number])).toThrow();store.close();
 });
});
describe('schema7迁移保护',()=>{
 it('真实旧schema6的设置/查询/历史/秘密槽和其它原表记录逐表不变',async()=>{
  const {store,file}=await fixture();store.saveQuery({id:'q',name:'旧查询',sql:'原文',updatedAt:'2026-10-18T00:00:00Z'});store.addHistory({id:'h',connectionId:profile.id,sql:'旧历史',startedAt:'2026-10-18T00:00:00Z',elapsedMs:1,success:true});store.saveSettings({...store.settings(),sidebarWidth:345});store.close();
  const SQL=await initSqlJs({locateFile:()=>wasm}),old=new SQL.Database(readFileSync(file));old.run('DROP TABLE table_presets;PRAGMA user_version=6');
  const tables=['connections','secrets','queries','history','settings','workbench','sql_snippets','table_preferences','tasks','table_apply_receipts'];const before=tables.map(name=>old.exec('SELECT * FROM '+name));writeFileSync(file,old.export());old.close();
  const migrated=await LocalStore.open(file,wasm,protector);expect(migrated.tablePresets(target).entries).toEqual([]);migrated.close();const after=new SQL.Database(readFileSync(file));expect(after.exec('PRAGMA user_version')[0].values[0][0]).toBe(7);expect(tables.map(name=>after.exec('SELECT * FROM '+name))).toEqual(before);after.close();
 });
 it.each(['future','document','migration'] as const)('%s失败保持原文件字节，不猜测降级',async mode=>{
  const {store,file}=await fixture();store.close();const SQL=await initSqlJs({locateFile:()=>wasm}),db=new SQL.Database(readFileSync(file));
  if(mode==='future')db.run('PRAGMA user_version=8');
  if(mode==='document')db.run('INSERT INTO table_presets VALUES (?,?,?,?)',[target.connectionId,target.database,target.table,JSON.stringify({version:2,revision:0,entries:[]})]);
  if(mode==='migration')db.run('DROP TABLE table_presets;PRAGMA user_version=6');
  writeFileSync(file,db.export());db.close();if(mode==='migration')mkdirSync(file+'.tmp');const before=readFileSync(file);
  await expect(LocalStore.open(file,wasm,protector)).rejects.toThrow();expect(readFileSync(file)).toEqual(before);
 });
});
