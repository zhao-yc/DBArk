import {afterEach,beforeAll,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,rmdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createContext,runInContext} from 'node:vm';
import ts from 'typescript';
import initSqlJs,{type Database} from 'sql.js';
import {LocalStore,defaultSettings} from '../../src/main/storage';
import {commandSchemas,validateCommand} from '../../src/shared/validation';
import {readQueryEditorHeight} from '../../src/shared/queryLayout';
import {emptyWorkbench} from '../../src/shared/workbench';
import {emptyTableApplyEvidence} from '../../src/shared/tableApplyReceipt';
import type {AppSettings} from '../../src/shared/contracts';
const wasm=createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'),root=resolve('.cache/query-layout-evidence/stores'),dirs:string[]=[],opened:LocalStore[]=[];
const protector={available:()=>false,encrypt:()=>{throw Error('查询布局不使用密钥');},decrypt:()=>{throw Error('不得解密合成秘密槽');}};
let SQL:Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async()=>{mkdirSync(root,{recursive:true});SQL=await initSqlJs({locateFile:()=>wasm});});
/** 只清理本例亲自创建并核对过父目录的合成库，不接触已有配置。 */
afterEach(()=>{for(const store of opened.splice(0))store.close();for(const dir of dirs.splice(0)){if(dirname(resolve(dir))!==root)throw Error('拒绝清理非本例目录');rmSync(dir,{recursive:true,force:true});}});
/** 每次创建本人缓存下独立合成库，复用只会失败的凭据端口。 */
async function fixture(){const dir=mkdtempSync(join(root,'layout-'));dirs.push(dir);const file=join(dir,'local.sqlite'),store=await LocalStore.open(file,wasm,protector);opened.push(store);return {file,store};}
/** 显式关闭后同步移除清理登记，避免重复关闭。 */
function close(store:LocalStore){store.close();opened.splice(opened.indexOf(store),1);}
/** 重新打开同一本例SQLite并登记清理，覆盖真正持久化读取。 */
async function reopen(file:string){const store=await LocalStore.open(file,wasm,protector);opened.push(store);return store;}
/** 只编辑已关闭的本例SQLite，用真实pragma和settings行模拟旧版本或损坏字段。 */
function edit(file:string,action:(db:Database)=>void){const db=new SQL.Database(readFileSync(file));try{action(db);writeFileSync(file,db.export());}finally{db.close();}}
const sourceBinding={id:'saved',digest:'a'.repeat(64),connectionId:'ram',connectionDigest:'b'.repeat(64),context:{state:'known' as const,database:null}};
const original=():AppSettings=>({...defaultSettings,theme:'light',sidebarWidth:344,editorFontSize:22,editorWordWrap:false,editorTabSize:8,editorInsertSpaces:false,activeTabId:'q2',tabs:[{id:'q1',kind:'query',title:'原查询一',connectionId:'ram',sql:"SELECT '900719925474099312345';\r\n\t-- 🚢",databaseContext:{state:'unknown'},sourceBinding},{id:'q2',kind:'query',title:'原查询二',connectionId:'ram',sql:'未保存草稿',databaseContext:{state:'known',database:null}},{id:'t',kind:'table',title:'原表标签',connectionId:'ram',database:'原库',table:'原表'}]});
/** 真Main参数验证及settings分支保持原文，只提供本例LocalStore和状态边界。 */
function main(store:LocalStore){const text=readFileSync(new URL('../../src/main/index.ts',import.meta.url),'utf8'),tree=ts.createSourceFile('main.ts',text,ts.ScriptTarget.Latest,true),clauses:string[]=[];let validation='';
 function visit(node:ts.Node){if(ts.isCaseClause(node)&&["'settings.save'","'settings.get'"].includes(node.expression.getText(tree)))clauses.push(node.getText(tree));if(ts.isFunctionDeclaration(node)&&node.name?.text==='validateMainCommand')validation=node.getText(tree);ts.forEachChild(node,visit);}visit(tree);if(clauses.length!==2||!validation)throw Error('缺少真实Main设置入口');
 const context=createContext({store,validateCommand,rendererSettingsCurrent:true,rendererHasSettings:false,stateFlushed:undefined,Error});
 runInContext(ts.transpileModule(validation+'\nasync function route(command,input){input=validateMainCommand(command,input);switch(command){'+clauses.join('\n')+'}}globalThis.route=route;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);return context;
}

it('真实Main严格读写后SQLite重启逐标签保持高度，缺项不补写，SQL/来源/偏好不变',async()=>{
 const {file,store}=await fixture(),settings=original();settings.tabs[0].queryEditorHeight=130;settings.tabs[1].queryEditorHeight=8192;settings.tabs.push({id:'legacy',kind:'query',title:'旧缺项',connectionId:'ram',sql:'原文'});
 const port=main(store);await port.route('settings.save',settings);expect(await port.route('settings.get',{})).toEqual(settings);close(store);
 const restored=await reopen(file);expect(restored.settings()).toEqual(settings);expect(Object.hasOwn(restored.settings().tabs[3],'queryEditorHeight')).toBe(false);expect(readQueryEditorHeight(restored.settings().tabs[3].queryEditorHeight)).toBe(300);
 expect(restored.queries()).toEqual([]);expect(restored.history()).toEqual([]);expect(restored.tasks()).toEqual([]);
});
it('IPC schema/真实Main/直接存储共同拒绝显式坏值和table字段，未知字段仍strict且不改文件',async()=>{
 const {file,store}=await fixture(),settings=original(),port=main(store);store.saveSettings(settings);const before=readFileSync(file);
 for(const value of [undefined,null,'300',129,8193,200.5,NaN,Infinity,-Infinity,true,{},[]]){
  const input={...settings,tabs:[{...settings.tabs[0],queryEditorHeight:value}]};expect(()=>validateCommand('settings.save',input)).toThrow();expect(commandSchemas['settings.save'].safeParse(input).success).toBe(false);await expect(port.route('settings.save',input)).rejects.toThrow();expect(()=>store.saveSettings(input as AppSettings)).toThrow('整数');
 }
 for(const value of [undefined,300]){const input={...settings,tabs:[{...settings.tabs[2],queryEditorHeight:value}]};expect(()=>validateCommand('settings.save',input)).toThrow('只有查询');expect(commandSchemas['settings.save'].safeParse(input).success).toBe(false);expect(()=>store.saveSettings(input)).toThrow('只有查询');}
 const inherited=Object.assign(Object.create({queryEditorHeight:300}),settings.tabs[0]);expect(()=>validateCommand('settings.save',{...settings,tabs:[inherited]})).toThrow('自有');expect(()=>store.saveSettings({...settings,tabs:[inherited]})).toThrow('自有');
 for(const input of [{...settings,queryHeight:400},{...settings,tabs:[{...settings.tabs[0],editorHeight:400}]}])expect(()=>validateCommand('settings.save',input)).toThrow();
 expect(readFileSync(file)).toEqual(before);expect(store.settings()).toEqual(settings);
});
it('旧坏字段只局部回退/移除，另一个query高度、原SQL/sourceBinding和tabs顺序不丢，不隐式保存',async()=>{
 const {file,store}=await fixture();close(store);const settings=original();const raw={...settings,tabs:[{...settings.tabs[0],queryEditorHeight:'450'},{...settings.tabs[1],queryEditorHeight:600},{...settings.tabs[2],queryEditorHeight:500},{...settings.tabs[0],id:'missing'}]};
 edit(file,db=>{db.run('INSERT INTO settings VALUES(1,?)',[JSON.stringify(raw)]);});const restored=await reopen(file),afterOpen=readFileSync(file);
 const expected={...raw,tabs:[{...raw.tabs[0],queryEditorHeight:300},raw.tabs[1],settings.tabs[2],raw.tabs[3]]};expect(restored.settings()).toEqual(expected);expect(restored.settings()).toEqual(expected);expect(readFileSync(file)).toEqual(afterOpen);
 const db=new SQL.Database(readFileSync(file));expect(JSON.parse(String(db.exec('SELECT data FROM settings')[0].values[0][0]))).toEqual(raw);db.close();
});

/** 所有旧schema7表均有合成记录，秘密仅为不能解密的占位字节；不创建或读取实际凭据。 */
function populate(store:LocalStore){
 const profile={id:'ram',name:'合成连接',dialect:'mysql' as const,host:'offline.invalid',port:3306,user:'RAM',group:'',color:'#123456'};store.saveConnection(profile);store.saveSettings(original());
 store.saveQuery({id:'saved',name:'原保存查询',sql:'原查询正文\t🚢',updatedAt:'2026-10-18T00:00:00Z'});store.addHistory({id:'history',connectionId:'ram',sql:'原历史正文',startedAt:'2026-10-18T00:00:00Z',elapsedMs:1,success:true});
 store.saveTask({id:'task',kind:'query.execute',status:'completed',progress:100,message:'合成完成',startedAt:'2026-10-18T00:00:00Z'});store.saveSnippet({id:'snippet',name:'原片段',group:'组',description:'说明',sql:'原片段正文',updatedAt:'2026-10-18T00:00:00Z'});
 store.saveWorkbench({revision:0,document:{...emptyWorkbench(),focusMode:true}});store.saveTablePreferences({connectionId:'ram',database:'db',table:'t',preferences:{version:1,columns:[{name:'payload',hidden:false,width:200}]}});
 store.saveTableApplyReceipt({version:1,operationId:randomUUID(),taskId:'receipt-task',previewId:randomUUID(),target:{connectionId:'ram',connectionRevision:1,database:'db',table:'t'},intent:{insert:0,update:0,delete:0,statementCount:0},phase:'terminal',outcome:'not-sent',reason:'none',startedAt:'2026-10-18T00:00:00Z',finishedAt:'2026-10-18T00:00:01Z',sequence:0,committedReportedRows:0,scope:'target-transaction-only',evidence:emptyTableApplyEvidence()});
 const target={connectionId:'ram',database:'db',table:'t'},snapshot=store.tablePresets(target);store.saveTablePreset({...target,source:snapshot.source,expectedRevision:snapshot.revision,bindingToken:randomUUID(),name:'原方案',configuration:{filters:[],filterMode:'all',sort:[]}});
}
/** 生成与基线DDL相同的真实schema7；先移除后来新增的来源和可选历史表，保留原11表逐字比对。 */
function oldSeven(file:string){edit(file,db=>{db.run('DROP TABLE IF EXISTS query_file_sources');db.run('DROP TABLE IF EXISTS query_file_recents');db.run('INSERT INTO secrets VALUES(?,?,?)',['ram','password','NON_SECRET_CIPHERTEXT_MARKER']);db.run('PRAGMA user_version=7');});const db=new SQL.Database(readFileSync(file));try{const tables=db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0].values.map(([name])=>String(name));return tables.map(name=>({name,rows:db.exec('SELECT * FROM '+name)}));}finally{db.close();}}
it('真实旧schema7的11张表逐表原文保留原子升9，不读取合成秘密槽',async()=>{
 const {file,store}=await fixture();populate(store);close(store);const before=oldSeven(file);expect(before).toHaveLength(11);expect(before.every(table=>table.rows[0]?.values.length>0)).toBe(true);
 const restored=await reopen(file);expect(restored.settings()).toEqual(original());const db=new SQL.Database(readFileSync(file));expect(db.exec('PRAGMA user_version')[0].values[0][0]).toBe(9);expect(before.map(({name})=>({name,rows:db.exec('SELECT * FROM '+name)}))).toEqual(before);expect(db.exec('SELECT * FROM query_file_recents')).toEqual([]);db.close();
});
it('旧7迁移真实写盘失败保持旧文件和版本，故障消除后可重试且旧11表内容不变',async()=>{
 const {file,store}=await fixture();populate(store);close(store);const old=oldSeven(file),before=readFileSync(file);mkdirSync(file+'.tmp');
 await expect(LocalStore.open(file,wasm,protector)).rejects.toThrow('修改未保存');expect(readFileSync(file)).toEqual(before);const failed=new SQL.Database(readFileSync(file));expect(failed.exec('PRAGMA user_version')[0].values[0][0]).toBe(7);failed.close();
 rmdirSync(file+'.tmp');await reopen(file);const db=new SQL.Database(readFileSync(file));expect(db.exec('PRAGMA user_version')[0].values[0][0]).toBe(9);expect(old.map(({name})=>({name,rows:db.exec('SELECT * FROM '+name)}))).toEqual(old);db.close();
});
it('未来schema10在任何settings回退或迁移写入前拒绝，原文件字节保持',async()=>{
 const {file,store}=await fixture();close(store);edit(file,db=>{db.run('PRAGMA user_version=10');db.run('INSERT INTO settings VALUES(1,?)',[JSON.stringify({...original(),futureField:'保留'})]);});const before=readFileSync(file);await expect(LocalStore.open(file,wasm,protector)).rejects.toThrow('更新版本');expect(readFileSync(file)).toEqual(before);
});
it('高度保存及失败回滚不改变连接/工作台修订和方案CAS，后来操作不夹带失败高度',async()=>{
 const {file,store}=await fixture();populate(store);const before=original(),target={connectionId:'ram',database:'db',table:'t'},snapshot=store.tablePresets(target),selected={...target,source:snapshot.source,expectedRevision:snapshot.revision,bindingToken:randomUUID(),id:snapshot.entries[0].id};
 const connectionRevision=store.connectionRevision(),workbench=store.workbench();store.saveSettings({...before,tabs:before.tabs.map(tab=>tab.kind==='query'?{...tab,queryEditorHeight:500}:tab)});
 expect(store.connectionRevision()).toBe(connectionRevision);expect(store.workbench()).toEqual(workbench);expect(store.selectedTablePreset(selected)).toEqual(snapshot.entries[0].configuration);
 const second=store.saveTablePreset({...target,source:selected.source,expectedRevision:selected.expectedRevision,bindingToken:selected.bindingToken,name:'另一个方案',configuration:{filters:[],filterMode:'all',sort:[]}});store.saveSettings(store.settings());expect(()=>store.selectedTablePreset(selected)).toThrow('变化');expect(store.tablePresets(target)).toEqual(second);
 const valid=store.settings(),bytes=readFileSync(file);mkdirSync(file+'.tmp');expect(()=>store.saveSettings({...valid,tabs:valid.tabs.map(tab=>tab.kind==='query'?{...tab,queryEditorHeight:700}:tab)})).toThrow('修改未保存');expect(store.settings()).toEqual(valid);expect(readFileSync(file)).toEqual(bytes);expect(store.connectionRevision()).toBe(connectionRevision);expect(store.workbench()).toEqual(workbench);expect(store.tablePresets(target)).toEqual(second);
 rmdirSync(file+'.tmp');store.saveSettings({...store.settings(),theme:'dark'});close(store);const restored=await reopen(file);expect(restored.settings()).toEqual({...valid,theme:'dark'});
});
