import {randomUUID} from 'node:crypto';
import type {Connection,RowDataPacket} from 'mysql2/promise';
import {test,expect,page,closed,answerDialogs,quitDesktop,launchDesktop} from './desktop-fixture';
import {enabled,isolatedDatabase,openDatabaseQuery,executeSql,writeSql} from './live-helpers';

// 使用真实Electron/utility/数据库和磁盘，关闭轨迹避免记录表单凭据。
test.use({trace:'off'});
const query=()=>page.locator('.query-tab:visible');
/** 第二库与本例隔离；先退出应用，再按精确随机名称清理并核对残留。 */
async function otherDatabase(observer:Connection,body:(name:string)=>Promise<void>){
  const name='dbark_colperm_'+randomUUID().replaceAll('-','').slice(0,12);await observer.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`);
  try{await body(name);}finally{if(!closed){await answerDialogs([1,1]);await quitDesktop();}if(!/^dbark_colperm_[a-f0-9]{12}$/.test(name))throw Error('拒绝清理非本例数据库');await observer.query(`DROP DATABASE IF EXISTS \`${name}\``);const[rows]=await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[name]);expect(rows).toHaveLength(0);}
}
/** 通过实际保存入口记录当前草稿，正文不执行。 */
async function save(name:string){await query().getByRole('button',{name:'保存查询',exact:true}).click();const dialog=page.getByRole('dialog',{name:'保存查询',exact:true});await dialog.getByLabel('查询名称',{exact:true}).fill(name);await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toBeHidden();}
/** 通过历史面板新开标签，保留原标签，核对用户能选择到的真实入口。 */
async function reopen(marker:string,saved=false){await page.locator('.app-commandbar').getByRole('button',{name:'历史与查询',exact:true}).click();const dialog=page.getByRole('dialog',{name:'历史与保存的查询',exact:true});if(saved)await dialog.getByRole('button',{name:'保存的查询',exact:true}).click();const card=dialog.locator('.history-card').filter({hasText:marker});await expect(card).toHaveCount(1);await card.getByRole('button',{name:'在新标签打开',exact:true}).click();await expect(dialog).toBeHidden();}
/** 用已持久化草稿核对默认库，等待真实状态读回与400毫秒保存防抖结束。 */
async function savedContext(database:string|null|'unknown'){await expect.poll(()=>page.evaluate(async()=>{const settings=await window.dbark.invoke('settings.get',{});return settings.tabs.find(tab=>tab.id===settings.activeTabId)?.databaseContext;})).toEqual(database==='unknown'?{state:'unknown'}:{state:'known',database});}

