import {test as baseTest,expect,type TestInfo} from '@playwright/test';
import type {RowDataPacket} from 'mysql2/promise';
import {columnPatchZh as text} from '../../src/renderer/locales/columnPatches.zh-CN';
type Desktop=typeof import('./desktop-fixture');
type Live=typeof import('./live-helpers');
// 默认关闭，list先短路：不读取凭据文件、不加载实库和桌面夹具，不执行GUI或200操作。
const listing=process.argv.includes('--list'),armed=!listing&&process.env.DBARK_COLUMN_ON_UPDATE_UI==='1'&&process.env.DBARK_INTEGRATION_ENABLED==='1';
if(armed&&(process.env.DBARK_TEST_HOST!=='192.168.31.200'||!['13357','13380','13384','13310','13311','13484'].includes(process.env.DBARK_TEST_PORT??'')))throw Error('须ROOT明确分配200六组合中的单一目标');
const desktop:Desktop|undefined=armed?require('./desktop-fixture'):undefined,test=(desktop?.test??baseTest) as typeof baseTest;
test.skip(!armed,'默认关闭：须ROOT独占分配真实界面及对应六组合目标');test.use({trace:'off',screenshot:'off',video:'off'});test.setTimeout(180000);test.describe.configure({retries:0});
const page=()=>{if(!desktop)throw Error('未取得实际界面窗口');return desktop.page;},dialog=()=>page().getByRole('dialog',{name:text.title,exact:true});

/** 正式产品入口编辑，暂存及预览都不能写入结构；不注入组件状态或直接调用apply。 */
async function change(value:'expression'|'none'){
 await page().locator('.table-tab:visible').getByRole('button',{name:text.title,exact:true}).click();await dialog().getByRole('button',{name:/^updated_at ·/}).click();
 await dialog().getByRole('checkbox',{name:text.modify+' '+text.onUpdate,exact:true}).check();await dialog().getByRole('combobox',{name:text.onUpdate,exact:true}).selectOption(value);await dialog().getByRole('button',{name:text.rowSave,exact:true}).click();await dialog().getByRole('button',{name:text.preview,exact:true}).click();await expect(dialog().getByRole('heading',{name:text.fixedSql,exact:true})).toBeVisible();
}
/** 使用原风险确认和单次按钮；本测试从不调用生产apply IPC来替代用户操作。 */
async function confirm(){for(const label of [text.ackImplicit,text.ackWindow])await dialog().getByRole('checkbox',{name:label,exact:true}).check();await dialog().getByRole('button',{name:text.apply,exact:true}).click();await expect(dialog().getByRole('status')).toHaveText(text.succeeded);await expect(dialog().getByRole('button',{name:text.apply,exact:true})).toBeDisabled();await dialog().getByRole('button',{name:text.close,exact:true}).click();}

for(const type of ['DATETIME','DATETIME(6)','TIMESTAMP(6)'])test(type+'通过真实字段窗口开启及移除ON UPDATE，精确默认/旁列保持且不重放',async({},info:TestInfo)=>{
 const live:Live=await import('./live-helpers');await live.isolatedDatabase(async c=>{
  const target='`'+c.database.replaceAll('`','``')+'`.`column_auto_time`';await c.observer.query(`CREATE TABLE ${target}(id INT PRIMARY KEY,note VARCHAR(20),updated_at ${type} NULL DEFAULT '2001-01-01 00:00:00' COMMENT '保留时间',big_value DECIMAL(30,6) DEFAULT 12345678901234567890.123456,empty_text VARCHAR(10) DEFAULT '',text_null VARCHAR(10) DEFAULT 'NULL') ENGINE=InnoDB`);await c.observer.query(`INSERT INTO ${target}(id,note) VALUES(1,'原值')`);
  const read=async()=>{const [rows]=await c.observer.query<RowDataPacket[]>(`SELECT CAST(updated_at AS CHAR) AS timestamp_value,CAST(big_value AS CHAR) AS amount,empty_text,text_null FROM ${target} WHERE id=1`);return rows[0];};
  const ddl=async()=>{const [rows]=await c.observer.query<RowDataPacket[]>('SHOW CREATE TABLE '+target);return String(rows[0]['Create Table']);};const original=await ddl(),data=await read();
  const connection=page().locator('.connection-node').filter({has:page().locator('.connection-row').getByText(c.connectionName,{exact:true})});await connection.locator('.connection-row').hover();await connection.getByRole('button',{name:'刷新连接',exact:true}).click();await connection.locator('.database-row').getByRole('button',{name:c.database,exact:true}).click();await connection.locator('.object-row').getByText('column_auto_time',{exact:true}).click();await expect(page().locator('.table-tab:visible .loading-overlay')).toHaveCount(0);
  await change('expression');expect(await ddl()).toBe(original);expect(await read()).toEqual(data);await confirm();const enabled=await ddl();expect(enabled).toMatch(/ON UPDATE current_timestamp/i);expect(await read()).toEqual(data);
  await c.observer.query(`UPDATE ${target} SET note='更新后' WHERE id=1`);const updated=await read();expect(updated.timestamp_value).not.toBe(data.timestamp_value);expect({...updated,timestamp_value:data.timestamp_value}).toEqual(data);
  await change('none');expect(await ddl()).toBe(enabled);await confirm();expect(await ddl()).toBe(original);await c.observer.query(`UPDATE ${target} SET note='再次更新' WHERE id=1`);expect(await read()).toEqual(updated);
  const tasks=await page().evaluate(()=>window.dbark.invoke('tasks.list',{}));expect(tasks.filter(task=>task.kind==='schema.columns.apply')).toHaveLength(2);
 },info);
});
