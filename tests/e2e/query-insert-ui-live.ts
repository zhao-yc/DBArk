import mysql from 'mysql2';
import type { RowDataPacket } from 'mysql2/promise';
import type { ResultSetHeader } from 'mysql2';
import type { ElectronApplication, TestInfo } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { Socket } from 'node:net';
import { lstat, realpath, readdir, open, type FileHandle } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { closeMysqlConnection } from '../../src/engine/connection';
import { test, expect, dataDir, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, pageErrors } from './desktop-fixture';
import { BatchFillPreparation } from '../helpers/tableBatchFillLive';
import { QueryInsertUiScope, queryInsertUiCases, insertUiDatabase, type QueryInsertUiTarget } from '../helpers/queryInsertUiLive';
import { InsertUiObserverReceipt, connectInsertUiObserver, InsertUiOwnershipJournal, insertUiOwnershipPlan, captureInsertUiFile, verifyInsertUiFile, releaseInsertUiFile, expectedPreciseInsertUiFile as expectedInsertUiFile, insertUiPreciseSource, assertInsertUiSchema, type InsertUiFileReceipt } from '../helpers/queryInsertUiOwnership';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryStreamZh as stream } from '../../src/renderer/locales/queryStreamExport.zh-CN';
import { queryInsertZh as insert } from '../../src/shared/queryInsertExport.zh-CN';

/** 唯一替换点是本例一次原生保存回答；原函数立即恢复，不替换Main文件cap或任何IPC。 */
async function installInsertSaveAnswer(application:ElectronApplication,file:string,nonce:string){
  return application.evaluate(({dialog,BrowserWindow},{file,nonce})=>{
    type State={nonce:string;calls:number;restored:boolean;original:typeof dialog.showSaveDialog};
    const root=globalThis as typeof globalThis&{__insertUiSave?:State};if(root.__insertUiSave)throw Error('原保存回答仍存在');
    const windows=BrowserWindow.getAllWindows();if(windows.length!==1)throw Error('保存回答窗口归属未知');const window=windows[0],original=dialog.showSaveDialog;
    const state:State={nonce,calls:0,restored:false,original};root.__insertUiSave=state;
    dialog.showSaveDialog=(async(...args:unknown[])=>{
      const options=args.at(-1) as Electron.SaveDialogOptions;
      if(root.__insertUiSave!==state||window.isDestroyed()||BrowserWindow.getAllWindows().length!==1||BrowserWindow.getAllWindows()[0]!==window||args[0]!==window||state.calls||options.title!=='导出文件'||options.filters?.[0]?.extensions.join(',')!=='sql')throw Error('保存回答不是本例原SQL选择');
      state.calls++;dialog.showSaveDialog=original;state.restored=true;return{canceled:false,filePath:file};
    }) as typeof dialog.showSaveDialog;
    return {nonce,calls:state.calls,restored:state.restored};
  },{file,nonce});
}
/** 正常消费后才移除本例私有记录；未知失败不恢复未知函数或删除门线索。 */
async function finishInsertSaveAnswer(application:ElectronApplication,nonce:string){return application.evaluate(({dialog},nonce)=>{
  const root=globalThis as typeof globalThis&{__insertUiSave?:{nonce:string;calls:number;restored:boolean;original:typeof dialog.showSaveDialog}};
  const state=root.__insertUiSave;if(!state||state.nonce!==nonce||state.calls!==1||!state.restored||dialog.showSaveDialog!==state.original)throw Error('原保存回答未确认闭合');
  const result={calls:state.calls,restored:state.restored};delete root.__insertUiSave;return result;
},nonce);}

