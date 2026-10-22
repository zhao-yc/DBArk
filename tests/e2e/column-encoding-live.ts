import { columnPatchZh as columnText } from '../../src/renderer/locales/columnPatches.zh-CN';
import { columnEncodingZh as encodingText } from '../../src/renderer/locales/columnEncoding.zh-CN';
import type { TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import { resolve, win32 } from 'node:path';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';
import { closeMysqlConnection } from '../../src/engine/connection';
import { zh } from '../../src/renderer/locales/zh-CN';


const keys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_COLUMN_ENCODING_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_COLUMN_ENCODING_MANIFEST', 'DBARK_COLUMN_ENCODING_MANIFEST_SHA256'] as const;
/** 仅消费Root预置唯一随机库与准确来源清单；不建库、建用户、授权、Docker或自动DROP。 */
function bindEnvironment() {
  const values = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<typeof keys[number], string | undefined>;
  const args = JSON.stringify(process.argv); let failed = false;
  const assertCurrent = () => {
    try {
      if (failed || process.platform !== 'win32' || JSON.stringify(process.argv) !== args || keys.some(key => process.env[key] !== values[key])) throw Error('列字符集转换原环境已变化');
      for (const key of Object.keys(process.env)) if (/^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('列字符集转换拒绝环境大小写别名');
      if (values.DBARK_INTEGRATION_ENABLED !== '1' || values.DBARK_COLUMN_ENCODING_UI !== '1' || values.DBARK_TEST_HOST !== '192.168.31.200' || values.DBARK_TEST_PORT !== '13384' || values.DBARK_TEST_TLS !== '0' || !values.DBARK_TEST_USER || typeof values.DBARK_TEST_PASSWORD !== 'string' || values.DBARK_TEST_EXPECTED_SERVER_UUID !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || !/^dbark_e2e_colenc_ui_[a-f0-9]{32}$/.test(values.DBARK_TEST_DATABASE ?? '')) throw Error('列字符集转换须Root准确绑定200/13384/UUID与预置唯一随机库');
      if (!values.DBARK_COLUMN_ENCODING_MANIFEST || !win32.isAbsolute(values.DBARK_COLUMN_ENCODING_MANIFEST) || !/^[a-f0-9]{64}$/.test(values.DBARK_COLUMN_ENCODING_MANIFEST_SHA256 ?? '')) throw Error('列字符集转换缺少Root批准的绝对来源清单与SHA256');
      for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(process.env, key)) throw Error('列字符集转换源码专项拒绝替代运行环境');
      if (process.argv.some(value => /^(?:--(?:ui|debug|config)|-c)(?:=|$)/.test(value))) throw Error('列字符集转换拒绝替代配置或交互运行');
      for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('列字符集转换禁止CLI开启trace');
    } catch (error) { failed = true; throw error; }
  };
  assertCurrent(); return { values, assertCurrent };
}

/** 仅登记默认关闭的正式表单定义；来源及真实数据库观察独立，Main逐条IPC审计明确未做。 */
export function registerColumnEncodingUiTests() {
  const environment = bindEnvironment(), configPath = resolve('playwright.config.ts'), configurationHash = createHash('sha256').update(sync.readFileSync(configPath)).digest('hex');
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>; type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>(); let retained = false;
  const nativeTest = test.extend<{ columnEncodingSource: { clock: Clock; identity: Identity; assertConfiguration(): void } }>({
    columnEncodingSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() { environment.assertCurrent(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configPath || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('列字符集转换必须原配置、单worker、原120秒及零重试'); } }, () => nativeTest.info());
      clocks.set(info, clock);
      /** 每个用户await前后核配置字节；来源清单每个底层FSawait继续核原clock与环境。 */
      const assertConfiguration = () => { clock.assertCurrent(); try { if (createHash('sha256').update(sync.readFileSync(configPath)).digest('hex') !== configurationHash) throw Error('列字符集转换配置字节已变化'); } catch (reason) { retained = true; clock.retain(); throw reason; } clock.assertCurrent(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { clock.assertCurrent(); const value = await action(); clock.assertCurrent(); return value; };
      assertConfiguration();
      const identity = await checked(() => sealEditorIndentLaunchIdentity(environment.values.DBARK_COLUMN_ENCODING_MANIFEST!, environment.values.DBARK_COLUMN_ENCODING_MANIFEST_SHA256!, resolve('.'), { stat: path => checked(async () => { const value = await fs.lstat(path); return { file: value.isFile(), directory: value.isDirectory(), link: value.isSymbolicLink() }; }), real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)) }, () => clock.assertCurrent()));
      assertConfiguration(); if (identity.manifest.kind !== 'source') throw Error('本专项仅接受批准源码App，不冒充安装版');
      // 桌面夹具依赖本scope先收尾；afterEach不得提前删除clock，旧TestInfo不接管下一例。
      try { await use({ clock, identity, assertConfiguration }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ columnEncodingSource }, use) => { await use({ assertCurrent: () => columnEncodingSource.assertConfiguration(), assertPreparation(info) { if (clocks.get(info) !== columnEncodingSource.clock) throw Error('列字符集转换原启动归属变化'); columnEncodingSource.assertConfiguration(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('列字符集转换原App、控制连接或证据尚未闭合，保留随机库和现场'); } });
  nativeTest('真实字符列转换及恢复编码，原字节与完整索引定义保持', async ({ columnEncodingSource, trace, screenshot, video }, info) => {
    const { clock, identity, assertConfiguration } = columnEncodingSource, captured = ownedDesktopResources(info), page = captured.page, application = captured.application, originalProcess = application.process(), frame = page.mainFrame(), directory = dataDir;
    const database = environment.values.DBARK_TEST_DATABASE!, qualified = '`' + database + '`.`subject`';
    let closed = false, observerClosed = false, observer: Connection | undefined, stream: any, originalDirectory: { dev: number; ino: number } | undefined;
    /** 每个await保留原owner、进程、窗口、profile和原流身份，失败不重跑或自动删除随机库。 */
    const check = () => {
      assertConfiguration(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== directory || !closed && (application.process() !== originalProcess || page.mainFrame() !== frame || frame.isDetached()) || observer && ((observer as any).stream !== stream || observerClosed !== (stream?.closed === true))) throw Error('列字符集转换原资源身份变化');
      if (originalDirectory) { const value = sync.lstatSync(directory); if (!value.isDirectory() || value.isSymbolicLink() || sync.realpathSync(directory) !== directory || value.dev !== originalDirectory.dev || value.ino !== originalDirectory.ino) throw Error('列字符集转换原profile身份变化'); }
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch(reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; } };
    const phases = ['实际启动身份','原编码与提交前','转换及恢复核验','退出客户端前','退出与控制收尾后'], sourceChecks: string[] = []; let sourcePending = false;
    /** 完整清单只在这五个明确阶段重读，不扩称每个动作或Main所有IPC均有审计。 */
    const verifySource = async (phase: string, actual?: Parameters<Identity['assertActual']>[0]) => { check(); if(sourcePending || phases[sourceChecks.length] !== phase) throw Error('列字符集转换来源阶段失配'); sourcePending = true; await step(() => identity.assertCurrent()); if(actual) await step(() => identity.assertActual(actual)); sourceChecks.push(phase); sourcePending = false; };
    const statements = {
      identity: 'SELECT VERSION() AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      exists: 'SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME',
      rows: 'SELECT CAST(k AS CHAR) AS k,CAST(id AS CHAR) AS id,CAST(tag AS CHAR) AS tag,CAST(amount AS CHAR) AS amount,HEX(CONVERT(v USING latin1)) AS v,HEX(payload) AS payload FROM '+qualified+' ORDER BY k',
      bytes: 'SELECT CAST(k AS CHAR) AS k,HEX(v) AS v FROM '+qualified+' ORDER BY k',
      converted: 'SELECT CAST(k AS CHAR) AS k,HEX(CONVERT(v USING utf8mb4)) AS v FROM '+qualified+' ORDER BY k',
      definition: 'SHOW CREATE TABLE '+qualified,
      statistics: 'SELECT INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME,NON_UNIQUE,INDEX_TYPE,COLLATION,SUB_PART,INDEX_COMMENT,IS_VISIBLE,EXPRESSION FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY BINARY INDEX_NAME,SEQ_IN_INDEX',
      columns: 'SELECT COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION,CHARACTER_SET_NAME,COLLATION_NAME,COLUMN_COMMENT,CAST(CHARACTER_MAXIMUM_LENGTH AS CHAR) AS CHARACTER_MAXIMUM_LENGTH,CAST(CHARACTER_OCTET_LENGTH AS CHAR) AS CHARACTER_OCTET_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',
      threads: 'SELECT ID FROM INFORMATION_SCHEMA.PROCESSLIST WHERE DB=? AND ID<>?',
    };
    /** 观察器仅使用准确目标的固定只读SQL；不创建、修改、填充或清理数据库。 */
    const read = (sql: string, params: (string|number)[] = []): Promise<any> => {
      if(!Object.values(statements).includes(sql) || sql===statements.exists && (params.length!==1 || params[0]!==database) || [statements.statistics,statements.columns].includes(sql) && (params.length!==2 || params[0]!==database || params[1]!=='subject') || sql===statements.threads && (params.length!==2 || params[0]!==database || !Number.isSafeInteger(params[1])) || ![statements.exists,statements.statistics,statements.columns,statements.threads].includes(sql) && params.length!==0) throw Error('列字符集转换观察SQL越界');
      return step(()=>new Promise((resolve,reject)=>observer!.query({sql,values:params},(error,rows)=>error?reject(error):resolve(rows))));
    };
    try {
      check();expect([trace,screenshot,video]).toEqual(['off','off','off']);
      const actual=await step(()=>application.evaluate(({app})=>({executable:process.execPath,appPath:app.getAppPath(),resources:process.resourcesPath,packaged:app.isPackaged,pid:process.pid})));await verifySource('实际启动身份',actual);
      const profileStat=await step(()=>fs.lstat(directory));expect(profileStat.isDirectory()&&!profileStat.isSymbolicLink()).toBe(true);expect(await step(()=>fs.realpath(directory))).toBe(directory);originalDirectory={dev:profileStat.dev,ino:profileStat.ino};
      const mysql=require('mysql2') as typeof import('mysql2');observer=mysql.createConnection({host:environment.values.DBARK_TEST_HOST,port:13384,user:environment.values.DBARK_TEST_USER,password:environment.values.DBARK_TEST_PASSWORD,supportBigNumbers:true,bigNumberStrings:true,dateStrings:true,decimalNumbers:false,multipleStatements:false,charset:'UTF8MB4_BIN',connectTimeout:10000});stream=(observer as any).stream;
      await step(()=>new Promise<void>((resolve,reject)=>observer!.connect(error=>error?reject(error):resolve())));
      const facts=await read(statements.identity) as RowDataPacket[];expect(facts).toHaveLength(1);const threadId=Number(facts[0].threadId);expect({version:facts[0].version,os:facts[0].os,names:Number(facts[0].names),uuid:facts[0].uuid}).toEqual({version:'8.4.11',os:'Linux',names:0,uuid:environment.values.DBARK_TEST_EXPECTED_SERVER_UUID});expect(Number.isSafeInteger(threadId)&&threadId>0).toBe(true);
      expect(await read(statements.exists,[database])).toEqual([{name:'subject'}]);
      const authority=await read(statements.rows),originalBytes=await read(statements.bytes),convertedBytes=await read(statements.converted),originalDefinition=await read(statements.definition),originalStatistics=await read(statements.statistics,[database,'subject']),originalColumns=await read(statements.columns,[database,'subject']);
      expect(authority.map((row:any)=>row.id)).toEqual(['-9','0','0','7','9007199254740993']);expect(authority.map((row:any)=>row.tag)).toEqual(['1','2','3','4','5']);expect(authority.map((row:any)=>row.v)).toEqual([null,'','E9','4120','0080E9']);expect(originalBytes.map((row:any)=>row.v)).toEqual(authority.map((row:any)=>row.v));
      expect(originalStatistics.map((row:any)=>[row.INDEX_NAME,Number(row.SEQ_IN_INDEX),row.COLUMN_NAME,Number(row.NON_UNIQUE),row.SUB_PART===null?null:Number(row.SUB_PART)])).toEqual([['PRIMARY',1,'k',0,null],['idx_prefix',1,'v',1,3],['idx_prefix',2,'k',1,null],['uq_vtag',1,'v',0,null],['uq_vtag',2,'tag',0,null]]);
      const originalColumn=originalColumns.find((row:any)=>row.COLUMN_NAME==='v');expect(originalColumn).toMatchObject({COLUMN_TYPE:'varchar(24)',IS_NULLABLE:'YES',COLUMN_DEFAULT:'é',CHARACTER_SET_NAME:'latin1',COLLATION_NAME:'latin1_bin',COLUMN_COMMENT:'保留字符',CHARACTER_MAXIMUM_LENGTH:'24',CHARACTER_OCTET_LENGTH:'24'});
      await step(()=>page.locator('.app-commandbar').getByRole('button',{name:zh.common.newConnection,exact:true}).click());const form=page.getByRole('dialog',{name:zh.common.newConnection,exact:true});
      for(const[label,value]of [[zh.connections.text006,'列字符集转换本例'],[zh.connections.text009,environment.values.DBARK_TEST_HOST!],[zh.connections.text010,'13384'],[zh.common.user,environment.values.DBARK_TEST_USER!],[zh.connections.text011,environment.values.DBARK_TEST_PASSWORD!],[zh.connections.text012,database]])await step(()=>form.getByLabel(label,{exact:true}).fill(value));
      await step(()=>form.getByLabel(zh.connections.text016,{exact:true}).uncheck());await step(()=>form.getByRole('button',{name:zh.connections.text036,exact:true}).click());await step(()=>expect(form).toBeHidden());
      const profiles=await step(()=>page.evaluate(()=>window.dbark.invoke('connections.list',{})));expect(profiles).toHaveLength(1);const profile=profiles[0];expect(Boolean(profile.name==='列字符集转换本例'&&profile.host==='192.168.31.200'&&profile.port===13384&&profile.database===database&&profile.user===environment.values.DBARK_TEST_USER&&profile.rememberPassword===false&&!profile.ssh?.enabled&&!profile.tls?.enabled)).toBe(true);
      const sender=await step(()=>application.evaluate(({webContents})=>{const windows=webContents.getAllWebContents().filter(item=>item.getType()==='window');if(windows.length!==1)throw Error('列字符集转换原主窗口不唯一');return windows[0].id;}));
      // 只限制本例schema.columns三个请求，保留真实Main处理器和Engine回包；不是全IPC审计。
      await step(()=>application.evaluate(({ipcMain},input)=>{
        const handlers=(ipcMain as any)._invokeHandlers,original=handlers.get('dbark:request'),root=globalThis as any;
        if(typeof original!=='function'||root.__columnEncodingOwner)throw Error('列字符集转换原Main观察器归属未知');
        const state={gets:[] as any[],previews:[] as any[],applies:[] as any[],pending:0},snapshots=new Map<string,{ref:string;current:{charset:string;collation:string};hash:string;catalog:any[]}>(),plans=new Map<string,any>(),tasks=new Set<string>();
        const wrapped=async(event:any,payload:any)=>{
          const command=payload?.command,value=payload?.input;
          if(['query.execute','table.commit','table.truncate','table.drop','schema.execute'].includes(command))throw Error('列字符集转换专项禁止其它产品写入');
          if(!['schema.columns.get','schema.columns.preview','schema.columns.apply'].includes(command))return original(event,payload);
          if(event.sender.id!==input.sender||event.senderFrame!==event.sender.mainFrame||typeof value?.taskId!=='string'||!value.taskId||tasks.has(value.taskId))throw Error('列字符集转换原sender或任务身份变化');
          let kind:'gets'|'previews'|'applies',entry:any;
          if(command==='schema.columns.get'){if(value.connectionId!==input.id||value.database!==input.database||value.table!=='subject'||value.includeEncodingFacts!==true||state.gets.length>=4)throw Error('列字符集转换get目标或预算变化');kind='gets';entry={};}
          else if(command==='schema.columns.preview'){
            const owner=snapshots.get(value.snapshotId),patch=value.patches?.[0],pair=patch?.changes?.encoding,next=owner?.current.charset==='latin1'?{charset:'utf8mb4',collation:'utf8mb4_bin'}:{charset:'latin1',collation:'latin1_bin'};
            if(!owner||!Array.isArray(value.patches)||value.patches.length!==1||patch?.kind!=='alter'||patch.columnRef!==owner.ref||Object.keys(patch).sort().join(',')!=='changes,columnRef,kind'||Object.keys(patch.changes??{}).join(',')!=='encoding'||!pair||Object.keys(pair).sort().join(',')!=='charset,collation'||pair.charset!==next.charset||pair.collation!==next.collation||!owner.catalog.some(candidate=>candidate.charset===pair.charset&&candidate.collation===pair.collation)||state.previews.length>=3)throw Error('列字符集转换preview不属于准确原列及完整配对');
            kind='previews';entry={pair:{...pair},snapshotId:value.snapshotId,hash:owner.hash};
          }else{
            const plan=plans.get(value.previewToken);if(!plan||JSON.stringify(value.acknowledgements)!==JSON.stringify(plan.acknowledgements)||state.applies.length>=2)throw Error('列字符集转换apply不属于本例单次原预览');plans.delete(value.previewToken);kind='applies';entry={pair:plan.pair,previewToken:value.previewToken};
          }
          state[kind].push(entry);state.pending++;tasks.add(value.taskId);
          try{
            const reply=await original(event,payload);if(reply?.ok!==true)throw Error('列字符集转换原请求未成功');
            if(kind==='gets'){
              const result=reply.result,column=result?.columns?.find((item:any)=>item.name==='v'),current=column?.encoding?.current,expected=state.applies.length===1?{charset:'utf8mb4',collation:'utf8mb4_bin'}:{charset:'latin1',collation:'latin1_bin'};
              if(!column||column.encoding?.access.editable!==true||current?.charset!==expected.charset||current?.collation!==expected.collation||!Array.isArray(result.encodingCatalog)||!result.encodingCatalog.some((candidate:any)=>candidate.charset===current.charset&&candidate.collation===current.collation))throw Error('列字符集转换真实投影或完整目录未明确开放');
              entry.pair={...current};snapshots.set(result.snapshotId,{ref:column.columnRef,current:{...current},hash:result.ddlHash,catalog:result.encodingCatalog});
            }
            if(kind==='previews'){
              const plan=reply.result,risks=['ddl-implicit-commit','external-ddl-window','column-encoding-copy'];
              // 本fixture字面量不含空白；只规范化服务端保留的关键字间空白，完整其余SQL必须一致。
              const expectedSql='ALTER TABLE '+input.qualified+' MODIFY COLUMN '+String.fromCharCode(96)+'v'+String.fromCharCode(96)+" varchar(24) CHARACTER SET "+entry.pair.charset+' COLLATE '+entry.pair.collation+" DEFAULT 'é' COMMENT '保留字符', ALGORITHM=COPY, LOCK=EXCLUSIVE;";
              if(plan?.target.connectionId!==input.id||plan.target.database!==input.database||plan.target.table!=='subject'||plan.ddlHash!==entry.hash||typeof plan.sql!=='string'||plan.sql.replace(/\s+/g,' ')!==expectedSql||!Array.isArray(plan.requiredAcknowledgements)||plan.requiredAcknowledgements.length!==3||new Set(plan.requiredAcknowledgements).size!==3||!risks.every(id=>plan.requiredAcknowledgements.includes(id)))throw Error('列字符集转换真实预览不属于准确目标、完整定义、方向与COPY排他算法');
              entry.sql=plan.sql;plans.set(plan.previewToken,{pair:entry.pair,acknowledgements:plan.requiredAcknowledgements});
            }
            if(kind==='applies'){entry.result=reply.result;if(reply.result?.ddlCompleted!==true||reply.result?.definitionVerified!==true)throw Error('列字符集转换实际DDL未完成完整定义核验');}
            return reply;
          }finally{state.pending--;}
        };
        handlers.set('dbark:request',wrapped);root.__columnEncodingOwner={handlers,wrapped,state};
      },{id:profile.id,database,sender,qualified}));
      const state=()=>step(()=>application.evaluate(()=>{const owner=(globalThis as any).__columnEncodingOwner;if(!owner||owner.handlers.get('dbark:request')!==owner.wrapped)throw Error('列字符集转换原Main观察器已变化');return owner.state as {gets:{pair:{charset:string;collation:string}}[];previews:{pair:{charset:string;collation:string};sql:string}[];applies:{pair:{charset:string;collation:string};result:{definitionVerified:boolean}}[];pending:number};}));
      const node=page.locator('.connection-node').filter({has:page.getByRole('button',{name:profile.name,exact:true})});await step(()=>node.getByRole('button',{name:profile.name,exact:true}).click());const databaseRow=node.locator('.database-row').filter({has:page.getByRole('button',{name:database,exact:true})});await step(()=>databaseRow.getByRole('button',{name:database,exact:true}).click());await step(()=>node.locator('.object-row').getByRole('button',{name:'subject',exact:true}).click());
      const table=page.locator('.table-tab:visible'),dialog=page.getByRole('dialog',{name:columnText.title,exact:true});await step(()=>expect(table.locator('.loading-overlay')).toHaveCount(0));
      /** 两次转换均经真实字段编辑器、真实目录选择及固定SQL预览，不注入草稿或写IPC。 */
      const prepare=async(charset:string,collation:string)=>{
        await step(()=>table.getByRole('button',{name:columnText.title,exact:true}).click());await step(()=>dialog.getByRole('button',{name:/^v · varchar\(24\)$/i}).click());
        const charsetInput=dialog.getByRole('combobox',{name:encodingText.charset,exact:true}),collationInput=dialog.getByRole('combobox',{name:encodingText.collation,exact:true});await step(()=>expect(charsetInput).toBeEnabled());await step(()=>charsetInput.selectOption(charset));await step(()=>expect(collationInput).toHaveValue(''));await step(()=>collationInput.selectOption(collation));
        await step(()=>dialog.getByRole('button',{name:columnText.rowSave,exact:true}).click());await step(()=>dialog.getByRole('button',{name:columnText.preview,exact:true}).click());await step(()=>expect(dialog.getByRole('heading',{name:columnText.fixedSql,exact:true})).toBeVisible());
      };
      const apply=async()=>{
        for(const label of [columnText.ackImplicit,columnText.ackWindow,encodingText.acknowledgement])await step(()=>dialog.getByRole('checkbox',{name:label,exact:true}).check());await step(()=>dialog.getByRole('button',{name:columnText.apply,exact:true}).click());await step(()=>expect(dialog.getByRole('status')).toHaveText(columnText.succeeded));await step(()=>expect(dialog.getByRole('button',{name:columnText.apply,exact:true})).toBeDisabled());await step(()=>dialog.getByRole('button',{name:columnText.close,exact:true}).click());await step(()=>expect(dialog).toBeHidden());await step(()=>expect(table.locator('.loading-overlay')).toHaveCount(0));
      };
      await prepare('utf8mb4','utf8mb4_bin');expect(await read(statements.definition)).toEqual(originalDefinition);expect(await read(statements.rows)).toEqual(authority);expect(await read(statements.bytes)).toEqual(originalBytes);expect((await state()).applies).toHaveLength(0);await verifySource('原编码与提交前');
      const screenshotPath=resolve(info.outputPath('列字符集转换SQL与风险预览.png'));await step(()=>dialog.screenshot({path:screenshotPath}));const screenshotSha256=createHash('sha256').update(await step(()=>fs.readFile(screenshotPath))).digest('hex');
      await apply();expect(await read(statements.rows)).toEqual(authority);expect(await read(statements.bytes)).toEqual(convertedBytes);expect(await read(statements.statistics,[database,'subject'])).toEqual(originalStatistics);expect(await read(statements.columns,[database,'subject'])).toEqual(originalColumns.map((row:any)=>row.COLUMN_NAME==='v'?{...row,CHARACTER_SET_NAME:'utf8mb4',COLLATION_NAME:'utf8mb4_bin',CHARACTER_OCTET_LENGTH:'96'}:row));const convertedDefinition=await read(statements.definition);expect(convertedDefinition).not.toEqual(originalDefinition);expect((await state()).applies).toHaveLength(1);
      await prepare('latin1','latin1_bin');expect(await read(statements.definition)).toEqual(convertedDefinition);expect(await read(statements.rows)).toEqual(authority);expect(await read(statements.bytes)).toEqual(convertedBytes);expect((await state()).applies).toHaveLength(1);await apply();expect(await read(statements.definition)).toEqual(originalDefinition);expect(await read(statements.statistics,[database,'subject'])).toEqual(originalStatistics);expect(await read(statements.columns,[database,'subject'])).toEqual(originalColumns);expect(await read(statements.rows)).toEqual(authority);expect(await read(statements.bytes)).toEqual(originalBytes);await verifySource('转换及恢复核验');
      const final=await state(),pairs=[{charset:'utf8mb4',collation:'utf8mb4_bin'},{charset:'latin1',collation:'latin1_bin'}];expect(final.applies.map(item=>item.pair)).toEqual(pairs);expect(final.applies.every(item=>item.result.definitionVerified)).toBe(true);expect(final.previews.map(item=>item.pair)).toEqual(pairs);expect(final.pending).toBe(0);expect(await step(()=>page.evaluate(()=>window.dbark.invoke('history.list',{})))).toEqual([]);
      await verifySource('退出客户端前');check();await confirmOwnedDesktopExit(info);closed=true;check();expect(originalProcess.exitCode).toBe(0);expect(await read(statements.threads,[database,threadId])).toEqual([]);await closeMysqlConnection(observer,true);observerClosed=true;check();expect(stream.closed).toBe(true);await verifySource('退出与控制收尾后');expect(sourceChecks).toEqual(phases);
      await step(()=>info.attach('列字符集转换专项终态',{body:Buffer.from(JSON.stringify({kind:'dbark.column-encoding-ui',version:1,platform:process.platform,database,normalExit:closed,observerClosed,originalProcessExitCode:originalProcess.exitCode,targetThreadsAfterExit:0,databaseRetainedForRoot:true,originalRowsPreserved:true,originalBytesRestored:true,convertedBytesVerified:true,originalDefinitionRestored:true,completeStableIndexCatalogPreserved:true,octetLengths:[24,96,24],audit:final,source:{manifestSha256:environment.values.DBARK_COLUMN_ENCODING_MANIFEST_SHA256,phases:sourceChecks},screenshot:{path:screenshotPath,sha256:screenshotSha256},mainIpcAuditVerified:false,systemClipboard:0,installerVerified:false,macOSVerified:false})),contentType:'application/json'}));finished.add(info);
    }catch(reason){retained=true;clock.retain();retainOwnedDesktopResources(info);throw reason;}
  });
}
