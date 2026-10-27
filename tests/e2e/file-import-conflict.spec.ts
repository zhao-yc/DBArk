import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, unlink, readFile, rmdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Socket } from 'node:net';
import mysql, { type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, pageErrors } from './desktop-fixture';
import { installConflictFileAnswer, finishConflictFileAnswer } from '../helpers/fileImportConflictUi';
import { fileImportConflictReportSchema, fileImportKeyCatalogSchema, type FileImportKeyCatalog, type FileImportConflictSelection } from '../../src/shared/fileImportConflict';
import type { FileImportResult } from '../../src/shared/sqlFileImport';
import { fileImportConflictZh as t } from '../../src/renderer/locales/fileImportConflict.zh-CN';
import { fileImportTransactionZh } from '../../src/renderer/locales/fileImportTransaction.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';

const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_FILE_IMPORT_CONFLICT_UI === '1';
test.skip(!enabled, '冲突导入正式窗口须统筹预核200隔离实例并显式开启双门');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(180000);
interface Audit {
  pending: number; choices: { token: string; name: string; format: string }[]; catalogs: FileImportKeyCatalog[];
  started: { taskId: string; token: string; conflict: FileImportConflictSelection }[];
  imports: { taskId: string; result: FileImportResult }[]; cancels: { taskId: string; ok: boolean }[];
}
const zero = () => ({ inserted: 0, matchedUpdates: 0, skippedExisting: 0, skippedMissing: 0 });

