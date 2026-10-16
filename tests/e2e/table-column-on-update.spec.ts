import {test as baseTest,expect,type TestInfo,type Page} from '@playwright/test';
import type {RowDataPacket} from 'mysql2/promise';
import {columnPatchZh as text} from '../../src/renderer/locales/columnPatches.zh-CN';
type Desktop=typeof import('./desktop-fixture');
type Live=typeof import('./live-helpers');
// 默认关闭，list先短路：不读取凭据文件、不加载实库和桌面夹具，不执行GUI或200操作。
const listing=process.argv.includes('--list'),armed=!listing&&process.env.DBARK_COLUMN_ON_UPDATE_UI==='1'&&process.env.DBARK_INTEGRATION_ENABLED==='1';
if(armed&&(process.env.DBARK_TEST_HOST!=='192.168.31.200'||!['13357','13380','13384','13310','13311','13484'].includes(process.env.DBARK_TEST_PORT??'')))throw Error('须ROOT明确分配200六组合中的单一目标');
const desktop:Desktop|undefined=armed?require('./desktop-fixture'):undefined,test=(desktop?.test??baseTest) as typeof baseTest;
// 新写入专项独立开启所属实例退出证明；失败或取消不能清理未确认的隔离现场。
if(desktop)desktop.test.use({preserveOnUnconfirmedExit:true});
test.skip(!armed,'默认关闭：须ROOT独占分配真实界面及对应六组合目标');test.use({trace:'off',screenshot:'off',video:'off'});test.setTimeout(180000);test.describe.configure({retries:0});
/** 本例页面只由显式owner提供，旧TestInfo及每次页面获取均须核归属。 */
interface CaseOwner{page:Page;assertCurrent():void;}
const page=(owner:CaseOwner)=>{owner.assertCurrent();return owner.page;},dialog=(owner:CaseOwner)=>page(owner).getByRole('dialog',{name:text.title,exact:true});

/** 正式产品入口编辑，暂存及预览都不能写入结构；不注入组件状态或直接调用apply。 */
async function change(owner:CaseOwner,value:'expression'|'none'){
 await page(owner).locator('.table-tab:visible').getByRole('button',{name:text.title,exact:true}).click();owner.assertCurrent();await dialog(owner).getByRole('button',{name:/^updated_at ·/}).click();owner.assertCurrent();
 await dialog(owner).getByRole('checkbox',{name:text.modify+' '+text.onUpdate,exact:true}).check();owner.assertCurrent();await dialog(owner).getByRole('combobox',{name:text.onUpdate,exact:true}).selectOption(value);owner.assertCurrent();await dialog(owner).getByRole('button',{name:text.rowSave,exact:true}).click();owner.assertCurrent();await dialog(owner).getByRole('button',{name:text.preview,exact:true}).click();owner.assertCurrent();await expect(dialog(owner).getByRole('heading',{name:text.fixedSql,exact:true})).toBeVisible();owner.assertCurrent();
}
/** 使用原风险确认和单次按钮；本测试从不调用生产apply IPC来替代用户操作。 */
async function confirm(owner:CaseOwner){for(const label of [text.ackImplicit,text.ackWindow]){await dialog(owner).getByRole('checkbox',{name:label,exact:true}).check();owner.assertCurrent();}await dialog(owner).getByRole('button',{name:text.apply,exact:true}).click();owner.assertCurrent();await expect(dialog(owner).getByRole('status')).toHaveText(text.succeeded);owner.assertCurrent();await expect(dialog(owner).getByRole('button',{name:text.apply,exact:true})).toBeDisabled();owner.assertCurrent();await dialog(owner).getByRole('button',{name:text.close,exact:true}).click();owner.assertCurrent();}

