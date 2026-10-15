import {mkdir,rmdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {RowDataPacket} from 'mysql2/promise';
import {test,expect,page,dataDir} from './desktop-fixture';
import {enabled,isolatedDatabase,openDatabaseQuery,executeSql,writeSql} from './live-helpers';
test.use({trace:'off'});
test('200隔离实例：默认库恢复快照实际写盘失败时不发送用户写入，修复后仍需显式执行',async({},info)=>{
  test.skip(!enabled,'需要显式启用200隔离数据库');test.setTimeout(120000);
  await isolatedDatabase(async({observer,database})=>{
    await observer.query(`CREATE TABLE \`${database}\`.subject(id INT PRIMARY KEY)`);await openDatabaseQuery(database);await executeSql('SELECT 1');const sql='INSERT INTO subject VALUES(21)';await writeSql(sql);
    await expect.poll(()=>page.evaluate(async()=>{const s=await window.dbark.invoke('settings.get',{});return s.tabs.find(tab=>tab.id===s.activeTabId)?.sql;})).toBe(sql);
    const blocked=join(dataDir,'dbark.sqlite.tmp');if(resolve(blocked)!==resolve(dataDir,'dbark.sqlite.tmp'))throw Error('写盘故障目标不符');await mkdir(blocked);
    try{const query=page.locator('.query-tab:visible');await query.getByRole('button',{name:'执行全部',exact:true}).click();await expect(query.getByRole('button',{name:'停止',exact:true})).toBeDisabled();await expect(query.locator('.error-box')).toContainText('未发送本次 SQL');expect(Number((await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${database}\`.subject`))[0][0].n)).toBe(0);await page.screenshot({path:info.outputPath('context-write-failure-no-sql.png')});}
    finally{await rmdir(blocked);}
    expect(Number((await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${database}\`.subject`))[0][0].n)).toBe(0);await executeSql(sql);expect(Number((await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${database}\`.subject`))[0][0].n)).toBe(1);
  },info);
});