test('真实CSV和JSON策略键选择、指定键upsert/其它unique拒绝、原按钮取消与收尾', async ({}, info) => {
  if (process.platform !== 'win32') throw Error('本专项仅Windows，不能作为macOS验收');
  const live = await import('./live-helpers'), env = live.environment, host = env.DBARK_TEST_HOST ?? '', port = Number(env.DBARK_TEST_PORT), tls = env.DBARK_TEST_TLS === '1';
  if (!enabled || !['deve-server.yinzon.com', '192.168.31.200'].includes(host) || ![13357,13380,13384,13310,13311,13484].includes(port) || !env.DBARK_TEST_USER || !env.DBARK_TEST_EXPECTED_HOSTNAME) throw Error('仅允许预核200六个隔离实例');
  if (port === 13484 && (!tls || !env.DBARK_TEST_CA)) throw Error('13484必须保持原严格TLS及CA');
  const original = ownedDesktopResources(info), application = original.application, page = original.page;
  const check = () => { const value = ownedDesktopResources(info); if (value.application !== application || value.page !== page) throw Error('冲突导入原窗口归属变化'); };
  const database = 'dbark_importconflict_ui_' + randomUUID().replaceAll('-', ''), marker = randomUUID(), threads = new Set<number>();
  const observer = await mysql.createConnection({ host, port, user: env.DBARK_TEST_USER, password: env.DBARK_TEST_PASSWORD, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, connectTimeout: 15000, ...(tls ? { ssl: { ca: readFileSync(env.DBARK_TEST_CA!), rejectUnauthorized: true, verifyIdentity: true } } : {}) });
  const observerId = observer.threadId, socket = (observer as unknown as { connection: { stream: Socket } }).connection.stream;
  let sawClose = socket.closed === true, endAttempted = false, created = false, marked = false, installed = false, held = false, directory = '', failed = false, failure: unknown;
  const closed = new Promise<void>(resolve => { if (sawClose) resolve(); else socket.once('close', () => { sawClose = true; resolve(); }); });
  /** 原观察连接只关闭一次，end之后最多观察5秒socket，不补强停或重连。 */
  const endObserver = async () => { if (endAttempted) throw Error('原观察连接不能重复关闭'); endAttempted = true; await observer.end(); let timer: ReturnType<typeof setTimeout> | undefined; try { await Promise.race([closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('原观察socket关闭未确认')),5000); })]); } finally { if (timer) clearTimeout(timer); } expect(sawClose && socket.closed).toBe(true); };
  /** DDL/DML校验无警告Header，行查询才复制数组；不能把任意回包伪造为行集合。 */
  const observe = async (sql: string, values: (string|number)[] = []) => { check(); const [rows] = await observer.query<RowDataPacket[]|ResultSetHeader>(sql, values); check(); if (Array.isArray(rows)) return rows.map(row => ({ ...row })); expect(rows.fieldCount).toBe(0); expect(Number.isSafeInteger(rows.affectedRows) && rows.affectedRows >= 0).toBe(true); expect(Number.isInteger(rows.serverStatus) && rows.serverStatus >= 0 && rows.serverStatus <= 65535).toBe(true); expect(rows.warningStatus).toBe(0); return []; };
  const table = (name: string) => '`'+database+'`.`'+name+'`';
  const files: { path: string; bytes: Buffer; format: 'csv'|'json' }[] = [];
  const audit = async (): Promise<Audit> => { check(); const result = await application.evaluate(() => { const state = (globalThis as any).__conflictImportAudit; state.check(); return { pending: state.pending, choices: state.choices, catalogs: state.catalogs, started: state.started, imports: state.imports, cancels: state.cancels }; }); check(); return result; };
  try {
    const identity = (await observe('SELECT @@hostname AS hostname,VERSION() AS version,CONNECTION_ID() AS id'))[0]; expect(identity.hostname).toBe(env.DBARK_TEST_EXPECTED_HOSTNAME); expect(Number(identity.id)).toBe(observerId);
    if (!String(identity.version).includes('MariaDB')) { if (!env.DBARK_TEST_EXPECTED_UUID) throw Error('缺少原MySQL UUID，未建库'); expect((await observe('SELECT @@server_uuid AS uuid'))[0].uuid).toBe(env.DBARK_TEST_EXPECTED_UUID); }
    await info.attach('冲突导入原资源', { body: JSON.stringify({ database, owner: marker, observerId, port, version: identity.version }), contentType: 'application/json' });
    created = true; const context = await live.connectAndCreate(database, { page, application, assertCurrent: check });
    await observe('CREATE TABLE '+table('__owner')+' (token VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB'); await observe('INSERT INTO '+table('__owner')+' VALUES (?)',[marker]); marked = true;
    await observe('CREATE TABLE '+table('subject')+" (tenant INT NOT NULL,k VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,alt VARCHAR(32) NOT NULL,amount DECIMAL(30,12) NOT NULL,n BIGINT UNSIGNED NOT NULL,note VARCHAR(80) NULL,untouched VARCHAR(32) NOT NULL DEFAULT '保持原值',PRIMARY KEY(tenant,k),UNIQUE KEY uq_alt(alt)) ENGINE=InnoDB");
    await observe('INSERT INTO '+table('subject')+" (tenant,k,alt,amount,n) VALUES(1,'Alpha','u1',0,0),(1,'Beta','u2',0,0)");
    directory = await mkdtemp(join(tmpdir(),'dbark-importconflict-ui-'));
    const sources = [
      { format:'csv' as const, name:'explicit-upsert.csv', text:'tenant,k,alt,amount,n,note\r\n1,alpha,u1,9007199254740993.123456789012,18446744073709551615,匹配更新😀\r\n1,Gamma,u3,-9007199254740993.123456789011,18446744073709551614,新增😀\r\n' },
      { format:'json' as const, name:'other-unique.json', text:'[{"tenant":1,"k":"alpha","alt":"u2","amount":99,"n":18446744073709551615,"note":"不得更新另一个唯一键对应行"}]' },
      { format:'csv' as const, name:'explicit-cancel.csv', text:'tenant,k,alt,amount,n,note\r\n1,alpha,u1,77,18446744073709551615,取消不能覆盖\r\n' },
    ];
    for (const source of sources) { const path = join(directory,source.name), bytes = Buffer.from(source.text,'utf8'); await writeFile(path,bytes,{flag:'wx'}); files.push({ path, bytes, format:source.format }); }
    await info.attach('冲突导入三份源字节', { body:JSON.stringify(files.map(file=>({path:file.path,format:file.format,bytes:file.bytes.length,sha256:createHash('sha256').update(file.bytes).digest('hex')}))),contentType:'application/json' });
    /** 仅旁观原Main能力、目录及回执，绝不从页面直接发送files.import。 */
    await application.evaluate(({ipcMain,BrowserWindow},input)=>{
      const root=globalThis as any,handlers=(ipcMain as any)._invokeHandlers,previous=handlers?.get('dbark:request'),windows=BrowserWindow.getAllWindows(),window=windows[0],contents=window?.webContents,frame=contents?.mainFrame;
      if(root.__conflictImportAudit||typeof previous!=='function'||windows.length!==1||!frame)throw Error('冲突导入Main旁观归属未知');
      const state={pending:0,choices:[] as Audit['choices'],catalogs:[] as Audit['catalogs'],started:[] as Audit['started'],imports:[] as Audit['imports'],cancels:[] as Audit['cancels'],check(){},restore(){}};
      const check=()=>{if(root.__conflictImportAudit!==state||handlers.get('dbark:request')!==wrapped||window.isDestroyed()||contents.isDestroyed()||contents.mainFrame!==frame||BrowserWindow.getAllWindows().length!==1||BrowserWindow.getAllWindows()[0]!==window)throw Error('冲突导入Main原归属变化');};
      const wrapped=async(event:any,payload:any)=>{
        check();if(event.sender!==contents||event.senderFrame!==frame)throw Error('冲突导入Main来源变化');const command=payload.command,value=payload.input,relevant=['files.choose','files.importKeys','files.import','query.cancel'].includes(command);if(relevant)state.pending++;
        try{
          if(command==='files.import'){
            const catalog=state.catalogs.at(-1),index=state.imports.length;
            if(index>=3||state.started.length!==index||value.connectionId!==input.connectionId||value.database!==input.database||value.table!=='subject'||value.format!==input.formats[index]||value.encoding!=='utf8'||value.transactionMode!=='atomic'||value.fileToken!==state.choices[index]?.token||value.conflict?.mode!=='upsert'||value.conflict.schemaHash!==catalog?.schemaHash||value.conflict.key.name!=='PRIMARY'||JSON.stringify(value.conflict.key.columns)!==JSON.stringify(['tenant','k'])||Object.hasOwn(value,'filePath'))throw Error('冲突导入未冻结本次策略、键、文件或目标');
            state.started.push({taskId:value.taskId,token:value.fileToken,conflict:value.conflict});
          }
          if(command==='query.cancel'){if(state.cancels.length||state.started.length!==3||state.imports.length!==2||value.taskId!==state.started[2].taskId)throw Error('冲突取消未指向原第三任务');state.cancels.push({taskId:value.taskId,ok:false});}
          const response=await previous(event,payload);check();
          if(command==='files.choose'){if(!response?.ok||value.purpose!=='import'||value.format!==input.formats[state.choices.length]||state.choices.length>=3||typeof response.result?.token!=='string'||state.choices.some(choice=>choice.token===response.result.token))throw Error('冲突导入真实文件能力无效');state.choices.push({...response.result,format:value.format});}
          if(command==='files.importKeys'){if(!response?.ok||value.connectionId!==input.connectionId||value.database!==input.database||value.table!=='subject')throw Error('冲突目录来源无效');state.catalogs.push(response.result);}
          if(command==='files.import'){if(!response?.ok)throw Error('冲突导入缺结构化回执');state.imports.push({taskId:value.taskId,result:response.result});}
          if(command==='query.cancel')state.cancels[0].ok=response?.ok===true;
          return response;
        }finally{if(relevant)state.pending--;}
      };
      state.check=check;state.restore=()=>{check();if(state.pending)throw Error('冲突原请求尚在途');handlers.set('dbark:request',previous);delete root.__conflictImportAudit;};root.__conflictImportAudit=state;handlers.set('dbark:request',wrapped);
    },{connectionId:context.connectionId,database,formats:files.map(file=>file.format)});installed=true;
    await page.locator('.database-row').filter({has:page.getByRole('button',{name:database,exact:true})}).getByRole('button',{name:database,exact:true}).click();
    await page.locator('.object-row').getByRole('button',{name:'subject',exact:true}).click();const tab=page.locator('.table-tab:visible');await expect(tab.getByRole('grid')).toBeVisible();await tab.getByRole('button',{name:zh.common.import,exact:true}).click();
    const dialog=page.getByRole('dialog',{name:`${zh.transfer.text004} · ${database}.subject`,exact:true}),start=dialog.getByRole('button',{name:zh.transfer.text028,exact:true}),report=dialog.getByRole('status',{name:t.report,exact:true}),mode=dialog.getByRole('combobox',{name:t.mode,exact:true}),key=dialog.getByRole('combobox',{name:t.key,exact:true});
    await expect(mode).toHaveValue('insert');expect((await audit()).catalogs).toHaveLength(0);
    for(const[index,file]of files.entries()){
      await dialog.getByRole('combobox',{name:zh.transfer.text006,exact:true}).selectOption(file.format);
      const nonce=randomUUID();await installConflictFileAnswer(application,{nonce,path:file.path,format:file.format});await dialog.locator('.file-picker').click();expect(await finishConflictFileAnswer(application,nonce)).toMatchObject({calls:1,originalRestored:true});
      await expect(dialog.locator('.file-picker')).toContainText(basename(file.path));await expect(dialog.locator('.sample-grid').getByRole('grid')).toBeVisible();
      for(const name of ['tenant','k','alt','amount','n','note'])await expect(dialog.getByRole('combobox',{name:formatText(zh.transfer.text020,name),exact:true})).toHaveValue(name);
      await expect(mode).toHaveValue('insert');await expect(report).toHaveCount(0);expect((await audit()).imports).toHaveLength(index);
      const before=(await audit()).catalogs.length;await mode.selectOption('upsert');await expect.poll(async()=>(await audit()).catalogs.length).toBe(before+1);fileImportKeyCatalogSchema.parse((await audit()).catalogs.at(-1));
      await expect(key).toHaveValue('');await expect(start).toBeDisabled();await key.selectOption('PRIMARY');
      await dialog.getByRole('combobox',{name:fileImportTransactionZh.label,exact:true}).selectOption('atomic');await expect(mode).toHaveValue('upsert');await expect(key).toHaveValue('PRIMARY');
      // 每轮以原观察事务制造可观察的真实匹配锁等待，登记线程后才分别放行或点击取消。
      await observe('START TRANSACTION');held=true;await observe('SELECT tenant FROM '+table('subject')+" WHERE tenant=1 AND k='Alpha' FOR UPDATE");
      await expect(start).toBeEnabled();await start.click();
      await expect.poll(async()=>{const rows=await observe('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? AND ID<>? AND INFO LIKE ?',[database,observerId,'%FOR UPDATE%']);for(const row of rows)threads.add(Number(row.ID));return rows.length;}).toBe(1);
      if(index===2){
        await expect(dialog.locator('.file-picker')).toBeDisabled();await dialog.getByRole('button',{name:zh.transfer.text027,exact:true}).click();
      }else{await observe('ROLLBACK');held=false;}
      await expect.poll(async()=>(await audit()).imports.length).toBe(index+1);await expect.poll(async()=>(await audit()).pending).toBe(0);
      const original=(await audit()).imports[index],receipt=fileImportConflictReportSchema.parse(original.result.conflicts);expect(receipt.taskId).toBe(original.taskId);expect(receipt.mode).toBe('upsert');await expect(report).toBeVisible();await expect(report).toContainText(t.countsHint);
      if(index===0){expect(receipt).toMatchObject({termination:'completed',readRecords:2,acknowledged:{...zero(),inserted:1,matchedUpdates:1},committed:{...zero(),inserted:1,matchedUpdates:1},currentBatch:'none'});await expect(report).toContainText(t.completed);}
      else if(index===1){expect(receipt).toMatchObject({termination:'failed',readRecords:1,acknowledged:zero(),committed:zero(),currentBatch:'rolled-back',failure:{stage:'update',record:1}});await expect(report).toContainText(t.failed);await expect(report).toContainText(t.stages.update);}
      else{expect(receipt).toMatchObject({termination:'cancelled',readRecords:1,acknowledged:zero(),committed:zero(),currentBatch:'rolled-back',failure:{stage:'match',record:1}});expect((await audit()).cancels).toEqual([{taskId:original.taskId,ok:true}]);await expect(report).toContainText(t.cancelled);await expect(report).toContainText(t.stages.match);await observe('ROLLBACK');held=false;}
      await expect(report.locator('tbody tr').nth(0).getByRole('cell')).toHaveText(index===0?['1','1','0','0']:['0','0','0','0']);
      await expect(report.locator('tbody tr').nth(1).getByRole('cell')).toHaveText(index===0?['1','1','0','0']:['0','0','0','0']);
      await expect(report).toContainText(t.committed);await expect(report).toContainText(t.batches[receipt.currentBatch]);await expect(start).toBeDisabled();
      expect(await observe('SELECT k,alt,CAST(amount AS CHAR) AS amount,CAST(n AS CHAR) AS n,untouched FROM '+table('subject')+' ORDER BY k')).toEqual([{k:'Alpha',alt:'u1',amount:'9007199254740993.123456789012',n:'18446744073709551615',untouched:'保持原值'},{k:'Beta',alt:'u2',amount:'0.000000000000',n:'0',untouched:'保持原值'},{k:'Gamma',alt:'u3',amount:'-9007199254740993.123456789011',n:'18446744073709551614',untouched:'保持原值'}]);
      await info.attach('冲突第'+(index+1)+'次回执',{body:JSON.stringify(receipt,null,2),contentType:'application/json'});await info.attach('冲突第'+(index+1)+'次原生报告',{body:await report.screenshot(),contentType:'image/png'});
    }
    const state=await audit();expect(state.imports).toHaveLength(3);expect(new Set(state.started.map(value=>value.taskId)).size).toBe(3);expect(new Set(state.choices.map(value=>value.token)).size).toBe(3);expect(threads.size).toBe(3);await info.attach('冲突Main原始任务及取消旁观',{body:JSON.stringify(state,null,2),contentType:'application/json'});expect(pageErrors).toEqual([]);
    await application.evaluate(()=>(globalThis as any).__conflictImportAudit.restore());installed=false;await dialog.getByRole('button',{name:zh.common.done,exact:true}).click();
  }catch(error){failed=true;failure=error;}
  try{
    if(held){await observe('ROLLBACK');held=false;}
    await info.attach('冲突原资源收尾前登记',{body:JSON.stringify({database,owner:marker,observerId,threads:[...threads],created,marked,files:files.map(file=>({path:file.path,sha256:createHash('sha256').update(file.bytes).digest('hex')}))}),contentType:'application/json'});
    if(installed){expect((await audit()).pending).toBe(0);await application.evaluate(()=>(globalThis as any).__conflictImportAudit.restore());installed=false;}
    await confirmOwnedDesktopExit(info);check();
    if(created){if(!marked||!/^dbark_importconflict_ui_[a-f0-9]{32}$/.test(database))throw Error('冲突原owner未知，保留资源');expect(await observe('SELECT token FROM '+table('__owner'))).toEqual([{token:marker}]);for(const id of threads)expect(await observe('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?',[id])).toEqual([]);expect(await observe('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=?',[database])).toEqual([]);await observe('SET SESSION lock_wait_timeout=5');await observe('DROP DATABASE `'+database+'`');expect(await observe('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[database])).toEqual([]);}
    for(const file of files){expect(await readFile(file.path)).toEqual(file.bytes);await unlink(file.path);}if(directory)await rmdir(directory);await endObserver();
    await info.attach('冲突原线程及清理终态',{body:JSON.stringify({database,owner:marker,observerId,threads:[...threads],normalExit:true,socketClosed:socket.closed,sawClose,threadsRemaining:0,databaseRemaining:0,未验:['utility逐语句物理账（另由Engine专项验证）','真实COMMIT断线/ROLLBACK失败','系统原生文件窗口输入','剪贴板','macOS','安装包']}),contentType:'application/json'});
  }catch(cleanup){retainOwnedDesktopResources(info);if(!endAttempted)try{await endObserver();}catch(closing){throw new AggregateError(failed?[failure,cleanup,closing]:[cleanup,closing],'冲突UI原现场保留且观察关闭未确认',{cause:failed?failure:cleanup});}if(failed)throw new AggregateError([failure,cleanup],'原冲突UI及收尾失败',{cause:failure});throw cleanup;}
  if(failed)throw failure;
});