/** 仅双门显式加载；不导入会读取旧.env的live-helpers，不拓宽共享fixture。 */
export function registerQueryInsertUi(binding:QueryInsertUiTarget){
  const preparations=new WeakMap<TestInfo,BatchFillPreparation>(),scopes=new WeakMap<TestInfo,QueryInsertUiScope>();
  const launchGuard={assertCurrent(){binding.assertCurrent();},assertPreparation(info:TestInfo){let preparation=preparations.get(info);if(!preparation){preparation=new BatchFillPreparation(info as TestInfo&{_startWallTime?:number});preparations.set(info,preparation);}preparation.assertCurrent();}};
  test.describe.configure({mode:'serial',timeout:120000,retries:0});test.use({trace:'off',screenshot:'off',video:'off',preserveOnUnconfirmedExit:true,ownedDesktopLaunchGuard:launchGuard});
  test.afterEach(({},info)=>{const scope=scopes.get(info);if(scope)scope.end();else retainOwnedDesktopResources(info);});
  for(const [scenario,name]of queryInsertUiCases.entries())test(name,async({},info)=>{
    const captured=ownedDesktopResources(info),page=captured.page,application=captured.application,directory=dataDir;
    type Driver=ReturnType<typeof mysql.createConnection>&{stream:Socket};type Observer=ReturnType<Driver['promise']>&{connection:Driver};
    let native:Driver|undefined,observerReceipt:InsertUiObserverReceipt<Socket,Driver,Observer>|undefined;
    let targetHandle:FileHandle|undefined,partialHandle:FileHandle|undefined,targetReceipt:InsertUiFileReceipt|undefined,partialReceipt:InsertUiFileReceipt|undefined,journal:InsertUiOwnershipJournal|undefined;
    let desktopConfirmed=false,databaseAck=false;
    let originalFailure:unknown;
    const plan=insertUiOwnershipPlan(scenario,randomUUID().replaceAll('-',''),createHash('sha256').update(info.testId+':'+scenario).digest('hex'));
    const database=insertUiDatabase(plan.database),definitions:Record<string,string>={};
    const file=join(directory,'insert-native.sql'),original='本例原目标，确认发布之前必须逐字保持。\n';
    const scope=new QueryInsertUiScope(info as TestInfo&{_startWallTime?:number},()=>test.info(),binding,{
      assertCurrent(allowClosed){const owner=ownedDesktopResources(info);if(owner.application!==application||owner.page!==page||dataDir!==directory||!allowClosed&&(owner.closed||page.isClosed()))throw Error('完整INSERT原app/page/目录/观察流归属已失效');observerReceipt?.assertCurrent();},retain(){retainOwnedDesktopResources(info);},
    });scopes.set(info,scope);
    const step=<T>(action:()=>Promise<T>,closed=false)=>scope.step(action,closed);
    const resourceCheck=()=>scope.assertCurrent(desktopConfirmed);
    try{
      scope.assertCurrent();
      const dirStat=await step(()=>lstat(directory,{bigint:true})),canonical=await step(()=>realpath(directory));
      expect(dirStat.isDirectory()&&!dirStat.isSymbolicLink()&&canonical===resolve(directory)).toBe(true);
      /** 原目录跨所有文件与DROP前检查，不从同名路径重新认领。 */
      async function directoryCurrent(closed=false){const stat=await step(()=>lstat(directory,{bigint:true}),closed);expect([stat.dev,stat.ino,stat.isSymbolicLink()]).toEqual([dirStat.dev,dirStat.ino,false]);expect(await step(()=>realpath(directory),closed)).toBe(canonical);}
      async function partials(){await directoryCurrent();return(await step(()=>readdir(directory))).filter(value=>value.startsWith(basename(file)+'.dbark-')&&value.endsWith('.partial'));}
      /** 每次读取都消费同一scope与原句柄回执，不从目标路径更新身份。 */
      async function originalFile(receipt:InsertUiFileReceipt,path:string){await directoryCurrent();const bytes=await step(()=>verifyInsertUiFile(receipt,path,resourceCheck));await directoryCurrent();return bytes.toString('utf8');}
      journal=new InsertUiOwnershipJournal(join(directory,'insert-ui2-'+plan.nonce+'.ownership.ndjson'),resourceCheck);
      await step(()=>journal!.start(plan));await step(()=>journal!.append('paths-planned',{directory,file,partialRule:basename(file)+'.dbark-<UUID>.partial'}));
      observerReceipt=new InsertUiObserverReceipt<Socket,Driver,Observer>(()=>scope.preserve());await step(()=>journal!.append('observer-planned'));
      const observer=await step(()=>connectInsertUiObserver(observerReceipt!,{
        allocate:()=>new Socket(),
        construct:socket=>{native=mysql.createConnection({host:binding.target.host,port:binding.target.port,user:binding.target.user,password:binding.target.password,stream:socket,charset:'utf8mb4',supportBigNumbers:true,bigNumberStrings:true,decimalNumbers:false,jsonStrings:true,flags:['-IGNORE_SPACE'],connectTimeout:15000}) as Driver;return native;},
        wrap:driver=>driver.promise() as Observer,register:(driver,done)=>{driver.connect(error=>done(error??undefined));},connect:socket=>{socket.connect({host:binding.target.host,port:binding.target.port});},
      },resourceCheck));await step(()=>journal!.append('observer-connected',observerReceipt!.summary()));
      const [server]=await step(()=>observer.query<RowDataPacket[]>({sql:'SELECT @@server_uuid AS uuid,@@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names',timeout:10000}));
      // 独立原协议核实该系统变量是LONGLONG；bigNumberStrings要求精确字符串，不能与number混判。
      expect(server).toHaveLength(1);expect(Boolean(server[0].uuid===binding.target.uuid&&/^8\.4\.11(?:[-+ ]|$)/.test(server[0].version)&&server[0].os==='Linux'&&server[0].names==='0')).toBe(true);
      await step(()=>journal!.append('schema-planned'));const [schemaCreated]=await step(()=>observer.query<ResultSetHeader>({sql:`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,timeout:10000}));expect(schemaCreated.affectedRows).toBe(1);databaseAck=true;await step(()=>journal!.append('schema-created'));
      await step(()=>observer.query({sql:`CREATE TABLE \`${database}\`.__insert_owner(nonce CHAR(32) PRIMARY KEY,case_hash CHAR(64),scenario INT) ENGINE=InnoDB COMMENT='${plan.comment}'`,timeout:10000}));
      await step(()=>observer.query({sql:`INSERT INTO \`${database}\`.__insert_owner VALUES(?,?,?)`,values:[plan.nonce,plan.caseHash,scenario],timeout:10000}));
      await step(()=>observer.query({sql:`CREATE TABLE \`${database}\`.insert_neighbor(id INT PRIMARY KEY,nonce CHAR(32)) ENGINE=InnoDB COMMENT='${plan.comment}'`,timeout:10000}));
      await step(()=>observer.query({sql:`INSERT INTO \`${database}\`.insert_neighbor VALUES(7,?)`,values:[plan.nonce],timeout:10000}));
      await step(()=>observer.query({sql:`CREATE TABLE \`${database}\`.insert_source(id INT PRIMARY KEY,note TEXT NULL,big_value BIGINT UNSIGNED,amount DECIMAL(30,6),doc JSON,payload VARBINARY(8)) ENGINE=InnoDB COMMENT='${plan.comment}'`,timeout:10000}));
      await step(()=>observer.query({sql:`CREATE TABLE \`${database}\`.insert_target(note TEXT NULL,big_value BIGINT UNSIGNED,amount DECIMAL(30,6),doc JSON,payload VARBINARY(8)) ENGINE=InnoDB COMMENT='${plan.comment}'`,timeout:10000}));
      for(const name of plan.tables){const [rows]=await step(()=>observer.query<RowDataPacket[]>({sql:`SHOW CREATE TABLE \`${database}\`.\`${name}\``,timeout:10000}));definitions[name]=String(rows[0]['Create Table']);}
      await step(()=>observer.query({sql:`INSERT INTO \`${database}\`.insert_source VALUES(1,NULL,18446744073709551615,12345678901234567890.120000,CAST('9007199254740993' AS JSON),X'00ff'),(2,'',9007199254740993,0.000001,CAST('null' AS JSON),X'')`,timeout:10000}));
      /** 独立CAST/HEX快照保留JSON原数字，导出生成文件从不执行到目标表。 */
      async function databaseProof(closed=false){observerReceipt!.assertConnected();const [rows]=await step(()=>observer.query<RowDataPacket[]>({sql:`SELECT id,note,CAST(big_value AS CHAR) AS big_value,CAST(amount AS CHAR) AS amount,CAST(doc AS CHAR CHARACTER SET utf8mb4) AS doc,HEX(payload) AS payload FROM \`${database}\`.insert_source ORDER BY id`,timeout:10000}),closed);expect(rows).toEqual(insertUiPreciseSource);const [target]=await step(()=>observer.query<RowDataPacket[]>({sql:`SELECT CAST(COUNT(*) AS CHAR) AS n FROM \`${database}\`.insert_target`,timeout:10000}),closed);expect(target[0].n).toBe('0');return{source:rows,target};}
      /** 完整集合、标记、结构与源邻表都匹配才允许DROP，随机名字不单独授予删除权。 */
      async function namespaceProof(closed=false){
        observerReceipt!.assertConnected();await directoryCurrent(closed);const query=(sql:string,values?:unknown[])=>step(()=>observer.query<RowDataPacket[]>({sql,values,timeout:10000}),closed);
        const [server]=await query('SELECT @@server_uuid AS uuid,@@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names'),[marker]=await query(`SELECT nonce,case_hash,scenario FROM \`${database}\`.__insert_owner`),[tables]=await query('SELECT TABLE_NAME AS name,TABLE_TYPE AS kind,TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME',[database]),values=await databaseProof(closed),[neighbor]=await query(`SELECT id,nonce FROM \`${database}\`.insert_neighbor ORDER BY id`);
        const unknown={triggers:[] as RowDataPacket[],routines:[] as RowDataPacket[],events:[] as RowDataPacket[]},current:Record<string,string>={};
        for(const [view,column,key]of [['TRIGGERS','TRIGGER_SCHEMA','triggers'],['ROUTINES','ROUTINE_SCHEMA','routines'],['EVENTS','EVENT_SCHEMA','events']]as const){const [rows]=await query(`SELECT 1 FROM information_schema.${view} WHERE BINARY ${column}=BINARY ?`,[database]);unknown[key]=rows;}
        for(const name of plan.tables){const [rows]=await query(`SHOW CREATE TABLE \`${database}\`.\`${name}\``);current[name]=String(rows[0]['Create Table']);}
        assertInsertUiSchema(plan,databaseAck,{server,marker,tables,...values,neighbor,unknown,definitions:current},definitions);
      }
      await namespaceProof();await step(()=>journal!.append('seed-verified',{rows:2,definitions:Object.fromEntries(Object.entries(definitions).map(([name,ddl])=>[name,createHash('sha256').update(ddl).digest('hex')]))}));
      await step(()=>journal!.append('target-planned',{file}));await step(async()=>{targetHandle=await open(file,'wx+');});await step(()=>targetHandle!.writeFile(original));await step(()=>targetHandle!.sync());targetReceipt=await step(()=>captureInsertUiFile(file,targetHandle!,Buffer.from(original),resourceCheck));await step(()=>releaseInsertUiFile(targetReceipt!));await step(()=>journal!.append('target-created',{identity:targetReceipt!.identity}));
      await step(()=>page.locator('.app-commandbar').getByRole('button',{name:zh.common.newConnection,exact:true}).click());
      const form=page.getByRole('dialog',{name:zh.common.newConnection,exact:true}),connectionName='完整INSERT '+database;
      await step(()=>form.getByRole('combobox',{name:new RegExp('^'+zh.connections.text008)}).selectOption('mysql'));
      for(const [label,value]of [[zh.connections.text006,connectionName],[zh.connections.text009,binding.target.host],[zh.connections.text010,String(binding.target.port)],[zh.common.user,binding.target.user],[zh.connections.text011,binding.target.password],[zh.connections.text012,database]])await step(()=>form.getByLabel(label,{exact:true}).fill(value));
      await step(()=>form.getByLabel(zh.connections.text016,{exact:true}).uncheck());await step(()=>form.getByRole('button',{name:zh.connections.text036,exact:true}).click());
      // 保存异常在本次动作停链前只读原错误框；口令在RAM脱敏，避免仅报“表单未关闭”丢失实际原因。
      await step(async()=>{try{await expect(form).toBeHidden();}catch(reason){resourceCheck();const alerts=await form.locator('.error-box').allTextContents();resourceCheck();const safe=alerts.map(value=>binding.target.password?value.split(binding.target.password).join('[已隐藏]'):value);throw Error('原保存连接未关闭；原错误框='+JSON.stringify(safe),{cause:reason});}});
      const profiles=await step(()=>page.evaluate(()=>window.dbark.invoke('connections.list',{})));const profile=profiles.find(value=>value.name===connectionName);expect(Boolean(profile&&!profile.ssh?.enabled&&!profile.tls?.enabled&&profile.host===binding.target.host&&profile.port===13384&&profile.rememberPassword===false&&profile.password===undefined&&profile.hasPassword===Boolean(binding.target.password))).toBe(true);
      await step(()=>page.locator('.app-commandbar').getByRole('button',{name:zh.common.newQuery,exact:true}).click());const query=page.getByRole('dialog',{name:zh.common.newQuery,exact:true});
      await step(()=>query.getByRole('combobox',{name:new RegExp('^'+zh.app.text049)}).selectOption(profile!.id));await step(()=>query.getByLabel(zh.app.text050,{exact:true}).fill(database));await step(()=>query.getByRole('button',{name:zh.app.text053,exact:true}).click());await step(()=>expect(query).toBeHidden());
      const tab=page.locator('.query-tab:visible'),modifier=process.platform==='darwin'?'Meta':'Control';
      /** 输入经真实Monaco键盘入口，不使用模型setter或系统剪贴板。 */
      async function write(sql:string){await step(()=>tab.locator('.monaco-editor').getByRole('textbox').focus());await step(()=>page.keyboard.press(modifier+'+A'));await step(()=>page.keyboard.insertText(sql));}
      /** 准备及只读观察使用真实执行全部按钮，不直接调用执行IPC。 */
      async function execute(sql:string){await write(sql);await step(()=>tab.getByRole('button',{name:zh.query.text011,exact:true}).click());await step(()=>expect(tab.getByRole('button',{name:zh.common.stop,exact:true})).toBeDisabled({timeout:20000}));await step(()=>expect(tab.locator('.error-box')).toHaveCount(0));}
      const counter="SELECT CONCAT('sid=',CONNECTION_ID(),';runs=',CAST(@dbark_e2e_insert_runs AS CHAR)) AS proof,'后台保持' AS marker";
      /** 只读取服务器经真实查询展示的唯一标记，不把任务或历史条数当执行次数。 */
      async function readCounter(){const values=await step(()=>tab.locator('.result-body .results-grid [role="gridcell"]').allTextContents());const hits=values.map(value=>/^sid=(\d+);runs=(\d+)$/.exec(value)).filter((value):value is RegExpExecArray=>!!value);expect(hits).toHaveLength(1);return{session:hits[0][1],runs:hits[0][2]};}
      await execute('SET @dbark_e2e_insert_runs = 0');await execute(counter);const session=(await readCounter()).session;expect(await readCounter()).toEqual({session,runs:'0'});
      const grid=()=>tab.locator('.result-body .results-grid [role="gridcell"]').allTextContents(),background=await step(grid);
      const source=`SELECT note,big_value,amount,doc,payload FROM \`${database}\`.insert_source WHERE (@dbark_e2e_insert_runs := @dbark_e2e_insert_runs + 1) > 0 ORDER BY id`;
      await write(source);const beforeTasks=await step(()=>page.evaluate(()=>window.dbark.invoke('tasks.list',{})));
      await step(()=>tab.getByRole('button',{name:stream.open,exact:true}).click());const dialog=page.getByRole('dialog',{name:stream.title,exact:true});
      await step(()=>dialog.getByRole('combobox',{name:stream.format,exact:true}).selectOption('sql'));
      await step(()=>dialog.getByRole('combobox',{name:new RegExp('^'+stream.encoding)}).selectOption('utf8'));
      for(const [label,value]of [[insert.database,database],[insert.table,'insert_target'],[insert.columns,'note\nbig_value\namount\ndoc\npayload']])await step(()=>dialog.getByLabel(label,{exact:true}).fill(value));
      const nonce=randomUUID();await step(()=>installInsertSaveAnswer(application,file,nonce));await step(()=>dialog.locator('.file-picker').click());expect(await step(()=>finishInsertSaveAnswer(application,nonce))).toEqual({calls:1,restored:true});
      await step(()=>expect(dialog.locator('.file-picker')).toContainText(basename(file)));expect(await originalFile(targetReceipt!,file)).toBe(original);expect(await partials()).toEqual([]);expect(await step(grid)).toEqual(background);
      await step(()=>dialog.getByRole('checkbox',{name:stream.acknowledge,exact:true}).check());await step(()=>dialog.getByRole('button',{name:insert.start,exact:true}).click());
      const sample=dialog.locator('pre[aria-label="'+insert.preview+'"]'),expected=expectedInsertUiFile(database);
      await step(()=>expect(sample).toBeVisible({timeout:20000}));expect(await step(()=>sample.textContent())).toBe(expected);
      await step(()=>expect(dialog.locator('section[aria-label="'+insert.preview+'"]')).toContainText(`完整2行；样例2行；暂存${Buffer.byteLength(expected)}字节；编码utf8；等待确认最多120秒。`));
      expect(await originalFile(targetReceipt!,file)).toBe(original);const pending=await partials();expect(pending).toHaveLength(1);const temporary=join(directory,pending[0]);await step(async()=>{partialHandle=await open(temporary,'r');});partialReceipt=await step(()=>captureInsertUiFile(temporary,partialHandle!,Buffer.from(expected),resourceCheck,file));expect(await originalFile(partialReceipt,temporary)).toBe(expected);await step(()=>releaseInsertUiFile(partialReceipt!));await step(()=>journal!.append('partial-frozen',{name:pending[0],identity:partialReceipt!.identity}));await databaseProof();expect(await step(grid)).toEqual(background);
      const tasks=await step(()=>page.evaluate(()=>window.dbark.invoke('tasks.list',{}))),created=tasks.filter(task=>task.kind==='query.exportStream'&&!beforeTasks.some(before=>before.id===task.id));expect(created).toHaveLength(1);const taskId=created[0].id;expect(created[0].status).toBe('running');
      if(scenario===0){await step(()=>dialog.getByLabel(insert.confirmation,{exact:true}).fill(database+'.wrong'));await step(()=>dialog.getByRole('checkbox',{name:insert.acknowledge,exact:true}).check());await step(()=>expect(dialog.getByRole('button',{name:insert.publish,exact:true})).toBeDisabled());expect(await originalFile(targetReceipt!,file)).toBe(original);await step(()=>dialog.getByLabel(insert.confirmation,{exact:true}).fill(database+'.insert_target'));await step(()=>dialog.getByRole('button',{name:insert.publish,exact:true}).click());await step(()=>expect(dialog.locator('.success-box')).toHaveText(insert.completed));expect(await originalFile(partialReceipt!,file)).toBe(expected);}
      else{await step(()=>dialog.getByRole('button',{name:stream.cancel,exact:true}).click());await step(()=>expect(dialog.locator('.error-box')).toContainText(/取消/));await step(()=>expect(dialog.getByRole('button',{name:stream.cancel,exact:true})).toBeDisabled());expect(await originalFile(targetReceipt!,file)).toBe(original);}
      await expect.poll(()=>step(()=>page.evaluate(()=>window.dbark.invoke('tasks.list',{}))).then(list=>list.find(task=>task.id===taskId)?.status)).toBe(scenario===0?'completed':'cancelled');expect(await partials()).toEqual([]);await databaseProof();
      await step(()=>dialog.locator('footer').getByRole('button',{name:zh.common.close,exact:true}).click());await step(()=>expect(dialog).toBeHidden());expect(await step(grid)).toEqual(background);
      // 只读查询始终走真实UI及同一会话；两行各求值一次为2，发布/取消/后续观察不得变成4。
      for(let observation=0;observation<3;observation++){await execute(counter);expect(await readCounter()).toEqual({session,runs:'2'});}
      const finalTasks=await step(()=>page.evaluate(()=>window.dbark.invoke('tasks.list',{})));expect(finalTasks.some(task=>task.status==='running')).toBe(false);expect(finalTasks.filter(task=>task.kind==='query.exportStream'&&!beforeTasks.some(before=>before.id===task.id)).map(task=>task.id)).toEqual([taskId]);expect(pageErrors).toEqual([]);
      await step(()=>confirmOwnedDesktopExit(info),true);expect(ownedDesktopResources(info).closed).toBe(true);desktopConfirmed=true;await namespaceProof(true);await step(()=>journal!.append('cleanup-verified',{database,target:targetReceipt!.identity,partial:partialReceipt!.identity}),true);
      await step(()=>observer.query({sql:`DROP DATABASE \`${insertUiDatabase(database)}\``,timeout:10000}),true);const [remaining]=await step(()=>observer.query<RowDataPacket[]>({sql:'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',values:[database],timeout:10000}),true);expect(remaining).toHaveLength(0);
      await step(async()=>{await closeMysqlConnection(native!,true);observerReceipt!.confirmClosed();},true);await step(()=>journal!.append('database-dropped',{observer:observerReceipt!.summary()}),true);await step(async()=>{await info.attach('完整INSERT资源登记',{body:await journal!.snapshot(),contentType:'application/x-ndjson'});},true);scope.complete();
      await info.attach('完整INSERT专项终态',{body:Buffer.from(JSON.stringify({scenario,taskId,sessionUnchanged:true,rowEvaluations:2,backgroundPreserved:true,targetRows:0,normalExitConfirmed:true,databaseDropped:true,observerStreamClosed:true,directoryRemoval:'原fixture退出后收尾；尚未在body中删除',saveDialogAnswerOnly:true})),contentType:'application/json'});
    }catch(reason){originalFailure=reason;scope.preserve();try{await info.attach('完整INSERT保留现场',{body:Buffer.from(JSON.stringify({database,directory,file,plan,journal:journal?.summary(),observer:observerReceipt?.summary(),target:targetReceipt?.identity,partial:partialReceipt?.identity,targetHandleCaptured:!!targetHandle,partialHandleCaptured:!!partialHandle,automaticReplay:false,forceStop:false})),contentType:'application/json'});}catch(attachment){throw originalFailure=new AggregateError([reason,attachment],'专项失败且现场附录失败',{cause:reason});}throw reason;}finally{
      const failures:unknown[]=[];for(const handle of [partialHandle,targetHandle,journal?.handle])if(handle)try{await handle.close();}catch(reason){failures.push(reason);}
      if(failures.length){scope.preserve();throw new AggregateError(originalFailure===undefined?failures:[originalFailure,...failures],'INSERT UI原文件句柄关闭失败，保留首因与现场',{cause:originalFailure});}
    }
  });
}
