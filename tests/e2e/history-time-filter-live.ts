import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test,expect,page,dataDir,quitDesktop,launchDesktop } from './desktop-fixture';
import { LocalStore } from '../../src/main/storage';
import { historyPagesZh as t } from '../../src/renderer/locales/historyPages.zh-CN';
const requireRuntime=createRequire(join(process.cwd(),'package.json'));
/** 仅未来明确开启的离线原生定义；须先证明退出，再使用生产存储写本例合成夹具。 */
export function registerHistoryTimeFilterTests(){
 test('历史真实时间范围端点、坏时间报告、清除及关闭，不执行历史SQL',async()=>{
  await quitDesktop();const store=await LocalStore.open(join(dataDir,'dbark.sqlite'),requireRuntime.resolve('sql.js/dist/sql-wasm.wasm'),{available:()=>false,encrypt:value=>value,decrypt:value=>value});
  try{for(const[id,startedAt]of[['start','2026-10-17T00:00:00Z'],['middle','2026-10-17T12:00:00Z'],['end','2026-10-18T00:00:00Z'],['legacy','2026-10-19']])store.addHistory({id,connectionId:'offline',sql:'UPDATE synthetic SET n=1 -- 只筛选，不执行',startedAt,elapsedMs:1,success:true});}finally{store.close();}await launchDesktop();
  await page.locator('.app-commandbar').getByRole('button',{name:'历史与查询',exact:true}).click();const dialog=page.getByRole('dialog',{name:'历史与保存的查询',exact:true});
  await expect(dialog.getByRole('button',{name:t.refresh,exact:true})).toBeEnabled();await expect(dialog.locator('.history-card')).toHaveCount(4);
  await dialog.getByLabel(t.from,{exact:true}).fill('2026-10-17T00:00:00Z');await dialog.getByLabel(t.until,{exact:true}).fill('2026-10-18T00:00:00Z');await dialog.getByRole('button',{name:t.searchButton,exact:true}).click();
  await expect(dialog.getByRole('button',{name:t.refresh,exact:true})).toBeEnabled();await expect(dialog.locator('.history-card')).toHaveCount(2);await expect(dialog.locator('[data-history-id="start"]')).toBeVisible();await expect(dialog.locator('[data-history-id="middle"]')).toBeVisible();await expect(dialog.getByRole('status',{name:t.pageStatus,exact:true})).toContainText('读取失败1条');
  await dialog.getByRole('button',{name:t.clearTime,exact:true}).click();await dialog.getByRole('button',{name:t.searchButton,exact:true}).click();await expect(dialog.locator('.history-card')).toHaveCount(4);
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.dbark.invoke('tasks.list',{}))).toEqual([]);expect((await page.evaluate(()=>window.dbark.invoke('history.list',{})))).toHaveLength(4);
 });
}
