import {test,expect,page,pageErrors} from './desktop-fixture';
import {savedQueryNavigationZh as t} from '../../src/renderer/locales/savedQueryNavigation.zh-CN';

test.skip(process.env.DBARK_W03_SAVED_QUERY_NAVIGATION_TEST!=='1','默认关闭：须ROOT明确启用本地保存查询多处导航专项');
test.use({trace:'off',screenshot:'off',video:'off'});
test.setTimeout(90000);
const dialog=()=>page.getByRole('dialog',{name:'全库搜索：本地保存查询',exact:true});
const query=()=>page.locator('.query-tab:visible');
const navigation=()=>query().getByRole('region',{name:t.title,exact:true});

/** 只准备本机保存查询和不可用的离线来源，不连接服务器或执行正文。 */
async function prepare(sql:string){
 const connection=await page.evaluate(()=>window.dbark.invoke('connections.save',{id:'',name:'W03本地导航来源',group:'',color:'#123456',dialect:'mysql',host:'127.0.0.1',port:1,user:'offline'}));
 const original={id:'constructor',kind:'query' as const,title:'原草稿与结果保留',connectionId:connection.id,sql:'SELECT 9007199254740993 -- 原草稿',databaseContext:{state:'known' as const,database:null}};
 await page.evaluate(async({connection,original,sql})=>{const settings=await window.dbark.invoke('settings.get',{});await window.dbark.invoke('settings.save',{...settings,tabs:[original],activeTabId:original.id});await window.dbark.invoke('queries.save',{id:'w03-navigation',name:'多处导航正文',connectionId:connection.id,databaseContext:{state:'unknown'},sql,updatedAt:''});},{connection,original,sql});
 await page.reload();await expect(page.locator('.app-statusbar')).toBeVisible();return original;
}
/** 沿实际入口检索并摘要复核打开，只读导航不调用SQL执行或直接注入Monaco内容。 */
async function open(keyword:string,mode='contains'){
 await page.locator('.app-commandbar').getByRole('button',{name:'全库搜索',exact:true}).click();
 await page.getByRole('dialog',{name:'全库搜索：结构名称',exact:true}).getByRole('button',{name:'搜索保存查询',exact:true}).click();
 await dialog().getByLabel('本地搜索文字',{exact:true}).fill(keyword);await dialog().getByLabel('本地匹配方式',{exact:true}).selectOption(mode);
 await dialog().getByRole('button',{name:'开始本地搜索',exact:true}).click();await expect(dialog().getByRole('button',{name:'开始本地搜索',exact:true})).toBeEnabled({timeout:20000});
 await dialog().locator('.rdg-row').click();await dialog().getByRole('button',{name:'打开查询（不执行）',exact:true}).click();await expect(dialog()).toHaveCount(0);
 await expect(navigation()).toBeVisible();
}
/** 生产工作台快照只用于核对正文，没有通过脚本替换编辑器或认证回包。 */
async function activeSql(){const settings=await page.evaluate(()=>window.dbark.invoke('settings.get',{}));return settings.tabs.find(tab=>tab.id===settings.activeTabId)?.sql;}

test('多处UTF16与CRLF导航后编辑立即失效，撤销不复活且原草稿零执行保持',async()=>{
 const sql="-- 😀锚点\r\nUPDATE subject SET note='锚点';\r\n-- 锚点",original=await prepare(sql);await open('锚点');
 await expect(navigation().getByRole('status')).toHaveText(t.count(0,3));await expect(query().locator('.saved-query-match')).toHaveCount(3);
 await navigation().getByRole('button',{name:t.next,exact:true}).click();await expect(navigation().getByRole('status')).toHaveText(t.count(1,3));
 await navigation().getByRole('button',{name:t.previous,exact:true}).click();await navigation().getByRole('button',{name:t.previous,exact:true}).click();await expect(navigation().getByRole('status')).toHaveText(t.count(2,3));
 const offset=sql.lastIndexOf('锚点');await page.keyboard.insertText('定位探针');await expect.poll(activeSql).toBe(sql.slice(0,offset)+'定位探针'+sql.slice(offset));
 await expect(navigation().getByRole('status')).toHaveText(t.invalid);await expect(query().locator('.saved-query-match')).toHaveCount(0);
 await page.keyboard.press(`${process.platform==='darwin'?'Meta':'Control'}+z`);await expect.poll(activeSql).toBe(sql);await expect(navigation().getByRole('status')).toHaveText(t.invalid);
 await navigation().getByRole('button',{name:t.close,exact:true}).click();await expect(navigation()).toHaveCount(0);
 const settings=await page.evaluate(()=>window.dbark.invoke('settings.get',{}));expect(settings.tabs.find(tab=>tab.id===original.id)).toEqual(original);
 expect(await page.evaluate(()=>window.dbark.invoke('history.list',{}))).toEqual([]);expect(pageErrors).toEqual([]);
});
test('大量命中明确只显示前200处，关闭高亮后旧控件不能恢复',async()=>{
 await prepare('-- '+ '锚点 '.repeat(210));await open('锚点');await expect(navigation().getByRole('status')).toHaveText(t.count(0,200));await expect(navigation()).toContainText(t.capped(200));
 await navigation().getByRole('button',{name:t.previous,exact:true}).click();await expect(navigation().getByRole('status')).toHaveText(t.count(199,200));
 await navigation().getByRole('button',{name:t.close,exact:true}).click();await expect(navigation()).toHaveCount(0);await expect(query().locator('.saved-query-match')).toHaveCount(0);
 expect(await page.evaluate(()=>window.dbark.invoke('history.list',{}))).toEqual([]);
});
test('Unicode零宽正则可导航末尾，零宽标记不写入SQL',async()=>{
 const sql='-- 😀 😀',original=await prepare(sql);await open('(?=😀)|$','regexp');await expect(navigation().getByRole('status')).toHaveText(t.count(0,3));
 await navigation().getByRole('button',{name:t.previous,exact:true}).click();await expect(navigation().getByRole('status')).toHaveText(t.count(2,3));await expect.poll(activeSql).toBe(sql);
 const settings=await page.evaluate(()=>window.dbark.invoke('settings.get',{}));expect(settings.tabs.find(tab=>tab.id===original.id)).toEqual(original);expect(await page.evaluate(()=>window.dbark.invoke('history.list',{}))).toEqual([]);
});
test('CRLF内部零宽命中明确不可精确定位，不显示两处同点或修改原文',async()=>{
 const sql='a\r\nb',original=await prepare(sql);await open('(?=\\r)|(?=\\n)','regexp');
 await expect(navigation().getByRole('status')).toHaveText(t.unlocatable);await expect(navigation().getByRole('button',{name:t.previous,exact:true})).toHaveCount(0);await expect(navigation().getByRole('button',{name:t.next,exact:true})).toHaveCount(0);
 await expect(query().locator('.saved-query-match')).toHaveCount(0);await expect.poll(activeSql).toBe(sql);
 const settings=await page.evaluate(()=>window.dbark.invoke('settings.get',{}));expect(settings.tabs.find(tab=>tab.id===original.id)).toEqual(original);expect(await page.evaluate(()=>window.dbark.invoke('history.list',{}))).toEqual([]);
 await navigation().getByRole('button',{name:t.close,exact:true}).click();await expect(navigation()).toHaveCount(0);
});