for(const type of ['DATETIME','DATETIME(6)','TIMESTAMP(6)'])test(type+'通过真实字段窗口开启及移除ON UPDATE，精确默认/旁列保持且不重放',async({},info:TestInfo)=>{
 if(!desktop)throw Error('未取得本例窗口');
 const captured=desktop.ownedDesktopResources(info);
 const owner:CaseOwner={page:captured.page,assertCurrent:()=>{desktop.ownedDesktopResources(info);}};
 const live:Live=await import('./live-helpers');owner.assertCurrent();await live.isolatedDatabase(async c=>{
  owner.assertCurrent();
  /** 观察请求未知或失去归属即保留；只调用一次本例observer，不借退出收尾取消它。 */
  const observe = async <T>(request: () => Promise<T>): Promise<T> => {
    owner.assertCurrent();
    try { const value = await request(); owner.assertCurrent(); return value; }
    catch (reason) { desktop.retainOwnedDesktopResources(info); throw reason; }
  };
  const target='`'+c.database.replaceAll('`','``')+'`.`column_auto_time`';await observe(() => c.observer.query(`CREATE TABLE ${target}(id INT PRIMARY KEY,note VARCHAR(20),updated_at ${type} NULL DEFAULT '2001-01-01 00:00:00' COMMENT '保留时间',big_value DECIMAL(30,6) DEFAULT 12345678901234567890.123456,empty_text VARCHAR(10) DEFAULT '',text_null VARCHAR(10) DEFAULT 'NULL') ENGINE=InnoDB`));owner.assertCurrent();await observe(() => c.observer.query(`INSERT INTO ${target}(id,note) VALUES(1,'原值')`));owner.assertCurrent();
  const read=async()=>{owner.assertCurrent();const [rows]=await observe(() => c.observer.query<RowDataPacket[]>(`SELECT CAST(updated_at AS CHAR) AS timestamp_value,CAST(big_value AS CHAR) AS amount,empty_text,text_null FROM ${target} WHERE id=1`));owner.assertCurrent();return rows[0];};
  const ddl=async()=>{owner.assertCurrent();const [rows]=await observe(() => c.observer.query<RowDataPacket[]>('SHOW CREATE TABLE '+target));owner.assertCurrent();return String(rows[0]['Create Table']);};const original=await ddl(),data=await read();owner.assertCurrent();
  const connection=page(owner).locator('.connection-node').filter({has:page(owner).locator('.connection-row').getByText(c.connectionName,{exact:true})});await connection.locator('.connection-row').hover();owner.assertCurrent();await connection.getByRole('button',{name:'刷新连接',exact:true}).click();owner.assertCurrent();await connection.locator('.database-row').getByRole('button',{name:c.database,exact:true}).click();owner.assertCurrent();await connection.locator('.object-row').getByText('column_auto_time',{exact:true}).click();owner.assertCurrent();await expect(page(owner).locator('.table-tab:visible .loading-overlay')).toHaveCount(0);owner.assertCurrent();
  await change(owner,'expression');owner.assertCurrent();expect(await ddl()).toBe(original);owner.assertCurrent();expect(await read()).toEqual(data);owner.assertCurrent();await confirm(owner);owner.assertCurrent();const enabled=await ddl();owner.assertCurrent();expect(enabled).toMatch(/ON UPDATE current_timestamp/i);expect(await read()).toEqual(data);owner.assertCurrent();
  await observe(() => c.observer.query(`UPDATE ${target} SET note='更新后' WHERE id=1`));owner.assertCurrent();const updated=await read();owner.assertCurrent();expect(updated.timestamp_value).not.toBe(data.timestamp_value);expect({...updated,timestamp_value:data.timestamp_value}).toEqual(data);
  await change(owner,'none');owner.assertCurrent();expect(await ddl()).toBe(enabled);owner.assertCurrent();await confirm(owner);owner.assertCurrent();expect(await ddl()).toBe(original);owner.assertCurrent();await observe(() => c.observer.query(`UPDATE ${target} SET note='再次更新' WHERE id=1`));owner.assertCurrent();expect(await read()).toEqual(updated);owner.assertCurrent();
  const tasks=await page(owner).evaluate(()=>window.dbark.invoke('tasks.list',{}));owner.assertCurrent();expect(tasks.filter(task=>task.kind==='schema.columns.apply')).toHaveLength(2);
 },info);owner.assertCurrent();
});
