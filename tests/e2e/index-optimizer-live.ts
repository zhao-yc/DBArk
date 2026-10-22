import { indexPatchZh as indexText } from '../../src/renderer/locales/indexPatches.zh-CN';
import type { TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import { resolve, win32, relative, isAbsolute } from 'node:path';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';
import { closeMysqlConnection } from '../../src/engine/connection';
import { zh } from '../../src/renderer/locales/zh-CN';


const keys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_INDEX_OPTIMIZER_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_INDEX_OPTIMIZER_MANIFEST', 'DBARK_INDEX_OPTIMIZER_MANIFEST_SHA256'] as const;
/** 仅消费Root预置唯一随机库与准确来源清单；不建库、建用户、授权、Docker或自动DROP。 */
function bindEnvironment() {
  const values = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<typeof keys[number], string | undefined>;
  const args = JSON.stringify(process.argv); let failed = false;
  const assertCurrent = () => {
    try {
      if (failed || process.platform !== 'win32' || JSON.stringify(process.argv) !== args || keys.some(key => process.env[key] !== values[key])) throw Error('索引优化器状态原环境已变化');
      for (const key of Object.keys(process.env)) if (/^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('索引优化器状态拒绝环境大小写别名');
      if (values.DBARK_INTEGRATION_ENABLED !== '1' || values.DBARK_INDEX_OPTIMIZER_UI !== '1' || values.DBARK_TEST_HOST !== '192.168.31.200' || values.DBARK_TEST_PORT !== '13384' || values.DBARK_TEST_TLS !== '0' || !values.DBARK_TEST_USER || typeof values.DBARK_TEST_PASSWORD !== 'string' || values.DBARK_TEST_EXPECTED_SERVER_UUID !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || !/^dbark_e2e_indexopt_ui_[a-f0-9]{32}$/.test(values.DBARK_TEST_DATABASE ?? '')) throw Error('索引优化器状态须Root准确绑定200/13384/UUID与预置唯一随机库');
      if (!values.DBARK_INDEX_OPTIMIZER_MANIFEST || !win32.isAbsolute(values.DBARK_INDEX_OPTIMIZER_MANIFEST) || !/^[a-f0-9]{64}$/.test(values.DBARK_INDEX_OPTIMIZER_MANIFEST_SHA256 ?? '')) throw Error('索引优化器状态缺少Root批准的绝对来源清单与SHA256');
      for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(process.env, key)) throw Error('索引优化器状态源码专项拒绝替代运行环境');
      if (process.argv.some(value => /^(?:--(?:ui|debug|config)|-c)(?:=|$)/.test(value))) throw Error('索引优化器状态拒绝替代配置或交互运行');
      for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('索引优化器状态禁止CLI开启trace');
    } catch (error) { failed = true; throw error; }
  };
  assertCurrent(); return { values, assertCurrent };
}

/** 仅登记默认关闭的正式表单定义；来源及真实数据库观察独立，Main逐条IPC审计明确未做。 */
export function registerIndexOptimizerUiTests() {
  const environment = bindEnvironment(), configPath = resolve('playwright.config.ts'), configurationHash = createHash('sha256').update(sync.readFileSync(configPath)).digest('hex');
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>; type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>(); let retained = false;
  const nativeTest = test.extend<{ indexOptimizerSource: { clock: Clock; identity: Identity; assertConfiguration(): void } }>({
    indexOptimizerSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() { environment.assertCurrent(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configPath || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('索引优化器状态必须原配置、单worker、原120秒及零重试'); } }, () => nativeTest.info());
      clocks.set(info, clock);
      /** 每个用户await前后核配置字节；来源清单每个底层FSawait继续核原clock与环境。 */
      const assertConfiguration = () => { clock.assertCurrent(); try { if (createHash('sha256').update(sync.readFileSync(configPath)).digest('hex') !== configurationHash) throw Error('索引优化器状态配置字节已变化'); } catch (reason) { retained = true; clock.retain(); throw reason; } clock.assertCurrent(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { clock.assertCurrent(); const value = await action(); clock.assertCurrent(); return value; };
      assertConfiguration();
      const identity = await checked(() => sealEditorIndentLaunchIdentity(environment.values.DBARK_INDEX_OPTIMIZER_MANIFEST!, environment.values.DBARK_INDEX_OPTIMIZER_MANIFEST_SHA256!, resolve('.'), { stat: path => checked(async () => { const value = await fs.lstat(path); return { file: value.isFile(), directory: value.isDirectory(), link: value.isSymbolicLink() }; }), real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)) }, () => clock.assertCurrent()));
      assertConfiguration(); if (identity.manifest.kind !== 'source') throw Error('本专项仅接受批准源码App，不冒充安装版');
      // 桌面夹具依赖本scope先收尾；afterEach不得提前删除clock，旧TestInfo不接管下一例。
      try { await use({ clock, identity, assertConfiguration }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ indexOptimizerSource }, use) => { await use({ assertCurrent: () => indexOptimizerSource.assertConfiguration(), assertPreparation(info) { if (clocks.get(info) !== indexOptimizerSource.clock) throw Error('索引优化器状态原启动归属变化'); indexOptimizerSource.assertConfiguration(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('索引优化器状态原App、控制连接或证据尚未闭合，保留随机库和现场'); } });
  nativeTest('真实索引停止及恢复供优化器使用，原数据与完整定义保持', async ({ indexOptimizerSource, trace, screenshot, video }, info) => {
    const { clock, identity, assertConfiguration } = indexOptimizerSource, captured = ownedDesktopResources(info), page = captured.page, application = captured.application, originalProcess = application.process(), frame = page.mainFrame(), directory = dataDir;
    const database = environment.values.DBARK_TEST_DATABASE!, qualified = '`' + database + '`.`subject`';
    let closed = false, observerClosed = false, observer: Connection | undefined, stream: any, originalDirectory: { dev: number; ino: number } | undefined;
    /** 每个await保留原owner、进程、窗口、profile和原流身份，失败不重跑或自动删除随机库。 */
    const check = () => {
      assertConfiguration(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== directory || !closed && (application.process() !== originalProcess || page.mainFrame() !== frame || frame.isDetached()) || observer && ((observer as any).stream !== stream || observerClosed !== (stream?.closed === true))) throw Error('索引优化器状态原资源身份变化');
      if (originalDirectory) { const value = sync.lstatSync(directory); if (!value.isDirectory() || value.isSymbolicLink() || sync.realpathSync(directory) !== directory || value.dev !== originalDirectory.dev || value.ino !== originalDirectory.ino) throw Error('索引优化器状态原profile身份变化'); }
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch(reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; } };
    const phases = ['实际启动身份','原索引与提交前','停止及恢复核验','退出客户端前','退出与控制收尾后'], sourceChecks: string[] = []; let sourcePending = false;
    /** 完整清单只在这五个明确阶段重读，不扩称每个动作或Main所有IPC均有审计。 */
    const verifySource = async (phase: string, actual?: Parameters<Identity['assertActual']>[0]) => { check(); if(sourcePending || phases[sourceChecks.length] !== phase) throw Error('索引优化器状态来源阶段失配'); sourcePending = true; await step(() => identity.assertCurrent()); if(actual) await step(() => identity.assertActual(actual)); sourceChecks.push(phase); sourcePending = false; };
    const statements = {
      identity: 'SELECT VERSION() AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      exists: 'SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME',
      rows: 'SELECT CAST(k AS CHAR) AS k,CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,HEX(payload) AS payload FROM '+qualified+' ORDER BY k',
      definition: 'SHOW CREATE TABLE '+qualified,
      statistics: 'SELECT INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME,NON_UNIQUE,INDEX_TYPE,COLLATION,SUB_PART,INDEX_COMMENT,IS_VISIBLE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY BINARY INDEX_NAME,SEQ_IN_INDEX',
      threads: 'SELECT ID FROM INFORMATION_SCHEMA.PROCESSLIST WHERE DB=? AND ID<>?',
    };
    /** 原observer只允许固定只读SQL及本轮准确资源，不建表或执行变更。 */
    const read = (sql: string, params: (string|number)[] = []): Promise<any> => {
      if(!Object.values(statements).includes(sql) || sql === statements.exists && (params.length !== 1 || params[0] !== database) || sql === statements.statistics && (params.length !== 2 || params[0] !== database || params[1] !== 'subject') || sql === statements.threads && (params.length !== 2 || params[0] !== database || !Number.isSafeInteger(params[1])) || ![statements.exists,statements.statistics,statements.threads].includes(sql) && params.length !== 0) throw Error('索引优化器状态观察SQL越界');
      return step(() => new Promise((resolve,reject) => observer!.query({sql,values:params},(error,rows)=>error?reject(error):resolve(rows))));
    };
    try {
      check(); expect([trace,screenshot,video]).toEqual(['off','off','off']);
      const actual = await step(() => application.evaluate(({app})=>({executable:process.execPath,appPath:app.getAppPath(),resources:process.resourcesPath,packaged:app.isPackaged,pid:process.pid}))); await verifySource('实际启动身份',actual);
      const profileStat = await step(() => fs.lstat(directory)); expect(profileStat.isDirectory()&&!profileStat.isSymbolicLink()).toBe(true); expect(await step(()=>fs.realpath(directory))).toBe(directory); originalDirectory={dev:profileStat.dev,ino:profileStat.ino};
      const mysql=require('mysql2') as typeof import('mysql2'); observer=mysql.createConnection({host:environment.values.DBARK_TEST_HOST,port:13384,user:environment.values.DBARK_TEST_USER,password:environment.values.DBARK_TEST_PASSWORD,supportBigNumbers:true,bigNumberStrings:true,dateStrings:true,decimalNumbers:false,multipleStatements:false,charset:'UTF8MB4_BIN',connectTimeout:10000}); stream=(observer as any).stream;
      await step(()=>new Promise<void>((resolve,reject)=>observer!.connect(error=>error?reject(error):resolve())));
      const facts=await read(statements.identity) as RowDataPacket[]; expect(facts).toHaveLength(1); const threadId=Number(facts[0].threadId);
      expect({version:facts[0].version,os:facts[0].os,names:Number(facts[0].names),uuid:facts[0].uuid}).toEqual({version:'8.4.11',os:'Linux',names:0,uuid:environment.values.DBARK_TEST_EXPECTED_SERVER_UUID}); expect(Number.isSafeInteger(threadId)&&threadId>0).toBe(true);
      expect(await read(statements.exists,[database])).toEqual([{name:'subject'}]); const authority=await read(statements.rows), originalDefinition=await read(statements.definition), originalStatistics=await read(statements.statistics,[database,'subject']); expect(authority.map((row:any)=>row.id)).toEqual(['-9','0','0','7','9007199254740993']); expect(originalStatistics.filter((row:any)=>row.INDEX_NAME==='idx_id')).toHaveLength(1); expect(originalStatistics.find((row:any)=>row.INDEX_NAME==='idx_id').IS_VISIBLE).toBe('YES');
      await step(()=>page.locator('.app-commandbar').getByRole('button',{name:zh.common.newConnection,exact:true}).click()); const form=page.getByRole('dialog',{name:zh.common.newConnection,exact:true});
      for(const[label,value]of [[zh.connections.text006,'索引优化器状态本例'],[zh.connections.text009,environment.values.DBARK_TEST_HOST!],[zh.connections.text010,'13384'],[zh.common.user,environment.values.DBARK_TEST_USER!],[zh.connections.text011,environment.values.DBARK_TEST_PASSWORD!],[zh.connections.text012,database]]) await step(()=>form.getByLabel(label,{exact:true}).fill(value));
      await step(()=>form.getByLabel(zh.connections.text016,{exact:true}).uncheck()); await step(()=>form.getByRole('button',{name:zh.connections.text036,exact:true}).click()); await step(()=>expect(form).toBeHidden());
      const profiles=await step(()=>page.evaluate(()=>window.dbark.invoke('connections.list',{}))); expect(profiles).toHaveLength(1); const profile=profiles[0]; expect(Boolean(profile.name==='索引优化器状态本例'&&profile.host==='192.168.31.200'&&profile.port===13384&&profile.database===database&&profile.user===environment.values.DBARK_TEST_USER&&profile.rememberPassword===false&&!profile.ssh?.enabled&&!profile.tls?.enabled)).toBe(true);
      const sender = await step(() => application.evaluate(({ webContents }) => { const windows = webContents.getAllWebContents().filter(item => item.getType() === 'window'); if (windows.length !== 1) throw Error('索引优化器状态原主窗口不唯一'); return windows[0].id; }));
      // 只观察并精确限制本例schema.indexes请求，不代替原Main处理器或Engine结果。
      await step(()=>application.evaluate(({ipcMain},input)=>{
        const handlers=(ipcMain as any)._invokeHandlers,original=handlers.get('dbark:request'),root=globalThis as any;
        if(typeof original!=='function'||root.__indexOptimizerOwner) throw Error('索引优化器状态原Main观察器归属未知');
        const state={gets:[] as any[],previews:[] as any[],applies:[] as any[],pending:0},snapshots=new Map<string,{ref:string;enabled:boolean}>(),plans=new Map<string,any>(),tasks=new Set<string>();
        const wrapped=async(event:any,payload:any)=>{
          const command=payload?.command,value=payload?.input;
          if(['query.execute','table.commit','table.truncate','table.drop','schema.execute'].includes(command)) throw Error('索引优化器状态专项禁止其它产品写入');
          if(!['schema.indexes.get','schema.indexes.preview','schema.indexes.apply'].includes(command)) return original(event,payload);
          if(event.sender.id!==input.sender||event.senderFrame!==event.sender.mainFrame||typeof value?.taskId!=='string'||!value.taskId||tasks.has(value.taskId)) throw Error('索引优化器状态原sender或任务身份变化');
          let kind:'gets'|'previews'|'applies',entry:any;
          if(command==='schema.indexes.get') { if(value.connectionId!==input.id||value.database!==input.database||value.table!=='subject'||value.includeOptimizerFacts!==true||state.gets.length>=4) throw Error('索引优化器状态get目标或预算变化');kind='gets';entry={}; }
          else if(command==='schema.indexes.preview') { const owner=snapshots.get(value.snapshotId),patch=value.patches?.[0];if(!owner||!Array.isArray(value.patches)||value.patches.length!==1||patch?.op!=='alter'||patch.indexRef!==owner.ref||Object.keys(patch.changes??{}).length!==1||patch.changes.optimizerVisible!==!owner.enabled||state.previews.length>=3) throw Error('索引优化器状态preview不属于准确原索引切换');kind='previews';entry={enabled:patch.changes.optimizerVisible,snapshotId:value.snapshotId}; }
          else { const plan=plans.get(value.previewToken);if(!plan||JSON.stringify(value.acknowledgements)!==JSON.stringify(plan.acknowledgements)||state.applies.length>=2) throw Error('索引优化器状态apply不属于本例原预览');plans.delete(value.previewToken);kind='applies';entry={enabled:plan.enabled,previewToken:value.previewToken}; }
          state[kind].push(entry);state.pending++;tasks.add(value.taskId);
          try { const reply=await original(event,payload);if(reply?.ok!==true) throw Error('索引优化器状态原请求未成功');
            if(kind==='gets'){const index=reply.result?.indexes?.find((item:any)=>item.name==='idx_id');if(!index||index.optimizer?.access.allowed!==true||typeof index.optimizer.visible!=='boolean') throw Error('索引优化器状态真实投影未明确开放');entry.enabled=index.optimizer.visible;snapshots.set(reply.result.snapshotId,{ref:index.indexRef,enabled:entry.enabled});}
            if(kind==='previews'){const plan=reply.result,expectedSql='ALTER TABLE `'+input.database+'`.`subject` ALTER INDEX `idx_id` '+(entry.enabled?'VISIBLE':'INVISIBLE')+', ALGORITHM=INPLACE, LOCK=NONE;';if(plan?.sql!==expectedSql||!['ddl-implicit-commit','external-ddl-window','index-optimizer-change'].every(id=>plan.requiredAcknowledgements?.includes(id))) throw Error('索引优化器状态真实预览不属于准确目标、方向与原生算法');entry.sql=plan.sql;plans.set(plan.previewToken,{enabled:entry.enabled,acknowledgements:plan.requiredAcknowledgements});}
            if(kind==='applies'){entry.result=reply.result;if(reply.result?.ddlCompleted!==true||reply.result?.definitionVerified!==true) throw Error('索引优化器状态实际DDL未完成完整定义核验');} return reply;
          } finally {state.pending--;tasks.delete(value.taskId);}
        };
        handlers.set('dbark:request',wrapped);root.__indexOptimizerOwner={handlers,wrapped,state};
      },{id:profile.id,database,sender}));
      const state=()=>step(()=>application.evaluate(()=>{const owner=(globalThis as any).__indexOptimizerOwner;if(!owner||owner.handlers.get('dbark:request')!==owner.wrapped)throw Error('索引优化器状态原Main观察器已变化');return owner.state as {gets:{enabled:boolean}[];previews:{enabled:boolean;sql:string}[];applies:{enabled:boolean;result:{definitionVerified:boolean}}[];pending:number};}));
      const node=page.locator('.connection-node').filter({has:page.getByRole('button',{name:profile.name,exact:true})});await step(()=>node.getByRole('button',{name:profile.name,exact:true}).click());const databaseRow=node.locator('.database-row').filter({has:page.getByRole('button',{name:database,exact:true})});await step(()=>databaseRow.getByRole('button',{name:database,exact:true}).click());await step(()=>node.locator('.object-row').getByRole('button',{name:'subject',exact:true}).click());
      const table=page.locator('.table-tab:visible'),dialog=page.getByRole('dialog',{name:indexText.title,exact:true});await step(()=>expect(table.locator('.loading-overlay')).toHaveCount(0));
      /** 全部动作经过实际索引编辑器；不注入草稿、预览或apply。 */
      const prepare=async(enabled:boolean)=>{await step(()=>table.getByRole('button',{name:indexText.title,exact:true}).click());await step(()=>dialog.getByRole('button',{name:indexText.optimizerEntryNamed.replace('{0}','idx_id'),exact:true}).click());const toggle=dialog.getByRole('checkbox',{name:indexText.optimizerToggle,exact:true});await step(()=>expect(toggle).toBeEnabled());if(enabled)await step(()=>toggle.check());else await step(()=>toggle.uncheck());await step(()=>dialog.getByRole('button',{name:indexText.rowSave,exact:true}).click());await step(()=>dialog.getByRole('button',{name:indexText.preview,exact:true}).click());await step(()=>expect(dialog.getByRole('heading',{name:indexText.fixedSql,exact:true})).toBeVisible());};
      const apply=async()=>{for(const label of [indexText.ackImplicit,indexText.ackWindow,indexText.ackOptimizer])await step(()=>dialog.getByRole('checkbox',{name:label,exact:true}).check());await step(()=>dialog.getByRole('button',{name:indexText.apply,exact:true}).click());await step(()=>expect(dialog.getByRole('status')).toHaveText(indexText.succeeded));await step(()=>expect(dialog.getByRole('button',{name:indexText.apply,exact:true})).toBeDisabled());await step(()=>dialog.getByRole('button',{name:indexText.close,exact:true}).click());await step(()=>expect(dialog).toBeHidden());await step(()=>expect(table.locator('.loading-overlay')).toHaveCount(0));};
      await prepare(false);expect(await read(statements.definition)).toEqual(originalDefinition);expect(await read(statements.rows)).toEqual(authority);expect((await state()).applies).toHaveLength(0);await verifySource('原索引与提交前');
      const screenshotPath=resolve(info.outputPath('索引优化器状态SQL与风险预览.png'));await step(()=>dialog.screenshot({path:screenshotPath}));const screenshotSha256=createHash('sha256').update(await step(()=>fs.readFile(screenshotPath))).digest('hex');
      await apply();expect(await read(statements.rows)).toEqual(authority);const hiddenDefinition=await read(statements.definition);expect(hiddenDefinition[0]['Create Table']).toMatch(/KEY `idx_id` \(`id`\).*INVISIBLE/i);expect((await state()).applies).toHaveLength(1); const hiddenStatistics=await read(statements.statistics,[database,'subject']);expect(hiddenStatistics).toEqual(originalStatistics.map((row:any)=>row.INDEX_NAME==='idx_id'?{...row,IS_VISIBLE:'NO'}:row));
      await prepare(true);expect(await read(statements.definition)).toEqual(hiddenDefinition);expect(await read(statements.rows)).toEqual(authority);expect((await state()).applies).toHaveLength(1);await apply();expect(await read(statements.definition)).toEqual(originalDefinition);expect(await read(statements.statistics,[database,'subject'])).toEqual(originalStatistics);expect(await read(statements.rows)).toEqual(authority);await verifySource('停止及恢复核验');
      const final=await state();expect(final.applies.map(item=>item.enabled)).toEqual([false,true]);expect(final.applies.every(item=>item.result.definitionVerified)).toBe(true);expect(final.previews.map(item=>item.enabled)).toEqual([false,true]);expect(final.pending).toBe(0);expect(await step(()=>page.evaluate(()=>window.dbark.invoke('history.list',{})))).toEqual([]);
      await verifySource('退出客户端前');check();await confirmOwnedDesktopExit(info);closed=true;check();expect(originalProcess.exitCode).toBe(0);expect(await read(statements.threads,[database,threadId])).toEqual([]);await closeMysqlConnection(observer,true);observerClosed=true;check();expect(stream.closed).toBe(true);await verifySource('退出与控制收尾后');expect(sourceChecks).toEqual(phases);
      await step(()=>info.attach('索引优化器状态专项终态',{body:Buffer.from(JSON.stringify({kind:'dbark.index-optimizer-ui',version:1,platform:process.platform,database,normalExit:closed,observerClosed,originalProcessExitCode:originalProcess.exitCode,targetThreadsAfterExit:0,databaseRetainedForRoot:true,originalRowsPreserved:true,originalDefinitionRestored:true,audit:final,source:{manifestSha256:environment.values.DBARK_INDEX_OPTIMIZER_MANIFEST_SHA256,phases:sourceChecks},screenshot:{path:screenshotPath,sha256:screenshotSha256},mainIpcAuditVerified:false,systemClipboard:0,installerVerified:false,macOSVerified:false})),contentType:'application/json'}));finished.add(info);
    } catch(reason){retained=true;clock.retain();retainOwnedDesktopResources(info);throw reason;}
  });
}