test.describe('200隔离实例：查询上下文的实际入口',()=>{
  test.skip(!enabled,'需要显式启用200隔离数据库');
  test('USE之后历史、保存查询与布局恢复在B库执行，同名A表不会误读',async({},info)=>{
    test.setTimeout(180000);await isolatedDatabase(async({observer,database})=>otherDatabase(observer,async other=>{
      await observer.query(`CREATE TABLE \`${database}\`.subject(v VARCHAR(40))`);await observer.query(`INSERT INTO \`${database}\`.subject VALUES('A-source')`);
      await observer.query(`CREATE TABLE \`${other}\`.subject(v VARCHAR(40))`);await observer.query(`INSERT INTO \`${other}\`.subject VALUES('B-source')`);
      await openDatabaseQuery(database);await executeSql(`USE \`${other}\``);await savedContext(other);const statement='SELECT v FROM subject /* DBARK_CONTEXT_HISTORY */';await executeSql(statement);await expect(query().locator('.result-body')).toContainText('B-source');
      const history=await page.evaluate(()=>window.dbark.invoke('history.list',{}));expect(history.find(item=>item.sql===statement)?.databaseContext).toEqual({state:'known',database:other});
      await writeSql('SELECT v FROM subject /* DBARK_CONTEXT_SAVED */');await save('B库保存查询');await reopen('DBARK_CONTEXT_HISTORY');await query().getByRole('button',{name:'执行全部',exact:true}).click();await expect(query().getByRole('button',{name:'停止',exact:true})).toBeDisabled();await expect(query().locator('.result-body')).toContainText('B-source');
      await reopen('B库保存查询',true);await executeSql('SELECT v FROM subject');await expect(query().locator('.result-body')).toContainText('B-source');await savedContext(other);await quitDesktop();await launchDesktop();await expect(query().getByLabel('当前查询默认库',{exact:true})).toHaveText(other);await executeSql('SELECT v FROM subject');await expect(query().locator('.result-body')).toContainText('B-source');await expect(query().locator('.result-body')).not.toContainText('A-source');await page.screenshot({path:info.outputPath('history-saved-restored-database.png')});
    }),info);
  });
  test('未知库保存与重启需确认，断线后的写入不重放，确认重连后仍需显式执行',async({},info)=>{
    test.setTimeout(180000);await isolatedDatabase(async({observer,database})=>otherDatabase(observer,async other=>{
      for(const name of[database,other])await observer.query(`CREATE TABLE \`${name}\`.subject(id INT PRIMARY KEY)`);
      await openDatabaseQuery(database);await executeSql(`SET SESSION session_track_system_variables='';SET SESSION session_track_schema=OFF;USE \`${other}\``);await savedContext('unknown');await writeSql('INSERT INTO subject VALUES(77)');await save('未知库写入草稿');await reopen('未知库写入草稿',true);await savedContext('unknown');await quitDesktop();await launchDesktop();
      await expect(query().getByLabel('当前查询默认库',{exact:true})).toHaveText('默认库待确认');await query().getByRole('button',{name:'执行全部',exact:true}).click();let dialog=page.getByRole('dialog',{name:'确认重连数据库',exact:true});await expect(dialog).toBeVisible();await dialog.getByLabel('数据库名称',{exact:true}).fill(other);await dialog.getByRole('button',{name:'使用此数据库',exact:true}).click();
      expect(Number((await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${other}\`.subject`))[0][0].n)).toBe(0);
      await executeSql('SELECT CONNECTION_ID() AS ctx_id');await expect(query().locator('.result-body')).toContainText('ctx_id');const ids=(await query().locator('.result-body').innerText()).match(/\b\d+\b/g);expect(ids).toHaveLength(1);const id=Number(ids![0]);expect(Number.isSafeInteger(id)&&id>0).toBe(true);await observer.query(`KILL CONNECTION ${id}`);
      await writeSql('INSERT INTO subject VALUES(77)');await query().getByRole('button',{name:'执行全部',exact:true}).click();await expect(query().getByRole('button',{name:'停止',exact:true})).toBeDisabled();await expect(query().locator('.error-box')).toContainText('断开');await savedContext('unknown');
      await query().getByRole('button',{name:'选择重连数据库',exact:true}).click();dialog=page.getByRole('dialog',{name:'确认重连数据库',exact:true});await dialog.getByLabel('数据库名称',{exact:true}).fill(other);await dialog.getByRole('button',{name:'使用此数据库',exact:true}).click();expect(Number((await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${other}\`.subject`))[0][0].n)).toBe(0);
      await executeSql('INSERT INTO subject VALUES(77)');expect(Number((await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${other}\`.subject`))[0][0].n)).toBe(1);expect(Number((await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${database}\`.subject`))[0][0].n)).toBe(0);await page.screenshot({path:info.outputPath('explicit-reconnect-no-write-replay.png')});
    }),info);
  });
  test('确认无默认库的保存与重启不会回退连接配置中的A库',async({},info)=>{
    test.setTimeout(180000);await isolatedDatabase(async({observer,database,connectionName})=>otherDatabase(observer,async other=>{
      const row=page.locator('.connection-row').filter({has:page.getByRole('button',{name:connectionName,exact:true})});await row.getByRole('button',{name:connectionName,exact:true}).focus();await row.getByRole('button',{name:`编辑连接 ${connectionName}`,exact:true}).click();const edit=page.getByRole('dialog',{name:'编辑连接',exact:true});await edit.getByLabel('默认数据库（可选）',{exact:true}).fill(database);await edit.getByRole('button',{name:'保存连接',exact:true}).click();await expect(edit).toBeHidden();
      // 使用独立SQL标签显式切到可丢弃库，再删除当前库，协议报告空库。
      await page.locator('.app-commandbar').getByRole('button',{name:'新建查询',exact:true}).click();await page.getByRole('dialog',{name:'新建查询',exact:true}).getByRole('button',{name:'打开查询',exact:true}).click();await executeSql(`USE \`${other}\`;DROP DATABASE \`${other}\``);await savedContext(null);await writeSql('SELECT DATABASE() AS restored_database');await save('确认无默认库');await reopen('确认无默认库',true);await quitDesktop();await launchDesktop();await expect(query().getByLabel('当前查询默认库',{exact:true})).toHaveText('未选择数据库');await executeSql('SELECT DATABASE() AS restored_database');await savedContext(null);await expect(query().locator('.result-body')).toContainText('NULL');
      const history=await page.evaluate(()=>window.dbark.invoke('history.list',{}));expect(history.find(item=>item.sql==='SELECT DATABASE() AS restored_database')?.databaseContext).toEqual({state:'known',database:null});
    }),info);
  });
});
